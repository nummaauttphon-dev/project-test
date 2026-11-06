import { z } from "zod";

const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";

export function normalizePhone(input: string): string {
  const ascii = input.replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)));
  const compact = ascii.replace(/[\s-]/g, "");
  return compact.startsWith("+66") ? `0${compact.slice(3)}` : compact;
}

/**
 * Normalizes free text: zero-width characters are dropped, every run of Unicode whitespace (NBSP
 * included) on a line becomes one space, and lines and the whole text are trimmed. Line breaks
 * stay, so an address can span lines; three or more in a row collapse to one blank line.
 */
export function normalizeText(input: string): string {
  return input
    .replace(/[​-‍⁠﻿]/g, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const checkoutSchema = z.object({
  customerName: z
    .string()
    .transform(normalizeText)
    .pipe(z.string().min(1, "กรุณากรอกชื่อ").max(100, "ชื่อยาวเกินไป")),
  phone: z
    .string()
    .transform(normalizePhone)
    .refine((v) => /^0\d{8,9}$/.test(v), "เบอร์โทรไม่ถูกต้อง"),
  shippingAddress: z
    .string()
    .transform(normalizeText)
    .pipe(z.string().min(10, "กรุณากรอกที่อยู่ให้ครบถ้วน").max(500, "ที่อยู่ยาวเกินไป")),
  idempotencyKey: z
    .string()
    .max(128, "คำขอไม่ถูกต้อง")
    .regex(/^[A-Za-z0-9_-]{22,}$/, "คำขอไม่ถูกต้อง"),
  expectedTotalSatang: z.number().int().nonnegative(),
  items: z
    .array(
      z.object({
        productId: z.uuid("สินค้าไม่ถูกต้อง"),
        quantity: z.number().int().min(1, "จำนวนต้องอย่างน้อย 1").max(10, "สั่งได้ไม่เกิน 10 ชิ้นต่อรายการ"),
      }),
    )
    .min(1, "ตะกร้าว่าง")
    .max(50, "ตะกร้ามีสินค้าได้ไม่เกิน 50 รายการ"),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
