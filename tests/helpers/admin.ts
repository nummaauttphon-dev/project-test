import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { adminClient } from "./supabase";

/** Every helper-made account uses this domain, so cleanup can also remove leftovers of a crashed run. */
export const TEST_EMAIL_DOMAIN = "admin-test.example.com";

export type TestUser = {
  id: string;
  email: string;
  password: string;
  /** Read from the real enrollment screen; present once the user has enrolled. */
  totpSecret?: string;
};

export function testEmail(): string {
  return `user-${randomBytes(6).toString("hex")}@${TEST_EMAIL_DOMAIN}`;
}

async function createUser(): Promise<TestUser> {
  const email = testEmail();
  const password = randomBytes(24).toString("base64url");
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  return { id: data.user.id, email, password };
}

export function createNonAdminUser(): Promise<TestUser> {
  return createUser();
}

export async function createAdminUser(): Promise<TestUser> {
  const user = await createUser();
  const { error } = await adminClient().from("admins").insert({ user_id: user.id });
  if (error) throw new Error(`createAdminUser: ${error.message}`);
  return user;
}

export async function revokeAdmin(user: TestUser): Promise<void> {
  const { error } = await adminClient().from("admins").delete().eq("user_id", user.id);
  if (error) throw new Error(`revokeAdmin: ${error.message}`);
}

export async function factorsOf(user: TestUser) {
  const { data, error } = await adminClient().auth.admin.mfa.listFactors({ userId: user.id });
  if (error || !data) throw new Error(`factorsOf: ${error?.message}`);
  return data.factors;
}

let defaultAdmin: TestUser | undefined;

/**
 * Deletes every helper-made user. `admins.user_id` is ON DELETE RESTRICT and resetData keeps the
 * table, so the admins rows go first.
 */
export async function deleteTestUsers(): Promise<void> {
  const db = adminClient();
  const perPage = 1000;
  const ids: string[] = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`deleteTestUsers: ${error.message}`);
    for (const user of data.users) {
      if (user.email?.endsWith(`@${TEST_EMAIL_DOMAIN}`)) ids.push(user.id);
    }
    if (data.users.length < perPage) break;
  }
  defaultAdmin = undefined;
  if (ids.length === 0) return;
  const rows = await db.from("admins").delete().in("user_id", ids);
  if (rows.error) throw new Error(`deleteTestUsers admins: ${rows.error.message}`);
  for (const id of ids) {
    const { error } = await db.auth.admin.deleteUser(id);
    if (error) throw new Error(`deleteTestUsers user: ${error.message}`);
  }
}

/**
 * The current window's code. Auth accepts the same code for several challenges within a window and
 * a clock skew of one window either side; `tests/integration/admin-auth.test.ts` pins the reuse, so
 * repeated sign-ins need neither a wait nor a remembered counter. If an Auth upgrade starts
 * rejecting reuse, that test fails first and this function is the place to change.
 */
export function currentTotp(secret: string): string {
  return new OTPAuth.TOTP({ secret, algorithm: "SHA1", digits: 6, period: 30 }).generate();
}

export async function submitPassword(page: Page, user: Pick<TestUser, "email" | "password">): Promise<void> {
  await page.goto("/admin/login");
  await page.getByLabel("อีเมล").fill(user.email);
  await page.getByLabel("รหัสผ่าน").fill(user.password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
}

/** Starts enrollment on the MFA screen and returns the secret it shows. */
export async function startEnrollment(page: Page): Promise<string> {
  await page.getByRole("button", { name: "เริ่มตั้งค่า" }).click();
  return (await page.getByTestId("totp-secret").innerText()).trim();
}

export async function submitCode(page: Page, code: string): Promise<void> {
  await page.getByLabel("รหัส 6 หลัก").fill(code);
  await page.getByRole("button", { name: "ยืนยันรหัส" }).click();
}

/**
 * Signs in through the real UI up to the dashboard: enrolls TOTP on the user's first sign-in and
 * answers a challenge afterwards. Without a user, it shares one admin across the worker's tests.
 */
export async function signInAdminWithMfa(page: Page, user?: TestUser): Promise<TestUser> {
  const admin = user ?? (defaultAdmin ??= await createAdminUser());
  await submitPassword(page, admin);
  await page.waitForURL(/\/admin\/mfa$/);
  admin.totpSecret ??= await startEnrollment(page);
  await submitCode(page, currentTotp(admin.totpSecret));
  await page.waitForURL(/\/admin$/);
  return admin;
}
