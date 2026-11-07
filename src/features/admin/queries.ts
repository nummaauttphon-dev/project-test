import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderStatus } from "@/features/orders/queries";

export const ORDER_STATUSES: readonly OrderStatus[] = [
  "awaiting_payment",
  "payment_review",
  "paid",
  "shipped",
  "expired",
  "cancelled",
];

export const ORDERS_PAGE_SIZE = 50;
export const LOW_STOCK_THRESHOLD = 5;
const LOW_STOCK_LIMIT = 50;
/** Signed slip links live this long: enough to look at the slip, short if a link leaks. */
export const SLIP_URL_SECONDS = 300;
const SLIP_BUCKET = "payment-slips";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isOrderId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}

export type LowStockProduct = { id: string; name: string; stockQuantity: number };

export type DashboardStats = {
  pendingReview: number;
  paidOrders: number;
  revenueSatang: number;
  lowStock: LowStockProduct[];
};

export type OrderSummary = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  customerName: string;
  totalSatang: number;
  /** ISO 8601. */
  createdAt: string;
};

export type OrderPage = { orders: OrderSummary[]; total: number; page: number; pageCount: number };

export type SlipView = {
  id: string;
  reviewStatus: "pending" | "approved" | "rejected";
  rejectReason: string | null;
  /** ISO 8601. */
  createdAt: string;
  reviewedAt: string | null;
  fileDeleted: boolean;
  /** A signed link valid for SLIP_URL_SECONDS, or null when there is no file to show. */
  url: string | null;
};

/**
 * Everything the admin order page shows. Unlike the customer's OrderView it holds the full name,
 * phone and address, which the admin needs to ship. Storage paths stay on the server.
 */
export type OrderDetail = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  customerName: string;
  phone: string;
  shippingAddress: string;
  items: { name: string; unitPriceSatang: number; quantity: number }[];
  subtotalSatang: number;
  shippingFeeSatang: number;
  totalSatang: number;
  trackingNumber: string | null;
  /** ISO 8601. */
  createdAt: string;
  expiresAt: string;
  /** Newest first. */
  slips: SlipView[];
};

function failure(where: string, error: { code?: string } | null): Error {
  return new Error(`${where}: ${error?.code ?? "unknown"}`);
}

type StatsRow = { pending_review?: unknown; paid_orders?: unknown; revenue_satang?: unknown };

/**
 * The counts and revenue come from admin_dashboard_stats, one statement and so one snapshot. Paid
 * orders and revenue count paid and shipped only (spec, section 5).
 */
export async function getDashboardStats(client: SupabaseClient): Promise<DashboardStats> {
  const [stats, lowStock] = await Promise.all([
    client.rpc("admin_dashboard_stats"),
    client
      .from("products")
      .select("id, name, stock_quantity")
      .eq("is_active", true)
      .lte("stock_quantity", LOW_STOCK_THRESHOLD)
      .order("stock_quantity")
      .order("name")
      .limit(LOW_STOCK_LIMIT),
  ]);
  if (stats.error) throw failure("admin_dashboard_stats", stats.error);
  if (lowStock.error) throw failure("lowStock", lowStock.error);
  const row = (stats.data ?? {}) as StatsRow;
  return {
    pendingReview: Number(row.pending_review ?? 0),
    paidOrders: Number(row.paid_orders ?? 0),
    revenueSatang: Number(row.revenue_satang ?? 0),
    lowStock: (lowStock.data ?? []).map((product) => ({
      id: String(product.id),
      name: String(product.name),
      stockQuantity: Number(product.stock_quantity),
    })),
  };
}

const SUMMARY_COLUMNS = "id, order_number, status, customer_name, total_satang, created_at";

type SummaryRow = {
  id: unknown;
  order_number: unknown;
  status: unknown;
  customer_name: unknown;
  total_satang: unknown;
  created_at: unknown;
};

function toSummary(row: SummaryRow): OrderSummary {
  return {
    id: String(row.id),
    orderNumber: String(row.order_number),
    status: isOrderStatus(row.status) ? row.status : "cancelled",
    customerName: String(row.customer_name),
    totalSatang: Number(row.total_satang),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

type OrderFilter = { include: OrderStatus } | { exclude: OrderStatus };

async function countWhere(client: SupabaseClient, filter: OrderFilter): Promise<number> {
  const query = client.from("orders").select("id", { count: "exact", head: true });
  const { count, error } = await ("include" in filter
    ? query.eq("status", filter.include)
    : query.neq("status", filter.exclude));
  if (error) throw failure("listOrders count", error);
  return count ?? 0;
}

/** Rows offset..offset+limit-1 of the filtered orders, newest first. */
async function sliceWhere(
  client: SupabaseClient,
  filter: OrderFilter,
  offset: number,
  limit: number,
): Promise<OrderSummary[]> {
  if (limit <= 0) return [];
  const query = client.from("orders").select(SUMMARY_COLUMNS);
  const { data, error } = await ("include" in filter
    ? query.eq("status", filter.include)
    : query.neq("status", filter.exclude))
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw failure("listOrders", error);
  return ((data ?? []) as SummaryRow[]).map(toSummary);
}

/**
 * Orders for the admin list, ORDERS_PAGE_SIZE per page. Without a status filter, orders waiting for
 * slip review come first and the rest follow, each part newest first. The API cannot sort by such
 * a rule, so the page is cut from the two parts separately. Counting first keeps every requested
 * range inside the rows that exist.
 */
export async function listOrders(client: SupabaseClient, status?: OrderStatus, page = 1): Promise<OrderPage> {
  const current = Number.isSafeInteger(page) && page >= 1 ? page : 1;
  const offset = (current - 1) * ORDERS_PAGE_SIZE;
  const parts: OrderFilter[] = status
    ? [{ include: status }]
    : [{ include: "payment_review" }, { exclude: "payment_review" }];

  const totals = await Promise.all(parts.map((part) => countWhere(client, part)));
  const orders: OrderSummary[] = [];
  let skip = offset;
  for (const [index, part] of parts.entries()) {
    const partOffset = Math.min(skip, totals[index]);
    const take = Math.min(ORDERS_PAGE_SIZE - orders.length, totals[index] - partOffset);
    orders.push(...(await sliceWhere(client, part, partOffset, take)));
    skip -= partOffset;
  }
  const total = totals.reduce((sum, n) => sum + n, 0);
  return { orders, total, page: current, pageCount: Math.max(1, Math.ceil(total / ORDERS_PAGE_SIZE)) };
}

type SlipRow = {
  id: unknown;
  storage_path: unknown;
  review_status: unknown;
  reject_reason: unknown;
  created_at: unknown;
  reviewed_at: unknown;
  file_deleted_at: unknown;
};

/**
 * Signs links for this order's slips only: a path outside the order's own folder gets none, so a
 * bad row cannot expose another order's slip. The links are never logged.
 */
async function signSlips(client: SupabaseClient, orderId: string, rows: SlipRow[]): Promise<Map<string, string>> {
  const paths = rows
    .filter((row) => row.file_deleted_at === null)
    .map((row) => String(row.storage_path))
    .filter((path) => path.startsWith(`${orderId}/`) && !path.slice(orderId.length + 1).includes("/"));
  const signed = new Map<string, string>();
  if (paths.length === 0) return signed;

  try {
    const { data, error } = await client.storage.from(SLIP_BUCKET).createSignedUrls(paths, SLIP_URL_SECONDS);
    if (error) {
      console.error("slip signing failed", error.name);
      return signed;
    }
    for (const entry of data ?? []) {
      if (entry.path && entry.signedUrl && !entry.error) signed.set(entry.path, entry.signedUrl);
    }
  } catch {
    console.error("slip signing threw");
  }
  return signed;
}

function isoOrNull(value: unknown): string | null {
  return value ? new Date(String(value)).toISOString() : null;
}

function reviewStatus(value: unknown): SlipView["reviewStatus"] {
  return value === "approved" || value === "rejected" ? value : "pending";
}

/** Call only after requireAdminPage: it creates signed links to the order's slips. */
export async function getOrderDetail(client: SupabaseClient, id: string): Promise<OrderDetail | null> {
  if (!isOrderId(id)) return null;
  const { data: order, error } = await client
    .from("orders")
    .select(
      "id, order_number, status, customer_name, phone, shipping_address, subtotal_satang, shipping_fee_satang, total_satang, tracking_number, created_at, expires_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw failure("getOrderDetail", error);
  if (!order || !isOrderStatus(order.status)) return null;

  const [items, slips] = await Promise.all([
    client
      .from("order_items")
      .select("product_name, unit_price_satang, quantity")
      .eq("order_id", id)
      .order("product_name")
      .order("id"),
    client
      .from("payment_slips")
      .select("id, storage_path, review_status, reject_reason, created_at, reviewed_at, file_deleted_at")
      .eq("order_id", id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }),
  ]);
  if (items.error) throw failure("getOrderDetail items", items.error);
  if (slips.error) throw failure("getOrderDetail slips", slips.error);

  const slipRows = (slips.data ?? []) as SlipRow[];
  const signed = await signSlips(client, id, slipRows);

  return {
    id: String(order.id),
    orderNumber: String(order.order_number),
    status: order.status,
    customerName: String(order.customer_name),
    phone: String(order.phone),
    shippingAddress: String(order.shipping_address),
    items: (items.data ?? []).map((row) => ({
      name: String(row.product_name),
      unitPriceSatang: Number(row.unit_price_satang),
      quantity: Number(row.quantity),
    })),
    subtotalSatang: Number(order.subtotal_satang),
    shippingFeeSatang: Number(order.shipping_fee_satang),
    totalSatang: Number(order.total_satang),
    trackingNumber: order.tracking_number ? String(order.tracking_number) : null,
    createdAt: new Date(String(order.created_at)).toISOString(),
    expiresAt: new Date(String(order.expires_at)).toISOString(),
    slips: slipRows.map((row) => ({
      id: String(row.id),
      reviewStatus: reviewStatus(row.review_status),
      rejectReason: row.reject_reason ? String(row.reject_reason) : null,
      createdAt: new Date(String(row.created_at)).toISOString(),
      reviewedAt: isoOrNull(row.reviewed_at),
      fileDeleted: row.file_deleted_at !== null,
      url: signed.get(String(row.storage_path)) ?? null,
    })),
  };
}
