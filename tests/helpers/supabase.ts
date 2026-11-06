import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Product = {
  id: string;
  slug: string;
  name: string;
  description: string;
  price_satang: number;
  stock_quantity: number;
  image_path: string | null;
  is_active: boolean;
};

export type Order = {
  id: string;
  order_number: string;
  status: string;
  total_satang: number;
};

export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}; run node scripts/test-env.mjs`);
  return value;
}

const options = { auth: { persistSession: false, autoRefreshToken: false } };

export function adminClient(): SupabaseClient {
  return createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("SUPABASE_SECRET_KEY"),
    options,
  );
}

export function anonClient(): SupabaseClient {
  return createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    options,
  );
}

const SLIP_BUCKET = "payment-slips";

async function emptyBucket(prefix = ""): Promise<void> {
  const storage = adminClient().storage.from(SLIP_BUCKET);
  const { data, error } = await storage.list(prefix, { limit: 1000 });
  if (error) throw error;
  const files: string[] = [];
  for (const entry of data ?? []) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null) await emptyBucket(path);
    else files.push(path);
  }
  if (files.length > 0) {
    const removed = await storage.remove(files);
    if (removed.error) throw removed.error;
  }
}

/** Deletes test data in foreign-key order and clears the slip bucket. Keeps store_settings. */
export async function resetData(): Promise<void> {
  const db = adminClient();
  const nil = "00000000-0000-0000-0000-000000000000";
  for (const table of ["payment_slips", "order_items", "orders", "products"]) {
    const { error } = await db.from(table).delete().neq("id", nil);
    if (error) throw new Error(`resetData ${table}: ${error.message}`);
  }
  const limits = await db.from("rate_limits").delete().neq("action", "");
  if (limits.error) throw new Error(`resetData rate_limits: ${limits.error.message}`);
  await emptyBucket();
}

function productRow(overrides: Record<string, unknown> = {}) {
  const suffix = randomBytes(6).toString("hex");
  return {
    slug: `test-${suffix}`,
    name: `สินค้าทดสอบ ${suffix}`,
    description: "สินค้าสำหรับทดสอบ",
    price_satang: 10000,
    stock_quantity: 10,
    image_path: null,
    is_active: true,
    ...overrides,
  };
}

/** Inserts a product without throwing, so tests can assert on constraint errors. */
export async function seedProductRaw(overrides: Record<string, unknown> = {}) {
  return adminClient().from("products").insert(productRow(overrides)).select().single();
}

export async function seedProduct(overrides: Partial<Product> = {}): Promise<Product> {
  const { data, error } = await seedProductRaw(overrides);
  if (error || !data) throw new Error(`seedProduct: ${error?.message}`);
  return data as Product;
}

/** Inserts an order directly with the admin client (create_order arrives in Task 4). */
export async function seedOrder(overrides: Record<string, unknown> = {}): Promise<Order> {
  const { data, error } = await adminClient()
    .from("orders")
    .insert({
      customer_name: "ลูกค้าทดสอบ",
      phone: "0812345678",
      shipping_address: "123 ถนนทดสอบ แขวงทดสอบ เขตทดสอบ กรุงเทพฯ 10100",
      subtotal_satang: 10000,
      shipping_fee_satang: 5000,
      total_satang: 15000,
      token_hash: randomBytes(32).toString("hex"),
      idempotency_key: randomUUID() + randomBytes(8).toString("hex"),
      expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      ...overrides,
    })
    .select()
    .single();
  if (error || !data) throw new Error(`seedOrder: ${error?.message}`);
  return data as Order;
}
