import { expect, test } from "@playwright/test";
import { seedOrderWithToken } from "../helpers/orders";
import { resetData } from "../helpers/supabase";

test.beforeEach(async () => {
  await resetData();
});

test("every page refuses framing and MIME sniffing", async ({ page, request }) => {
  const { token } = await seedOrderWithToken();
  for (const url of ["/", `/orders/${token}`, "/admin/login"]) {
    const response = await page.goto(url);
    expect(response?.status(), url).toBe(200);
    const headers = response?.headers() ?? {};
    expect(headers["content-security-policy"], url).toBe("frame-ancestors 'none'");
    expect(headers["x-frame-options"], url).toBe("DENY");
    expect(headers["x-content-type-options"], url).toBe("nosniff");
  }

  // Admin redirects and static assets carry them too.
  const redirect = await request.get("/admin", { maxRedirects: 0 });
  expect(redirect.status()).toBeGreaterThanOrEqual(300);
  expect(redirect.headers()["x-frame-options"]).toBe("DENY");
  expect(redirect.headers()["content-security-policy"]).toBe("frame-ancestors 'none'");
});

test("a page framed by another site is blocked", async ({ page }) => {
  // The test server is the "other site": a data: page whose iframe points at the admin login.
  const blocked: string[] = [];
  page.on("console", (message) => {
    if (/frame-ancestors|X-Frame-Options|refused to (display|frame)/i.test(message.text())) blocked.push(message.text());
  });
  const target = new URL("/admin/login", test.info().project.use.baseURL).toString();
  await page.setContent(`<iframe id="f" src="${target}" title="framed"></iframe>`);
  await expect.poll(() => blocked.length).toBeGreaterThan(0);
  const frame = page.frame({ url: target });
  const framedHeading = frame ? await frame.locator("h1").count() : 0;
  expect(framedHeading).toBe(0);
});
