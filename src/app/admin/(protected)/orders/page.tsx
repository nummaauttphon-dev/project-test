import type { Metadata } from "next";
import Link from "next/link";
import { AdminStatusBadge } from "@/components/admin-status-badge";
import { requireAdminPage } from "@/features/admin/auth";
import { ADMIN_STATUS_LABELS, formatThaiDateTime } from "@/features/admin/format";
import { isOrderStatus, listOrders, ORDER_STATUSES } from "@/features/admin/queries";
import type { OrderStatus } from "@/features/orders/queries";
import { formatBaht } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "คำสั่งซื้อ" };

const FILTER_ORDER: OrderStatus[] = ["payment_review", ...ORDER_STATUSES.filter((s) => s !== "payment_review")];

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function listHref(status: OrderStatus | undefined, page = 1): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/admin/orders?${query}` : "/admin/orders";
}

const CHIP =
  "inline-flex min-h-11 items-center rounded-full border border-line-strong px-4 font-medium hover:bg-sunken aria-[current=page]:border-brand aria-[current=page]:bg-brand aria-[current=page]:text-on-brand";

export default async function AdminOrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  await requireAdminPage();
  const params = await searchParams;
  const rawStatus = first(params.status);
  const status = isOrderStatus(rawStatus) ? rawStatus : undefined;
  const requested = Number.parseInt(first(params.page) ?? "1", 10);
  const result = await listOrders(createAdminClient(), status, Number.isSafeInteger(requested) ? requested : 1);

  return (
    <>
      <h1 className="text-2xl font-bold">คำสั่งซื้อ</h1>

      <nav aria-label="กรองตามสถานะ" className="mt-4">
        <ul className="flex flex-wrap gap-2">
          <li>
            <Link href={listHref(undefined)} aria-current={status ? undefined : "page"} className={CHIP}>
              ทั้งหมด
            </Link>
          </li>
          {FILTER_ORDER.map((value) => (
            <li key={value}>
              <Link href={listHref(value)} aria-current={status === value ? "page" : undefined} className={CHIP}>
                {ADMIN_STATUS_LABELS[value]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <p className="mt-4 text-sm text-ink-soft">
        {status ? `สถานะ${ADMIN_STATUS_LABELS[status]} ` : "รายการรอตรวจสลิปแสดงก่อน แล้วตามด้วยรายการใหม่สุด "}
        ทั้งหมด {result.total} รายการ
      </p>

      {result.orders.length === 0 ? (
        <p className="mt-4 rounded-card border border-line bg-surface p-4">ไม่มีคำสั่งซื้อในหน้านี้</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {result.orders.map((order) => (
            <li
              key={order.id}
              data-testid="order-row"
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-card border border-line bg-surface p-3"
            >
              <div className="min-w-0">
                <Link
                  href={`/admin/orders/${order.id}`}
                  className="inline-flex min-h-11 items-center font-semibold underline"
                >
                  {order.orderNumber}
                </Link>
                <p className="truncate text-sm text-ink-soft">
                  {order.customerName} · {formatThaiDateTime(order.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-semibold tabular-nums">{formatBaht(order.totalSatang)}</span>
                <AdminStatusBadge status={order.status} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {result.pageCount > 1 ? (
        <nav aria-label="เลือกหน้า" className="mt-6 flex flex-wrap items-center justify-between gap-3">
          {result.page > 1 ? (
            <Link href={listHref(status, result.page - 1)} className={CHIP}>
              หน้าก่อนหน้า
            </Link>
          ) : (
            <span />
          )}
          <p>
            หน้า {result.page} จาก {result.pageCount}
          </p>
          {result.page < result.pageCount ? (
            <Link href={listHref(status, result.page + 1)} className={CHIP}>
              หน้าถัดไป
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </>
  );
}
