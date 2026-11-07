import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminUser, deleteTestUsers, type TestUser } from "../helpers/admin";
import { connect } from "../helpers/pg";
import { seedPendingSlip } from "../helpers/orders";
import { adminClient, resetData, seedOrder, seedProduct } from "../helpers/supabase";

const auth = vi.hoisted(() => ({ userId: "" }));

vi.mock("@/features/admin/auth", () => ({
  requireAdmin: async () => ({ ok: true, userId: auth.userId }),
}));
vi.mock("next/cache", () => ({ refresh: () => {} }));

import { cancelOrderAction } from "@/features/admin/order-actions";

const PNG = readFileSync(path.join(import.meta.dirname, "..", "fixtures", "real.png"));

let admin: TestUser;

beforeAll(async () => {
  await deleteTestUsers();
  admin = await createAdminUser();
  auth.userId = admin.id;
});

afterAll(async () => {
  // Reviewed slips reference the admin (ON DELETE RESTRICT), so they go first.
  await resetData();
  await deleteTestUsers();
});

beforeEach(async () => {
  await resetData();
});

async function orderState(orderId: string) {
  const { data, error } = await adminClient()
    .from("orders")
    .select("status, updated_at, expires_at, terminal_at")
    .eq("id", orderId)
    .single();
  if (error) throw error;
  return data;
}

async function stockOf(productId: string): Promise<number> {
  const { data, error } = await adminClient().from("products").select("stock_quantity").eq("id", productId).single();
  if (error) throw error;
  return Number(data.stock_quantity);
}

async function slipStatuses(orderId: string): Promise<string[]> {
  const { data, error } = await adminClient().from("payment_slips").select("review_status").eq("order_id", orderId);
  if (error) throw error;
  return (data ?? []).map((row) => String(row.review_status));
}

/** An order in payment_review holding 2 of a product with 3 left, and a pending slip. */
async function seedReviewWithStock() {
  const product = await seedProduct({ stock_quantity: 3 });
  const order = await seedOrder({ status: "payment_review" });
  const items = await adminClient()
    .from("order_items")
    .insert({ order_id: order.id, product_id: product.id, product_name: product.name, unit_price_satang: 10000, quantity: 2 });
  if (items.error) throw items.error;
  await seedPendingSlip(order.id, PNG);
  return { product, order };
}

describe("transition_order p_expected_status", () => {
  it("refuses with STATUS_CHANGED and changes nothing when the status moved on", async () => {
    const { product, order } = await seedReviewWithStock();
    const before = await orderState(order.id);

    const { data, error } = await adminClient().rpc("transition_order", {
      p_order_id: order.id,
      p_to: "cancelled",
      p_actor: admin.id,
      p_expected_status: "paid",
    });
    expect(error).toBeNull();
    expect(data).toEqual({ ok: false, code: "STATUS_CHANGED" });
    expect(await orderState(order.id)).toEqual(before);
    expect(await stockOf(product.id)).toBe(3);
    expect(await slipStatuses(order.id)).toEqual(["pending"]);
  });

  it("applies the transition when the status is the expected one", async () => {
    const { order } = await seedReviewWithStock();
    const { data, error } = await adminClient().rpc("transition_order", {
      p_order_id: order.id,
      p_to: "paid",
      p_actor: admin.id,
      p_expected_status: "payment_review",
    });
    expect(error).toBeNull();
    expect(data).toEqual({ ok: true, status: "paid" });
  });

  it("still answers NOT_FOUND for an unknown order", async () => {
    const { data } = await adminClient().rpc("transition_order", {
      p_order_id: "00000000-0000-4000-8000-000000000000",
      p_to: "cancelled",
      p_actor: admin.id,
      p_expected_status: "paid",
    });
    expect(data).toEqual({ ok: false, code: "NOT_FOUND" });
  });
});

describe("cancelOrderAction from a stale page", () => {
  it("refuses to cancel an order that became paid after the page showed payment_review", async () => {
    const { product, order } = await seedReviewWithStock();
    // The page renders: payment_review, with the softer warning.
    const shown = "payment_review";

    // Meanwhile another tab approves the slip.
    const approved = await adminClient().rpc("transition_order", { p_order_id: order.id, p_to: "paid", p_actor: admin.id });
    expect(approved.data).toEqual({ ok: true, status: "paid" });
    const before = await orderState(order.id);

    const result = await cancelOrderAction(order.id, shown);
    expect(result).toMatchObject({ ok: false, code: "STATUS_CHANGED" });
    if (!result.ok) expect(result.message).toContain("โหลดหน้าใหม่");

    expect(await orderState(order.id)).toEqual(before);
    expect(before.status).toBe("paid");
    expect(await stockOf(product.id)).toBe(3);
  });

  it("cancels and restocks when the page's status is still current", async () => {
    const { product, order } = await seedReviewWithStock();
    expect(await cancelOrderAction(order.id, "payment_review")).toEqual({ ok: true, data: { status: "cancelled" } });
    expect((await orderState(order.id)).status).toBe("cancelled");
    expect(await stockOf(product.id)).toBe(5);
  });
});

describe("admin_dashboard_stats", () => {
  it("grants EXECUTE to service_role only and pins search_path", async () => {
    const client = await connect();
    try {
      const { rows } = await client.query<Record<string, unknown>>(
        `select
           has_function_privilege('public', $1::regprocedure, 'execute') as public_exec,
           has_function_privilege('anon', $1::regprocedure, 'execute') as anon_exec,
           has_function_privilege('authenticated', $1::regprocedure, 'execute') as auth_exec,
           has_function_privilege('service_role', $1::regprocedure, 'execute') as service_exec,
           (select p.proconfig from pg_proc p where p.oid = $1::regprocedure) as config,
           (select p.prosecdef from pg_proc p where p.oid = $1::regprocedure) as definer`,
        ["public.admin_dashboard_stats()"],
      );
      expect(rows[0]).toEqual({
        public_exec: false,
        anon_exec: false,
        auth_exec: false,
        service_exec: true,
        config: ['search_path=""'],
        definer: false,
      });
    } finally {
      await client.end();
    }
  });

  it("returns the three numbers from one call", async () => {
    await seedOrder({ status: "payment_review", total_satang: 1 });
    await seedOrder({ status: "paid", total_satang: 200 });
    await seedOrder({ status: "shipped", total_satang: 3000 });
    await seedOrder({ status: "cancelled", total_satang: 40000 });
    const { data, error } = await adminClient().rpc("admin_dashboard_stats");
    expect(error).toBeNull();
    expect(data).toEqual({ pending_review: 1, paid_orders: 2, revenue_satang: 3200 });
  });
});
