import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { crc32, deflateSync } from "node:zlib";
import { adminClient, resetData, seedProduct } from "../helpers/supabase";

/** A valid solid-colour PNG; the 2x2 fixture is too small for the image optimizer to re-encode. */
function solidPng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x9a)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test.beforeEach(async () => {
  await resetData();
});

async function seedCart(page: Page, lines: { productId: string; quantity: number }[]) {
  await page.addInitScript((value) => {
    window.localStorage.setItem("cart.v1", value);
  }, JSON.stringify(lines));
}

test("adds a product to the cart and shows total with shipping", async ({ page }) => {
  const product = await seedProduct({ name: "แก้วกาแฟเซรามิก", price_satang: 12000, stock_quantity: 5 });

  await page.goto("/");
  await page.getByRole("link", { name: /แก้วกาแฟเซรามิก/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "แก้วกาแฟเซรามิก" })).toBeVisible();
  await expect(page.getByText("฿120.00").first()).toBeVisible();

  await page.getByLabel("จำนวน").selectOption("2");
  await page.getByRole("button", { name: "เพิ่มลงตะกร้า" }).click();
  await expect(page.getByRole("status").filter({ hasText: "เพิ่มลงตะกร้าแล้ว รวม 2 ชิ้น" })).toBeVisible();
  await expect(page.getByRole("link", { name: /ตะกร้า.*2/ })).toBeVisible();

  await page.getByRole("link", { name: "ดูตะกร้า" }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByRole("link", { name: product.name })).toBeVisible();
  await expect(page.getByTestId("cart-total")).toHaveText("฿290.00"); // 2 x 120.00 + 50.00 shipping
  await expect(page.getByRole("link", { name: "ไปหน้าชำระเงิน" })).toHaveAttribute("href", "/checkout");

  // Editing the quantity recomputes the total; removing the last line shows the empty state.
  await page.getByLabel(`จำนวน ${product.name}`).selectOption("1");
  await expect(page.getByTestId("cart-total")).toHaveText("฿170.00");
  await page.getByRole("button", { name: `ลบ ${product.name} ออกจากตะกร้า` }).click();
  await expect(page.getByRole("status").filter({ hasText: `นำ ${product.name} ออกจากตะกร้าแล้ว` })).toBeVisible();
  await expect(page.getByRole("heading", { name: "ตะกร้าของคุณยังว่างอยู่" })).toBeVisible();
});

test("shows sold-out label and disables adding", async ({ page }) => {
  const product = await seedProduct({ name: "สมุดโน้ตหมด", stock_quantity: 0 });

  await page.goto("/");
  await expect(page.getByRole("link", { name: /สมุดโน้ตหมด/ }).getByText("สินค้าหมด")).toBeVisible();

  await page.goto(`/products/${product.slug}`);
  await expect(page.getByText("สินค้าหมด")).toBeVisible();
  await expect(page.getByRole("button", { name: "เพิ่มลงตะกร้าไม่ได้" })).toBeDisabled();
});

test("shows empty cart state with link back", async ({ page }) => {
  await page.goto("/cart");
  await expect(page.getByRole("heading", { name: "ตะกร้าของคุณยังว่างอยู่" })).toBeVisible();
  await page.getByRole("link", { name: "เลือกดูสินค้า" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("shows empty store state when there are no products", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "ยังไม่มีสินค้าในร้านตอนนี้" })).toBeVisible();
});

test("survives corrupted cart in localStorage", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("cart.v1", "{broken"));
  await page.goto("/cart");
  await expect(page.getByRole("heading", { name: "ตะกร้าของคุณยังว่างอยู่" })).toBeVisible();
});

test("hidden product returns 404", async ({ page }) => {
  const hidden = await seedProduct({ is_active: false });
  const response = await page.goto(`/products/${hidden.slug}`);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "ไม่พบหน้าที่ต้องการ" })).toBeVisible();
  await expect(page.getByText(hidden.name)).toHaveCount(0);
});

test("cart announces removed and adjusted items", async ({ page }) => {
  const hidden = await seedProduct({ is_active: false });
  const low = await seedProduct({ name: "ปากกาสต็อกน้อย", stock_quantity: 2 });
  await seedCart(page, [
    { productId: hidden.id, quantity: 1 },
    { productId: low.id, quantity: 5 },
  ]);

  await page.goto("/cart");
  const status = page.getByRole("status");
  await expect(status.filter({ hasText: "นำสินค้า 1 รายการที่หมดหรือไม่มีจำหน่ายแล้วออกจากตะกร้า" })).toBeVisible();
  await expect(status.filter({ hasText: "ปรับจำนวน ปากกาสต็อกน้อย เหลือ 2 ชิ้น" })).toBeVisible();
  await expect(page.getByLabel(`จำนวน ${low.name}`)).toHaveValue("2");
  await expect(page.getByText(hidden.name)).toHaveCount(0);

  // The corrected cart is what gets stored.
  const stored = await page.evaluate(() => window.localStorage.getItem("cart.v1"));
  expect(JSON.parse(stored ?? "[]")).toEqual([{ productId: low.id, quantity: 2 }]);
});

test("has no detectable accessibility violations", async ({ page }) => {
  const product = await seedProduct({ name: "สินค้าตรวจเข้าถึง" });
  await seedCart(page, [{ productId: product.id, quantity: 1 }]);

  for (const path of ["/", `/products/${product.slug}`, "/cart"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    if (path === "/cart") await expect(page.getByTestId("cart-total")).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations, path).toEqual([]);
  }
});

test("loads a product image from Supabase storage and falls back when it is missing", async ({ page }) => {
  const path = `e2e-${Date.now()}.png`;
  const upload = await adminClient()
    .storage.from("product-images")
    .upload(path, solidPng(64, 64), { contentType: "image/png" });
  expect(upload.error).toBeNull();
  const withImage = await seedProduct({ name: "สินค้ามีรูป", image_path: path });
  const brokenImage = await seedProduct({ name: "สินค้ารูปหาย", image_path: "missing/none.png" });

  try {
    await page.goto(`/products/${withImage.slug}`);
    const image = page.getByRole("img", { name: withImage.name });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);

    // Answer the optimizer request for the missing object the way the optimizer itself does (400,
    // since Storage answers 400 for a missing object), so the server does not log the expected
    // "upstream image response failed" error into the test output. The fallback still runs on a
    // real failed <img> load in the browser.
    let missingRequests = 0;
    await page.route(/\/_next\/image\?url=.*none\.png/, async (route) => {
      missingRequests++;
      await route.fulfill({ status: 400, contentType: "text/plain", body: "upstream image response failed" });
    });
    await page.goto(`/products/${brokenImage.slug}`);
    await expect(page.getByRole("img", { name: "ไม่มีรูปสินค้า" })).toBeVisible();
    expect(missingRequests).toBeGreaterThan(0);
  } finally {
    await adminClient().storage.from("product-images").remove([path]);
  }
});

test("drops stored lines with a non-UUID product id instead of breaking the cart", async ({ page }) => {
  await seedCart(page, [{ productId: "x", quantity: 1 }]);
  await page.goto("/cart");
  await expect(page.getByRole("heading", { name: "ตะกร้าของคุณยังว่างอยู่" })).toBeVisible();
  await expect(page.getByText("ข้อมูลตะกร้าไม่ถูกต้อง")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^ตะกร้า$/ })).toBeVisible(); // no count badge
});

test("cart status live region stays mounted while notices appear", async ({ page }) => {
  const low = await seedProduct({ name: "ปากกาสต็อกน้อย", stock_quantity: 2 });
  await seedCart(page, [{ productId: low.id, quantity: 5 }]);
  // Hold the server action so the page is observed before and after the notice appears.
  await page.route("**/cart", async (route) => {
    if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue();
  });

  await page.goto("/cart");
  const status = page.getByTestId("cart-status");
  await expect(status).toBeAttached();
  await expect(status).toHaveText("");
  await status.evaluate((el) => el.setAttribute("data-mark", "same"));

  await expect(status).toContainText("ปรับจำนวน ปากกาสต็อกน้อย เหลือ 2 ชิ้น");
  await expect(status).toHaveAttribute("data-mark", "same");
  await expect(page.getByRole("status")).toHaveCount(1);
});

test("tells the customer when the cart cannot be saved", async ({ page }) => {
  const product = await seedProduct({ name: "สินค้าบันทึกไม่ได้" });
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("blocked", "QuotaExceededError");
    };
  });
  await page.goto(`/products/${product.slug}`);
  await page.getByRole("button", { name: "เพิ่มลงตะกร้า" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "บันทึกตะกร้าไม่สำเร็จ" })).toBeVisible();
  await expect(page.getByText("เพิ่มลงตะกร้าแล้ว")).toHaveCount(0);
});

test("refuses a 51st distinct product with an error", async ({ page }) => {
  const product = await seedProduct({ name: "สินค้ารายการที่ 51" });
  await seedCart(
    page,
    Array.from({ length: 50 }, (_, i) => ({
      productId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      quantity: 1,
    })),
  );
  await page.goto(`/products/${product.slug}`);
  await page.getByRole("button", { name: "เพิ่มลงตะกร้า" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "ตะกร้าเต็มแล้ว" })).toBeVisible();
  await expect(page.getByText("เพิ่มลงตะกร้าแล้ว")).toHaveCount(0);
});
