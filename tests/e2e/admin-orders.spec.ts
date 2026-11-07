import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { deleteTestUsers, signInAdminWithMfa, type TestUser } from "../helpers/admin";
import { seedOrderWithToken, seedPendingSlip } from "../helpers/orders";
import { adminClient, resetData, seedOrder, seedProduct } from "../helpers/supabase";

const png = readFileSync(path.join(__dirname, "..", "fixtures", "real.png"));

let admin: TestUser;

test.beforeAll(async () => {
  await resetData();
  await deleteTestUsers();
});

test.afterAll(async () => {
  // Reviewed slips reference the admin (ON DELETE RESTRICT), so they go first.
  await resetData();
  await deleteTestUsers();
});

test.beforeEach(async ({ page }) => {
  await resetData();
  admin = await signInAdminWithMfa(page);
});

async function orderRow(orderId: string) {
  const { data, error } = await adminClient()
    .from("orders")
    .select("status, tracking_number")
    .eq("id", orderId)
    .single();
  if (error) throw error;
  return data as { status: string; tracking_number: string | null };
}

async function slipsOf(orderId: string) {
  const { data, error } = await adminClient()
    .from("payment_slips")
    .select("review_status, reviewed_by, reject_reason")
    .eq("order_id", orderId);
  if (error) throw error;
  return data as { review_status: string; reviewed_by: string | null; reject_reason: string | null }[];
}

/** An order in payment_review with a real slip image, reachable by the customer through `token`. */
async function seedReview() {
  const { order, token } = await seedOrderWithToken({ status: "payment_review" });
  await seedPendingSlip(order.id, png);
  return { order, token };
}

function statusOf(page: Page) {
  return page.getByTestId("admin-order-status");
}

test("shows slip next to expected amount and approves", async ({ page }) => {
  const { order } = await seedReview();
  await page.goto(`/admin/orders/${order.id}`);

  const review = page.getByRole("region", { name: "ตรวจสลิป" });
  const slip = review.getByRole("img", { name: /สลิปการโอนเงิน/ });
  await expect(slip).toBeVisible();
  expect(await slip.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(review.getByTestId("expected-amount")).toHaveText("฿150.00");
  await expect(review).toContainText("ตรวจยอดเงินเข้าในแอปธนาคาร");

  // Shipping needs the full contact details.
  const customer = page.getByRole("region", { name: "ข้อมูลผู้รับ" });
  await expect(customer).toContainText("ลูกค้าทดสอบ");
  await expect(customer).toContainText("0812345678");
  await expect(customer).toContainText("123 ถนนทดสอบ แขวงทดสอบ เขตทดสอบ กรุงเทพฯ 10100");

  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await review.getByRole("button", { name: "ยืนยันการชำระเงิน" }).click();
  await expect(statusOf(page)).toHaveText("ชำระแล้ว");
  expect((await orderRow(order.id)).status).toBe("paid");
  expect(await slipsOf(order.id)).toEqual([{ review_status: "approved", reviewed_by: admin.id, reject_reason: null }]);
});

test("without a pending slip, neither approve nor reject is offered", async ({ page }) => {
  const { order } = await seedOrderWithToken({ status: "payment_review" });
  await page.goto(`/admin/orders/${order.id}`);
  const review = page.getByRole("region", { name: "ตรวจสลิป" });
  await expect(review).toContainText("ไม่พบสลิปที่รอตรวจ");
  await expect(review.getByRole("button", { name: "ยืนยันการชำระเงิน" })).toHaveCount(0);
  await expect(review.getByLabel("เหตุผลที่ปฏิเสธสลิป")).toHaveCount(0);
  await expect(review.getByRole("button", { name: "ปฏิเสธสลิป" })).toHaveCount(0);
});

test("rejecting requires a reason shown to the customer", async ({ page }) => {
  const { order, token } = await seedReview();
  await page.goto(`/admin/orders/${order.id}`);
  const review = page.getByRole("region", { name: "ตรวจสลิป" });
  const reason = review.getByLabel("เหตุผลที่ปฏิเสธสลิป");

  await reason.fill("   ");
  await review.getByRole("button", { name: "ปฏิเสธสลิป" }).click();
  await expect(review.getByTestId("reason-error")).toHaveText("กรุณากรอกเหตุผลที่ปฏิเสธสลิป ไม่เกิน 500 ตัวอักษร");
  await expect(reason).toHaveAttribute("aria-invalid", "true");
  expect((await orderRow(order.id)).status).toBe("payment_review");

  await reason.fill("  <b>ยอดเงินไม่ตรง</b>   โอนขาด   10 บาท ");
  await review.getByRole("button", { name: "ปฏิเสธสลิป" }).click();
  await expect(statusOf(page)).toHaveText("รอชำระเงิน");
  expect(await slipsOf(order.id)).toEqual([
    { review_status: "rejected", reviewed_by: admin.id, reject_reason: "<b>ยอดเงินไม่ตรง</b> โอนขาด 10 บาท" },
  ]);

  await page.goto(`/orders/${token}`);
  const notice = page.getByTestId("rejected-notice");
  await expect(notice).toContainText("เหตุผล: <b>ยอดเงินไม่ตรง</b> โอนขาด 10 บาท");
  await expect(notice.locator("b")).toHaveCount(0);
});

test("warns about manual refund before cancelling a paid order", async ({ page }) => {
  const product = await seedProduct({ stock_quantity: 3 });
  const order = await seedOrder({ status: "paid" });
  const items = await adminClient()
    .from("order_items")
    .insert({ order_id: order.id, product_id: product.id, product_name: product.name, unit_price_satang: 10000, quantity: 2 });
  if (items.error) throw items.error;
  await page.goto(`/admin/orders/${order.id}`);

  await page.getByRole("button", { name: "ยกเลิกคำสั่งซื้อ" }).click();
  const dialog = page.getByRole("dialog", { name: "ยืนยันการยกเลิกคำสั่งซื้อ" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("ระบบไม่คืนเงินให้อัตโนมัติ");
  await expect(dialog).toContainText("฿150.00");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await dialog.getByRole("button", { name: "ไม่ยกเลิก" }).click();
  await expect(dialog).toBeHidden();
  expect((await orderRow(order.id)).status).toBe("paid");

  await page.getByRole("button", { name: "ยกเลิกคำสั่งซื้อ" }).click();
  await dialog.getByRole("button", { name: "ยืนยันการยกเลิก" }).click();
  await expect(statusOf(page)).toHaveText("ยกเลิก");
  expect((await orderRow(order.id)).status).toBe("cancelled");
  const { data } = await adminClient().from("products").select("stock_quantity").eq("id", product.id).single();
  expect(data?.stock_quantity).toBe(5);
});

test("ships with tracking and customer sees it", async ({ page }) => {
  const { order, token } = await seedOrderWithToken({ status: "paid" });
  await page.goto(`/admin/orders/${order.id}`);

  const shipping = page.getByRole("region", { name: "จัดส่ง" });
  await shipping.getByLabel("เลขพัสดุ").fill("   ");
  await shipping.getByRole("button", { name: "บันทึกการจัดส่ง" }).click();
  await expect(shipping.getByTestId("tracking-error")).toHaveText("กรุณากรอกเลขพัสดุ ไม่เกิน 100 ตัวอักษร");
  expect((await orderRow(order.id)).status).toBe("paid");

  await shipping.getByLabel("เลขพัสดุ").fill("  TH1234567890  ");
  await shipping.getByRole("button", { name: "บันทึกการจัดส่ง" }).click();
  await expect(statusOf(page)).toHaveText("จัดส่งแล้ว");
  expect(await orderRow(order.id)).toEqual({ status: "shipped", tracking_number: "TH1234567890" });

  await page.goto(`/orders/${token}`);
  await expect(page.getByTestId("tracking-number")).toHaveText("TH1234567890");

  // A typo can be corrected after shipping.
  await page.goto(`/admin/orders/${order.id}`);
  const correction = page.getByRole("region", { name: "จัดส่ง" });
  await correction.getByLabel("เลขพัสดุ").fill("TH0000000001");
  await correction.getByRole("button", { name: "บันทึกเลขพัสดุใหม่" }).click();
  await expect(correction.getByTestId("current-tracking")).toHaveText("TH0000000001");

  await page.goto(`/orders/${token}`);
  await expect(page.getByTestId("tracking-number")).toHaveText("TH0000000001");
});

test("two tabs approving only applies once", async ({ page, context }) => {
  const { order } = await seedReview();
  const other = await context.newPage();
  await page.goto(`/admin/orders/${order.id}`);
  await other.goto(`/admin/orders/${order.id}`);

  await page.getByRole("button", { name: "ยืนยันการชำระเงิน" }).click();
  await expect(statusOf(page)).toHaveText("ชำระแล้ว");

  await other.getByRole("button", { name: "ยืนยันการชำระเงิน" }).click();
  await expect(other.getByTestId("action-error")).toContainText("สถานะคำสั่งซื้อเปลี่ยนไปแล้ว");
  expect((await orderRow(order.id)).status).toBe("paid");
  expect((await slipsOf(order.id)).map((slip) => slip.review_status)).toEqual(["approved"]);
});

test("dashboard shows review, paid, revenue and low stock", async ({ page }) => {
  await seedOrder({ status: "payment_review", total_satang: 15000 });
  await seedOrder({ status: "paid", total_satang: 20000 });
  await seedOrder({ status: "shipped", total_satang: 30050 });
  await seedOrder({ status: "cancelled", total_satang: 99999 });
  await seedProduct({ name: "สบู่ใกล้หมด", stock_quantity: 2 });
  await seedProduct({ name: "สบู่เหลือเยอะ", stock_quantity: 40 });

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "แดชบอร์ด" })).toBeVisible();
  await expect(page.getByTestId("stat-pending-review")).toHaveText("1");
  await expect(page.getByTestId("stat-paid-orders")).toHaveText("2");
  await expect(page.getByTestId("stat-revenue")).toHaveText("฿500.50");
  const lowStock = page.getByRole("region", { name: "สินค้าใกล้หมด" });
  await expect(lowStock).toContainText("สบู่ใกล้หมด");
  await expect(lowStock).toContainText("เหลือ 2 ชิ้น");
  await expect(lowStock).not.toContainText("สบู่เหลือเยอะ");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("link", { name: /รอตรวจสลิป/ }).first().click();
  await expect(page).toHaveURL(/\/admin\/orders\?status=payment_review$/);
});

test("orders list shows payment review first and filters by status", async ({ page }) => {
  const paid = await seedOrder({ status: "paid" });
  const review = await seedOrder({ status: "payment_review", created_at: "2026-01-01T00:00:00.000Z" });

  await page.goto("/admin/orders");
  await expect(page.getByRole("heading", { name: "คำสั่งซื้อ" })).toBeVisible();
  const rows = page.getByTestId("order-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText(review.order_number);
  await expect(rows.nth(0)).toContainText("รอตรวจสลิป");
  await expect(rows.nth(1)).toContainText(paid.order_number);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("link", { name: "ชำระแล้ว", exact: true }).click();
  await expect(page).toHaveURL(/status=paid$/);
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText(paid.order_number);

  await rows.nth(0).getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/admin/orders/${paid.id}$`));
});

test("cancelling from a page that no longer shows the real status changes nothing", async ({ page }) => {
  const { order } = await seedReview();
  await page.goto(`/admin/orders/${order.id}`);
  await expect(statusOf(page)).toHaveText("รอตรวจสลิป");

  // Approved elsewhere after this page rendered: its softer warning no longer fits.
  const { data, error } = await adminClient().rpc("transition_order", {
    p_order_id: order.id,
    p_to: "paid",
    p_actor: admin.id,
  });
  expect(error).toBeNull();
  expect(data).toEqual({ ok: true, status: "paid" });

  await page.getByRole("button", { name: "ยกเลิกคำสั่งซื้อ" }).click();
  const dialog = page.getByRole("dialog", { name: "ยืนยันการยกเลิกคำสั่งซื้อ" });
  await dialog.getByRole("button", { name: "ยืนยันการยกเลิก" }).click();
  await expect(dialog.getByTestId("action-error")).toContainText("กรุณาโหลดหน้าใหม่");
  expect((await orderRow(order.id)).status).toBe("paid");

  await page.reload();
  await expect(statusOf(page)).toHaveText("ชำระแล้ว");
});
