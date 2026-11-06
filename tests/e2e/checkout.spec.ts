import { expect, test, type Page } from "@playwright/test";
import { adminClient, resetData, seedProduct } from "../helpers/supabase";

test.beforeEach(async () => {
  await resetData();
});

/** Seeds the cart once; a later navigation (to the order page) must not bring it back. */
async function seedCart(page: Page, lines: { productId: string; quantity: number }[]) {
  await page.addInitScript((value) => {
    if (!window.localStorage.getItem("e2e.seeded")) {
      window.localStorage.setItem("e2e.seeded", "1");
      window.localStorage.setItem("cart.v1", value);
    }
  }, JSON.stringify(lines));
}

async function fillForm(page: Page) {
  await page.getByLabel("ชื่อผู้รับ").fill("สมชาย ใจดี");
  await page.getByLabel("เบอร์โทรศัพท์").fill("081-234-5678");
  await page.getByLabel("ที่อยู่จัดส่ง").fill("123/45 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพฯ 10110");
}

async function orders() {
  const { data, error } = await adminClient().from("orders").select("id, total_satang, token_hash");
  if (error) throw error;
  return data ?? [];
}

test("places an order on mobile and lands on the order page", async ({ page }) => {
  const product = await seedProduct({ name: "แก้วกาแฟเซรามิก", price_satang: 12000, stock_quantity: 5 });
  await seedCart(page, [{ productId: product.id, quantity: 2 }]);

  await page.goto("/checkout");
  await expect(page.getByTestId("checkout-total")).toHaveText("฿290.00");
  await expect(page.getByRole("link", { name: "นโยบายความเป็นส่วนตัว" })).toHaveAttribute("href", "/privacy");
  await fillForm(page);
  await page.getByRole("button", { name: "ยืนยันสั่งซื้อ" }).click();

  // The order page itself arrives with Task 9; here the URL and the database row are enough.
  await expect(page).toHaveURL(/\/orders\/[A-Za-z0-9_-]{20,}$/);
  const rows = await orders();
  expect(rows).toHaveLength(1);
  expect(rows[0].total_satang).toBe(29000);
  const token = new URL(page.url()).pathname.split("/").pop() ?? "";
  expect(rows[0].token_hash).not.toContain(token);

  const { data: stock } = await adminClient().from("products").select("stock_quantity").eq("id", product.id).single();
  expect(stock?.stock_quantity).toBe(3);
  const cart = await page.evaluate(() => window.localStorage.getItem("cart.v1"));
  expect(JSON.parse(cart ?? "null")).toEqual([]);
});

test("double click creates one order", async ({ page }) => {
  const product = await seedProduct({ stock_quantity: 5 });
  await seedCart(page, [{ productId: product.id, quantity: 1 }]);
  let posts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/checkout") posts++;
  });

  await page.goto("/checkout");
  await fillForm(page);
  posts = 0; // the cart view load above is also a server action POST
  await page.getByRole("button", { name: "ยืนยันสั่งซื้อ" }).dblclick();

  await expect(page).toHaveURL(/\/orders\//);
  expect(await orders()).toHaveLength(1);
  expect(posts).toBe(1);
});

test("keeps input when validation fails", async ({ page }) => {
  const product = await seedProduct();
  await seedCart(page, [{ productId: product.id, quantity: 1 }]);

  await page.goto("/checkout");
  await page.getByLabel("ชื่อผู้รับ").fill("  ");
  await page.getByLabel("เบอร์โทรศัพท์").fill("12345");
  await page.getByLabel("ที่อยู่จัดส่ง").fill("สั้นไป");
  await page.getByRole("button", { name: "ยืนยันสั่งซื้อ" }).click();

  await expect(page.getByTestId("checkout-alert")).toContainText("กรุณากรอกชื่อ");
  await expect(page.getByLabel("ชื่อผู้รับ")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("ชื่อผู้รับ")).toHaveAccessibleDescription("กรุณากรอกชื่อ");
  await expect(page.getByLabel("เบอร์โทรศัพท์")).toHaveAccessibleDescription(/เช่น 081-234-5678.*เบอร์โทรไม่ถูกต้อง/);
  await expect(page.getByLabel("ที่อยู่จัดส่ง")).toHaveAccessibleDescription(/กรุณากรอกที่อยู่ให้ครบถ้วน/);
  await expect(page.getByLabel("เบอร์โทรศัพท์")).toHaveValue("12345");
  await expect(page.getByLabel("ที่อยู่จัดส่ง")).toHaveValue("สั้นไป");
  await expect(page.getByRole("button", { name: "ยืนยันสั่งซื้อ" })).toBeEnabled();
  expect(await orders()).toHaveLength(0);

  // Fixing the input and submitting again works.
  await fillForm(page);
  await page.getByRole("button", { name: "ยืนยันสั่งซื้อ" }).click();
  await expect(page).toHaveURL(/\/orders\//);
  expect(await orders()).toHaveLength(1);
});

test("price change asks for reconfirmation before ordering", async ({ page }) => {
  const product = await seedProduct({ name: "ปากกาเจล", price_satang: 10000, stock_quantity: 5 });
  await seedCart(page, [{ productId: product.id, quantity: 1 }]);

  await page.goto("/checkout");
  await expect(page.getByTestId("checkout-total")).toHaveText("฿150.00");
  await fillForm(page);

  const { error } = await adminClient().from("products").update({ price_satang: 12000 }).eq("id", product.id);
  expect(error).toBeNull();
  await page.getByRole("button", { name: "ยืนยันสั่งซื้อ" }).click();

  await expect(page.getByTestId("checkout-status")).toContainText("ยอดรวมทั้งหมดเปลี่ยนเป็น ฿170.00");
  await expect(page.getByTestId("checkout-status")).not.toContainText("ราคาสินค้าเปลี่ยน");
  await expect(page.getByTestId("checkout-total")).toHaveText("฿170.00");
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.getByLabel("ชื่อผู้รับ")).toHaveValue("สมชาย ใจดี");
  expect(await orders()).toHaveLength(0);

  // Confirming again sends the new total and creates the order.
  await page.getByRole("button", { name: "ยืนยันสั่งซื้อ" }).click();
  await expect(page).toHaveURL(/\/orders\//);
  const rows = await orders();
  expect(rows).toHaveLength(1);
  expect(rows[0].total_satang).toBe(17000);
});
