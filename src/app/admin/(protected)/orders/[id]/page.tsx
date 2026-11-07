import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ApproveSlipButton,
  CancelOrderButton,
  RejectSlipForm,
  TrackingForm,
} from "@/components/admin-order-actions";
import { AdminStatusBadge } from "@/components/admin-status-badge";
import { requireAdminPage } from "@/features/admin/auth";
import { formatThaiDateTime } from "@/features/admin/format";
import { getOrderDetail, type OrderDetail, type SlipView } from "@/features/admin/queries";
import { formatBaht } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "รายละเอียดคำสั่งซื้อ" };

const SLIP_STATUS: Record<SlipView["reviewStatus"], string> = {
  pending: "รอตรวจ",
  approved: "ผ่าน",
  rejected: "ไม่ผ่าน",
};

function Section({ title, id, children }: { title: string; id: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-card border border-line bg-surface p-4">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function SlipImage({ slip, orderNumber }: { slip: SlipView; orderNumber: string }) {
  if (!slip.url) {
    return (
      <p className="rounded-lg border border-danger-ink bg-danger-bg p-3 text-danger-ink">
        {slip.fileDeleted ? "ไฟล์สลิปถูกลบตามกำหนดแล้ว" : "เปิดรูปสลิปไม่ได้ในขณะนี้ กรุณาโหลดหน้าใหม่"}
      </p>
    );
  }
  return (
    <figure className="space-y-2">
      {/* A signed, short-lived Storage link: next/image would fetch and cache it on the server. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={slip.url}
        alt={`สลิปการโอนเงินของคำสั่งซื้อ ${orderNumber} แนบเมื่อ ${formatThaiDateTime(slip.createdAt)}`}
        className="mx-auto max-h-[70vh] w-auto rounded-lg border border-line"
      />
      <figcaption className="text-sm text-ink-soft">
        <a href={slip.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline">
          เปิดรูปขนาดเต็ม
        </a>{" "}
        (ลิงก์ใช้ได้ 5 นาที หากเปิดไม่ได้ให้โหลดหน้านี้ใหม่)
      </figcaption>
    </figure>
  );
}

function ReviewSection({ order }: { order: OrderDetail }) {
  const pending = order.slips.find((slip) => slip.reviewStatus === "pending");
  return (
    <Section title="ตรวจสลิป" id="review-title">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          {pending ? (
            <SlipImage slip={pending} orderNumber={order.orderNumber} />
          ) : (
            <p className="rounded-lg border border-danger-ink bg-danger-bg p-3 text-danger-ink">
              ไม่พบสลิปที่รอตรวจของคำสั่งซื้อนี้ จึงยืนยันการชำระเงินไม่ได้
            </p>
          )}
        </div>
        <div className="space-y-4">
          <div>
            <p className="font-medium">ยอดที่ต้องได้รับ</p>
            <p data-testid="expected-amount" className="text-3xl font-bold tabular-nums">
              {formatBaht(order.totalSatang)}
            </p>
          </div>
          <p className="rounded-lg border border-notice-line bg-notice-bg p-3 text-notice-ink">
            <strong>ตรวจยอดเงินเข้าในแอปธนาคารทุกครั้งก่อนกดยืนยัน</strong> ให้ตรงกับยอดที่ต้องได้รับ
            เพราะรูปสลิปอย่างเดียวปลอมแปลงได้
          </p>
          {pending ? (
            <>
              {/* Approving needs the slip in view; without its image (shown with a reload hint) only rejecting is offered. */}
              {pending.url ? <ApproveSlipButton orderId={order.id} status={order.status} slipId={pending.id} /> : null}
              <RejectSlipForm orderId={order.id} status={order.status} slipId={pending.id} />
            </>
          ) : null}
        </div>
      </div>
    </Section>
  );
}

function ShippingSection({ order }: { order: OrderDetail }) {
  if (order.status === "paid") {
    return (
      <Section title="จัดส่ง" id="shipping-title">
        <p className="mb-3">กรอกเลขพัสดุหลังส่งของ ลูกค้าจะเห็นเลขนี้ในหน้าคำสั่งซื้อ</p>
        <TrackingForm orderId={order.id} status={order.status} />
      </Section>
    );
  }
  if (order.status === "shipped") {
    return (
      <Section title="จัดส่ง" id="shipping-title">
        <p>
          เลขพัสดุปัจจุบัน: <strong data-testid="current-tracking">{order.trackingNumber ?? "-"}</strong>
        </p>
        <p className="mb-3 mt-1 text-sm text-ink-soft">หากกรอกผิด แก้เป็นเลขที่ถูกต้องได้ที่นี่</p>
        <TrackingForm orderId={order.id} status={order.status} correct />
      </Section>
    );
  }
  return null;
}

export default async function AdminOrderPage({ params }: PageProps<"/admin/orders/[id]">) {
  await requireAdminPage();
  const { id } = await params;
  // Signed slip links are created here, after the admin check, for this order only.
  const order = await getOrderDetail(createAdminClient(), id);
  if (!order) notFound();

  const cancellable = order.status === "awaiting_payment" || order.status === "payment_review" || order.status === "paid";
  const history = order.slips.filter((slip) => slip.reviewStatus !== "pending");

  return (
    <div className="space-y-4">
      <p>
        <Link href="/admin/orders" className="inline-flex min-h-11 items-center underline">
          กลับไปรายการคำสั่งซื้อ
        </Link>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">คำสั่งซื้อ {order.orderNumber}</h1>
        <AdminStatusBadge status={order.status} testId="admin-order-status" />
      </div>
      <p className="text-sm text-ink-soft">
        สั่งเมื่อ {formatThaiDateTime(order.createdAt)}
        {order.status === "awaiting_payment" ? ` · ต้องแนบสลิปภายใน ${formatThaiDateTime(order.expiresAt)}` : null}
      </p>

      {order.status === "payment_review" ? <ReviewSection order={order} /> : null}
      <ShippingSection order={order} />

      <Section title="ข้อมูลผู้รับ" id="customer-title">
        <dl className="space-y-2">
          <div>
            <dt className="text-sm text-ink-soft">ชื่อ</dt>
            <dd>{order.customerName}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink-soft">เบอร์โทร</dt>
            <dd>
              <a href={`tel:${order.phone}`} className="inline-flex min-h-11 items-center underline">
                {order.phone}
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-sm text-ink-soft">ที่อยู่จัดส่ง</dt>
            <dd className="whitespace-pre-line">{order.shippingAddress}</dd>
          </div>
        </dl>
      </Section>

      <Section title="รายการสินค้า" id="items-title">
        <ul className="space-y-2">
          {order.items.map((item, index) => (
            <li key={`${item.name}-${index}`} className="flex justify-between gap-3">
              <span>
                {item.name} × {item.quantity}
              </span>
              <span className="tabular-nums">{formatBaht(item.unitPriceSatang * item.quantity)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 space-y-1 border-t border-line pt-3">
          <div className="flex justify-between">
            <dt>ค่าสินค้า</dt>
            <dd className="tabular-nums">{formatBaht(order.subtotalSatang)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>ค่าจัดส่ง</dt>
            <dd className="tabular-nums">{formatBaht(order.shippingFeeSatang)}</dd>
          </div>
          <div className="flex justify-between text-lg font-bold">
            <dt>ยอดรวม</dt>
            <dd className="tabular-nums">{formatBaht(order.totalSatang)}</dd>
          </div>
        </dl>
      </Section>

      {history.length > 0 ? (
        <Section title="ประวัติสลิป" id="history-title">
          <ul className="space-y-3">
            {history.map((slip) => (
              <li key={slip.id} className="border-b border-line pb-3 last:border-0 last:pb-0">
                <p>
                  แนบเมื่อ {formatThaiDateTime(slip.createdAt)} · <strong>{SLIP_STATUS[slip.reviewStatus]}</strong>
                </p>
                {slip.rejectReason ? <p className="text-sm">เหตุผล: {slip.rejectReason}</p> : null}
                {slip.url ? (
                  <a href={slip.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline">
                    เปิดรูปสลิป
                  </a>
                ) : slip.fileDeleted ? (
                  <p className="text-sm text-ink-soft">ไฟล์สลิปถูกลบตามกำหนดแล้ว</p>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {cancellable ? (
        <Section title="ยกเลิกคำสั่งซื้อ" id="cancel-title">
          <p className="mb-3 text-sm text-ink-soft">ระบบจะคืนสินค้าเข้าสต็อก และขอให้ยืนยันอีกครั้งก่อนยกเลิก</p>
          <CancelOrderButton
            orderId={order.id}
            status={order.status}
            totalText={formatBaht(order.totalSatang)}
          />
        </Section>
      ) : null}
    </div>
  );
}
