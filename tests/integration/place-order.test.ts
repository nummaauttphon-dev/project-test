import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { placeOrder, type PlaceOrderData } from "@/features/checkout/place-order";
import { deriveOrderToken, hashOrderToken } from "@/lib/order-token";
import { generateIdempotencyKey } from "@/lib/idempotency";
import type { ActionResult } from "@/lib/result";
import { adminClient, resetData, seedProduct, type Product } from "../helpers/supabase";

const SECRET = "test-token-secret";
const SALT = "test-rate-limit-salt";
const client = adminClient();
let ipCounter = 0;

beforeEach(resetData);
afterEach(() => {
  vi.restoreAllMocks();
});

function deps(overrides: Partial<{ client: SupabaseClient; ip: string }> = {}) {
  return { client, ip: `10.0.0.${++ipCounter}`, tokenSecret: SECRET, rateLimitSalt: SALT, ...overrides };
}

function input(items: { productId: string; quantity: number }[], total: number, extra: Record<string, unknown> = {}) {
  return {
    customerName: "สมชาย ใจดี",
    phone: "081-234-5678",
    shippingAddress: "123/45 ถนนสุขุมวิท กรุงเทพมหานคร 10110",
    idempotencyKey: generateIdempotencyKey(),
    expectedTotalSatang: total,
    items,
    ...extra,
  };
}

function one(product: Product, quantity = 1, extra: Record<string, unknown> = {}) {
  return input([{ productId: product.id, quantity }], product.price_satang * quantity + 5000, extra);
}

function data(result: ActionResult<PlaceOrderData>): PlaceOrderData {
  if (!result.ok) throw new Error(`expected ok, got ${result.code}`);
  return result.data;
}

async function orderRows() {
  const { data: rows, error } = await client.from("orders").select("*");
  if (error) throw error;
  return rows ?? [];
}

describe("placeOrder", () => {
  it("returns the same token when the same key is retried", async () => {
    const product = await seedProduct();
    const body = one(product);
    const first = data(await placeOrder(body, deps()));
    const second = data(await placeOrder(body, deps()));
    expect(first.kind).toBe("created");
    expect(second).toEqual(first);
    if (first.kind === "created") {
      expect(first.token).toBe(deriveOrderToken(body.idempotencyKey, SECRET));
    }
    expect(await orderRows()).toHaveLength(1);
  });

  it("stores only the hash of the token", async () => {
    const product = await seedProduct();
    const result = data(await placeOrder(one(product), deps()));
    if (result.kind !== "created") throw new Error("expected created");
    const rows = await orderRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBe(hashOrderToken(result.token));
    expect(JSON.stringify(rows[0])).not.toContain(result.token);
    const { data: items } = await client.from("order_items").select("*");
    expect(JSON.stringify(items)).not.toContain(result.token);
  });

  it("returns field errors for invalid input", async () => {
    const product = await seedProduct();
    const result = await placeOrder(one(product, 1, { customerName: "   ", phone: "123" }), deps());
    expect(result).toMatchObject({ ok: false, code: "VALIDATION" });
    if (result.ok) return;
    expect(result.fieldErrors).toMatchObject({ customerName: "กรุณากรอกชื่อ", phone: "เบอร์โทรไม่ถูกต้อง" });
    expect(await orderRows()).toHaveLength(0);
  });

  it("returns kind changed with details and creates no order", async () => {
    const product = await seedProduct({ price_satang: 10000, stock_quantity: 5 });
    const body = one(product, 2);
    await client.from("products").update({ price_satang: 12000 }).eq("id", product.id);
    const result = data(await placeOrder(body, deps()));
    expect(result).toMatchObject({ kind: "changed", currentTotalSatang: 24000 + 5000 });
    if (result.kind !== "changed") return;
    expect(result.changes).toEqual([
      { product_id: product.id, reason: "price_changed", available_quantity: 5, current_price_satang: 12000 },
    ]);
    expect(await orderRows()).toHaveLength(0);
  });

  it("reports insufficient stock and hides the price of an unavailable product", async () => {
    const low = await seedProduct({ stock_quantity: 1, price_satang: 7000 });
    const hidden = await seedProduct({ is_active: false, price_satang: 99900 });
    const body = input(
      [
        { productId: low.id, quantity: 3 },
        { productId: hidden.id, quantity: 1 },
      ],
      30000,
    );
    const result = data(await placeOrder(body, deps()));
    if (result.kind !== "changed") throw new Error("expected changed");
    const byId = new Map(result.changes.map((c) => [c.product_id, c]));
    expect(byId.get(low.id)).toMatchObject({
      reason: "insufficient_stock",
      available_quantity: 1,
      current_price_satang: 7000,
    });
    expect(byId.get(hidden.id)).toEqual({
      product_id: hidden.id,
      reason: "unavailable",
      available_quantity: 0,
      current_price_satang: null,
    });
    expect(JSON.stringify(result)).not.toContain("99900");
    expect(await orderRows()).toHaveLength(0);
  });

  it("merges duplicate product lines before ordering", async () => {
    const product = await seedProduct({ price_satang: 1000 });
    const body = input(
      [
        { productId: product.id, quantity: 3 },
        { productId: product.id, quantity: 4 },
      ],
      7000 + 5000,
    );
    expect(data(await placeOrder(body, deps())).kind).toBe("created");
    const { data: items } = await client.from("order_items").select("quantity");
    expect(items).toEqual([{ quantity: 7 }]);
  });

  it("rejects a merged quantity over 10", async () => {
    const product = await seedProduct();
    const body = input(
      [
        { productId: product.id, quantity: 6 },
        { productId: product.id, quantity: 5 },
      ],
      1,
    );
    const result = await placeOrder(body, deps());
    expect(result).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await orderRows()).toHaveLength(0);
  });

  it("blocks the 11th attempt in an hour", async () => {
    const product = await seedProduct({ stock_quantity: 100 });
    const d = deps();
    for (let i = 0; i < 10; i++) {
      expect(data(await placeOrder(one(product), d)).kind).toBe("created");
    }
    const blocked = await placeOrder(one(product), d);
    expect(blocked).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(await orderRows()).toHaveLength(10);
    // Another address is not affected.
    expect(data(await placeOrder(one(product), deps())).kind).toBe("created");
  });

  it("uses the subject unknown when the IP is missing", async () => {
    const rpc = vi.fn(async () => ({ data: false, error: null }));
    const stub = { rpc } as unknown as SupabaseClient;
    const product = await seedProduct();
    const result = await placeOrder(one(product), deps({ client: stub, ip: "" }));
    expect(result).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(rpc).toHaveBeenCalledWith(
      "check_rate_limit",
      expect.objectContaining({ p_key_hash: createHmac("sha256", SALT).update("unknown").digest("hex") }),
    );
  });

  it("does not leak database errors", async () => {
    const logged: unknown[][] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => {
      logged.push(args);
    });
    const stub = {
      rpc: async (name: string) =>
        name === "check_rate_limit"
          ? { data: true, error: null }
          : {
              data: null,
              error: {
                code: "23505",
                message: "duplicate key value",
                details: "Key (token_hash)=(deadbeefcafe) already exists.",
              },
            },
    } as unknown as SupabaseClient;
    const product = await seedProduct();
    const result = await placeOrder(one(product), deps({ client: stub }));
    expect(result).toMatchObject({ ok: false, code: "UNEXPECTED" });
    if (result.ok) return;
    expect(result.message).toMatch(/[ก-๙]/);
    expect(result.message).not.toMatch(/duplicate|token_hash|deadbeef|23505/);
    const text = JSON.stringify(logged);
    expect(text).not.toContain("deadbeef");
    expect(text).not.toContain("token_hash");
    expect(text).toContain("23505");
  });

  it("returns UNEXPECTED when the database answers with an unknown shape", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const stub = {
      rpc: async (name: string) =>
        name === "check_rate_limit" ? { data: true, error: null } : { data: { status: "weird" }, error: null },
    } as unknown as SupabaseClient;
    const product = await seedProduct();
    expect(await placeOrder(one(product), deps({ client: stub }))).toMatchObject({
      ok: false,
      code: "UNEXPECTED",
    });
  });
});

describe("placeOrder retry with different contact data", () => {
  it("reports no mismatch for a new order and for an identical retry", async () => {
    const product = await seedProduct();
    const body = one(product);
    expect(data(await placeOrder(body, deps()))).toMatchObject({ kind: "created", contactMismatch: false });
    // Same data, only spacing differs after normalization.
    const retry = { ...body, customerName: "  สมชาย  ใจดี ", phone: "0812345678" };
    expect(data(await placeOrder(retry, deps()))).toMatchObject({ kind: "created", contactMismatch: false });
  });

  it.each([
    ["customerName", "สมหญิง ใจงาม"],
    ["phone", "0899999999"],
    ["shippingAddress", "999 ถนนใหม่ แขวงใหม่ เขตใหม่ เชียงใหม่ 50000"],
  ])("flags a retry that changes %s and returns no stored values", async (field, value) => {
    const product = await seedProduct();
    const body = one(product);
    await placeOrder(body, deps());
    const result = data(await placeOrder({ ...body, [field]: value }, deps()));
    expect(result).toMatchObject({ kind: "created", contactMismatch: true });
    expect(Object.keys(result).sort()).toEqual(["contactMismatch", "kind", "token"]);
    const rows = await orderRows();
    expect(rows).toHaveLength(1);
    expect(rows[0][field === "customerName" ? "customer_name" : field === "phone" ? "phone" : "shipping_address"]).not.toBe(value);
  });
});
