import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connect, waitUntilBlocked } from "../helpers/pg";
import {
  adminClient,
  anonClient,
  resetData,
  seedOrder,
  seedProduct,
  type Product,
} from "../helpers/supabase";

const SHIPPING = 5000;
const DEFAULT_WINDOW_MINUTES = 1440;
const PAST = "2020-01-01T00:00:00.000Z";

const STATUSES = [
  "awaiting_payment",
  "payment_review",
  "paid",
  "shipped",
  "expired",
  "cancelled",
] as const;
type Status = (typeof STATUSES)[number];

// What transition_order accepts: the spec table without payment_review and expired, which only
// submit_payment_slip and expire_orders may enter.
const ALLOWED: [Status, Status][] = [
  ["awaiting_payment", "cancelled"],
  ["payment_review", "paid"],
  ["payment_review", "awaiting_payment"],
  ["payment_review", "cancelled"],
  ["paid", "shipped"],
  ["paid", "cancelled"],
];
const forbiddenTransitions: [Status, Status][] = STATUSES.flatMap((from) =>
  STATUSES.filter((to) => !ALLOWED.some(([f, t]) => f === from && t === to)).map(
    (to): [Status, Status] => [from, to],
  ),
);

const BLANKS: [string, string | null][] = [
  ["null", null],
  ["empty", ""],
  ["spaces", "   "],
  ["mixed whitespace", " \t\r\n "],
];

const SIGNATURES = [
  "public.submit_payment_slip(uuid,text)",
  "public.transition_order(uuid,public.order_status,uuid,text,text,public.order_status)",
  "public.set_tracking_number(uuid,text)",
  "public.expire_orders()",
  "public.restock_orders(uuid[])",
  "public.trim_to_null(text)",
];

type Result = { ok: boolean; code?: string; status?: Status };
type OrderRow = {
  id: string;
  status: Status;
  expires_at: string;
  tracking_number: string | null;
  terminal_at: string | null;
  updated_at: string;
};
type SlipRow = {
  id: string;
  storage_path: string;
  review_status: "pending" | "approved" | "rejected";
  reject_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
};

async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await adminClient().rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.code} ${error.message}`);
  return data as T;
}

function submit(orderId: string, path: string = `${orderId}/${randomUUID()}.png`): Promise<Result> {
  return callRpc("submit_payment_slip", { p_order_id: orderId, p_storage_path: path });
}

function setTracking(orderId: string, tracking: string | null): Promise<Result> {
  return callRpc("set_tracking_number", { p_order_id: orderId, p_tracking_number: tracking });
}

function expireOrders(): Promise<number> {
  return callRpc("expire_orders", {});
}

async function stockOf(id: string): Promise<number> {
  const { data, error } = await adminClient()
    .from("products")
    .select("stock_quantity")
    .eq("id", id)
    .single();
  if (error || !data) throw new Error(`stockOf: ${error?.message}`);
  return data.stock_quantity as number;
}

async function orderRow(id: string): Promise<OrderRow> {
  const { data, error } = await adminClient().from("orders").select("*").eq("id", id).single();
  if (error || !data) throw new Error(`orderRow: ${error?.message}`);
  return data as OrderRow;
}

async function slipsOf(orderId: string): Promise<SlipRow[]> {
  const { data, error } = await adminClient()
    .from("payment_slips")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at");
  if (error || !data) throw new Error(`slipsOf: ${error?.message}`);
  return data as SlipRow[];
}

async function setExpiresAt(id: string, value: string): Promise<void> {
  const { error } = await adminClient().from("orders").update({ expires_at: value }).eq("id", id);
  if (error) throw new Error(`setExpiresAt: ${error.message}`);
}

async function setWindow(minutes: number): Promise<void> {
  const { error } = await adminClient()
    .from("store_settings")
    .update({ payment_window_minutes: minutes })
    .eq("id", 1);
  if (error) throw new Error(`setWindow: ${error.message}`);
}

/** Inserts a slip directly, for states the functions alone would not produce. */
async function seedSlip(orderId: string, reviewStatus: SlipRow["review_status"]): Promise<void> {
  const { error } = await adminClient()
    .from("payment_slips")
    .insert({
      order_id: orderId,
      storage_path: `${orderId}/${randomUUID()}.png`,
      review_status: reviewStatus,
      reject_reason: reviewStatus === "rejected" ? "เหตุผลเดิม" : null,
    });
  if (error) throw new Error(`seedSlip: ${error.message}`);
}

/** Places a real order through create_order, so stock has actually been taken. */
async function placeOrder(lines: [Product, number][]): Promise<string> {
  const key = randomUUID();
  const result = await callRpc<{ status: string; order_id: string }>("create_order", {
    p_idempotency_key: key,
    p_token_hash: `hash-${key}`,
    p_customer_name: "ลูกค้าทดสอบ",
    p_phone: "0812345678",
    p_shipping_address: "123 ถนนทดสอบ แขวงทดสอบ เขตทดสอบ กรุงเทพฯ 10100",
    p_items: lines.map(([product, quantity]) => ({ product_id: product.id, quantity })),
    p_expected_total_satang:
      lines.reduce((sum, [product, quantity]) => sum + product.price_satang * quantity, 0) + SHIPPING,
  });
  expect(result.status).toBe("created");
  return result.order_id;
}

describe("order lifecycle", () => {
  const clients: pg.Client[] = [];
  let actor: string;

  function transition(
    orderId: string,
    to: Status,
    options: { actor?: string | null; reason?: string | null; tracking?: string | null } = {},
  ): Promise<Result> {
    return callRpc("transition_order", {
      p_order_id: orderId,
      p_to: to,
      p_actor: options.actor === undefined ? actor : options.actor,
      p_reason: options.reason ?? null,
      p_tracking_number: options.tracking ?? null,
    });
  }

  const approve = (id: string) => transition(id, "paid");
  const reject = (id: string, reason = "ยอดเงินไม่ตรง") =>
    transition(id, "awaiting_payment", { reason });
  const ship = (id: string, tracking = "TH123456789") => transition(id, "shipped", { tracking });
  const cancel = (id: string) => transition(id, "cancelled");

  async function tracked(): Promise<pg.Client> {
    const client = await connect();
    clients.push(client);
    return client;
  }

  /** A real order walked through the real functions to the wanted non-terminal status. */
  async function orderIn(status: "awaiting_payment" | "payment_review" | "paid", lines: [Product, number][]) {
    const id = await placeOrder(lines);
    if (status !== "awaiting_payment") expect((await submit(id)).ok).toBe(true);
    if (status === "paid") expect((await approve(id)).ok).toBe(true);
    return id;
  }

  beforeAll(async () => {
    const created = await adminClient().auth.admin.createUser({
      email: `lifecycle-${randomUUID()}@example.test`,
      password: randomUUID(),
      email_confirm: true,
    });
    if (created.error || !created.data.user) throw new Error("createUser failed");
    actor = created.data.user.id;
  });

  afterAll(async () => {
    await resetData(); // payment_slips.reviewed_by restricts deleting the user.
    await adminClient().auth.admin.deleteUser(actor);
  });

  beforeEach(async () => {
    await resetData();
  });

  afterEach(async () => {
    // Ends any transaction a failed test left open, so blocked calls cannot hang the suite.
    await Promise.all(clients.splice(0).map((client) => client.end()));
    await setWindow(DEFAULT_WINDOW_MINUTES);
  });

  describe("submit_payment_slip", () => {
    it("slip moves awaiting_payment to payment_review", async () => {
      const product = await seedProduct();
      const id = await placeOrder([[product, 1]]);
      const before = await orderRow(id);

      expect(await submit(id, `${id}/slip.png`)).toEqual({ ok: true, status: "payment_review" });

      expect((await orderRow(id)).status).toBe("payment_review");
      expect((await orderRow(id)).expires_at).toBe(before.expires_at);
      const slips = await slipsOf(id);
      expect(slips).toHaveLength(1);
      expect(slips[0]).toMatchObject({
        storage_path: `${id}/slip.png`,
        review_status: "pending",
        reject_reason: null,
        reviewed_by: null,
        reviewed_at: null,
      });
    });

    it("rejects slip after expires_at even before cron runs", async () => {
      const product = await seedProduct({ stock_quantity: 5 });
      const id = await placeOrder([[product, 2]]);
      await setExpiresAt(id, PAST);

      expect(await submit(id)).toEqual({ ok: false, code: "EXPIRED" });

      // Rejecting must not do cron's work: no status change, no restock, no terminal_at.
      expect(await orderRow(id)).toMatchObject({ status: "awaiting_payment", terminal_at: null });
      expect(await stockOf(product.id)).toBe(3);
      expect(await slipsOf(id)).toEqual([]);
    });

    it("reports EXPIRED once cron has expired the order too", async () => {
      const product = await seedProduct();
      const id = await placeOrder([[product, 1]]);
      await setExpiresAt(id, PAST);
      expect(await expireOrders()).toBe(1);
      expect(await submit(id)).toEqual({ ok: false, code: "EXPIRED" });
      expect(await slipsOf(id)).toEqual([]);
    });

    it("allows only one pending slip", async () => {
      const product = await seedProduct();
      const id = await placeOrder([[product, 1]]);
      expect((await submit(id)).ok).toBe(true);

      expect(await submit(id)).toEqual({ ok: false, code: "INVALID_STATUS" });
      expect(await slipsOf(id)).toHaveLength(1);

      const raced = await Promise.all([submit(id), submit(id)]);
      expect(raced.every((r) => r.code === "INVALID_STATUS")).toBe(true);
      expect(await slipsOf(id)).toHaveLength(1);
    });

    it("gives one slip when submissions race", async () => {
      const product = await seedProduct();
      const id = await placeOrder([[product, 1]]);
      const results = await Promise.all(Array.from({ length: 5 }, () => submit(id)));
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => r.code === "INVALID_STATUS")).toHaveLength(4);
      expect(await slipsOf(id)).toHaveLength(1);
    });

    it("raises if a pending slip already exists on an awaiting_payment order", async () => {
      const order = await seedOrder();
      const seeded = await adminClient()
        .from("payment_slips")
        .insert({ order_id: order.id, storage_path: `${order.id}/old.png` });
      expect(seeded.error).toBeNull();

      const { data, error } = await adminClient().rpc("submit_payment_slip", {
        p_order_id: order.id,
        p_storage_path: `${order.id}/new.png`,
      });

      expect(data).toBeNull();
      expect(error?.code).toBe("23505");
      expect((await orderRow(order.id)).status).toBe("awaiting_payment");
    });

    it("checks status before expires_at", async () => {
      const product = await seedProduct();
      const id = await orderIn("payment_review", [[product, 1]]);
      await setExpiresAt(id, PAST);
      expect(await submit(id)).toEqual({ ok: false, code: "INVALID_STATUS" });
    });

    it.each(["paid", "shipped", "cancelled"] as const)("rejects a slip on %s", async (status) => {
      const order = await seedOrder({ status });
      expect(await submit(order.id)).toEqual({ ok: false, code: "INVALID_STATUS" });
      expect(await slipsOf(order.id)).toEqual([]);
    });

    it("re-reads status after waiting for the order lock", async () => {
      const order = await seedOrder();
      const holder = await tracked();
      const observer = await tracked();
      await holder.query("begin");
      await holder.query("update public.orders set status = 'cancelled' where id = $1", [order.id]);

      const pending = submit(order.id);
      await waitUntilBlocked(observer, pending, "submit_payment_slip");
      await holder.query("commit");

      expect(await pending).toEqual({ ok: false, code: "INVALID_STATUS" });
      expect(await slipsOf(order.id)).toEqual([]);
    });
  });

  describe("transition table", () => {
    it.each(forbiddenTransitions)("rejects %s -> %s", async (from, to) => {
      const order = await seedOrder({ status: from });
      const before = await orderRow(order.id);

      const result = await transition(order.id, to, { reason: "เหตุผล", tracking: "TH1" });

      expect(result).toEqual({ ok: false, code: "INVALID_TRANSITION" });
      expect(await orderRow(order.id)).toEqual(before);
    });

    it.each(ALLOWED)("allows %s -> %s", async (from, to) => {
      const order = await seedOrder({ status: from });
      if (from === "payment_review") await seedSlip(order.id, "pending");
      const result = await transition(order.id, to, { reason: "เหตุผล", tracking: "TH1" });
      expect(result).toEqual({ ok: true, status: to });
      expect((await orderRow(order.id)).status).toBe(to);
    });

    it.each(["payment_review", "expired"] as const)(
      "keeps %s reachable only through its own function",
      async (to) => {
        const product = await seedProduct({ stock_quantity: 5 });
        const id = await placeOrder([[product, 2]]);
        await setExpiresAt(id, to === "expired" ? PAST : new Date(Date.now() + 3600000).toISOString());
        const before = await orderRow(id);

        const result = await transition(id, to, { reason: "เหตุผล", tracking: "TH1" });

        expect(result).toEqual({ ok: false, code: "INVALID_TRANSITION" });
        expect(await orderRow(id)).toEqual(before);
        expect(await stockOf(product.id)).toBe(3);

        if (to === "expired") {
          expect(await expireOrders()).toBe(1);
          expect(await stockOf(product.id)).toBe(5);
        } else {
          expect(await submit(id)).toEqual({ ok: true, status: "payment_review" });
        }
        expect((await orderRow(id)).status).toBe(to);
      },
    );

    it("rejects awaiting_payment -> paid even with a pending slip", async () => {
      const order = await seedOrder();
      await seedSlip(order.id, "pending");
      expect(await transition(order.id, "paid")).toEqual({ ok: false, code: "INVALID_TRANSITION" });
      expect((await orderRow(order.id)).status).toBe("awaiting_payment");
      expect((await slipsOf(order.id))[0].review_status).toBe("pending");
    });

    it("cannot take an order with no slip to paid by any route", async () => {
      const order = await seedOrder();
      for (const to of ["paid", "payment_review", "paid", "shipped", "paid"] as const) {
        const result = await transition(order.id, to, { reason: "เหตุผล", tracking: "TH1" });
        expect(result).toEqual({ ok: false, code: "INVALID_TRANSITION" });
        expect((await orderRow(order.id)).status).toBe("awaiting_payment");
      }
      expect(await slipsOf(order.id)).toEqual([]);
    });

    it("rejects payment_review -> paid when no slip exists", async () => {
      const order = await seedOrder({ status: "payment_review" });
      const before = await orderRow(order.id);
      expect(await transition(order.id, "paid")).toEqual({ ok: false, code: "INVALID_TRANSITION" });
      expect(await orderRow(order.id)).toEqual(before);
    });

    it.each(["approved", "rejected"] as const)(
      "rejects payment_review -> paid when the only slip is %s",
      async (reviewStatus) => {
        const order = await seedOrder({ status: "payment_review" });
        await seedSlip(order.id, reviewStatus);
        const before = await orderRow(order.id);
        const slipsBefore = await slipsOf(order.id);

        expect(await transition(order.id, "paid")).toEqual({
          ok: false,
          code: "INVALID_TRANSITION",
        });

        expect(await orderRow(order.id)).toEqual(before);
        expect(await slipsOf(order.id)).toEqual(slipsBefore);
      },
    );

    it("rejects paying an order whose slip was rejected, until a new slip arrives", async () => {
      const product = await seedProduct();
      const id = await orderIn("payment_review", [[product, 1]]);
      await reject(id);
      expect(await approve(id)).toEqual({ ok: false, code: "INVALID_TRANSITION" });
      expect((await orderRow(id)).status).toBe("awaiting_payment");

      expect((await submit(id)).ok).toBe(true);
      expect(await approve(id)).toEqual({ ok: true, status: "paid" });
    });

    it("covers every status pair", () => {
      expect(forbiddenTransitions.length + ALLOWED.length).toBe(STATUSES.length ** 2);
    });

    it("accepts only the first of two racing approvals", async () => {
      const product = await seedProduct();
      const id = await orderIn("payment_review", [[product, 1]]);
      const holder = await tracked();
      const observer = await tracked();
      await holder.query("begin");
      await holder.query("update public.orders set status = 'paid' where id = $1", [id]);

      const pending = approve(id);
      await waitUntilBlocked(observer, pending, "transition_order");
      await holder.query("commit");

      expect(await pending).toEqual({ ok: false, code: "INVALID_TRANSITION" });
    });
  });

  describe("not found", () => {
    const missing = "11111111-1111-4111-8111-111111111111";
    const notFound = { ok: false, code: "NOT_FOUND" };

    it("submit_payment_slip", async () => {
      expect(await submit(missing, "x/y.png")).toEqual(notFound);
    });
    it("transition_order", async () => {
      expect(await cancel(missing)).toEqual(notFound);
    });
    it("set_tracking_number", async () => {
      expect(await setTracking(missing, "TH1")).toEqual(notFound);
    });
  });

  describe("approve", () => {
    it("approve marks slip approved with reviewer", async () => {
      const product = await seedProduct({ stock_quantity: 5 });
      const id = await orderIn("payment_review", [[product, 2]]);

      expect(await approve(id)).toEqual({ ok: true, status: "paid" });

      expect(await orderRow(id)).toMatchObject({ status: "paid", terminal_at: null });
      const [slip] = await slipsOf(id);
      expect(slip).toMatchObject({
        review_status: "approved",
        reviewed_by: actor,
        reject_reason: null,
      });
      expect(Date.parse(slip.reviewed_at ?? "")).toBeGreaterThan(Date.now() - 60000);
      expect(await stockOf(product.id)).toBe(3);
    });

    it("approves only the pending slip, leaving earlier rejections alone", async () => {
      const product = await seedProduct();
      const id = await orderIn("payment_review", [[product, 1]]);
      await reject(id, "สลิปแรกไม่ผ่าน");
      const [first] = await slipsOf(id);
      expect((await submit(id)).ok).toBe(true);

      expect((await approve(id)).ok).toBe(true);

      const slips = await slipsOf(id);
      expect(slips).toHaveLength(2);
      expect(slips[0]).toEqual(first);
      expect(slips[1].review_status).toBe("approved");
    });
  });

  describe("reject", () => {
    it("reject requires reason, reopens payment and renews expires_at", async () => {
      await setWindow(90);
      const product = await seedProduct({ stock_quantity: 5 });
      const id = await orderIn("payment_review", [[product, 2]]);
      await setExpiresAt(id, PAST); // The window ran out during review; rejection still reopens.

      expect(await reject(id, "  ยอดเงินไม่ตรง \n")).toEqual({ ok: true, status: "awaiting_payment" });

      const order = await orderRow(id);
      expect(order.status).toBe("awaiting_payment");
      expect(order.terminal_at).toBeNull();
      // The trigger stamps updated_at with the same transaction now().
      expect(Date.parse(order.expires_at) - Date.parse(order.updated_at)).toBe(90 * 60 * 1000);
      const [slip] = await slipsOf(id);
      expect(slip).toMatchObject({
        review_status: "rejected",
        reject_reason: "ยอดเงินไม่ตรง",
        reviewed_by: actor,
      });
      expect(slip.reviewed_at).not.toBeNull();
      expect(await stockOf(product.id)).toBe(3); // Rejecting keeps the reservation.

      expect(await expireOrders()).toBe(0);
      expect((await submit(id)).ok).toBe(true);
      expect((await slipsOf(id)).map((s) => s.review_status)).toEqual(["rejected", "pending"]);
    });

    it.each(BLANKS)("treats a %s reason as missing", async (_name, reason) => {
      const product = await seedProduct();
      const id = await orderIn("payment_review", [[product, 1]]);
      const before = await orderRow(id);

      const result = await transition(id, "awaiting_payment", { reason });

      expect(result).toEqual({ ok: false, code: "REASON_REQUIRED" });
      expect(await orderRow(id)).toEqual(before);
      expect((await slipsOf(id))[0].review_status).toBe("pending");
    });
  });

  describe("p_actor", () => {
    it.each(["paid", "awaiting_payment", "cancelled"] as const)(
      "is required to review a slip by moving to %s",
      async (to) => {
        const product = await seedProduct();
        const id = await orderIn("payment_review", [[product, 1]]);
        const { data, error } = await adminClient().rpc("transition_order", {
          p_order_id: id,
          p_to: to,
          p_actor: null,
          p_reason: "เหตุผล",
        });
        expect(data).toBeNull();
        expect(error?.code).toBe("22023");
        expect((await orderRow(id)).status).toBe("payment_review");
        expect((await slipsOf(id))[0].review_status).toBe("pending");
      },
    );

    it("is optional when no slip is reviewed", async () => {
      const product = await seedProduct();
      const id = await orderIn("paid", [[product, 1]]);
      expect(await transition(id, "cancelled", { actor: null })).toEqual({
        ok: true,
        status: "cancelled",
      });
    });
  });

  describe("shipping", () => {
    it("shipping requires tracking number", async () => {
      const product = await seedProduct();
      const id = await orderIn("paid", [[product, 1]]);

      expect(await ship(id, "  TH999 \t")).toEqual({ ok: true, status: "shipped" });

      expect(await orderRow(id)).toMatchObject({ status: "shipped", tracking_number: "TH999" });
    });

    it.each(BLANKS)("treats a %s tracking number as missing", async (_name, tracking) => {
      const product = await seedProduct();
      const id = await orderIn("paid", [[product, 1]]);
      const before = await orderRow(id);

      const result = await transition(id, "shipped", { tracking });

      expect(result).toEqual({ ok: false, code: "TRACKING_REQUIRED" });
      expect(await orderRow(id)).toEqual(before);
    });
  });

  describe("cancel", () => {
    it.each(["awaiting_payment", "payment_review", "paid"] as const)(
      "cancel from %s restores stock",
      async (status) => {
        const a = await seedProduct({ stock_quantity: 5 });
        const b = await seedProduct({ stock_quantity: 7 });
        const id = await orderIn(status, [
          [a, 2],
          [b, 3],
        ]);
        expect(await stockOf(a.id)).toBe(3);
        expect(await stockOf(b.id)).toBe(4);

        expect(await cancel(id)).toEqual({ ok: true, status: "cancelled" });

        expect(await stockOf(a.id)).toBe(5);
        expect(await stockOf(b.id)).toBe(7);
      },
    );

    it("restores every line when an order lists a product twice", async () => {
      const product = await seedProduct({ stock_quantity: 5 });
      const order = await seedOrder();
      const line = {
        order_id: order.id,
        product_id: product.id,
        product_name: product.name,
        unit_price_satang: product.price_satang,
      };
      const { error } = await adminClient()
        .from("order_items")
        .insert([
          { ...line, quantity: 2 },
          { ...line, quantity: 3 },
        ]);
      expect(error).toBeNull();

      expect((await cancel(order.id)).ok).toBe(true);

      expect(await stockOf(product.id)).toBe(10);
    });

    it("restores stock on a hidden product too", async () => {
      const product = await seedProduct({ stock_quantity: 5 });
      const id = await placeOrder([[product, 2]]);
      await adminClient().from("products").update({ is_active: false }).eq("id", product.id);
      expect((await cancel(id)).ok).toBe(true);
      expect(await stockOf(product.id)).toBe(5);
    });

    it("cancel from payment_review rejects the pending slip", async () => {
      const product = await seedProduct();
      const id = await orderIn("payment_review", [[product, 1]]);

      const result = await transition(id, "cancelled", { reason: "  ลูกค้าขอยกเลิก " });

      expect(result).toEqual({ ok: true, status: "cancelled" });
      const [slip] = await slipsOf(id);
      expect(slip).toMatchObject({
        review_status: "rejected",
        reject_reason: "ลูกค้าขอยกเลิก",
        reviewed_by: actor,
      });
      expect(slip.reviewed_at).not.toBeNull();
    });

    it("rejects the pending slip with a default reason when none is given", async () => {
      const product = await seedProduct();
      const id = await orderIn("payment_review", [[product, 1]]);
      expect((await transition(id, "cancelled", { reason: "  " })).ok).toBe(true);
      const [slip] = await slipsOf(id);
      expect(slip.review_status).toBe("rejected");
      expect(slip.reject_reason).toBe("ออเดอร์ถูกยกเลิก");
    });

    it("leaves reviewed slips alone", async () => {
      const product = await seedProduct();
      const paid = await orderIn("paid", [[product, 1]]);
      const rejected = await orderIn("payment_review", [[product, 1]]);
      await reject(rejected);
      const before = [...(await slipsOf(paid)), ...(await slipsOf(rejected))];

      expect((await cancel(paid)).ok).toBe(true);
      expect((await cancel(rejected)).ok).toBe(true);

      expect([...(await slipsOf(paid)), ...(await slipsOf(rejected))]).toEqual(before);
    });

    it("restores stock exactly once on repeated cancel", async () => {
      const product = await seedProduct({ stock_quantity: 5 });
      const initialStock = product.stock_quantity;
      const id = await placeOrder([[product, 2]]);

      const results = await Promise.all([cancel(id), cancel(id), cancel(id)]);

      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => r.code === "INVALID_TRANSITION")).toHaveLength(2);
      expect(await stockOf(product.id)).toBe(initialStock);

      expect(await cancel(id)).toEqual({ ok: false, code: "INVALID_TRANSITION" });
      expect(await stockOf(product.id)).toBe(initialStock);
    });

    it("does not restock a shipped order", async () => {
      const product = await seedProduct({ stock_quantity: 5 });
      const id = await orderIn("paid", [[product, 2]]);
      await ship(id);
      expect(await cancel(id)).toEqual({ ok: false, code: "INVALID_TRANSITION" });
      expect(await stockOf(product.id)).toBe(3);
    });

    it("locks products in id order whatever the item order", async () => {
      const first = await seedProduct();
      const second = await seedProduct();
      const [low, high] = [first, second].sort((x, y) => (x.id < y.id ? -1 : 1));
      const id = await placeOrder([
        [high, 1],
        [low, 1],
      ]);
      const holder = await tracked();
      const observer = await tracked();
      await holder.query("begin");
      await holder.query("select 1 from public.products where id = $1 for update", [high.id]);

      const pending = cancel(id);
      await waitUntilBlocked(observer, pending, "transition_order");

      const { rowCount } = await observer.query(
        "select 1 from public.products where id = $1 for update skip locked",
        [low.id],
      );
      expect(rowCount).toBe(0);

      await holder.query("commit");
      expect((await pending).ok).toBe(true);
    });
  });

  describe("expire_orders", () => {
    it("expires only awaiting_payment past expires_at and restores stock", async () => {
      const product = await seedProduct({ stock_quantity: 8 });
      const past = await placeOrder([[product, 2]]);
      const future = await placeOrder([[product, 1]]);
      await setExpiresAt(past, PAST);

      expect(await expireOrders()).toBe(1);

      expect((await orderRow(past)).status).toBe("expired");
      expect(Date.parse((await orderRow(past)).expires_at)).toBe(Date.parse(PAST));
      expect((await orderRow(future)).status).toBe("awaiting_payment");
      expect(await stockOf(product.id)).toBe(7);
    });

    it("payment_review never expires", async () => {
      const product = await seedProduct({ stock_quantity: 5 });
      const id = await orderIn("payment_review", [[product, 2]]);
      await setExpiresAt(id, PAST);

      expect(await expireOrders()).toBe(0);

      expect((await orderRow(id)).status).toBe("payment_review");
      expect((await slipsOf(id))[0].review_status).toBe("pending");
      expect(await stockOf(product.id)).toBe(3);
    });

    it("ignores every status other than awaiting_payment", async () => {
      const others = STATUSES.filter((status) => status !== "awaiting_payment");
      const orders = await Promise.all(
        others.map((status) => seedOrder({ status, expires_at: PAST })),
      );
      expect(await expireOrders()).toBe(0);
      for (const [index, order] of orders.entries()) {
        expect((await orderRow(order.id)).status).toBe(others[index]);
      }
    });

    it("expire_orders is safe to call repeatedly", async () => {
      const product = await seedProduct({ stock_quantity: 5 });
      const id = await placeOrder([[product, 2]]);
      await setExpiresAt(id, PAST);

      expect(await expireOrders()).toBe(1);
      expect(await expireOrders()).toBe(0);

      expect(await stockOf(product.id)).toBe(5);
    });

    it("restores everything once when calls run concurrently", async () => {
      const product = await seedProduct({ stock_quantity: 10 });
      const ids = await Promise.all(Array.from({ length: 5 }, () => placeOrder([[product, 2]])));
      expect(await stockOf(product.id)).toBe(0);
      await Promise.all(ids.map((id) => setExpiresAt(id, PAST)));

      const counts = await Promise.all(Array.from({ length: 4 }, () => expireOrders()));

      expect(counts.reduce((sum, n) => sum + n, 0)).toBe(5);
      expect(await stockOf(product.id)).toBe(10);
    });

    it("sums a product shared by several expired orders", async () => {
      const product = await seedProduct({ stock_quantity: 6 });
      const a = await placeOrder([[product, 1]]);
      const b = await placeOrder([[product, 2]]);
      await setExpiresAt(a, PAST);
      await setExpiresAt(b, PAST);

      expect(await expireOrders()).toBe(2);

      expect(await stockOf(product.id)).toBe(6);
    });

    it("locks products in id order across orders", async () => {
      // Restocking order by order could hold the higher id while waiting for the lower one.
      const first = await seedProduct();
      const second = await seedProduct();
      const [low, high] = [first, second].sort((x, y) => (x.id < y.id ? -1 : 1));
      const a = await placeOrder([[high, 1]]);
      const b = await placeOrder([[low, 1]]);
      await setExpiresAt(a, PAST);
      await setExpiresAt(b, PAST);
      const holder = await tracked();
      const observer = await tracked();
      await holder.query("begin");
      await holder.query("select 1 from public.products where id = $1 for update", [high.id]);

      const pending = expireOrders();
      await waitUntilBlocked(observer, pending, "expire_orders");

      const { rowCount } = await observer.query(
        "select 1 from public.products where id = $1 for update skip locked",
        [low.id],
      );
      expect(rowCount).toBe(0);

      await holder.query("commit");
      expect(await pending).toBe(2);
    });

    describe("restores stock exactly once when cancel races expire_orders", () => {
      it("when cancel holds the order first", async () => {
        const product = await seedProduct({ stock_quantity: 5 });
        const id = await placeOrder([[product, 2]]);
        await setExpiresAt(id, PAST);
        const holder = await tracked();
        const observer = await tracked();
        // Parks cancel on the order lock while the holder keeps the row busy.
        await holder.query("begin");
        await holder.query("select 1 from public.orders where id = $1 for update", [id]);
        const pending = cancel(id);
        await waitUntilBlocked(observer, pending, "transition_order");

        // Skips the locked row rather than waiting on it.
        expect(await expireOrders()).toBe(0);

        await holder.query("commit");
        expect(await pending).toEqual({ ok: true, status: "cancelled" });
        expect(await expireOrders()).toBe(0);
        expect((await orderRow(id)).status).toBe("cancelled");
        expect(await stockOf(product.id)).toBe(5);
      });

      it("when expire_orders holds the order first", async () => {
        const product = await seedProduct({ stock_quantity: 5 });
        const id = await placeOrder([[product, 2]]);
        await setExpiresAt(id, PAST);
        const holder = await tracked();
        const observer = await tracked();
        // Parks expire_orders on the product, with the order row already locked by it.
        await holder.query("begin");
        await holder.query("select 1 from public.products where id = $1 for update", [product.id]);
        const expiring = expireOrders();
        await waitUntilBlocked(observer, expiring, "expire_orders");

        const cancelling = cancel(id);
        await waitUntilBlocked(observer, cancelling, "transition_order");

        await holder.query("commit");
        expect(await expiring).toBe(1);
        expect(await cancelling).toEqual({ ok: false, code: "INVALID_TRANSITION" });
        expect((await orderRow(id)).status).toBe("expired");
        expect(await stockOf(product.id)).toBe(5);
      });

      it("when they start together", async () => {
        const product = await seedProduct({ stock_quantity: 10 });
        const ids = await Promise.all(Array.from({ length: 5 }, () => placeOrder([[product, 2]])));
        await Promise.all(ids.map((id) => setExpiresAt(id, PAST)));

        const [results, count] = await Promise.all([
          Promise.all(ids.map((id) => cancel(id))),
          expireOrders(),
        ]);

        expect(results.filter((r) => r.ok).length + count).toBe(5);
        expect(await stockOf(product.id)).toBe(10);
      });
    });
  });

  describe("set_tracking_number", () => {
    it("set_tracking_number works only on shipped orders", async () => {
      const others = STATUSES.filter((status) => status !== "shipped");
      for (const status of others) {
        const order = await seedOrder({ status });
        expect(await setTracking(order.id, "TH1")).toEqual({ ok: false, code: "INVALID_STATUS" });
        expect((await orderRow(order.id)).tracking_number).toBeNull();
      }

      const shipped = await seedOrder({ status: "shipped", tracking_number: "TH0" });
      expect(await setTracking(shipped.id, "  TH2 ")).toEqual({ ok: true, status: "shipped" });
      expect((await orderRow(shipped.id)).tracking_number).toBe("TH2");
    });

    it.each(BLANKS)("treats a %s tracking number as missing", async (_name, tracking) => {
      const order = await seedOrder({ status: "shipped", tracking_number: "TH0" });
      const before = await orderRow(order.id);
      expect(await setTracking(order.id, tracking)).toEqual({ ok: false, code: "TRACKING_REQUIRED" });
      expect(await orderRow(order.id)).toEqual(before);
    });
  });

  describe("terminal_at", () => {
    it("sets terminal_at once and tracking edits never change it", async () => {
      const product = await seedProduct();
      const id = await orderIn("paid", [[product, 1]]);
      expect((await orderRow(id)).terminal_at).toBeNull();

      await ship(id);
      const shipped = await orderRow(id);
      expect(shipped.terminal_at).toBe(shipped.updated_at);

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect((await setTracking(id, "TH-NEW")).ok).toBe(true);
      expect(await cancel(id)).toEqual({ ok: false, code: "INVALID_TRANSITION" });

      const edited = await orderRow(id);
      expect(edited.terminal_at).toBe(shipped.terminal_at);
      expect(edited.tracking_number).toBe("TH-NEW");
      // Nothing else moved, apart from the trigger's updated_at.
      expect({
        ...edited,
        tracking_number: shipped.tracking_number,
        updated_at: shipped.updated_at,
      }).toEqual(shipped);
    });

    it("is set on cancel and on expiry", async () => {
      const product = await seedProduct();
      const cancelled = await placeOrder([[product, 1]]);
      const expired = await placeOrder([[product, 1]]);
      await setExpiresAt(expired, PAST);

      await cancel(cancelled);
      await expireOrders();

      for (const id of [cancelled, expired]) {
        const order = await orderRow(id);
        expect(order.terminal_at).not.toBeNull();
        expect(order.terminal_at).toBe(order.updated_at);
      }
    });

    it("stays null through review and rejection", async () => {
      const product = await seedProduct();
      const id = await orderIn("payment_review", [[product, 1]]);
      expect((await orderRow(id)).terminal_at).toBeNull();
      await reject(id);
      expect((await orderRow(id)).terminal_at).toBeNull();
    });
  });

  describe("privileges", () => {
    it("functions cannot be executed by anon", async () => {
      const product = await seedProduct({ stock_quantity: 5 });
      const id = await placeOrder([[product, 2]]);
      await setExpiresAt(id, PAST);
      const before = await orderRow(id);
      const anon = anonClient();

      const calls = [
        anon.rpc("submit_payment_slip", { p_order_id: id, p_storage_path: "x/y.png" }),
        anon.rpc("transition_order", { p_order_id: id, p_to: "cancelled", p_actor: actor }),
        anon.rpc("set_tracking_number", { p_order_id: id, p_tracking_number: "TH1" }),
        anon.rpc("expire_orders"),
        anon.rpc("restock_orders", { p_order_ids: [id] }),
        anon.rpc("trim_to_null", { p_value: " x " }),
      ];
      for (const { data, error } of await Promise.all(calls)) {
        expect(error?.code).toBe("42501");
        expect(data).toBeNull();
      }

      expect(await orderRow(id)).toEqual(before);
      expect(await stockOf(product.id)).toBe(3);
      expect(await slipsOf(id)).toEqual([]);
    });

    it.each(SIGNATURES)("grants EXECUTE to service_role only and pins search_path: %s", async (signature) => {
      const client = await tracked();
      const { rows } = await client.query<Record<string, unknown>>(
        `select
           has_function_privilege('public', $1::regprocedure, 'execute') as public_exec,
           has_function_privilege('anon', $1::regprocedure, 'execute') as anon_exec,
           has_function_privilege('authenticated', $1::regprocedure, 'execute') as auth_exec,
           has_function_privilege('service_role', $1::regprocedure, 'execute') as service_exec,
           (select p.proconfig from pg_proc p where p.oid = $1::regprocedure) as config,
           (select p.prosecdef from pg_proc p where p.oid = $1::regprocedure) as definer`,
        [signature],
      );
      expect(rows[0]).toEqual({
        public_exec: false,
        anon_exec: false,
        auth_exec: false,
        service_exec: true,
        config: ['search_path=""'],
        definer: false,
      });
    });
  });
});
