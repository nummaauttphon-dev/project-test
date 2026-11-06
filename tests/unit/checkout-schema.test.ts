import { describe, expect, it } from "vitest";
import { checkoutSchema } from "@/features/checkout/schema";

const uuid = "8f4b8d3e-6c1a-4b5e-9a3f-2d7e1c9b0a11";

function validCheckout(overrides: Record<string, unknown> = {}) {
  return {
    customerName: "สมชาย ใจดี",
    phone: "0812345678",
    shippingAddress: "123/45 ถ.สุขุมวิท กรุงเทพฯ 10110",
    idempotencyKey: "AAAAAAAAAAAAAAAAAAAAAA",
    expectedTotalSatang: 12350,
    items: [{ productId: uuid, quantity: 2 }],
    ...overrides,
  };
}

describe("checkoutSchema", () => {
  it.each(["๐๘๑-๒๓๔-๕๖๗๘", "081 234 5678", "+66812345678"])("normalizes %s", (phone) => {
    expect(checkoutSchema.parse(validCheckout({ phone })).phone).toBe("0812345678");
  });

  it("accepts a valid checkout", () => {
    expect(checkoutSchema.safeParse(validCheckout()).success).toBe(true);
  });

  it("rejects bad phone, quantity, empty items", () => {
    expect(checkoutSchema.safeParse(validCheckout({ phone: "12345" })).success).toBe(false);
    expect(checkoutSchema.safeParse(validCheckout({ items: [{ productId: uuid, quantity: 11 }] })).success).toBe(false);
    expect(checkoutSchema.safeParse(validCheckout({ items: [{ productId: uuid, quantity: 0 }] })).success).toBe(false);
    expect(checkoutSchema.safeParse(validCheckout({ items: [] })).success).toBe(false);
  });

  it("enforces name, address and idempotency key rules", () => {
    expect(checkoutSchema.safeParse(validCheckout({ customerName: "" })).success).toBe(false);
    expect(checkoutSchema.safeParse(validCheckout({ customerName: "ก".repeat(101) })).success).toBe(false);
    expect(checkoutSchema.safeParse(validCheckout({ shippingAddress: "สั้นไป" })).success).toBe(false);
    expect(checkoutSchema.safeParse(validCheckout({ shippingAddress: "ก".repeat(501) })).success).toBe(false);
    expect(checkoutSchema.safeParse(validCheckout({ idempotencyKey: "short" })).success).toBe(false);
  });

  it("rejects non-integer or negative totals", () => {
    expect(checkoutSchema.safeParse(validCheckout({ expectedTotalSatang: 1.5 })).success).toBe(false);
    expect(checkoutSchema.safeParse(validCheckout({ expectedTotalSatang: -1 })).success).toBe(false);
  });
});

describe("checkoutSchema hardening", () => {
  it("treats NBSP and zero-width characters as empty or collapses them", () => {
    expect(checkoutSchema.safeParse(validCheckout({ customerName: " ​  " })).success).toBe(false);
    const parsed = checkoutSchema.parse(
      validCheckout({ customerName: "  สมชาย   ใจดี ", shippingAddress: "123/45  ถนนสุขุมวิท\r\n\r\n\r\n\r\nกรุงเทพฯ" }),
    );
    expect(parsed.customerName).toBe("สมชาย ใจดี");
    expect(parsed.shippingAddress).toBe("123/45 ถนนสุขุมวิท\n\nกรุงเทพฯ");
  });

  it("caps the idempotency key at 128 characters and items at 50", () => {
    expect(checkoutSchema.safeParse(validCheckout({ idempotencyKey: "A".repeat(128) })).success).toBe(true);
    expect(checkoutSchema.safeParse(validCheckout({ idempotencyKey: "A".repeat(129) })).success).toBe(false);
    const item = { productId: uuid, quantity: 1 };
    expect(checkoutSchema.safeParse(validCheckout({ items: Array(50).fill(item) })).success).toBe(true);
    expect(checkoutSchema.safeParse(validCheckout({ items: Array(51).fill(item) })).success).toBe(false);
  });
});
