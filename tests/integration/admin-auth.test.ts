import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import * as OTPAuth from "otpauth";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getAdminContext, isAdminUser, requireAdmin } from "@/features/admin/auth";
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
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isAdminUser", () => {
  it("isAdminUser is true only for rows in admins", async () => {
    const admin = await createAdminUser();
    const other = await createNonAdminUser();
    expect(await isAdminUser(adminClient(), admin.id)).toBe(true);
    expect(await isAdminUser(adminClient(), other.id)).toBe(false);
    await revokeAdmin(admin);
    expect(await isAdminUser(adminClient(), admin.id)).toBe(false);
  });

  it("treats a failed lookup as not admin", async () => {
    const admin = await createAdminUser();
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    // Nothing listens on this port, so the request itself fails.
    const unreachable = createClient("http://127.0.0.1:1", required("SUPABASE_SECRET_KEY"), options);
    expect(await isAdminUser(unreachable, admin.id)).toBe(false);

    // The publishable key has no access to the table.
    const denied = createClient(
      required("NEXT_PUBLIC_SUPABASE_URL"),
      required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
      options,
    );
    expect(await isAdminUser(denied, admin.id)).toBe(false);

    // A malformed id makes PostgREST answer with an error.
    expect(await isAdminUser(adminClient(), "not-a-uuid")).toBe(false);

    expect(consoleError.mock.calls.flat().join(" ")).not.toContain(admin.id);
    consoleError.mockRestore();
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
