import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveOrderToken, hashOrderToken } from "@/lib/order-token";
import { isAllowed } from "@/lib/rate-limit";
import { fail, ok, type ActionResult } from "@/lib/result";
import { checkoutSchema } from "./schema";

export type OrderChange = {
  product_id: string;
  reason: "insufficient_stock" | "unavailable" | "price_changed";
  available_quantity: number;
  /** Null for an unavailable product: the price of a hidden product is never sent to the browser. */
  current_price_satang: number | null;
};

export type PlaceOrderData =
  | { kind: "created"; token: string; contactMismatch: boolean }
  | { kind: "changed"; changes: OrderChange[]; currentTotalSatang: number };

export type PlaceOrderDeps = {
  client: SupabaseClient;
  ip: string;
  tokenSecret: string;
  rateLimitSalt: string;
};

const MAX_LINE_QUANTITY = 10;
const UNEXPECTED_MESSAGE = "ไม่สามารถสั่งซื้อได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง";

const REASONS = new Set<string>(["insufficient_stock", "unavailable", "price_changed"]);

function parseChange(value: unknown): OrderChange | null {
  if (typeof value !== "object" || value === null) return null;
  const c = value as Record<string, unknown>;
  if (
    typeof c.product_id !== "string" ||
    typeof c.reason !== "string" ||
    !REASONS.has(c.reason) ||
    typeof c.available_quantity !== "number"
  ) {
    return null;
  }
  if (c.current_price_satang !== null && typeof c.current_price_satang !== "number") return null;
  const reason = c.reason as OrderChange["reason"];
  return {
    product_id: c.product_id,
    reason,
    available_quantity: c.available_quantity,
    current_price_satang: reason === "unavailable" ? null : (c.current_price_satang as number | null),
  };
}

export async function placeOrder(
  input: unknown,
  deps: PlaceOrderDeps,
): Promise<ActionResult<PlaceOrderData>> {
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "form");
      fieldErrors[field] ??= issue.message;
    }
    return fail("VALIDATION", "กรุณาตรวจสอบข้อมูลที่กรอก", fieldErrors);
  }
  const order = parsed.data;

  // Duplicate lines become one, so the per-item limit applies to what is actually ordered.
  const merged = new Map<string, number>();
  for (const item of order.items) {
    merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.quantity);
  }
  if ([...merged.values()].some((quantity) => quantity > MAX_LINE_QUANTITY)) {
    return fail("VALIDATION", "กรุณาตรวจสอบข้อมูลที่กรอก", {
      items: "สั่งได้ไม่เกิน 10 ชิ้นต่อรายการ",
    });
  }
  const items = [...merged].map(([product_id, quantity]) => ({ product_id, quantity }));

  const allowed = await isAllowed(deps.client, "place_order", deps.ip || "unknown", deps.rateLimitSalt);
  if (!allowed) {
    return fail("RATE_LIMITED", "สั่งซื้อบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง");
  }

  const token = deriveOrderToken(order.idempotencyKey, deps.tokenSecret);
  try {
    const { data, error } = await deps.client.rpc("create_order", {
      p_idempotency_key: order.idempotencyKey,
      p_token_hash: hashOrderToken(token),
      p_customer_name: order.customerName,
      p_phone: order.phone,
      p_shipping_address: order.shippingAddress,
      p_items: items,
      p_expected_total_satang: order.expectedTotalSatang,
    });
    if (error) {
      // Only the code: `details` of a unique violation carries the token hash.
      console.error("create_order failed", error.code ?? "unknown");
      return fail("UNEXPECTED", UNEXPECTED_MESSAGE);
    }

    const result = data as Record<string, unknown> | null;
    if (result && result.status === "created") {
      return ok({ kind: "created", token, contactMismatch: false });
    }
    if (result && result.status === "existing" && typeof result.order_id === "string") {
      // A retry of an earlier request. Tell the browser whether the edited contact data differs
      // from what was stored, without sending the stored values back.
      const stored = await deps.client
        .from("orders")
        .select("customer_name, phone, shipping_address")
        .eq("id", result.order_id)
        .single();
      if (stored.error || !stored.data) {
        console.error("existing order lookup failed", stored.error?.code ?? "no row");
        return fail("UNEXPECTED", UNEXPECTED_MESSAGE);
      }
      const contactMismatch =
        stored.data.customer_name !== order.customerName ||
        stored.data.phone !== order.phone ||
        stored.data.shipping_address !== order.shippingAddress;
      return ok({ kind: "created", token, contactMismatch });
    }
    if (
      result &&
      result.status === "changed" &&
      Array.isArray(result.changes) &&
      typeof result.current_total_satang === "number"
    ) {
      const changes = result.changes.map(parseChange);
      if (changes.every((c): c is OrderChange => c !== null)) {
        return ok({ kind: "changed", changes, currentTotalSatang: result.current_total_satang });
      }
    }
    console.error("create_order returned an unexpected shape");
    return fail("UNEXPECTED", UNEXPECTED_MESSAGE);
  } catch {
    console.error("create_order threw");
    return fail("UNEXPECTED", UNEXPECTED_MESSAGE);
  }
}
