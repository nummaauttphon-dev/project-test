"use server";

import { z } from "zod";
import { getProductsByIds, getStoreSettings, type CatalogProduct } from "@/features/catalog/queries";
import { fail, ok, type ActionResult } from "@/lib/result";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_CART_LINES, MAX_LINE_QUANTITY, type CartLine } from "./cart-storage";

export type CartView = {
  products: CatalogProduct[];
  shippingFeeSatang: number;
};

const cartSchema = z
  .array(
    z.object({
      productId: z.uuid(),
      quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
    }),
  )
  .max(MAX_CART_LINES);

/** Latest public data for the cart's products. Hidden or unknown products are simply absent. */
export async function getCartViewAction(lines: CartLine[]): Promise<ActionResult<CartView>> {
  const parsed = cartSchema.safeParse(lines);
  if (!parsed.success) return fail("invalid_cart", "ข้อมูลตะกร้าไม่ถูกต้อง กรุณารีเฟรชหน้านี้");

  try {
    const ids = [...new Set(parsed.data.map((line) => line.productId))];
    const [products, settings] = await Promise.all([
      getProductsByIds(ids),
      getStoreSettings(createAdminClient()),
    ]);
    return ok({ products, shippingFeeSatang: settings.shippingFeeSatang });
  } catch (error) {
    console.error("getCartViewAction failed", error instanceof Error ? error.message : "unknown");
    return fail("cart_unavailable", "โหลดตะกร้าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
  }
}
