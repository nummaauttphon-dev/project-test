import { ADMIN_STATUS_LABELS } from "@/features/admin/format";
import type { OrderStatus } from "@/features/orders/queries";

const TONES: Record<OrderStatus, string> = {
  awaiting_payment: "border-line-strong bg-surface text-ink",
  payment_review: "border-notice-line bg-notice-bg text-notice-ink",
  paid: "border-brand bg-surface text-brand",
  shipped: "border-line-strong bg-sunken text-ink",
  expired: "border-line-strong bg-sunken text-ink-soft",
  cancelled: "border-danger-ink bg-danger-bg text-danger-ink",
};

/** The status in words; the colour only repeats what the text says. */
export function AdminStatusBadge({ status, testId }: { status: OrderStatus; testId?: string }) {
  return (
    <span
      data-testid={testId}
      className={`inline-flex items-center rounded-full border px-3 py-0.5 text-sm font-semibold ${TONES[status]}`}
    >
      {ADMIN_STATUS_LABELS[status]}
    </span>
  );
}
