import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { codeOf } from "@/lib/log";
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

async function removeQuietly(client: SupabaseClient, path: string): Promise<void> {
  try {
    const { error } = await client.storage.from(BUCKET).remove([path]);
    if (error) console.error("slip cleanup failed", codeOf(error));
  } catch {
    console.error("slip cleanup threw");
  }
}

/**
 * Whether a payment_slips row points at `path`, i.e. whether submit_payment_slip committed. null
 * when the lookup itself fails, so nobody can tell.
 */
async function slipRecorded(client: SupabaseClient, path: string): Promise<boolean | null> {
  try {
    const { data, error } = await client.from("payment_slips").select("id").eq("storage_path", path).maybeSingle();
    if (error) {
      console.error("slip lookup failed", codeOf(error));
      return null;
    }
    return data !== null;
  } catch {
    console.error("slip lookup threw");
    return null;
  }
}

/**
 * The database call failed without a clear answer: it may have committed before the response was
 * lost. The file is deleted only once a lookup shows no row points at it; a committed slip is the
 * customer's success, and while unsure the file stays (an orphan is better than a slip without its
 * image).
 */
async function settleUnclearSubmit(
  client: SupabaseClient,
  path: string,
): Promise<ActionResult<{ status: "payment_review" }>> {
  const recorded = await slipRecorded(client, path);
  if (recorded === true) return ok({ status: "payment_review" });
  if (recorded === false) await removeQuietly(client, path);
  return refuse("UPLOAD_FAILED");
}

/**
 * Order of work: find the order, check status and expiry, rate limit per order, validate the file,
 * upload, then submit_payment_slip. If the database refuses, the new file is deleted again, so a
 * failed attempt leaves neither a status change nor an orphan in Storage. If the call fails without
 * a clear answer, see settleUnclearSubmit.
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

  let result: { ok?: unknown; code?: unknown } | null;
  try {
    const { data, error } = await client.rpc("submit_payment_slip", {
      p_order_id: order.id,
      p_storage_path: path,
    });
    if (error) {
      console.error("submit_payment_slip failed", codeOf(error));
      return await settleUnclearSubmit(client, path);
    }
    result = data as { ok?: unknown; code?: unknown } | null;
  } catch {
    console.error("submit_payment_slip threw");
    return await settleUnclearSubmit(client, path);
  }

  if (result?.ok === true) return ok({ status: "payment_review" });

  // A definite refusal: the function returned without inserting anything.
  const code = result?.code;
  if (code === "NOT_FOUND" || code === "EXPIRED" || code === "INVALID_STATUS") {
    await removeQuietly(client, path);
    return refuse(code);
  }
  console.error("submit_payment_slip returned an unexpected shape");
  return await settleUnclearSubmit(client, path);
}
