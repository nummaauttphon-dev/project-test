import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { codeOf, loggable } from "@/lib/log";
import { isOrderStatus, ORDER_STATUSES } from "@/lib/order-status";
import { MAX_IMAGE_BYTES } from "@/lib/upload-limits";
import { isUuid } from "@/lib/uuid";

const SRC = path.resolve(import.meta.dirname, "..", "..", "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

/** Files under src (relative, forward slashes) whose text matches `pattern`. */
function filesMatching(pattern: RegExp): string[] {
  return sourceFiles(SRC)
    .filter((file) => pattern.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(SRC, file).split(path.sep).join("/"))
    .sort();
}

describe("shared helpers live once, in src/lib", () => {
  it.each([
    ["loggable", /function loggable\(/, ["lib/log.ts"]],
    ["codeOf", /function codeOf\(/, ["lib/log.ts"]],
    ["the UUID pattern", /\[0-9a-f\]\{8\}-/, ["lib/uuid.ts"]],
    ["the order status list", /"awaiting_payment",\s*"payment_review",\s*"paid"/, ["lib/order-status.ts"]],
    ["the 4 MB limit", /4_?194_?304/, ["lib/upload-limits.ts"]],
  ])("%s is defined only in src/lib", (_, pattern, expected) => {
    expect(filesMatching(pattern)).toEqual(expected);
  });

  it("the upload limit module imports nothing, so client components can use it without file-type", () => {
    const text = readFileSync(path.join(SRC, "lib", "upload-limits.ts"), "utf8");
    expect(text).not.toMatch(/\bimport\b|\brequire\(/);
  });

  it("client forms take the limit from the shared module", () => {
    for (const file of ["components/slip-upload-form.tsx", "components/admin-product-form.tsx"]) {
      const text = readFileSync(path.join(SRC, file), "utf8");
      expect(text).toContain('from "@/lib/upload-limits"');
      expect(text).not.toContain("file-type");
      expect(text).not.toContain("@/lib/slip-file");
    }
  });
});

describe("shared helper behaviour", () => {
  it("keeps the limit at 4 MB", () => {
    expect(MAX_IMAGE_BYTES).toBe(4_194_304);
  });

  it("logs only code-shaped values", () => {
    expect(loggable("PGRST116")).toBe("PGRST116");
    expect(loggable("22P02")).toBe("22P02");
    expect(loggable("0812345678 ถนน")).toBe("unexpected");
    expect(loggable(42)).toBe("unexpected");
  });

  it("reads a code or a status code, never a message", () => {
    expect(codeOf({ code: "23505", message: "dup 0812345678" })).toBe("23505");
    expect(codeOf({ statusCode: 413, message: "too big" })).toBe("413");
    expect(codeOf(new Error("boom"))).toBe("unknown");
    expect(codeOf(null)).toBe("unknown");
  });

  it("recognises UUIDs and order statuses", () => {
    expect(isUuid("6F1C2A3B-4D5E-4F60-8A7B-9C0D1E2F3A4B")).toBe(true);
    expect(isUuid("6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4bx")).toBe(false);
    expect(isUuid(7)).toBe(false);
    expect(ORDER_STATUSES).toEqual(["awaiting_payment", "payment_review", "paid", "shipped", "expired", "cancelled"]);
    expect(isOrderStatus("paid")).toBe(true);
    expect(isOrderStatus("refunded")).toBe(false);
  });
});
