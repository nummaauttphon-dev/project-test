import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { deleteTestUsers, signInAdminWithMfa } from "../helpers/admin";
import { hashToken } from "../helpers/orders";
import { adminClient, resetData, seedProduct } from "../helpers/supabase";

const slipImage = readFileSync(path.join(__dirname, "..", "fixtures", "real.png"));

test.beforeAll(async () => {
  await resetData();
  await deleteTestUsers();
});

test.afterAll(async () => {
  // Reviewed slips reference the admin (ON DELETE RESTRICT), so the data goes first.
  await resetData();
  await deleteTestUsers();
});

test.beforeEach(async () => {
  await resetData();
});

async function stockOf(productId: string): Promise<number> {
  const { data, error } = await adminClient().from("products").select("stock_quantity").eq("id", productId).single();
  if (error) throw error;
  return data.stock_quantity as number;
}

async function orderByToken(token: string) {
  const { data, error } = await adminClient()
    .from("orders")
    .select("id, status, tracking_number, total_satang")
    .eq("token_hash", hashToken(token))
    .single();
  if (error) throw error;
  return data as { id: string; status: string; tracking_number: string | null; total_satang: number };
}

/** Browses the store like a customer, orders `quantity` of the product and returns the order token. */
async function buyThroughStore(page: Page, productName: string, quantity: number): Promise<string> {
  await page.goto("/");
  await page.getByRole("link", { name: new RegExp(productName) }).click();
  await expect(page.getByRole("heading", { level: 1, name: productName })).toBeVisible();
  await page.getByLabel("จำนวน").selectOption(String(quantity));
  await page.getByRole("button", { name: "เพิ่มลงตะกร้า" }).click();
  await expect(page.getByRole("status").filter({ hasText: `เพิ่มลงตะกร้าแล้ว รวม ${quantity} ชิ้น` })).toBeVisible();

  await page.getByRole("link", { name: "ดูตะกร้า" }).click();
  await expect(page.getByTestId("cart-total")).toBeVisible();
  await page.getByRole("link", { name: "ไปหน้าชำระเงิน" }).click();
  await expect(page).toHaveURL(/\/checkout$/);

  await page.getByLabel("ชื่อผู้รับ").fill("สมหญิง รักดี");
  await page.getByLabel("เบอร์โทรศัพท์").fill("089-876-5432");
  await page.getByLabel("ที่อยู่จัดส่ง").fill("88/8 ถนนนิมมานเหมินท์ ตำบลสุเทพ อำเภอเมือง เชียงใหม่ 50200");
  await page.getByRole("button", { name: "ยืนยันสั่งซื้อ" }).click();
  await expect(page).toHaveURL(/\/orders\/[A-Za-z0-9_-]{20,}$/);
  await expect(page.getByTestId("order-status")).toContainText("รอชำระเงิน");
  return new URL(page.url()).pathname.split("/").pop() ?? "";
}

async function uploadSlip(page: Page): Promise<void> {
  await page
    .getByLabel("เลือกรูปสลิปการโอนเงิน")
    .setInputFiles({ name: "slip.png", mimeType: "image/png", buffer: slipImage });
  await page.getByRole("button", { name: "ส่งสลิป" }).click();
  await expect(page.getByTestId("order-status")).toContainText("รอร้านตรวจสอบ");
}

/** Finds the order in the admin list the way the shop owner would, by its order number. */
async function openReviewInAdmin(admin: Page, orderNumber: string): Promise<void> {
  await admin.goto("/admin/orders?status=payment_review");
  const row = admin.getByTestId("order-row").filter({ hasText: orderNumber });
  await expect(row).toHaveCount(1);
  await row.getByRole("link").click();
  await expect(admin.getByTestId("admin-order-status")).toHaveText("รอตรวจสลิป");
}

test("customer buys, uploads slip, admin approves and ships, customer sees tracking", async ({ page, context }) => {
  const product = await seedProduct({ name: "ผ้าพันคอทอมือ", price_satang: 45000, stock_quantity: 4 });

  const token = await buyThroughStore(page, "ผ้าพันคอทอมือ", 2);
  await expect(page.getByTestId("amount")).toHaveText("฿950.00"); // 2 x 450.00 + 50.00 shipping
  await expect(page.getByRole("img", { name: /QR พร้อมเพย์สำหรับชำระเงิน ฿950\.00/ })).toBeVisible();
  const orderNumber = (await page.getByTestId("order-number").innerText()).trim();
  expect(await stockOf(product.id)).toBe(2);
  const stored = await page.evaluate(() => window.localStorage.getItem("cart.v1"));
  expect(JSON.parse(stored ?? "null")).toEqual([]);

  await uploadSlip(page);

  const admin = await context.newPage();
  await signInAdminWithMfa(admin);
  await openReviewInAdmin(admin, orderNumber);
  const review = admin.getByRole("region", { name: "ตรวจสลิป" });
  await expect(review.getByTestId("expected-amount")).toHaveText("฿950.00");
  await expect(review.getByRole("img", { name: /สลิปการโอนเงิน/ })).toBeVisible();
  await review.getByRole("button", { name: "ยืนยันการชำระเงิน" }).click();
  await expect(admin.getByTestId("admin-order-status")).toHaveText("ชำระแล้ว");

  await page.reload();
  await expect(page.getByTestId("order-status")).toContainText("ชำระเงินแล้ว");

  const shipping = admin.getByRole("region", { name: "จัดส่ง" });
  await shipping.getByLabel("เลขพัสดุ").fill("EF123456789TH");
  await shipping.getByRole("button", { name: "บันทึกการจัดส่ง" }).click();
  await expect(admin.getByTestId("admin-order-status")).toHaveText("จัดส่งแล้ว");

  await page.reload();
  await expect(page.getByTestId("order-status")).toContainText("จัดส่งแล้ว");
  await expect(page.getByTestId("tracking-number")).toHaveText("EF123456789TH");

  expect(await orderByToken(token)).toMatchObject({ status: "shipped", tracking_number: "EF123456789TH", total_satang: 95000 });
  expect(await stockOf(product.id)).toBe(2);

  // Paid and shipped orders count on the dashboard.
  await admin.goto("/admin");
  await expect(admin.getByTestId("stat-paid-orders")).toHaveText("1");
  await expect(admin.getByTestId("stat-revenue")).toHaveText("฿950.00");
});

test("rejected slip, re-upload, approval", async ({ page, context }) => {
  await seedProduct({ name: "เทียนหอมกลิ่นตะไคร้", price_satang: 15000, stock_quantity: 10 });
  const token = await buyThroughStore(page, "เทียนหอมกลิ่นตะไคร้", 1);
  const orderNumber = (await page.getByTestId("order-number").innerText()).trim();
  await uploadSlip(page);

  const admin = await context.newPage();
  await signInAdminWithMfa(admin);
  await openReviewInAdmin(admin, orderNumber);
  const review = admin.getByRole("region", { name: "ตรวจสลิป" });
  await review.getByLabel("เหตุผลที่ปฏิเสธสลิป").fill("ยอดโอนไม่ตรงกับยอดที่ต้องชำระ");
  await review.getByRole("button", { name: "ปฏิเสธสลิป" }).click();
  await expect(admin.getByTestId("admin-order-status")).toHaveText("รอชำระเงิน");

  // The customer sees the reason on the same link and can upload again.
  await page.reload();
  await expect(page.getByTestId("order-status")).toContainText("รอชำระเงิน");
  await expect(page.getByTestId("rejected-notice")).toContainText("ยอดโอนไม่ตรงกับยอดที่ต้องชำระ");
  await uploadSlip(page);

  await openReviewInAdmin(admin, orderNumber);
  await admin.getByRole("region", { name: "ตรวจสลิป" }).getByRole("button", { name: "ยืนยันการชำระเงิน" }).click();
  await expect(admin.getByTestId("admin-order-status")).toHaveText("ชำระแล้ว");

  await page.reload();
  await expect(page.getByTestId("order-status")).toContainText("ชำระเงินแล้ว");
  await expect(page.getByTestId("rejected-notice")).toHaveCount(0);

  const order = await orderByToken(token);
  expect(order.status).toBe("paid");
  const { data: slips, error } = await adminClient()
    .from("payment_slips")
    .select("review_status")
    .eq("order_id", order.id)
    .order("created_at");
  expect(error).toBeNull();
  expect(slips?.map((slip) => slip.review_status)).toEqual(["rejected", "approved"]);
});

test("unpaid order expires and stock returns", async ({ page }) => {
  const product = await seedProduct({ name: "หมวกสานใบตาล", price_satang: 25000, stock_quantity: 3 });
  const token = await buyThroughStore(page, "หมวกสานใบตาล", 2);
  expect(await stockOf(product.id)).toBe(1);
  const order = await orderByToken(token);

  // The payment window ran out; the scheduled job then runs.
  const past = new Date(Date.now() - 60_000).toISOString();
  const moved = await adminClient().from("orders").update({ expires_at: past }).eq("id", order.id);
  expect(moved.error).toBeNull();
  const expired = await adminClient().rpc("expire_orders");
  expect(expired.error).toBeNull();

  expect((await orderByToken(token)).status).toBe("expired");
  expect(await stockOf(product.id)).toBe(3);

  // Running the job again changes nothing.
  expect((await adminClient().rpc("expire_orders")).error).toBeNull();
  expect(await stockOf(product.id)).toBe(3);

  await page.reload();
  await expect(page.getByTestId("order-status")).toContainText("หมดอายุ");
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(page.getByRole("img", { name: /QR/ })).toHaveCount(0);
  await page.getByRole("link", { name: "กลับไปสั่งซื้อ" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: /หมวกสานใบตาล/ })).toBeVisible();
});
