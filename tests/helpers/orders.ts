import { createHash, randomBytes } from "node:crypto";
import { adminClient, seedOrder, type Order } from "./supabase";

/** token_hash exactly as hashOrderToken computes it (that module is server-only). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Seeds an order reachable through `token`, with one line item. */
export async function seedOrderWithToken(
  overrides: Record<string, unknown> = {},
): Promise<{ order: Order; token: string }> {
  const token = newToken();
  const order = await seedOrder({ token_hash: hashToken(token), ...overrides });
  const { error } = await adminClient()
    .from("order_items")
    .insert({
      order_id: order.id,
      product_id: await anyProductId(),
      product_name: "แก้วกาแฟเซรามิก",
      unit_price_satang: 10000,
      quantity: 1,
    });
  if (error) throw new Error(`seedOrderWithToken items: ${error.message}`);
  return { order, token };
}

async function anyProductId(): Promise<string> {
  const db = adminClient();
  const found = await db.from("products").select("id").limit(1).maybeSingle();
  if (found.data) return found.data.id as string;
  const { data, error } = await db
    .from("products")
    .insert({
      slug: `seed-${randomBytes(6).toString("hex")}`,
      name: "สินค้าทดสอบ",
      description: "สินค้าสำหรับทดสอบ",
      price_satang: 10000,
      stock_quantity: 10,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`anyProductId: ${error?.message}`);
  return data.id as string;
}

export async function seedRejectedSlip(orderId: string, reason: string): Promise<void> {
  const { error } = await adminClient()
    .from("payment_slips")
    .insert({
      order_id: orderId,
      storage_path: `${orderId}/old.png`,
      review_status: "rejected",
      reject_reason: reason,
      reviewed_at: new Date().toISOString(),
    });
  if (error) throw new Error(`seedRejectedSlip: ${error.message}`);
}

/** Every object path in the private slip bucket under one order folder. */
export async function slipObjects(orderId: string): Promise<string[]> {
  const { data, error } = await adminClient().storage.from("payment-slips").list(orderId);
  if (error) throw new Error(`slipObjects: ${error.message}`);
  return (data ?? []).map((entry) => `${orderId}/${entry.name}`);
}
