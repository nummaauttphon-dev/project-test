import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStoreSettings } from "@/features/catalog/queries";
import { maskAddress, maskName } from "@/lib/mask";
import { hashOrderToken } from "@/lib/order-token";

export type OrderStatus =
  | "awaiting_payment"
  | "payment_review"
  | "paid"
  | "shipped"
  | "expired"
  | "cancelled";

const STATUSES: readonly string[] = [
  "awaiting_payment",
  "payment_review",
  "paid",
  "shipped",
  "expired",
  "cancelled",
];

/**
 * Everything the order page may show. It holds no phone, no full name or address, no ids and no
 * storage paths: add a field here only after checking it is safe to render to whoever has the link.
 */
export type OrderView = {
  orderNumber: string;
  /** Already adjusted: an awaiting_payment order past expires_at is "expired", whatever cron says. */
  status: OrderStatus;
  items: { name: string; unitPriceSatang: number; quantity: number }[];
  subtotalSatang: number;
  shippingFeeSatang: number;
  totalSatang: number;
  /** ISO 8601. */
  expiresAt: string;
  trackingNumber: string | null;
  maskedName: string;
  maskedAddress: string;
  /** The admin's reason for the latest rejected slip, only while the order is awaiting payment again. */
  rejectedReason: string | null;
  /** An http(s) link, or null. */
  contactUrl: string | null;
};

function isStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && STATUSES.includes(value);
}

/** Only http and https may become links; javascript:, data: and the like never reach an href. */
export function safeContactUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export type OrderLookup = {
  id: string;
  status: OrderStatus;
  expiresAt: string;
};

/** Finds an order by link token. Hashes the token; the plain token is never queried or logged. */
export async function findOrderByToken(client: SupabaseClient, token: string): Promise<OrderLookup | null> {
  if (!token) return null;
  const { data, error } = await client
    .from("orders")
    .select("id, status, expires_at")
    .eq("token_hash", hashOrderToken(token))
    .maybeSingle();
  if (error) throw new Error(`findOrderByToken: ${error.code ?? "unknown"}`);
  if (!data || !isStatus(data.status)) return null;
  return { id: String(data.id), status: data.status, expiresAt: new Date(String(data.expires_at)).toISOString() };
}

/** The status the customer sees: a lapsed payment window counts as expired before cron has run. */
export function presentStatus(status: OrderStatus, expiresAt: string, now: Date = new Date()): OrderStatus {
  return status === "awaiting_payment" && new Date(expiresAt).getTime() <= now.getTime() ? "expired" : status;
}

export async function getOrderViewByToken(
  client: SupabaseClient,
  token: string,
  now: Date = new Date(),
): Promise<OrderView | null> {
  if (!token) return null;
  const { data: order, error } = await client
    .from("orders")
    .select(
      "id, order_number, status, customer_name, shipping_address, subtotal_satang, shipping_fee_satang, total_satang, expires_at, tracking_number",
    )
    .eq("token_hash", hashOrderToken(token))
    .maybeSingle();
  if (error) throw new Error(`getOrderViewByToken: ${error.code ?? "unknown"}`);
  if (!order || !isStatus(order.status)) return null;

  const expiresAt = new Date(String(order.expires_at)).toISOString();
  const status = presentStatus(order.status, expiresAt, now);

  const [items, rejected, settings] = await Promise.all([
    client
      .from("order_items")
      .select("product_name, unit_price_satang, quantity")
      .eq("order_id", order.id)
      .order("product_name")
      .order("id"),
    status === "awaiting_payment"
      ? client
          .from("payment_slips")
          .select("reject_reason")
          .eq("order_id", order.id)
          .eq("review_status", "rejected")
          .order("reviewed_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    getStoreSettings(client),
  ]);
  if (items.error) throw new Error(`getOrderViewByToken items: ${items.error.code ?? "unknown"}`);
  if (rejected.error) throw new Error(`getOrderViewByToken slips: ${rejected.error.code ?? "unknown"}`);

  return {
    orderNumber: String(order.order_number),
    status,
    items: (items.data ?? []).map((row) => ({
      name: String(row.product_name),
      unitPriceSatang: Number(row.unit_price_satang),
      quantity: Number(row.quantity),
    })),
    subtotalSatang: Number(order.subtotal_satang),
    shippingFeeSatang: Number(order.shipping_fee_satang),
    totalSatang: Number(order.total_satang),
    expiresAt,
    trackingNumber: order.tracking_number ? String(order.tracking_number) : null,
    maskedName: maskName(String(order.customer_name)),
    maskedAddress: maskAddress(String(order.shipping_address)),
    rejectedReason: rejected.data?.reject_reason ? String(rejected.data.reject_reason) : null,
    contactUrl: safeContactUrl(settings.contactUrl),
  };
}
