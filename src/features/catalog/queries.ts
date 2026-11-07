import type { SupabaseClient } from "@supabase/supabase-js";
import { queryError } from "@/lib/log";
import { createServerSupabase } from "@/lib/supabase/server";

/** Public product fields only. Never add columns here without checking they are safe to expose. */
export type CatalogProduct = {
  id: string;
  slug: string;
  name: string;
  price_satang: number;
  stock_quantity: number;
  image_path: string | null;
};

export type ProductDetail = CatalogProduct & { description: string };

const LIST_COLUMNS = "id, slug, name, price_satang, stock_quantity, image_path";
const DETAIL_COLUMNS = `${LIST_COLUMNS}, description`;

// Reads use the publishable key, so Row Level Security hides inactive products.
// A client can be passed in (tests); pages use the cookie-aware server client.

export async function listProducts(client?: SupabaseClient): Promise<CatalogProduct[]> {
  const db = client ?? (await createServerSupabase());
  const { data, error } = await db
    .from("products")
    .select(LIST_COLUMNS)
    .order("created_at", { ascending: false })
    .order("id");
  if (error) throw queryError("listProducts", error);
  return (data ?? []) as CatalogProduct[];
}

export async function getProductBySlug(
  slug: string,
  client?: SupabaseClient,
): Promise<ProductDetail | null> {
  const db = client ?? (await createServerSupabase());
  const { data, error } = await db
    .from("products")
    .select(DETAIL_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw queryError("getProductBySlug", error);
  return (data as ProductDetail | null) ?? null;
}

/** Hidden and unknown ids are simply absent from the result. */
export async function getProductsByIds(
  ids: string[],
  client?: SupabaseClient,
): Promise<CatalogProduct[]> {
  if (ids.length === 0) return [];
  const db = client ?? (await createServerSupabase());
  const { data, error } = await db.from("products").select(LIST_COLUMNS).in("id", ids);
  if (error) throw queryError("getProductsByIds", error);
  return (data ?? []) as CatalogProduct[];
}

export type StoreSettings = {
  shippingFeeSatang: number;
  paymentWindowMinutes: number;
  contactUrl: string;
};

/** store_settings is closed to anon, so the caller passes the admin client. */
export async function getStoreSettings(client: SupabaseClient): Promise<StoreSettings> {
  const { data, error } = await client
    .from("store_settings")
    .select("shipping_fee_satang, payment_window_minutes, contact_url")
    .eq("id", 1)
    .single();
  if (error) throw queryError("getStoreSettings", error);
  if (!data) throw new Error("getStoreSettings: no row");
  return {
    // bigint columns arrive as JSON numbers; satang amounts stay far below 2^53.
    shippingFeeSatang: Number(data.shipping_fee_satang),
    paymentWindowMinutes: Number(data.payment_window_minutes),
    contactUrl: String(data.contact_url),
  };
}
