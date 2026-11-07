import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  createAdminUser,
  createNonAdminUser,
  currentTotp,
  deleteTestUsers,
  factorsOf,
  revokeAdmin,
  signInAdminWithMfa,
  startEnrollment,
  submitCode,
  submitPassword,
  testEmail,
} from "../helpers/admin";
import { adminClient, anonClient, resetData, seedOrder } from "../helpers/supabase";

const LOGIN_FAILED = "อีเมลหรือรหัสผ่านไม่ถูกต้อง หรือบัญชีนี้ไม่มีสิทธิ์เข้าใช้งาน";

/** The form's own alert. Next.js's route announcer is also role="alert" but sits outside <main>. */
function formAlert(page: Page) {
  return page.getByRole("main").getByRole("alert");
}

async function authCookies(context: BrowserContext) {
  return (await context.cookies()).filter((cookie) => cookie.name.startsWith("sb-"));
}

async function orderStatus(orderId: string): Promise<string> {
  const { data, error } = await adminClient().from("orders").select("status").eq("id", orderId).single();
  if (error) throw error;
  return data.status;
}

test.beforeAll(async () => {
  await deleteTestUsers();
});

test.afterAll(async () => {
  await deleteTestUsers();
});

test("signup is disabled and no signup link exists", async ({ page }) => {
  const { error } = await anonClient().auth.signUp({
    email: testEmail(),
    password: "a-long-enough-password",
  });
  expect(error?.code).toBe("signup_disabled");

  await page.goto("/admin/login");
  await expect(page.getByRole("button", { name: "เข้าสู่ระบบ" })).toBeVisible();
  await expect(page.getByRole("link", { name: /สมัคร|ลงทะเบียน/ })).toHaveCount(0);
  await expect(page.getByText(/สมัคร/)).toHaveCount(0);
  await expect(page.locator('a[href*="signup"], a[href*="register"]')).toHaveCount(0);
});

test("anonymous visitor is redirected to login from every admin route", async ({ page, context }) => {
  const routes = [
    "/admin",
    "/admin/mfa",
    "/admin/orders",
    "/admin/orders/00000000-0000-4000-8000-000000000000",
    "/admin/products",
    "/admin/settings",
    "/admin/not-a-real-page",
  ];
  for (const route of routes) {
    await page.goto(route);
    await expect(page, route).toHaveURL(/\/admin\/login$/);
  }
  expect(await authCookies(context)).toEqual([]);
});

test("non-admin user cannot enter admin", async ({ page, context }) => {
  const user = await createNonAdminUser();

  await submitPassword(page, user);
  await expect(formAlert(page)).toHaveText(LOGIN_FAILED);
  await expect(page).toHaveURL(/\/admin\/login$/);
  expect(await authCookies(context)).toEqual([]);

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.goto("/admin/mfa");
  await expect(page).toHaveURL(/\/admin\/login$/);
  expect(await factorsOf(user)).toEqual([]);
});

test("login failures do not reveal whether an account exists", async ({ page, context }) => {
  const admin = await createAdminUser();

  await submitPassword(page, { email: admin.email, password: "a-wrong-password-here" });
  await expect(formAlert(page)).toHaveText(LOGIN_FAILED);

  await submitPassword(page, { email: testEmail(), password: "a-wrong-password-here" });
  await expect(formAlert(page)).toHaveText(LOGIN_FAILED);
  expect(await authCookies(context)).toEqual([]);
});

test("a session whose admin rights were removed is signed out with the generic message", async ({
  page,
  context,
}) => {
  const admin = await createAdminUser();
  await submitPassword(page, admin);
  await page.waitForURL(/\/admin\/mfa$/);
  expect((await authCookies(context)).length).toBeGreaterThan(0);

  await revokeAdmin(admin);
  await page.goto("/admin");

  await expect(page).toHaveURL(/\/admin\/login\?error=denied$/);
  await expect(formAlert(page)).toHaveText(LOGIN_FAILED);
  expect(await authCookies(context)).toEqual([]);
});

test("a user who loses admin rights on the MFA screen cannot enroll", async ({ page, context }) => {
  const admin = await createAdminUser();
  await submitPassword(page, admin);
  await page.waitForURL(/\/admin\/mfa$/);

  await revokeAdmin(admin);
  await page.getByRole("button", { name: "เริ่มตั้งค่า" }).click();

  await expect(page).toHaveURL(/\/admin\/login\?error=denied$/);
  expect(await factorsOf(admin)).toEqual([]);
  expect(await authCookies(context)).toEqual([]);
});

test("login without MFA is sent to /admin/mfa", async ({ page }) => {
  const admin = await createAdminUser();
  await submitPassword(page, admin);
  await expect(page).toHaveURL(/\/admin\/mfa$/);

  // Password alone never reaches the dashboard.
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/mfa$/);
  await page.goto("/admin/login");
  await expect(page).toHaveURL(/\/admin\/mfa$/);
});

test("admin completes TOTP and reaches dashboard", async ({ page }) => {
  const admin = await createAdminUser();
  await submitPassword(page, admin);
  await page.waitForURL(/\/admin\/mfa$/);

  const secret = await startEnrollment(page);
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
  const qr = page.getByRole("img", { name: "QR Code สำหรับตั้งค่าแอปยืนยันตัวตน" });
  await expect(qr).toBeVisible();
  expect(await qr.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  await submitCode(page, currentTotp(secret) === "000000" ? "111111" : "000000");
  await expect(formAlert(page)).toHaveText("รหัสไม่ถูกต้องหรือหมดอายุ กรุณาลองใหม่อีกครั้ง");
  await expect(page).toHaveURL(/\/admin\/mfa$/);

  await submitCode(page, currentTotp(secret));
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "แดชบอร์ด" })).toBeVisible();

  const factors = await factorsOf(admin);
  expect(factors.map((factor) => factor.status)).toEqual(["verified"]);

  // Already through MFA: the sign-in screens send the admin back.
  await page.goto("/admin/mfa");
  await expect(page).toHaveURL(/\/admin$/);
});

test("a returning admin is challenged, and the secret is not shown again", async ({ page, context }) => {
  const admin = await createAdminUser();
  await signInAdminWithMfa(page, admin);

  await page.getByRole("button", { name: "ออกจากระบบ" }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  expect(await authCookies(context)).toEqual([]);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);

  await submitPassword(page, admin);
  await page.waitForURL(/\/admin\/mfa$/);
  await expect(page.getByLabel("รหัส 6 หลัก")).toBeVisible();
  await expect(page.getByTestId("totp-secret")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "เริ่มตั้งค่า" })).toHaveCount(0);
  expect(await page.content()).not.toContain(admin.totpSecret as string);

  // Normally the same 30-second window as the sign-in above.
  await submitCode(page, currentTotp(admin.totpSecret as string));
  await expect(page.getByRole("heading", { name: "แดชบอร์ด" })).toBeVisible();
  expect(await factorsOf(admin)).toHaveLength(1);
});

test("an abandoned enrollment is replaced on a return visit", async ({ page }) => {
  const admin = await createAdminUser();
  await submitPassword(page, admin);
  await page.waitForURL(/\/admin\/mfa$/);
  const abandoned = await startEnrollment(page);
  expect((await factorsOf(admin)).map((factor) => factor.status)).toEqual(["unverified"]);

  await page.reload();
  // The secret lived only on the abandoned screen.
  expect(await page.content()).not.toContain(abandoned);

  const secret = await startEnrollment(page);
  expect(secret).not.toBe(abandoned);
  expect((await factorsOf(admin)).map((factor) => factor.status)).toEqual(["unverified"]);

  await submitCode(page, currentTotp(secret));
  await expect(page.getByRole("heading", { name: "แดชบอร์ด" })).toBeVisible();
  expect((await factorsOf(admin)).map((factor) => factor.status)).toEqual(["verified"]);
});

test("auth cookies are Lax, Secure, HttpOnly and never sent to the storefront", async ({ page, context }) => {
  await signInAdminWithMfa(page);

  const cookies = await authCookies(context);
  expect(cookies.length).toBeGreaterThan(0);
  for (const cookie of cookies) {
    expect(cookie.sameSite).toBe("Lax");
    // E2E runs a production build, where cookies must be Secure.
    expect(cookie.secure).toBe(true);
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.path).toBe("/admin");
  }

  const response = await page.goto("/");
  const sent = await response?.request().allHeaders();
  expect(sent?.cookie ?? "").not.toContain("sb-");
  expect(await response?.headerValue("set-cookie")).toBeNull();
});

test("login and MFA screens have no accessibility violations", async ({ page }) => {
  await page.goto("/admin/login");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  const admin = await createAdminUser();
  await submitPassword(page, admin);
  await page.waitForURL(/\/admin\/mfa$/);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await startEnrollment(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

// Review Focus 5. Task 11 adds the order page and enables this test.
test.fixme("expired session on submit changes nothing and returns to login", async ({ page, context }) => {
  await resetData();
  const { id: orderId } = await seedOrder({ status: "payment_review" });
  await signInAdminWithMfa(page);
  await page.goto(`/admin/orders/${orderId}`);
  await context.clearCookies();
  await page.getByRole("button", { name: "ยืนยันการชำระเงิน" }).click();
  await expect(page).toHaveURL(/\/admin\/login/);
  expect(await orderStatus(orderId)).toBe("payment_review");
});
