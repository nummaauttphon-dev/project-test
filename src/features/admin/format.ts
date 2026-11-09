import type { OrderStatus } from "@/lib/order-status";

/** Status names on admin screens: short, for scanning a list. */
export const ADMIN_STATUS_LABELS: Record<OrderStatus, string> = {
  awaiting_payment: "รอชำระเงิน",
  payment_review: "รอตรวจสลิป",
  paid: "ชำระแล้ว",
  shipped: "จัดส่งแล้ว",
  expired: "หมดอายุ",
  cancelled: "ยกเลิก",
};

const dateTime = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Bangkok",
});

/** An ISO 8601 time in Thai, in the store's time zone whatever the server's. */
export function formatThaiDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}
