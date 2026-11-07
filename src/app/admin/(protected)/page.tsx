import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminPage } from "@/features/admin/auth";
import { getDashboardStats, LOW_STOCK_THRESHOLD } from "@/features/admin/queries";
import { formatBaht } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "แดชบอร์ด" };

function Stat({
  label,
  value,
  testId,
  href,
  note,
  highlight = false,
}: {
  label: string;
  value: string;
  testId: string;
  href?: string;
  note: string;
  highlight?: boolean;
}) {
  const body = (
    <>
      <span className="block font-medium">{label}</span>
      <span data-testid={testId} className="mt-1 block text-3xl font-bold tabular-nums">
        {value}
      </span>
      <span className="mt-1 block text-sm text-ink-soft">{note}</span>
    </>
  );
  const box = `block h-full rounded-card border p-4 ${highlight ? "border-notice-line bg-notice-bg" : "border-line bg-surface"}`;
  return (
    <li>
      {href ? (
        <Link href={href} className={`${box} hover:border-line-strong`}>
          {body}
        </Link>
      ) : (
        <div className={box}>{body}</div>
      )}
    </li>
  );
}

export default async function AdminDashboardPage() {
  await requireAdminPage();
  const stats = await getDashboardStats(createAdminClient());

  return (
    <>
      <h1 className="text-2xl font-bold">แดชบอร์ด</h1>

      <ul className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat
          label="รอตรวจสลิป"
          value={String(stats.pendingReview)}
          testId="stat-pending-review"
          href="/admin/orders?status=payment_review"
          note={stats.pendingReview > 0 ? "กดเพื่อเปิดรายการที่รอตรวจ" : "ไม่มีสลิปที่รอตรวจ"}
          highlight={stats.pendingReview > 0}
        />
        <Stat
          label="ออเดอร์ที่ชำระแล้ว"
          value={String(stats.paidOrders)}
          testId="stat-paid-orders"
          note="นับสถานะชำระแล้วและจัดส่งแล้ว"
        />
        <Stat
          label="ยอดขายรวม"
          value={formatBaht(stats.revenueSatang)}
          testId="stat-revenue"
          note="รวมค่าส่ง จากออเดอร์ที่ชำระแล้วและจัดส่งแล้ว"
        />
      </ul>

      <section aria-labelledby="low-stock-title" className="mt-8 rounded-card border border-line bg-surface p-4">
        <h2 id="low-stock-title" className="text-lg font-semibold">
          สินค้าใกล้หมด
        </h2>
        <p className="text-sm text-ink-soft">สินค้าที่เปิดขายและเหลือไม่เกิน {LOW_STOCK_THRESHOLD} ชิ้น</p>
        {stats.lowStock.length === 0 ? (
          <p className="mt-3">ไม่มีสินค้าใกล้หมด</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {stats.lowStock.map((product) => (
              <li key={product.id} className="flex justify-between gap-3 py-2">
                <span>{product.name}</span>
                <span className={`shrink-0 font-semibold ${product.stockQuantity === 0 ? "text-danger-ink" : ""}`}>
                  {product.stockQuantity === 0 ? "หมดแล้ว (เหลือ 0 ชิ้น)" : `เหลือ ${product.stockQuantity} ชิ้น`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-6">
        <Link href="/admin/orders" className="inline-flex min-h-11 items-center font-semibold underline">
          ดูคำสั่งซื้อทั้งหมด
        </Link>
      </p>
    </>
  );
}
