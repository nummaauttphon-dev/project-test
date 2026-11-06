import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { adminClient, resetData } from "../helpers/supabase";
import { newToken, seedOrderWithToken, seedRejectedSlip, slipObjects } from "../helpers/orders";

const PAST = "2020-01-01T00:00:00.000Z";
const fixture = (name: string) => readFileSync(path.join(__dirname, "..", "fixtures", name));

test.beforeEach(async () => {
  await resetData();
});

async function setContactUrl(value: string) {
  const { error } = await adminClient().from("store_settings").update({ contact_url: value }).eq("id", 1);
  if (error) throw error;
}

test.describe("awaiting payment", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("shows QR with amount text, countdown and copy link", async ({ page }) => {
    const { order, token } = await seedOrderWithToken();
    await page.goto(`/orders/${token}`);

    await expect(page.getByTestId("order-number")).toHaveText(order.order_number);
    await expect(page.getByTestId("order-status")).toContainText("รอชำระเงิน");
    await expect(page.getByTestId("amount")).toHaveText("฿150.00");
    const qr = page.getByRole("img", { name: "QR พร้อมเพย์สำหรับชำระเงิน ฿150.00" });
    await expect(qr).toBeVisible();
    await expect(qr).toHaveAttribute("src", /^data:image\/png;base64,/);

    await expect(page.getByTestId("countdown")).toHaveText(/^2[34]:\d\d:\d\d$/);
    // The ticking text is hidden from assistive technology; the spoken text is minute-level.
    await expect(page.getByTestId("countdown")).toHaveAttribute("aria-hidden", "true");
    await expect(page.getByTestId("countdown-spoken")).toHaveText(/^เหลือเวลาอีก \d+ ชั่วโมง \d+ นาที$/);

    await page.getByRole("button", { name: "คัดลอกลิงก์คำสั่งซื้อ" }).click();
    await expect(page.getByTestId("copy-status")).toHaveText("คัดลอกลิงก์แล้ว");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());

    // The PromptPay ID reaches the browser only inside the QR image.
    const html = await page.content();
    expect(html).not.toContain(process.env.PROMPTPAY_ID ?? "no-promptpay-id");
    expect(html).not.toContain("PROMPTPAY");
  });

  test("shows the link to copy when the clipboard is refused", async ({ page }) => {
    const { token } = await seedOrderWithToken();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: () => Promise.reject(new Error("denied")) },
        configurable: true,
      });
    });
    await page.goto(`/orders/${token}`);
    await page.getByRole("button", { name: "คัดลอกลิงก์คำสั่งซื้อ" }).click();
    await expect(page.getByTestId("copy-status")).toContainText("คัดลอกอัตโนมัติไม่สำเร็จ");
    await expect(page.getByLabel("ลิงก์คำสั่งซื้อ")).toHaveValue(page.url());
  });

  test("save QR button downloads an image", async ({ page }) => {
    const { order, token } = await seedOrderWithToken();
    await page.goto(`/orders/${token}`);
    const link = page.getByRole("link", { name: "บันทึกรูป QR" });
    await expect(link).toHaveAttribute("download", `promptpay-${order.order_number}.png`);
    const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
    expect(download.suggestedFilename()).toBe(`promptpay-${order.order_number}.png`);
    const file = await download.path();
    const bytes = readFileSync(file);
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  test("reaching zero re-fetches and shows the order as expired", async ({ page }) => {
    const { token } = await seedOrderWithToken({ expires_at: new Date(Date.now() + 5000).toISOString() });
    await page.goto(`/orders/${token}`);
    await expect(page.getByTestId("order-status")).toContainText("รอชำระเงิน");
    await expect(page.getByTestId("order-status")).toContainText("หมดอายุ", { timeout: 20000 });
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
  });

  test("has no automatic accessibility violations", async ({ page }) => {
    const { order, token } = await seedOrderWithToken();
    await seedRejectedSlip(order.id, "ยอดเงินไม่ตรง");
    await page.goto(`/orders/${token}`);
    await expect(page.getByTestId("rejected-notice")).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test("shows reject reason and allows re-upload", async ({ page }) => {
  const { order, token } = await seedOrderWithToken();
  await seedRejectedSlip(order.id, "ยอดเงินไม่ตรงกับคำสั่งซื้อ");
  await page.goto(`/orders/${token}`);

  await expect(page.getByTestId("rejected-notice")).toContainText("ยอดเงินไม่ตรงกับคำสั่งซื้อ");
  const input = page.getByLabel("เลือกรูปสลิปการโอนเงิน");
  await expect(input).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
  const submit = page.getByRole("button", { name: "ส่งสลิป" });
  await expect(submit).toBeDisabled();

  // A HEIC file is refused with guidance, and nothing changes.
  await input.setInputFiles({ name: "photo.heic", mimeType: "image/heic", buffer: fixture("photo.heic") });
  await expect(page.getByTestId("slip-file-name")).toHaveText("ไฟล์ที่เลือก: photo.heic");
  await page.getByRole("button", { name: "ส่งสลิป" }).click();
  await expect(page.getByTestId("slip-error")).toContainText("ภาพหน้าจอ");
  await expect(page.getByTestId("slip-error")).toContainText("JPEG");
  await expect(page.getByRole("button", { name: "ลองส่งสลิปอีกครั้ง" })).toBeEnabled();
  await expect(page.getByTestId("order-status")).toContainText("รอชำระเงิน");

  // A valid image goes through.
  await input.setInputFiles({ name: "slip.png", mimeType: "image/png", buffer: fixture("real.png") });
  await expect(page.getByTestId("slip-file-name")).toHaveText("ไฟล์ที่เลือก: slip.png");
  await page.getByRole("button", { name: "ส่งสลิป" }).click();
  await expect(page.getByTestId("order-status")).toContainText("รอร้านตรวจสอบ");
  await expect(page.locator('input[type="file"]')).toHaveCount(0);

  const { data } = await adminClient().from("orders").select("status").eq("id", order.id).single();
  expect(data?.status).toBe("payment_review");
  expect(await slipObjects(order.id)).toHaveLength(1);
});

test("disables submission while the upload is pending", async ({ page }) => {
  const { token } = await seedOrderWithToken();
  await page.goto(`/orders/${token}`);
  await page.route("**/orders/**", async (route) => {
    if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue();
  });
  await page
    .getByLabel("เลือกรูปสลิปการโอนเงิน")
    .setInputFiles({ name: "slip.png", mimeType: "image/png", buffer: fixture("real.png") });
  await page.getByRole("button", { name: "ส่งสลิป" }).click();
  await expect(page.getByRole("button", { name: "กำลังส่งสลิป…" })).toBeDisabled();
  await expect(page.getByTestId("order-status")).toContainText("รอร้านตรวจสอบ");
});

test("expired order shows reorder link and no upload", async ({ page }) => {
  const { order, token } = await seedOrderWithToken({ expires_at: PAST });
  await page.goto(`/orders/${token}`);
  await expect(page.getByTestId("order-status")).toContainText("หมดอายุ");
  await expect(page.getByRole("link", { name: "กลับไปสั่งซื้อ" })).toHaveAttribute("href", "/");
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(page.getByRole("img", { name: /QR/ })).toHaveCount(0);
  await expect(page.locator("main")).toContainText(order.order_number);
});

test("shows tracking number once shipped", async ({ page }) => {
  const { token } = await seedOrderWithToken({ status: "shipped", tracking_number: "TH123456789" });
  await page.goto(`/orders/${token}`);
  await expect(page.getByTestId("tracking-number")).toHaveText("TH123456789");
});

test("masks the customer name and address, and never shows the phone", async ({ page }) => {
  const { token } = await seedOrderWithToken();
  await page.goto(`/orders/${token}`);
  const text = await page.locator("main").innerText();
  expect(text).toContain("ลู***");
  expect(text).toContain("••• 10100");
  expect(text).not.toContain("ลูกค้าทดสอบ");
  expect(text).not.toContain("0812345678");
  expect(text).not.toContain("ถนนทดสอบ");
});

test("renders only http(s) contact links", async ({ page }) => {
  const { token } = await seedOrderWithToken();
  try {
    await setContactUrl("javascript:alert(1)");
    await page.goto(`/orders/${token}`);
    await expect(page.getByRole("link", { name: "ติดต่อร้านค้า" })).toHaveCount(0);

    await setContactUrl("https://line.me/R/ti/p/@shop");
    await page.goto(`/orders/${token}`);
    const link = page.getByRole("link", { name: "ติดต่อร้านค้า" });
    await expect(link).toHaveAttribute("href", "https://line.me/R/ti/p/@shop");
    await expect(link).toHaveAttribute("rel", /noopener/);
  } finally {
    await setContactUrl("");
  }
});

test("unknown token shows 404 without hinting", async ({ page }) => {
  const { token } = await seedOrderWithToken();
  const unknown = await page.goto(`/orders/${newToken()}`);
  expect(unknown?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "ไม่พบหน้าที่ต้องการ" })).toBeVisible();
  const unknownText = await page.locator("main").innerText();

  // A near miss of a real token gives the identical page.
  const near = await page.goto(`/orders/${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`);
  expect(near?.status()).toBe(404);
  expect(await page.locator("main").innerText()).toBe(unknownText);
  expect(unknownText).not.toMatch(/ORD-|หมดอายุ|ไม่มีคำสั่งซื้อ/);
});

test("response has noindex and no-referrer headers and is not cached", async ({ page }) => {
  const { token } = await seedOrderWithToken();
  for (const [url, status] of [
    [`/orders/${token}`, 200],
    [`/orders/${newToken()}`, 404],
  ] as const) {
    const response = await page.goto(url);
    expect(response?.status()).toBe(status);
    const headers = response?.headers() ?? {};
    expect(headers["x-robots-tag"]).toBe("noindex");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["cache-control"]).toContain("no-store");
  }
  const html = await (await page.goto(`/orders/${token}`))?.text();
  expect(html).toMatch(/<meta name="robots" content="noindex/);
});
