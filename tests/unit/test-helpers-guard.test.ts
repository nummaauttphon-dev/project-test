import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteTestUsers, revokeAdmin } from "../helpers/admin";
import { connect } from "../helpers/pg";
import { adminClient, resetData } from "../helpers/supabase";

// The destructive test helpers wipe tables, buckets and users with the secret key. Pointed at a
// real project by a stray env, they would wipe it, so they refuse anything but the local stack.

const REMOTE = "https://abcdefghijklmnop.supabase.co";

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
  fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in unit tests"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("destructive test helpers", () => {
  it.each([
    ["a Supabase cloud project", REMOTE],
    ["a look-alike host", "http://127.0.0.1.example.com:54321"],
    ["a host that only starts with localhost", "http://localhost.evil.test:54321"],
  ])("refuse %s without sending a request", async (_, url) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    expect(() => adminClient()).toThrow(/127\.0\.0\.1 or localhost/);
    await expect(resetData()).rejects.toThrow(/127\.0\.0\.1 or localhost/);
    await expect(deleteTestUsers()).rejects.toThrow(/127\.0\.0\.1 or localhost/);
    await expect(revokeAdmin({ id: "x", email: "x", password: "x" })).rejects.toThrow(/127\.0\.0\.1 or localhost/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never print the refused URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", REMOTE);
    expect(() => adminClient()).toThrow(expect.objectContaining({ message: expect.not.stringContaining("abcdefghijklmnop") }));
  });

  it.each(["http://127.0.0.1:54321", "http://localhost:54321"])("allow the local stack at %s", (url) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    expect(() => adminClient()).not.toThrow();
  });

  it("refuse a database connection that is not local, before connecting", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://postgres:secret@db.abcdefghijklmnop.supabase.co:5432/postgres");
    await expect(connect()).rejects.toThrow(/127\.0\.0\.1 or localhost/);
    await expect(connect()).rejects.not.toThrow(/secret|abcdefghijklmnop/);
  });
});
