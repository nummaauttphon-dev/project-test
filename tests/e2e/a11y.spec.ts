import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createAdminUser, deleteTestUsers, signInAdminWithMfa, submitPassword } from "../helpers/admin";
import { newToken, seedOrderWithToken, seedPendingSlip, seedRejectedSlip } from "../helpers/orders";
import { resetData, seedOrder, seedProduct } from "../helpers/supabase";

const slipImage = readFileSync(path.join(__dirname, "..", "fixtures", "real.png"));
const PAST = "2020-01-01T00:00:00.000Z";

test.beforeAll(async () => {
  await resetData();
  await deleteTestUsers();
});

test.afterAll(async () => {
  await resetData();
  await deleteTestUsers();
});

test.beforeEach(async () => {
  await resetData();
});

/** Fails on serious and critical violations of any axe rule, and names the rule and elements. */
async function expectNoSeriousViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => ({
      rule: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => node.target.join(" ")),
    }));
  expect(serious, label).toEqual([]);
}

async function seedCart(page: Page, lines: { productId: string; quantity: number }[]): Promise<void> {
  // Once only: a later navigation (to the order page) must not bring the cart back.
  await page.addInitScript((value) => {
    if (!window.localStorage.getItem("e2e.seeded")) {
      window.localStorage.setItem("e2e.seeded", "1");
      window.localStorage.setItem("cart.v1", value);
    }
  }, JSON.stringify(lines));
}

type Route = {
  name: string;
  admin?: boolean;
  /** Seeds what the page needs and opens it. */
  open: (page: Page) => Promise<void>;
};

const h1 = (page: Page) => expect(page.getByRole("heading", { level: 1 })).toBeVisible();

async function orderPage(page: Page, overrides: Record<string, unknown>, extra?: (orderId: string) => Promise<void>) {
  const { order, token } = await seedOrderWithToken(overrides);
  if (extra) await extra(order.id);
  await page.goto(`/orders/${token}`);
  await expect(page.getByTestId("order-status")).toBeVisible();
}

const publicAndAdminRoutes: Route[] = [
  {
    name: "/ (with products)",
    open: async (page) => {
      await seedProduct({ name: "สินค้าพร้อมขาย" });
      await seedProduct({ name: "สินค้าหมดแล้ว", stock_quantity: 0 });
      await page.goto("/");
      await h1(page);
    },
  },
  { name: "/ (empty store)", open: async (page) => (await page.goto("/"), h1(page)) },
  {
    name: "/products/[slug]",
    open: async (page) => {
      const product = await seedProduct({ name: "สินค้าตรวจเข้าถึง" });
      await page.goto(`/products/${product.slug}`);
      await h1(page);
    },
  },
  {
    name: "/products/[slug] (sold out)",
    open: async (page) => {
      const product = await seedProduct({ name: "สินค้าหมด", stock_quantity: 0 });
      await page.goto(`/products/${product.slug}`);
      await h1(page);
    },
  },
  {
    name: "/products/[slug] (404)",
    open: async (page) => {
      expect((await page.goto("/products/no-such-product"))?.status()).toBe(404);
      await h1(page);
    },
  },
  { name: "/cart (empty)", open: async (page) => (await page.goto("/cart"), h1(page)) },
  {
    name: "/cart (with items and notices)",
    open: async (page) => {
      const product = await seedProduct({ name: "สินค้าในตะกร้า", stock_quantity: 2 });
      await seedCart(page, [{ productId: product.id, quantity: 5 }]);
      await page.goto("/cart");
      await expect(page.getByTestId("cart-total")).toBeVisible();
      await expect(page.getByTestId("cart-status")).toContainText("ปรับจำนวน");
    },
  },
  {
    name: "/checkout (validation errors)",
    open: async (page) => {
      const product = await seedProduct();
      await seedCart(page, [{ productId: product.id, quantity: 1 }]);
      await page.goto("/checkout");
      await expect(page.getByTestId("checkout-total")).toBeVisible();
      await page.getByRole("button", { name: "ยืนยันสั่งซื้อ" }).click();
      await expect(page.getByTestId("checkout-alert")).toContainText("กรุณา");
    },
  },
  { name: "/privacy", open: async (page) => (await page.goto("/privacy"), h1(page)) },
  { name: "/orders/[token] awaiting_payment", open: (page) => orderPage(page, {}) },
  {
    name: "/orders/[token] awaiting_payment after a rejected slip",
    open: (page) => orderPage(page, {}, (id) => seedRejectedSlip(id, "ยอดเงินไม่ตรง")),
  },
  {
    name: "/orders/[token] slip upload error",
    open: async (page) => {
      await orderPage(page, {});
      await page
        .getByLabel("เลือกรูปสลิปการโอนเงิน")
        .setInputFiles({ name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("not an image") });
      await page.getByRole("button", { name: "ส่งสลิป" }).click();
      await expect(page.getByTestId("slip-error")).not.toBeEmpty();
    },
  },
  { name: "/orders/[token] payment_review", open: (page) => orderPage(page, { status: "payment_review" }) },
  { name: "/orders/[token] paid", open: (page) => orderPage(page, { status: "paid" }) },
  {
    name: "/orders/[token] shipped",
    open: (page) => orderPage(page, { status: "shipped", tracking_number: "TH123456789" }),
  },
  { name: "/orders/[token] expired", open: (page) => orderPage(page, { expires_at: PAST }) },
  { name: "/orders/[token] cancelled", open: (page) => orderPage(page, { status: "cancelled" }) },
  {
    name: "/orders/[token] (404)",
    open: async (page) => {
      expect((await page.goto(`/orders/${newToken()}`))?.status()).toBe(404);
      await h1(page);
    },
  },
  {
    name: "/admin/login",
    open: async (page) => {
      await page.goto("/admin/login");
      await h1(page);
      // The failed sign-in state too.
      await page.getByLabel("อีเมล").fill("nobody@admin-test.example.com");
      await page.getByLabel("รหัสผ่าน").fill("wrong-password");
      await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
      await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toBeVisible();
    },
  },
  {
    name: "/admin/mfa (enrollment)",
    open: async (page) => {
      await submitPassword(page, await createAdminUser());
      await page.waitForURL(/\/admin\/mfa$/);
      await page.getByRole("button", { name: "เริ่มตั้งค่า" }).click();
      await expect(page.getByTestId("totp-secret")).toBeVisible();
    },
  },
  {
    name: "/admin/mfa (challenge)",
    open: async (page) => {
      const admin = await signInAdminWithMfa(page);
      await page.context().clearCookies();
      await submitPassword(page, admin);
      await page.waitForURL(/\/admin\/mfa$/);
      await expect(page.getByLabel("รหัส 6 หลัก")).toBeVisible();
    },
  },
  {
    name: "/admin",
    admin: true,
    open: async (page) => {
      await seedOrder({ status: "payment_review" });
      await seedOrder({ status: "paid" });
      await seedProduct({ name: "สินค้าใกล้หมด", stock_quantity: 1 });
      await page.goto("/admin");
      await h1(page);
    },
  },
  {
    name: "/admin/orders",
    admin: true,
    open: async (page) => {
      await seedOrder({ status: "payment_review" });
      await seedOrder({ status: "shipped" });
      await page.goto("/admin/orders");
      await expect(page.getByTestId("order-row")).toHaveCount(2);
    },
  },
  {
    name: "/admin/orders (empty filter)",
    admin: true,
    open: async (page) => {
      await page.goto("/admin/orders?status=cancelled");
      await h1(page);
    },
  },
  {
    name: "/admin/orders/[id] payment_review with slip",
    admin: true,
    open: async (page) => {
      const { order } = await seedOrderWithToken({ status: "payment_review" });
      await seedPendingSlip(order.id, slipImage);
      await page.goto(`/admin/orders/${order.id}`);
      await expect(page.getByRole("region", { name: "ตรวจสลิป" }).getByRole("img")).toBeVisible();
    },
  },
  {
    name: "/admin/orders/[id] paid with cancel dialog",
    admin: true,
    open: async (page) => {
      const { order } = await seedOrderWithToken({ status: "paid" });
      await page.goto(`/admin/orders/${order.id}`);
      await page.getByRole("button", { name: "ยกเลิกคำสั่งซื้อ" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
    },
  },
  {
    name: "/admin/orders/[id] shipped",
    admin: true,
    open: async (page) => {
      const { order } = await seedOrderWithToken({ status: "shipped", tracking_number: "TH1" });
      await page.goto(`/admin/orders/${order.id}`);
      await h1(page);
    },
  },
  {
    name: "/admin/products",
    admin: true,
    open: async (page) => {
      await seedProduct({ name: "สินค้าขายอยู่" });
      await seedProduct({ name: "สินค้าซ่อน", is_active: false });
      await page.goto("/admin/products");
      await h1(page);
    },
  },
  {
    name: "/admin/products/new (validation errors)",
    admin: true,
    open: async (page) => {
      await page.goto("/admin/products/new");
      await h1(page);
      await page.getByRole("main").getByRole("button", { name: "เพิ่มสินค้า" }).click();
      await expect(page.locator('[aria-invalid="true"]').first()).toBeVisible();
    },
  },
  {
    name: "/admin/products/[id]",
    admin: true,
    open: async (page) => {
      const product = await seedProduct({ name: "สินค้าแก้ไข" });
      await page.goto(`/admin/products/${product.id}`);
      await h1(page);
    },
  },
  {
    name: "/admin/settings",
    admin: true,
    open: async (page) => {
      await page.goto("/admin/settings");
      await h1(page);
    },
  },
  {
    name: "/admin unknown URL (404)",
    admin: true,
    open: async (page) => {
      expect((await page.goto("/admin/no-such-page"))?.status()).toBe(404);
      await notFoundPage(page, "กลับไปหน้าแรกหลังร้าน");
    },
  },
  {
    name: "/admin/orders/[id] unknown order (404)",
    admin: true,
    open: async (page) => {
      expect((await page.goto("/admin/orders/00000000-0000-4000-8000-000000000000"))?.status()).toBe(404);
      await notFoundPage(page, "กลับไปหน้าแรกหลังร้าน");
    },
  },
  {
    name: "unmatched URL (404)",
    open: async (page) => {
      expect((await page.goto("/no-such-page"))?.status()).toBe(404);
      await notFoundPage(page, "กลับไปหน้าร้าน");
    },
  },
];

/** A 404 in Thai inside one main landmark, with a way back. */
async function notFoundPage(page: Page, backLink: string): Promise<void> {
  await expect(page.getByRole("heading", { level: 1, name: "ไม่พบหน้าที่ต้องการ" })).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("main").getByRole("link", { name: backLink })).toBeVisible();
}

for (const route of publicAndAdminRoutes) {
  test(`${route.name} has no serious axe violations`, async ({ page }) => {
    if (route.admin) await signInAdminWithMfa(page);
    await route.open(page);
    await expectNoSeriousViolations(page, route.name);
  });
}

/** Presses Tab until `target` has focus, like a keyboard user moving through the page. */
async function tabTo(page: Page, target: Locator, maxPresses = 40): Promise<void> {
  for (let i = 0; i < maxPresses; i++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error(`could not reach ${target} with Tab`);
}

/** The focused element shows a visible focus indicator (outline or ring). */
async function expectVisibleFocus(target: Locator): Promise<void> {
  const style = await target.evaluate((el) => {
    const s = getComputedStyle(el);
    return { outline: s.outlineStyle, width: parseFloat(s.outlineWidth), shadow: s.boxShadow };
  });
  const outlined = style.outline !== "none" && style.width > 0;
  expect(outlined || style.shadow !== "none", JSON.stringify(style)).toBe(true);
}

test("checkout and slip upload work with keyboard only", async ({ page }) => {
  const product = await seedProduct({ name: "สินค้าคีย์บอร์ด", price_satang: 10000, stock_quantity: 5 });
  await seedCart(page, [{ productId: product.id, quantity: 1 }]);

  await page.goto("/checkout");
  await expect(page.getByTestId("checkout-total")).toHaveText("฿150.00");

  // The first Tab reaches the skip link, which is visible while focused.
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "ข้ามไปยังเนื้อหาหลัก" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();

  for (const [label, value] of [
    ["ชื่อผู้รับ", "สมศรี มีสุข"],
    ["เบอร์โทรศัพท์", "0812345678"],
    ["ที่อยู่จัดส่ง", "55 ถนนพระราม 9 แขวงห้วยขวาง เขตห้วยขวาง กรุงเทพฯ 10310"],
  ] as const) {
    const field = page.getByLabel(label);
    await tabTo(page, field);
    await expectVisibleFocus(field);
    await page.keyboard.type(value);
    await expect(field).toHaveValue(value);
  }

  const confirm = page.getByRole("button", { name: "ยืนยันสั่งซื้อ" });
  await tabTo(page, confirm);
  await expectVisibleFocus(confirm);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/orders\/[A-Za-z0-9_-]{20,}$/);
  await expect(page.getByTestId("order-status")).toContainText("รอชำระเงิน");

  // The file picker opens from the keyboard, and the form submits with Enter.
  const fileInput = page.getByLabel("เลือกรูปสลิปการโอนเงิน");
  await tabTo(page, fileInput);
  await expectVisibleFocus(fileInput);
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.keyboard.press("Space")]);
  await chooser.setFiles({ name: "slip.png", mimeType: "image/png", buffer: slipImage });
  await expect(page.getByTestId("slip-file-name")).toHaveText("ไฟล์ที่เลือก: slip.png");

  const send = page.getByRole("button", { name: "ส่งสลิป" });
  await tabTo(page, send);
  await expectVisibleFocus(send);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("order-status")).toContainText("รอร้านตรวจสอบ");
});
