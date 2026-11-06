import { z } from "zod";

const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";

export function normalizePhone(input: string): string {
  const ascii = input.replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)));
  const compact = ascii.replace(/[\s-]/g, "");
  return compact.startsWith("+66") ? `0${compact.slice(3)}` : compact;
}

export const checkoutSchema = z.object({
  customerName: z.string().trim().min(1, "กรุณากรอกชื่อ").max(100, "ชื่อยาวเกินไป"),
  phone: z
    .string()
    .transform(normalizePhone)
    .refine((v) => /^0\d{8,9}$/.test(v), "เบอร์โทรไม่ถูกต้อง"),
  shippingAddress: z
    .string()
    .trim()
    .min(10, "กรุณากรอกที่อยู่ให้ครบถ้วน")
    .max(500, "ที่อยู่ยาวเกินไป"),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{22,}$/, "คำขอไม่ถูกต้อง"),
  expectedTotalSatang: z.number().int().nonnegative(),
  items: z
    .array(
      z.object({
        productId: z.uuid("สินค้าไม่ถูกต้อง"),
        quantity: z.number().int().min(1, "จำนวนต้องอย่างน้อย 1").max(10, "สั่งได้ไม่เกิน 10 ชิ้นต่อรายการ"),
      }),
    )
    .min(1, "ตะกร้าว่าง"),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
