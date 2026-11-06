import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAllowed } from "@/lib/rate-limit";
import { fail, ok, type ActionResult } from "@/lib/result";
import { validateSlipFile } from "@/lib/slip-file";
import { findOrderByToken, presentStatus } from "./queries";
import { SLIP_MESSAGES, type SlipFailureCode } from "./slip-messages";

export type SubmitSlipDeps = {
  client: SupabaseClient;
  rateLimitSalt: string;
};

const BUCKET = "payment-slips";

function refuse(code: SlipFailureCode): ActionResult<never> {
  return fail(code, SLIP_MESSAGES[code]);
}

/** A code that is safe to log. Error messages can carry storage paths, so they are never logged. */
function codeOf(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const e = error as { code?: unknown; statusCode?: unknown };
    if (typeof e.code === "string") return e.code;
    if (typeof e.statusCode === "string" || typeof e.statusCode === "number") return String(e.statusCode);
  }
  return "unknown";
}

async function removeQuietly(client: SupabaseClient, path: string): Promise<void> {
  try {
    const { error } = await client.storage.from(BUCKET).remove([path]);
    if (error) console.error("slip cleanup failed", codeOf(error));
  } catch {
    console.error("slip cleanup threw");
  }
}

/**
 * Order of work: find the order, check status and expiry, rate limit per order, validate the file,
 * upload, then submit_payment_slip. If the database call fails, the new file is deleted again, so
 * a failed attempt leaves neither a status change nor an orphan in Storage.
 */
export async function submitSlip(
  token: string,
  file: File,
  deps: SubmitSlipDeps,
): Promise<ActionResult<{ status: "payment_review" }>> {
  const { client } = deps;
  const order = await findOrderByToken(client, token);
  if (!order) return refuse("NOT_FOUND");

  const status = presentStatus(order.status, order.expiresAt);
  if (status === "expired") return refuse("EXPIRED");
  if (status !== "awaiting_payment") return refuse("INVALID_STATUS");

  if (!(await isAllowed(client, "submit_slip", order.id, deps.rateLimitSalt))) {
    return refuse("RATE_LIMITED");
  }

  const checked = await validateSlipFile(file);
  if (!checked.ok) return refuse(checked.code === "EMPTY" ? "UNSUPPORTED_TYPE" : checked.code);

  const path = `${order.id}/${randomUUID()}.${checked.ext}`;
  try {
    const upload = await client.storage
      .from(BUCKET)
      .upload(path, checked.bytes, { contentType: checked.mime, upsert: false });
    if (upload.error) {
      console.error("slip upload failed", codeOf(upload.error));
      return refuse("UPLOAD_FAILED");
    }
  } catch {
    console.error("slip upload threw");
    return refuse("UPLOAD_FAILED");
  }

  try {
    const { data, error } = await client.rpc("submit_payment_slip", {
      p_order_id: order.id,
      p_storage_path: path,
    });
    if (error) {
      console.error("submit_payment_slip failed", codeOf(error));
      await removeQuietly(client, path);
      return refuse("UPLOAD_FAILED");
    }
    const result = data as { ok?: unknown; code?: unknown } | null;
    if (result?.ok === true) return ok({ status: "payment_review" });

    await removeQuietly(client, path);
    const code = result?.code;
    if (code === "NOT_FOUND" || code === "EXPIRED" || code === "INVALID_STATUS") return refuse(code);
    console.error("submit_payment_slip returned an unexpected shape");
    return refuse("UPLOAD_FAILED");
  } catch {
    console.error("submit_payment_slip threw");
    await removeQuietly(client, path);
    return refuse("UPLOAD_FAILED");
  }
}
