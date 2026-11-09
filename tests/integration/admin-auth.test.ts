import { spawnSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import * as OTPAuth from "otpauth";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as notAdminRoute } from "@/app/admin/not-admin/route";
import { loginAction } from "@/features/admin/actions";
import { getAdminContext, lookupAdmin, requireAdmin } from "@/features/admin/auth";
import { updateSession } from "@/lib/supabase/proxy";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  createAdminUser,
  createNonAdminUser,
  deleteTestUsers,
  revokeAdmin,
  testEmail,
  type TestUser,
} from "../helpers/admin";
import { adminClient, required } from "../helpers/supabase";

const jar = vi.hoisted(() => new Map<string, { value: string; options: Record<string, unknown> }>());

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...jar].map(([name, cookie]) => ({ name, value: cookie.value })),
    set: (name: string, value: string, options: Record<string, unknown>) => {
      if (options?.maxAge === 0) jar.delete(name);
      else jar.set(name, { value, options });
    },
    delete: (name: string) => jar.delete(name),
  }),
}));

/** Lets a test replace the service-role client the auth code uses, e.g. with an unreachable one. */
const adminOverride = vi.hoisted(() => ({ client: null as SupabaseClient | null }));

vi.mock("@/lib/supabase/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/admin")>();
  return { createAdminClient: () => adminOverride.client ?? actual.createAdminClient() };
});

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };

/** Requests to this port fail: nothing listens there. */
function unreachableClient(): SupabaseClient {
  return createClient("http://127.0.0.1:1", required("SUPABASE_SECRET_KEY"), clientOptions);
}

const totp = (secret: string) =>
  new OTPAuth.TOTP({ secret, algorithm: "SHA1", digits: 6, period: 30 }).generate();

async function signIn(user: TestUser) {
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw error;
  return supabase;
}

async function signInWithTotp(user: TestUser) {
  const supabase = await signIn(user);
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
  if (error) throw error;
  const verified = await supabase.auth.mfa.challengeAndVerify({ factorId: data.id, code: totp(data.totp.secret) });
  if (verified.error) throw verified.error;
  return { secret: data.totp.secret, factorId: data.id };
}

function decodeSession(encoded: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(encoded.replace(/^base64-/, ""), "base64url").toString("utf8"));
}

/** The session JSON behind the (possibly chunked) cookie in the jar. */
function readSession(): { name: string; session: Record<string, unknown> } {
  const names = [...jar.keys()].filter((name) => name.startsWith("sb-")).sort();
  const encoded = names.map((part) => jar.get(part)?.value ?? "").join("");
  return { name: names[0].replace(/\.\d+$/, ""), session: decodeSession(encoded) };
}

function writeSession(name: string, session: Record<string, unknown>) {
  for (const key of [...jar.keys()]) if (key.startsWith("sb-")) jar.delete(key);
  const value = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
  jar.set(name, { value, options: {} });
}

function adminRequest(path = "/admin"): NextRequest {
  const cookie = [...jar].map(([name, stored]) => `${name}=${stored.value}`).join("; ");
  return new NextRequest(new URL(path, "http://localhost:3100"), { headers: { cookie } });
}

beforeAll(async () => {
  await deleteTestUsers();
});

afterAll(async () => {
  await deleteTestUsers();
});

beforeEach(() => {
  jar.clear();
  adminOverride.client = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("lookupAdmin", () => {
  it("tells a failed lookup apart from a user who is not an admin", async () => {
    const admin = await createAdminUser();
    const other = await createNonAdminUser();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await lookupAdmin(adminClient(), admin.id)).toBe("admin");
    expect(await lookupAdmin(adminClient(), other.id)).toBe("not_admin");
    expect(await lookupAdmin(unreachableClient(), admin.id)).toBe("error");
    expect(await lookupAdmin(adminClient(), "not-a-uuid")).toBe("error");

    expect(consoleError.mock.calls.flat().join(" ")).not.toContain(admin.id);
    consoleError.mockRestore();
  });

  it("is admin only while the user has a row in admins", async () => {
    const admin = await createAdminUser();
    expect(await lookupAdmin(adminClient(), admin.id)).toBe("admin");
    await revokeAdmin(admin);
    expect(await lookupAdmin(adminClient(), admin.id)).toBe("not_admin");
  });

  it("never answers admin through a key without access to admins", async () => {
    const admin = await createAdminUser();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const denied = createClient(
      required("NEXT_PUBLIC_SUPABASE_URL"),
      required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    expect(await lookupAdmin(denied, admin.id)).toBe("error");
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain(admin.id);
    consoleError.mockRestore();
  });
});

describe("a failed admins lookup", () => {
  it("is unavailable, answers try-again and keeps the session", async () => {
    const admin = await createAdminUser();
    await signInWithTotp(admin);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    adminOverride.client = unreachableClient();
    expect(await getAdminContext()).toEqual({ state: "unavailable", userId: admin.id });
    expect(await requireAdmin()).toEqual({
      ok: false,
      code: "SERVICE_UNAVAILABLE",
      message: "ระบบไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่อีกครั้ง",
    });

    // Nothing was signed out: once the lookup works again, the same session is let in.
    adminOverride.client = null;
    expect(await getAdminContext()).toEqual({ state: "ok", userId: admin.id });
    consoleError.mockRestore();
  });

  it("at login answers try-again instead of the no-rights message", async () => {
    const admin = await createAdminUser();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    adminOverride.client = unreachableClient();

    const form = new FormData();
    form.set("email", admin.email);
    form.set("password", admin.password);
    expect(await loginAction(null, form)).toEqual({
      ok: false,
      code: "SERVICE_UNAVAILABLE",
      message: "ระบบไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่อีกครั้ง",
    });
    expect([...jar.keys()].filter((name) => name.startsWith("sb-"))).toEqual([]);
    consoleError.mockRestore();
  });
});

describe("signing out a non-admin", () => {
  /** A second, independent session of the same user, as on another device. */
  async function otherDevice(user: TestUser) {
    const client = createClient(
      required("NEXT_PUBLIC_SUPABASE_URL"),
      required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
      clientOptions,
    );
    const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
    if (error) throw error;
    return client;
  }

  it("the not-admin route ends only this browser's session", async () => {
    const user = await createNonAdminUser();
    const elsewhere = await otherDevice(user);
    await signIn(user);
    const { session } = readSession();

    await expect(notAdminRoute()).rejects.toMatchObject({
      digest: expect.stringContaining("/admin/login?error=denied"),
    });

    expect([...jar.keys()].filter((name) => name.startsWith("sb-"))).toEqual([]);
    const here = createClient(
      required("NEXT_PUBLIC_SUPABASE_URL"),
      required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
      clientOptions,
    );
    const revoked = await here.auth.refreshSession({ refresh_token: String(session.refresh_token) });
    expect(revoked.error).not.toBeNull();
    const kept = await elsewhere.auth.refreshSession();
    expect(kept.error).toBeNull();
  });

  it("a login refused for lack of rights ends only that new session", async () => {
    const user = await createNonAdminUser();
    const elsewhere = await otherDevice(user);

    const form = new FormData();
    form.set("email", user.email);
    form.set("password", user.password);
    expect(await loginAction(null, form)).toMatchObject({ ok: false, code: "INVALID_CREDENTIALS" });

    expect([...jar.keys()].filter((name) => name.startsWith("sb-"))).toEqual([]);
    expect((await elsewhere.auth.refreshSession()).error).toBeNull();
  });
});

describe("MFA enrollment through GoTrue", () => {
  it("refuses another factor from an aal1 session once a TOTP factor is verified", async () => {
    const admin = await createAdminUser();
    await signInWithTotp(admin);
    jar.clear();
    await signIn(admin);
    const { session } = readSession();
    const accessToken = String(session.access_token);
    expect(JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8")).aal).toBe("aal1");

    // Straight to the Auth API, past any check supabase-js might make first.
    const response = await fetch(`${required("NEXT_PUBLIC_SUPABASE_URL")}/auth/v1/factors`, {
      method: "POST",
      headers: {
        apikey: required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ factor_type: "totp", friendly_name: "attacker" }),
    });
    const body = (await response.json()) as { error_code?: string; code?: string | number };
    expect(response.ok).toBe(false);
    expect(body.error_code ?? body.code).toBe("insufficient_aal");

    const { data, error } = await adminClient().auth.admin.mfa.listFactors({ userId: admin.id });
    expect(error).toBeNull();
    expect(data?.factors.map((factor) => factor.status)).toEqual(["verified"]);
  });
});

describe("getAdminContext and requireAdmin", () => {
  it("is anonymous without a session", async () => {
    expect(await getAdminContext()).toEqual({ state: "anonymous" });
    expect(await requireAdmin()).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
  });

  it("is not_admin for a signed-in user outside admins, even at aal2", async () => {
    const user = await createNonAdminUser();
    await signInWithTotp(user);
    expect(await getAdminContext()).toEqual({ state: "not_admin", userId: user.id });
    expect(await requireAdmin()).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
  });

  it("is mfa_required for an admin at aal1", async () => {
    const admin = await createAdminUser();
    await signIn(admin);
    expect(await getAdminContext()).toEqual({ state: "mfa_required", userId: admin.id });
    expect(await requireAdmin()).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
  });

  it("is ok for an admin at aal2, until the admins row is gone", async () => {
    const admin = await createAdminUser();
    await signInWithTotp(admin);
    expect(await getAdminContext()).toEqual({ state: "ok", userId: admin.id });
    expect(await requireAdmin()).toEqual({ ok: true, userId: admin.id });

    await revokeAdmin(admin);
    expect(await getAdminContext()).toEqual({ state: "not_admin", userId: admin.id });
  });

  it("rejects a session whose JWT was edited to claim aal2 or another user", async () => {
    const admin = await createAdminUser();
    const user = await createNonAdminUser();
    await signIn(user);
    const { name, session } = readSession();
    const [header, payload, signature] = String(session.access_token).split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const forged = Buffer.from(JSON.stringify({ ...claims, aal: "aal2", sub: admin.id }), "utf8").toString("base64url");

    writeSession(name, { ...session, access_token: `${header}.${forged}.${signature}` });

    expect(await getAdminContext()).toEqual({ state: "anonymous" });
    expect(await requireAdmin()).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
  });
});

describe("TOTP behaviour the E2E helper relies on", () => {
  it("accepts the same code for further sign-ins within the window", async () => {
    const admin = await createAdminUser();
    const { secret, factorId } = await signInWithTotp(admin);
    const code = totp(secret);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      jar.clear();
      const supabase = await signIn(admin);
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      expect(error).toBeNull();
    }
  });
});

describe("session cookies", () => {
  it("passes SameSite, HttpOnly and the admin path to the cookies it writes", async () => {
    const admin = await createAdminUser();
    await signIn(admin);
    const written = [...jar.values()];
    expect(written.length).toBeGreaterThan(0);
    for (const { options } of written) {
      expect(options).toMatchObject({ sameSite: "lax", httpOnly: true, path: "/admin", secure: false });
    }
  });

  it("marks cookies Secure on production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const admin = await createAdminUser();
    await signIn(admin);
    const written = [...jar.values()];
    expect(written.length).toBeGreaterThan(0);
    for (const { options } of written) expect(options).toMatchObject({ secure: true, sameSite: "lax" });
  });
});

describe("updateSession", () => {
  it("leaves cookies alone without a session and for a fresh session", async () => {
    const empty = await updateSession(adminRequest());
    expect(empty.cookies.getAll()).toEqual([]);

    const admin = await createAdminUser();
    await signIn(admin);
    const fresh = await updateSession(adminRequest());
    expect(fresh.cookies.getAll()).toEqual([]);
  });

  it("refreshes an expiring session and writes it to the request and the response", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const admin = await createAdminUser();
    await signIn(admin);
    const { name, session } = readSession();
    writeSession(name, { ...session, expires_at: Math.floor(Date.now() / 1000) - 10 });
    const request = adminRequest();

    const response = await updateSession(request);

    const written = response.cookies.getAll().filter((cookie) => cookie.name.startsWith("sb-"));
    expect(written.length).toBeGreaterThan(0);
    for (const cookie of written) {
      expect(cookie).toMatchObject({ sameSite: "lax", secure: true, httpOnly: true, path: "/admin" });
    }
    expect(response.headers.get("cache-control")).toContain("no-store");

    // The page rendered after the proxy must read the rotated session, not the old one.
    const encoded = written
      .map((cookie) => cookie.name)
      .sort()
      .map((part) => request.cookies.get(part)?.value ?? "")
      .join("");
    const rotated = decodeSession(encoded);
    expect(rotated.refresh_token).not.toBe(session.refresh_token);
    expect((rotated.user as { id: string }).id).toBe(admin.id);
  });

  it("does not throw on a garbled cookie", async () => {
    const request = new NextRequest("http://localhost:3100/admin", {
      headers: { cookie: "sb-127-auth-token=base64-not-valid-json" },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await updateSession(request);
    expect(response.status).toBe(200);
    warn.mockRestore();
  });
});

describe("scripts/create-admin.mjs", () => {
  const base = () => ({
    PATH: process.env.PATH ?? "",
    SystemRoot: process.env.SystemRoot ?? "",
    NEXT_PUBLIC_SUPABASE_URL: required("NEXT_PUBLIC_SUPABASE_URL"),
    SUPABASE_SECRET_KEY: required("SUPABASE_SECRET_KEY"),
  });

  function run(env: Record<string, string>, args: string[] = []) {
    return spawnSync(process.execPath, ["scripts/create-admin.mjs", ...args], {
      env: { ...env, NODE_ENV: "test" },
      encoding: "utf8",
    });
  }

  async function findUser(email: string) {
    const { data, error } = await adminClient().auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) throw error;
    return data.users.find((user) => user.email === email);
  }

  function expectNoSecrets(output: string, password: string) {
    expect(output).not.toContain(password);
    expect(output).not.toContain(required("SUPABASE_SECRET_KEY"));
  }

  it("creates the admin once and is idempotent", async () => {
    const email = testEmail();
    const password = "a-strong-password-for-tests";
    const env = { ...base(), ADMIN_EMAIL: email, ADMIN_PASSWORD: password };

    const first = run(env);
    expect(first.status).toBe(0);
    expectNoSecrets(first.stdout + first.stderr, password);

    const second = run(env);
    expect(second.status).toBe(0);
    expectNoSecrets(second.stdout + second.stderr, password);

    const user = await findUser(email);
    expect(user).toBeDefined();
    const { data, error } = await adminClient().from("admins").select("user_id").eq("user_id", user?.id ?? "");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("refuses a password under 12 characters without creating anyone", async () => {
    const email = testEmail();
    const password = "elevenchars";
    const result = run({ ...base(), ADMIN_EMAIL: email, ADMIN_PASSWORD: password });
    expect(result.status).not.toBe(0);
    expectNoSecrets(result.stdout + result.stderr, password);
    expect(await findUser(email)).toBeUndefined();
  });

  it.each(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "ADMIN_EMAIL", "ADMIN_PASSWORD"])(
    "requires %s",
    async (name) => {
      const email = testEmail();
      const env: Record<string, string> = {
        ...base(),
        ADMIN_EMAIL: email,
        ADMIN_PASSWORD: "a-strong-password-for-tests",
      };
      delete env[name];
      const result = run(env);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(name);
      expect(await findUser(email)).toBeUndefined();
    },
  );

  it("refuses command-line arguments so a password cannot be passed there", async () => {
    const email = testEmail();
    const password = "a-strong-password-for-tests";
    const result = run({ ...base(), ADMIN_EMAIL: email, ADMIN_PASSWORD: password }, [password]);
    expect(result.status).not.toBe(0);
    expectNoSecrets(result.stdout + result.stderr, password);
    expect(await findUser(email)).toBeUndefined();
  });
});
