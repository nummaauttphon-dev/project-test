import { describe, expect, it } from "vitest";
import {
  parseBahtToSatang,
  satangToBahtInput,
  validateContactUrl,
  validateProductInput,
  validateSettingsInput,
} from "@/features/admin/validation";

const MAX_PRODUCT = 10_000_000;

describe("parseBahtToSatang", () => {
  it.each([
    ["0", 0],
    ["1", 100],
    ["12.5", 1250],
    ["12.50", 1250],
    ["0.07", 7],
    ["0.29", 29],
    ["19.99", 1999],
    ["1.10", 110],
    [" 8.2 ", 820],
    ["007.05", 705],
    ["10000000", 1_000_000_000],
    ["10000000.00", 1_000_000_000],
  ])("accepts %j as %i satang with no floating point drift", (input, satang) => {
    expect(parseBahtToSatang(input, MAX_PRODUCT)).toBe(satang);
  });

  it.each(["", " ", "-1", "-0.01", "+5", "1.234", "1.", ".5", "1e3", "0x10", "1,000", "abc", "1 2", "١٢"])(
    "rejects %j",
    (input) => {
      expect(parseBahtToSatang(input, MAX_PRODUCT)).toBeNull();
    },
  );

  it("rejects values above the maximum, however written", () => {
    expect(parseBahtToSatang("10000000.01", MAX_PRODUCT)).toBeNull();
    expect(parseBahtToSatang("10000001", MAX_PRODUCT)).toBeNull();
    expect(parseBahtToSatang("99999999999999999999", MAX_PRODUCT)).toBeNull();
    expect(parseBahtToSatang("10000", 10_000)).toBe(1_000_000);
    expect(parseBahtToSatang("10000.01", 10_000)).toBeNull();
  });

  it("rejects non-strings", () => {
    expect(parseBahtToSatang(12.5, MAX_PRODUCT)).toBeNull();
    expect(parseBahtToSatang(null, MAX_PRODUCT)).toBeNull();
    expect(parseBahtToSatang(undefined, MAX_PRODUCT)).toBeNull();
  });
});

describe("satangToBahtInput", () => {
  it("writes whole baht and satang without grouping", () => {
    expect(satangToBahtInput(0)).toBe("0");
    expect(satangToBahtInput(100)).toBe("1");
    expect(satangToBahtInput(1250)).toBe("12.50");
    expect(satangToBahtInput(7)).toBe("0.07");
    expect(satangToBahtInput(1_000_000_000)).toBe("10000000");
  });
});

const valid = { slug: "ceramic-mug", name: "แก้วเซรามิก", description: "", price: "120.50", stock: "5" };

describe("validateProductInput", () => {
  it("accepts a valid product and converts the price", () => {
    expect(validateProductInput(valid, { creating: true })).toEqual({
      ok: true,
      value: { slug: "ceramic-mug", name: "แก้วเซรามิก", description: "", priceSatang: 12050, stock: 5 },
    });
  });

  it("does not need a stock when editing", () => {
    const rest: Record<string, unknown> = { ...valid };
    delete rest.stock;
    expect(validateProductInput(rest, { creating: false })).toMatchObject({ ok: true });
  });

  it.each([
    ["slug", { slug: "" }],
    ["slug", { slug: "Has-Upper" }],
    ["slug", { slug: "has space" }],
    ["slug", { slug: "ไทย" }],
    ["slug", { slug: "under_score" }],
    ["slug", { slug: "a".repeat(81) }],
    ["name", { name: "" }],
    ["name", { name: "   " }],
    ["name", { name: "ก".repeat(121) }],
    ["description", { description: "x".repeat(2001) }],
    ["price", { price: "-1" }],
    ["price", { price: "1.005" }],
    ["price", { price: "10000000.01" }],
    ["price", { price: "" }],
    ["stock", { stock: "-1" }],
    ["stock", { stock: "1.5" }],
    ["stock", { stock: "" }],
    ["stock", { stock: "1000001" }],
  ])("reports a %s error for %j", (field, override) => {
    const result = validateProductInput({ ...valid, ...override }, { creating: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.fieldErrors)).toEqual([field]);
      expect(result.fieldErrors[field]).toMatch(/[฀-๿]/);
    }
  });

  it("accepts the limits exactly", () => {
    const result = validateProductInput(
      { slug: "a".repeat(80), name: "ก".repeat(120), description: "x".repeat(2000), price: "10000000", stock: "1000000" },
      { creating: true },
    );
    expect(result.ok).toBe(true);
  });

  it("counts characters, not UTF-16 units", () => {
    expect(validateProductInput({ ...valid, name: "😀".repeat(120) }, { creating: true }).ok).toBe(true);
    expect(validateProductInput({ ...valid, name: "😀".repeat(121) }, { creating: true }).ok).toBe(false);
  });

  it("rejects input that is not an object of strings", () => {
    expect(validateProductInput(null, { creating: true }).ok).toBe(false);
    expect(validateProductInput({ ...valid, price: 12 }, { creating: true }).ok).toBe(false);
  });
});

describe("validateContactUrl", () => {
  it.each(["", "https://line.me/ti/p/abc", "http://example.com/a?b=c#d", "HTTPS://Example.com"])("accepts %j", (url) => {
    expect(validateContactUrl(url)).toMatchObject({ ok: true });
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:x",
    "file:///etc/passwd",
    "ftp://example.com",
    "mailto:a@b.com",
    "//example.com",
    "example.com",
    "https://",
    "https:// spaced.com",
    "https://exa\nmple.com",
    "https://example.com/" + "a".repeat(500),
  ])("rejects %j", (url) => {
    expect(validateContactUrl(url)).toMatchObject({ ok: false });
  });

  it("allows exactly 500 characters", () => {
    const url = "https://example.com/" + "a".repeat(480);
    expect(url).toHaveLength(500);
    expect(validateContactUrl(url)).toMatchObject({ ok: true });
  });
});

describe("validateSettingsInput", () => {
  const settings = { shippingFee: "50", paymentWindowMinutes: "1440", contactUrl: "" };

  it("converts the fee to satang", () => {
    expect(validateSettingsInput({ ...settings, shippingFee: "49.5" })).toEqual({
      ok: true,
      value: { shippingFeeSatang: 4950, paymentWindowMinutes: 1440, contactUrl: "" },
    });
  });

  it("accepts the limits", () => {
    expect(validateSettingsInput({ ...settings, shippingFee: "0", paymentWindowMinutes: "1" }).ok).toBe(true);
    expect(validateSettingsInput({ ...settings, shippingFee: "10000", paymentWindowMinutes: "10080" }).ok).toBe(true);
  });

  it.each([
    ["shippingFee", { shippingFee: "10000.01" }],
    ["shippingFee", { shippingFee: "-1" }],
    ["shippingFee", { shippingFee: "1.999" }],
    ["paymentWindowMinutes", { paymentWindowMinutes: "0" }],
    ["paymentWindowMinutes", { paymentWindowMinutes: "10081" }],
    ["paymentWindowMinutes", { paymentWindowMinutes: "1.5" }],
    ["paymentWindowMinutes", { paymentWindowMinutes: "-5" }],
    ["paymentWindowMinutes", { paymentWindowMinutes: "" }],
    ["contactUrl", { contactUrl: "javascript:alert(1)" }],
  ])("reports a %s error for %j", (field, override) => {
    const result = validateSettingsInput({ ...settings, ...override });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.fieldErrors)).toEqual([field]);
  });
});
