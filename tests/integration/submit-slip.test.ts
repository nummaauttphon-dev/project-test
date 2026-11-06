import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOrderViewByToken } from "@/features/orders/queries";
import { submitSlip } from "@/features/orders/submit-slip";
import { adminClient, resetData } from "../helpers/supabase";
import { newToken, seedOrderWithToken, seedRejectedSlip, slipObjects } from "../helpers/orders";

const SALT = "test-rate-limit-salt";
const PAST = "2020-01-01T00:00:00.000Z";
const client = adminClient();

beforeEach(resetData);
afterEach(() => {
  vi.restoreAllMocks();
});

function fixture(name: string, type: string): File {
  const bytes = readFileSync(path.join(import.meta.dirname, "..", "fixtures", name));
  return new File([new Uint8Array(bytes)], name, { type });
}
const png = () => fixture("real.png", "image/png");
const heic = () => fixture("photo.heic", "image/heic");
const deps = (c: SupabaseClient = client) => ({ client: c, rateLimitSalt: SALT });

async function statusOf(id: string): Promise<string> {
  const { data, error } = await client.from("orders").select("status").eq("id", id).single();
  if (error || !data) throw new Error(error?.message);
  return data.status as string;
}

async function slipCount(orderId: string): Promise<number> {
  const { count, error } = await client
    .from("payment_slips")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

type StorageResult = Promise<{ data: null; error: { message: string } }>;
type RpcResult = Promise<{ data: null; error: { code: string; message: string } }>;
type Override = {
  upload?: () => StorageResult;
  remove?: () => StorageResult;
  /** Return a result to replace the call, or null to let the real one run. */
  rpc?: (fn: string) => RpcResult | null;
};

const failSubmit = (fn: string): RpcResult | null =>
  fn === "submit_payment_slip" ? Promise.resolve({ data: null, error: { code: "XX000", message: "boom" } }) : null;

/** The real client, with chosen storage and rpc calls replaced. */
function patched(override: Override): SupabaseClient {
  return new Proxy(client, {
    get(target, prop) {
      if (prop === "storage") {
        return {
          from: (bucket: string) =>
            new Proxy(target.storage.from(bucket), {
              get(real, key) {
                if (key === "upload" && override.upload) return override.upload;
                if (key === "remove" && override.remove) return override.remove;
                const value = Reflect.get(real, key) as unknown;
                return typeof value === "function" ? value.bind(real) : value;
              },
            }),
        };
      }
      if (prop === "rpc" && override.rpc) {
        const realRpc = target.rpc.bind(target) as (...args: unknown[]) => unknown;
        return (fn: string, args: unknown) => override.rpc?.(fn) ?? realRpc(fn, args);
      }
      const value = Reflect.get(target, prop) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("getOrderViewByToken", () => {
  it("view never contains full name, address or phone", async () => {
    const { token } = await seedOrderWithToken();
    const view = await getOrderViewByToken(client, token);
    expect(view).not.toBeNull();
    const json = JSON.stringify(view);
    expect(json).not.toContain("ลูกค้าทดสอบ");
    expect(json).not.toContain("0812345678");
    expect(json).not.toContain("ถนนทดสอบ");
    expect(json).not.toContain("token_hash");
    expect(view?.maskedName).toBe("ลู***");
    expect(view?.maskedAddress).toBe("••• 10100");
    expect(view?.items).toEqual([{ name: "แก้วกาแฟเซรามิก", unitPriceSatang: 10000, quantity: 1 }]);
    expect(view).toMatchObject({ subtotalSatang: 10000, shippingFeeSatang: 5000, totalSatang: 15000 });
    expect(Object.keys(view ?? {}).sort()).toEqual(
      [
        "contactUrl",
        "expiresAt",
        "items",
        "maskedAddress",
        "maskedName",
        "orderNumber",
        "rejectedReason",
        "shippingFeeSatang",
        "status",
        "subtotalSatang",
        "totalSatang",
        "trackingNumber",
      ].sort(),
    );
  });

  it("view treats past expires_at as expired before cron runs", async () => {
    const { order, token } = await seedOrderWithToken({ expires_at: PAST });
    expect(await statusOf(order.id)).toBe("awaiting_payment");
    expect((await getOrderViewByToken(client, token))?.status).toBe("expired");
  });

  it("does not treat a past expires_at as expired once the slip is under review", async () => {
    const { token } = await seedOrderWithToken({ expires_at: PAST, status: "payment_review" });
    expect((await getOrderViewByToken(client, token))?.status).toBe("payment_review");
  });

  it("returns null for unknown token", async () => {
    await seedOrderWithToken();
    expect(await getOrderViewByToken(client, newToken())).toBeNull();
    expect(await getOrderViewByToken(client, "")).toBeNull();
  });

  it("shows the latest rejection reason only while awaiting payment", async () => {
    const { order, token } = await seedOrderWithToken();
    await seedRejectedSlip(order.id, "ยอดเงินไม่ตรง");
    expect((await getOrderViewByToken(client, token))?.rejectedReason).toBe("ยอดเงินไม่ตรง");
    await client.from("orders").update({ status: "cancelled" }).eq("id", order.id);
    expect((await getOrderViewByToken(client, token))?.rejectedReason).toBeNull();
  });

  it("only exposes http and https contact links", async () => {
    const { token } = await seedOrderWithToken();
    const setContact = (value: string) => client.from("store_settings").update({ contact_url: value }).eq("id", 1);
    const contact = async () => (await getOrderViewByToken(client, token))?.contactUrl;
    await setContact("javascript:alert(1)");
    expect(await contact()).toBeNull();
    await setContact("data:text/html,x");
    expect(await contact()).toBeNull();
    await setContact("not a url");
    expect(await contact()).toBeNull();
    await setContact("");
    expect(await contact()).toBeNull();
    await setContact("https://line.me/R/ti/p/@shop");
    expect(await contact()).toBe("https://line.me/R/ti/p/@shop");
    await setContact("http://example.com/contact");
    expect(await contact()).toBe("http://example.com/contact");
    await setContact("");
  });
});

describe("submitSlip", () => {
  it("uploads slip to private bucket and moves to payment_review", async () => {
    const { order, token } = await seedOrderWithToken();
    const result = await submitSlip(token, png(), deps());
    expect(result).toEqual({ ok: true, data: { status: "payment_review" } });
    expect(await statusOf(order.id)).toBe("payment_review");

    const paths = await slipObjects(order.id);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatch(new RegExp(`^${order.id}/[0-9a-f-]{36}\\.png$`));
    const { data: slips } = await client.from("payment_slips").select("storage_path, review_status");
    expect(slips).toEqual([{ storage_path: paths[0], review_status: "pending" }]);

    const publicAttempt = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/payment-slips/${paths[0]}`,
    );
    expect(publicAttempt.ok).toBe(false);
  });

  it("removes uploaded file if submit_payment_slip fails", async () => {
    const { order, token } = await seedOrderWithToken();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await submitSlip(token, png(), deps(patched({ rpc: failSubmit })));
    expect(result).toMatchObject({ ok: false, code: "UPLOAD_FAILED" });
    expect(await slipObjects(order.id)).toEqual([]);
    expect(await statusOf(order.id)).toBe("awaiting_payment");
    expect(await slipCount(order.id)).toBe(0);
    expect(error.mock.calls.flat().join(" ")).not.toContain(token);
  });

  it("removes the file when the order changes between the pre-check and the database call", async () => {
    const { order, token } = await seedOrderWithToken();
    const racing = patched({
      rpc: (fn) => {
        if (fn !== "submit_payment_slip") return null;
        // Runs right before the real call would: the order is cancelled by someone else first.
        return client
          .from("orders")
          .update({ status: "cancelled" })
          .eq("id", order.id)
          .then(() =>
            client.rpc("submit_payment_slip", { p_order_id: order.id, p_storage_path: "x" }),
          ) as unknown as RpcResult;
      },
    });
    const result = await submitSlip(token, png(), deps(racing));
    expect(result).toMatchObject({ ok: false, code: "INVALID_STATUS" });
    expect(await slipObjects(order.id)).toEqual([]);
    expect(await slipCount(order.id)).toBe(0);
  });

  it("a failure to delete the file keeps the customer message and logs only a code", async () => {
    const { order, token } = await seedOrderWithToken();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await submitSlip(
      token,
      png(),
      deps(
        patched({
          rpc: failSubmit,
          remove: () => Promise.resolve({ data: null, error: { message: `cannot remove ${order.id}/secret.png` } }),
        }),
      ),
    );
    expect(result).toMatchObject({ ok: false, code: "UPLOAD_FAILED" });
    expect(error).toHaveBeenCalled();
    const logged = error.mock.calls.flat().join(" ");
    expect(logged).not.toContain(order.id);
    expect(logged).not.toContain("secret.png");
    expect(logged).not.toContain(token);
  });

  it("rejects HEIC with guidance", async () => {
    const { order, token } = await seedOrderWithToken();
    const result = await submitSlip(token, heic(), deps());
    expect(result).toMatchObject({ ok: false, code: "HEIC" });
    if (!result.ok) {
      expect(result.message).toContain("ภาพหน้าจอ");
      expect(result.message).toContain("JPEG");
    }
    expect(await slipObjects(order.id)).toEqual([]);
    expect(await statusOf(order.id)).toBe("awaiting_payment");
  });

  it("rejects files that are too large, naming 4 MB, and other types", async () => {
    const { token } = await seedOrderWithToken();
    const big = new File([new Uint8Array(4_194_305)], "big.png", { type: "image/png" });
    const tooLarge = await submitSlip(token, big, deps());
    expect(tooLarge).toMatchObject({ ok: false, code: "TOO_LARGE" });
    if (!tooLarge.ok) expect(tooLarge.message).toContain("4 MB");

    const text = new File(["<svg/>"], "x.png", { type: "image/png" });
    expect(await submitSlip(token, text, deps())).toMatchObject({ ok: false, code: "UNSUPPORTED_TYPE" });
    expect(await submitSlip(token, new File([], "e.png", { type: "image/png" }), deps())).toMatchObject({
      ok: false,
      code: "UNSUPPORTED_TYPE",
    });
  });

  it("answers NOT_FOUND for an unknown token", async () => {
    expect(await submitSlip(newToken(), png(), deps())).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("refuses an expired order before cron has run and says to contact the shop", async () => {
    const { order, token } = await seedOrderWithToken({ expires_at: PAST });
    const result = await submitSlip(token, png(), deps());
    expect(result).toMatchObject({ ok: false, code: "EXPIRED" });
    if (!result.ok) expect(result.message).toContain("ติดต่อร้าน");
    expect(await slipObjects(order.id)).toEqual([]);
    expect(await statusOf(order.id)).toBe("awaiting_payment");
  });

  it("refuses an order that is not awaiting payment", async () => {
    const { order, token } = await seedOrderWithToken({ status: "payment_review" });
    expect(await submitSlip(token, png(), deps())).toMatchObject({ ok: false, code: "INVALID_STATUS" });
    expect(await slipObjects(order.id)).toEqual([]);
  });

  it("blocks the 11th slip attempt per order", async () => {
    const { token } = await seedOrderWithToken();
    const junk = () => new File(["not an image"], "x.png", { type: "image/png" });
    for (let i = 0; i < 10; i++) {
      expect(await submitSlip(token, junk(), deps())).toMatchObject({ code: "UNSUPPORTED_TYPE" });
    }
    expect(await submitSlip(token, png(), deps())).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    // Another order is not affected.
    const other = await seedOrderWithToken();
    expect(await submitSlip(other.token, png(), deps())).toMatchObject({ ok: true });
  });

  it("does not change status when upload fails", async () => {
    const { order, token } = await seedOrderWithToken();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await submitSlip(
      token,
      png(),
      deps(patched({ upload: () => Promise.resolve({ data: null, error: { message: "storage down" } }) })),
    );
    expect(result).toMatchObject({ ok: false, code: "UPLOAD_FAILED" });
    expect(await statusOf(order.id)).toBe("awaiting_payment");
    expect(await slipCount(order.id)).toBe(0);
    expect(error).toHaveBeenCalled();
  });

  it("lets a customer upload again after a rejection", async () => {
    const { order, token } = await seedOrderWithToken();
    await seedRejectedSlip(order.id, "ยอดเงินไม่ตรง");
    expect(await submitSlip(token, png(), deps())).toMatchObject({ ok: true });
    expect(await statusOf(order.id)).toBe("payment_review");
  });
});
