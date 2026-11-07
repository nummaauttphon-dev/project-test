import AxeBuilder from "@axe-core/playwright";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { deleteTestUsers, signInAdminWithMfa } from "../helpers/admin";
import { adminClient, resetData, seedProduct } from "../helpers/supabase";

const PNG_PATH = path.join(__dirname, "..", "fixtures", "real.png");
const IMAGE_PATH = /^products\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/;

test.beforeAll(async () => {
  await resetData();
  await deleteTestUsers();
});

test.afterAll(async () => {
  await resetData();
  await deleteTestUsers();
  await restoreSettings();
});

test.beforeEach(async ({ page }) => {
  await resetData();
  await restoreSettings();
  await signInAdminWithMfa(page);
});

async function restoreSettings() {
  const { error } = await adminClient()
    .from("store_settings")
    .update({ shipping_fee_satang: 5000, payment_window_minutes: 1440, contact_url: "" })
    .eq("id", 1);
  if (error) throw error;
}

async function expectNoAxeViolations(page: Page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}

test("admin creates a product and it appears in the store", async ({ page }) => {
  await page.goto("/admin/products");
  await expect(page.getByText("ยังไม่มีสินค้า")).toBeVisible();
  await expectNoAxeViolations(page);

  await page.getByRole("link", { name: "เพิ่มสินค้า" }).click();
  await expect(page).toHaveURL(/\/admin\/products\/new$/);
  await page.getByLabel("ชื่อสินค้า").fill("แก้วกาแฟใบใหม่");
  await page.getByLabel("ชื่อในลิงก์ (slug)").fill("new-coffee-cup");
  await page.getByLabel("คำอธิบาย").fill("<b>ทำมือ</b> ทุกใบ");
  await page.getByLabel("ราคา (บาท)").fill("199.5");
  await page.getByLabel("สต็อกเริ่มต้น (ชิ้น)").fill("4");
  await page.getByLabel("รูปสินค้า", { exact: true }).setInputFiles(PNG_PATH);
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "เพิ่มสินค้า" }).click();

  await expect(page).toHaveURL(/\/admin\/products$/);
  const row = page.getByTestId("product-row").filter({ hasText: "แก้วกาแฟใบใหม่" });
  await expect(row).toContainText("฿199.50");
  await expect(row.getByTestId("product-stock")).toHaveText("4 ชิ้น");
  await expect(row.getByTestId("product-status")).toHaveText("แสดงในร้าน");
  const created = await adminClient().from("products").select("image_path, description").eq("slug", "new-coffee-cup").single();
  expect(created.data?.image_path).toMatch(IMAGE_PATH);
  expect(created.data?.description).toBe("<b>ทำมือ</b> ทุกใบ");

  await page.goto("/");
  await page.getByRole("link", { name: /แก้วกาแฟใบใหม่/ }).click();
  await expect(page).toHaveURL(/\/products\/new-coffee-cup$/);
  await expect(page.getByRole("heading", { level: 1, name: "แก้วกาแฟใบใหม่" })).toBeVisible();
  await expect(page.getByText("฿199.50").first()).toBeVisible();
  // The description is text, never markup.
  await expect(page.getByText("<b>ทำมือ</b> ทุกใบ")).toBeVisible();
});

test("shows field errors without clearing the form, and edits a product", async ({ page }) => {
  await seedProduct({ slug: "taken-slug", name: "สินค้าเดิม" });

  await page.goto("/admin/products/new");
  await page.getByLabel("ชื่อสินค้า").fill("สินค้าซ้ำ");
  await page.getByLabel("ชื่อในลิงก์ (slug)").fill("taken-slug");
  await page.getByLabel("ราคา (บาท)").fill("1.234");
  await page.getByRole("button", { name: "เพิ่มสินค้า" }).click();
  await expect(page.getByTestId("price-error")).toContainText("ทศนิยมไม่เกิน 2 ตำแหน่ง");
  await expect(page.getByLabel("ราคา (บาท)")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("ชื่อสินค้า")).toHaveValue("สินค้าซ้ำ");

  await page.getByLabel("ราคา (บาท)").fill("10");
  await page.getByRole("button", { name: "เพิ่มสินค้า" }).click();
  await expect(page.getByTestId("slug-error")).toContainText("ซ้ำ");
  await expectNoAxeViolations(page);

  await page.goto("/admin/products");
  await page.getByRole("link", { name: "สินค้าเดิม" }).click();
  await expect(page.getByLabel("ชื่อสินค้า")).toHaveValue("สินค้าเดิม");
  await expect(page.getByLabel("ราคา (บาท)")).toHaveValue("100");
  await page.getByLabel("ราคา (บาท)").fill("123.45");
  await page.getByLabel("รูปสินค้า", { exact: true }).setInputFiles(PNG_PATH);
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "บันทึกการแก้ไข" }).click();
  await expect(page.getByTestId("saved")).toHaveText("บันทึกสินค้าแล้ว");

  await page.goto("/admin/products");
  await expect(page.getByTestId("product-row")).toContainText("฿123.45");
  const edited = await adminClient().from("products").select("image_path, price_satang").eq("slug", "taken-slug").single();
  expect(edited.data?.price_satang).toBe(12345);
  expect(edited.data?.image_path).toMatch(IMAGE_PATH);
});

test("adjusts stock from the list and refuses to go below zero", async ({ page }) => {
  await seedProduct({ name: "ปรับสต็อก", stock_quantity: 3 });
  await page.goto("/admin/products");
  const row = page.getByTestId("product-row");

  await row.getByLabel("ปรับสต็อก ปรับสต็อก (ชิ้น)").fill("2");
  await row.getByRole("button", { name: "เพิ่ม", exact: true }).click();
  await expect(row.getByTestId("product-stock")).toHaveText("5 ชิ้น");
  await expect(row.getByTestId("stock-result")).toHaveText("สต็อกของ ปรับสต็อก เหลือ 5 ชิ้น");

  await row.getByLabel("ปรับสต็อก ปรับสต็อก (ชิ้น)").fill("9");
  await row.getByRole("button", { name: "ลด", exact: true }).click();
  await expect(row.getByTestId("action-error")).toContainText("สต็อกไม่พอ");
  await expect(row.getByTestId("product-stock")).toHaveText("5 ชิ้น");

  await row.getByLabel("ปรับสต็อก ปรับสต็อก (ชิ้น)").fill("0");
  await row.getByRole("button", { name: "ลด", exact: true }).click();
  await expect(row.getByTestId("stock-amount-error")).toHaveText("กรอกจำนวนเต็ม 1-1,000");
  await expectNoAxeViolations(page);
});

test("hidden product disappears from the store", async ({ page }) => {
  await seedProduct({ name: "สินค้าที่จะซ่อน", slug: "to-hide" });
  await page.goto("/");
  await expect(page.getByRole("link", { name: /สินค้าที่จะซ่อน/ })).toBeVisible();

  await page.goto("/admin/products");
  await page.getByRole("button", { name: "ซ่อน สินค้าที่จะซ่อน จากร้าน" }).click();
  await expect(page.getByTestId("product-status")).toHaveText("ซ่อนอยู่");

  await page.goto("/");
  await expect(page.getByRole("link", { name: /สินค้าที่จะซ่อน/ })).toHaveCount(0);
  expect((await page.goto("/products/to-hide"))?.status()).toBe(404);

  await page.goto("/admin/products");
  await page.getByRole("button", { name: "แสดง สินค้าที่จะซ่อน ในร้าน" }).click();
  await expect(page.getByTestId("product-status")).toHaveText("แสดงในร้าน");
  await page.goto("/");
  await expect(page.getByRole("link", { name: /สินค้าที่จะซ่อน/ })).toBeVisible();
});

test("changed shipping fee appears in the cart", async ({ page }) => {
  const product = await seedProduct({ name: "สินค้าในตะกร้า", price_satang: 10000 });
  await page.addInitScript((value) => window.localStorage.setItem("cart.v1", value), JSON.stringify([
    { productId: product.id, quantity: 1 },
  ]));

  await page.goto("/cart");
  await expect(page.getByTestId("cart-total")).toHaveText("฿150.00");

  await page.goto("/admin/settings");
  await expect(page.getByLabel("ค่าจัดส่ง (บาท)")).toHaveValue("50");
  await expect(page.getByLabel("เวลาให้แนบสลิป (นาที)")).toHaveValue("1440");
  await expect(page.getByText(/PromptPay/)).toBeVisible();
  await expect(page.getByLabel(/promptpay/i)).toHaveCount(0);
  await expectNoAxeViolations(page);

  await page.getByLabel("ค่าจัดส่ง (บาท)").fill("65.50");
  await page.getByRole("button", { name: "บันทึกการตั้งค่า" }).click();
  await expect(page.getByTestId("saved")).toHaveText("บันทึกการตั้งค่าแล้ว");

  await page.goto("/cart");
  await expect(page.getByTestId("cart-total")).toHaveText("฿165.50");
});

test("settings show field errors for a bad window and a javascript: link", async ({ page }) => {
  await page.goto("/admin/settings");
  await page.getByLabel("เวลาให้แนบสลิป (นาที)").fill("0");
  await page.getByLabel("ช่องทางติดต่อร้าน (ลิงก์)").fill("javascript:alert(1)");
  await page.getByRole("button", { name: "บันทึกการตั้งค่า" }).click();

  await expect(page.getByTestId("payment-window-error")).toBeVisible();
  await expect(page.getByTestId("contact-url-error")).toBeVisible();
  await expect(page.getByLabel("ช่องทางติดต่อร้าน (ลิงก์)")).toHaveAttribute("aria-invalid", "true");
  await expectNoAxeViolations(page);

  const { data } = await adminClient().from("store_settings").select("payment_window_minutes, contact_url").eq("id", 1).single();
  expect(data).toEqual({ payment_window_minutes: 1440, contact_url: "" });
});
