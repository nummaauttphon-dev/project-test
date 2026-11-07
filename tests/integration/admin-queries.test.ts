import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { getDashboardStats, getOrderDetail, listOrders, ORDERS_PAGE_SIZE } from "@/features/admin/queries";
import { connect } from "../helpers/pg";
import { seedPendingSlip } from "../helpers/orders";
import { adminClient, resetData, seedOrder, seedProduct } from "../helpers/supabase";

const png = readFileSync(path.join(import.meta.dirname, "..", "fixtures", "real.png"));

beforeEach(async () => {
  await resetData();
});

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

describe("getDashboardStats", () => {
  it("counts paid and shipped only in paidOrders and revenue", async () => {
    await seedOrder({ status: "awaiting_payment", total_satang: 1 });
    await seedOrder({ status: "payment_review", total_satang: 20 });
    await seedOrder({ status: "payment_review", total_satang: 300 });
    await seedOrder({ status: "paid", total_satang: 4_000 });
    await seedOrder({ status: "shipped", total_satang: 50_000 });
    await seedOrder({ status: "shipped", total_satang: 600_000 });
    await seedOrder({ status: "expired", total_satang: 7_000_000 });
    await seedOrder({ status: "cancelled", total_satang: 80_000_000 });

    const stats = await getDashboardStats(adminClient());
    expect(stats).toMatchObject({ pendingReview: 2, paidOrders: 3, revenueSatang: 654_000 });
  });

  it("sums revenue beyond the API's 1000-row page", async () => {
    const db = await connect();
    try {
      await db.query(
        `insert into public.orders (customer_name, phone, shipping_address, subtotal_satang,
           shipping_fee_satang, total_satang, token_hash, idempotency_key, expires_at, status)
         select 'ลูกค้า', '0812345678', 'ที่อยู่', 100, 0, 100, md5(random()::text || g),
           md5(random()::text || g) || g, now() + interval '1 day',
           (case when g % 2 = 0 then 'paid' else 'shipped' end)::public.order_status
         from generate_series(1, 1205) as g`,
      );
    } finally {
      await db.end();
    }
    const stats = await getDashboardStats(adminClient());
    expect(stats.paidOrders).toBe(1205);
    expect(stats.revenueSatang).toBe(120_500);
  });

  it("lists low stock at 5 or fewer among active products", async () => {
    const empty = await seedProduct({ name: "หมดแล้ว", stock_quantity: 0 });
    const five = await seedProduct({ name: "เหลือห้า", stock_quantity: 5 });
    const two = await seedProduct({ name: "เหลือสอง", stock_quantity: 2 });
    await seedProduct({ name: "เหลือหก", stock_quantity: 6 });
    await seedProduct({ name: "ซ่อนไว้", stock_quantity: 1, is_active: false });

    const { lowStock } = await getDashboardStats(adminClient());
    expect(lowStock).toEqual([
      { id: empty.id, name: "หมดแล้ว", stockQuantity: 0 },
      { id: two.id, name: "เหลือสอง", stockQuantity: 2 },
      { id: five.id, name: "เหลือห้า", stockQuantity: 5 },
    ]);
  });

  it("is all zeros on an empty store", async () => {
    expect(await getDashboardStats(adminClient())).toEqual({
      pendingReview: 0,
      paidOrders: 0,
      revenueSatang: 0,
      lowStock: [],
    });
  });
});

describe("listOrders", () => {
  it("lists payment_review before other statuses", async () => {
    const oldReview = await seedOrder({ status: "payment_review", created_at: minutesAgo(300) });
    const newestPaid = await seedOrder({ status: "paid", created_at: minutesAgo(1) });
    const newReview = await seedOrder({ status: "payment_review", created_at: minutesAgo(100) });
    const olderAwaiting = await seedOrder({ status: "awaiting_payment", created_at: minutesAgo(50) });
    const oldestShipped = await seedOrder({ status: "shipped", created_at: minutesAgo(900) });

    const page = await listOrders(adminClient());
    expect(page.orders.map((order) => order.id)).toEqual([
      newReview.id,
      oldReview.id,
      newestPaid.id,
      olderAwaiting.id,
      oldestShipped.id,
    ]);
    expect(page).toMatchObject({ total: 5, page: 1, pageCount: 1 });
    expect(page.orders[0]).toEqual({
      id: newReview.id,
      orderNumber: newReview.order_number,
      status: "payment_review",
      customerName: "ลูกค้าทดสอบ",
      totalSatang: 15000,
      createdAt: expect.any(String),
    });
  });

  it("pages 50 at a time across the review and other orders", async () => {
    expect(ORDERS_PAGE_SIZE).toBe(50);
    const db = await connect();
    try {
      // 3 in review, 52 others: page 1 is the 3 reviews and the 47 newest others.
      await db.query(
        `insert into public.orders (customer_name, phone, shipping_address, subtotal_satang,
           shipping_fee_satang, total_satang, token_hash, idempotency_key, expires_at, status, created_at)
         select 'ลูกค้า ' || g, '0812345678', 'ที่อยู่', 100, 0, 100, md5(random()::text || g),
           md5(random()::text || g) || g, now() + interval '1 day',
           (case when g <= 3 then 'payment_review' else 'awaiting_payment' end)::public.order_status,
           now() - make_interval(mins => g)
         from generate_series(1, 55) as g`,
      );
    } finally {
      await db.end();
    }

    const first = await listOrders(adminClient());
    expect(first).toMatchObject({ total: 55, page: 1, pageCount: 2 });
    expect(first.orders).toHaveLength(50);
    expect(first.orders.slice(0, 3).map((order) => order.status)).toEqual(Array(3).fill("payment_review"));
    expect(first.orders.slice(0, 4).map((order) => order.customerName)).toEqual([
      "ลูกค้า 1",
      "ลูกค้า 2",
      "ลูกค้า 3",
      "ลูกค้า 4",
    ]);

    const second = await listOrders(adminClient(), undefined, 2);
    expect(second).toMatchObject({ total: 55, page: 2, pageCount: 2 });
    expect(second.orders.map((order) => order.customerName)).toEqual(
      [51, 52, 53, 54, 55].map((n) => `ลูกค้า ${n}`),
    );

    const ids = new Set([...first.orders, ...second.orders].map((order) => order.id));
    expect(ids.size).toBe(55);

    // Past the end: an empty page, not an error.
    expect((await listOrders(adminClient(), undefined, 9)).orders).toEqual([]);
  });

  it("filters by status, newest first", async () => {
    const older = await seedOrder({ status: "paid", created_at: minutesAgo(20) });
    const newer = await seedOrder({ status: "paid", created_at: minutesAgo(10) });
    await seedOrder({ status: "payment_review" });

    const page = await listOrders(adminClient(), "paid");
    expect(page.orders.map((order) => order.id)).toEqual([newer.id, older.id]);
    expect(page).toMatchObject({ total: 2, pageCount: 1 });
  });
});

describe("getOrderDetail", () => {
  it("returns the full contact details, items and slips with 300-second signed URLs", async () => {
    const product = await seedProduct({ name: "แก้วกาแฟ" });
    const order = await seedOrder({ status: "payment_review", total_satang: 25_000 });
    const items = await adminClient()
      .from("order_items")
      .insert({ order_id: order.id, product_id: product.id, product_name: "แก้วกาแฟ", unit_price_satang: 10_000, quantity: 2 });
    expect(items.error).toBeNull();
    const slipPath = await seedPendingSlip(order.id, png);

    const detail = await getOrderDetail(adminClient(), order.id);
    expect(detail).toMatchObject({
      id: order.id,
      orderNumber: order.order_number,
      status: "payment_review",
      customerName: "ลูกค้าทดสอบ",
      phone: "0812345678",
      shippingAddress: "123 ถนนทดสอบ แขวงทดสอบ เขตทดสอบ กรุงเทพฯ 10100",
      totalSatang: 25_000,
      items: [{ name: "แก้วกาแฟ", unitPriceSatang: 10_000, quantity: 2 }],
    });
    expect(detail?.slips).toHaveLength(1);
    const [slip] = detail?.slips ?? [];
    expect(slip).toMatchObject({ reviewStatus: "pending", rejectReason: null });
    // The path reaches the page only inside the signed link itself.
    const withoutLinks = { ...detail, slips: detail?.slips.map((entry) => ({ ...entry, url: null })) };
    expect(JSON.stringify(withoutLinks)).not.toContain(slipPath);

    const url = new URL(String(slip.url));
    const token = url.searchParams.get("token") ?? "";
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    expect(claims.exp - claims.iat).toBe(300);

    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).equals(png)).toBe(true);
  });

  it("signs only files inside the viewed order's folder", async () => {
    const order = await seedOrder({ status: "payment_review" });
    const other = await seedOrder({ status: "payment_review" });
    await seedPendingSlip(other.id, png);
    // A row that points at another order's file must not yield a link to it.
    const { error } = await adminClient()
      .from("payment_slips")
      .insert({ order_id: order.id, storage_path: `${other.id}/slip.png` });
    expect(error).toBeNull();

    const detail = await getOrderDetail(adminClient(), order.id);
    expect(detail?.slips).toHaveLength(1);
    expect(detail?.slips[0].url).toBeNull();
  });

  it("gives no link for a slip whose file was purged", async () => {
    const order = await seedOrder({ status: "cancelled" });
    const { error } = await adminClient().from("payment_slips").insert({
      order_id: order.id,
      storage_path: `${order.id}/gone.png`,
      review_status: "rejected",
      reject_reason: "ออเดอร์ถูกยกเลิก",
      file_deleted_at: new Date().toISOString(),
    });
    expect(error).toBeNull();

    const detail = await getOrderDetail(adminClient(), order.id);
    expect(detail?.slips).toMatchObject([
      { reviewStatus: "rejected", rejectReason: "ออเดอร์ถูกยกเลิก", url: null, fileDeleted: true },
    ]);
  });

  it("is null for an unknown or malformed id", async () => {
    expect(await getOrderDetail(adminClient(), "00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await getOrderDetail(adminClient(), "not-a-uuid")).toBeNull();
  });
});
