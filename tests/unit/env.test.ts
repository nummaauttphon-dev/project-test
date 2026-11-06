import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@/lib/env-schema";

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pub",
  SUPABASE_SECRET_KEY: "sec",
  DATABASE_URL: "postgresql://u:p@127.0.0.1:54322/postgres",
  PROMPTPAY_ID: "0812345678",
  ORDER_TOKEN_SECRET: "a",
  RATE_LIMIT_SALT: "b",
  CRON_SECRET: "c",
};

describe("parseServerEnv", () => {
  it("throws naming the missing server variable", () => {
    expect(() => parseServerEnv({})).toThrow(/SUPABASE_SECRET_KEY/);
  });
  it("never includes values in the error message", () => {
    expect(() => parseServerEnv({ SUPABASE_SECRET_KEY: "s3cret" })).not.toThrow(
      /s3cret/,
    );
  });
  it("does not leak a bad value of an invalid variable", () => {
    expect(() =>
      parseServerEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "not-a-url-xyz" }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(() =>
      parseServerEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "not-a-url-xyz" }),
    ).not.toThrow(/not-a-url-xyz/);
  });
  it("returns typed values when complete", () => {
    expect(parseServerEnv(valid).PROMPTPAY_ID).toBe("0812345678");
  });
});
