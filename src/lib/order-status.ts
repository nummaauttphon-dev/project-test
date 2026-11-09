/** Every order status, in the database enum's order. */
export const ORDER_STATUSES = [
  "awaiting_payment",
  "payment_review",
  "paid",
  "shipped",
  "expired",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}
