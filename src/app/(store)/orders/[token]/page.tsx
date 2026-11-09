import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyLinkButton } from "@/components/copy-link-button";
import { OrderCountdown } from "@/components/order-countdown";
import { RefreshButton } from "@/components/refresh-button";
import { SlipUploadForm } from "@/components/slip-upload-form";
import { getOrderViewByToken, type OrderView } from "@/features/orders/queries";
import { serverEnv } from "@/lib/env";
import { formatBaht } from "@/lib/money";
import type { OrderStatus } from "@/lib/order-status";
import { createPromptPayPayload, renderQrDataUrl } from "@/lib/promptpay";
import { createAdminClient } from "@/lib/supabase/admin";

// The page shows live state and a link-only secret: it must never be prerendered or cached.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "สถานะคำสั่งซื้อ", robots: { index: false, follow: false } };

const HEADLINES: Record<OrderStatus, string> = {
  awaiting_payment: "รอชำระเงิน",
  payment_review: "ได้รับสลิปแล้ว รอร้านตรวจสอบ",
  paid: "ชำระเงินแล้ว ร้านกำลังเตรียมจัดส่ง",
  shipped: "จัดส่งแล้ว",
  expired: "คำสั่งซื้อนี้หมดอายุแล้ว",
  cancelled: "คำสั่งซื้อนี้ถูกยกเลิกแล้ว",
};

const LINK_BUTTON =
  "inline-flex min-h-11 items-center rounded-full bg-brand px-6 font-semibold text-on-brand hover:bg-brand-hover";

/** Generated on the server; only the image leaves it, never PROMPTPAY_ID itself. */
async function buildQr(view: OrderView): Promise<string | null> {
  if (view.status !== "awaiting_payment") return null;
  try {
    return await renderQrDataUrl(createPromptPayPayload(serverEnv().PROMPTPAY_ID, view.totalSatang));
  } catch {
    console.error("promptpay qr failed");
    return null;
  }
}

function Panel({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <section aria-label={label} className="mt-4 rounded-card border border-line bg-surface p-4">
      {children}
    </section>
  );
}

export default async function OrderPage({ params }: PageProps<"/orders/[token]">) {
  const { token } = await params;
  const view = await getOrderViewByToken(createAdminClient(), token);
  if (!view) notFound();

  const qr = await buildQr(view);
  const open = view.status !== "expired" && view.status !== "cancelled";
  const contact = view.contactUrl ? (
    <a
      href={view.contactUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center underline"
    >
      ติดต่อร้านค้า
    </a>
  ) : null;

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        คำสั่งซื้อ <span data-testid="order-number">{view.orderNumber}</span>
      </h1>
      <p
        role="status"
        data-testid="order-status"
        className="mt-3 rounded-lg border border-line-strong bg-sunken p-3 text-lg font-semibold"
      >
        สถานะ: {HEADLINES[view.status]}
      </p>

      {view.status === "awaiting_payment" ? (
        <>
          {view.rejectedReason ? (
            <div
              data-testid="rejected-notice"
              className="mt-4 rounded-lg border border-danger-ink bg-danger-bg p-3 text-danger-ink"
            >
              <p className="font-semibold">ร้านตรวจสลิปแล้วแต่ยังไม่ผ่าน</p>
              <p>เหตุผล: {view.rejectedReason}</p>
              <p>กรุณาตรวจสอบและแนบสลิปใหม่ด้านล่าง</p>
            </div>
          ) : null}

          <Panel label="ชำระเงินด้วยพร้อมเพย์">
            <h2 className="text-lg font-semibold">ชำระเงินด้วยพร้อมเพย์</h2>
            <p className="mt-1">
              ยอดที่ต้องชำระ{" "}
              <strong className="text-xl" data-testid="amount">
                {formatBaht(view.totalSatang)}
              </strong>
            </p>
            {qr ? (
              <div className="mt-3 flex flex-col items-center gap-3">
                <Image
                  src={qr}
                  alt={`QR พร้อมเพย์สำหรับชำระเงิน ${formatBaht(view.totalSatang)}`}
                  width={288}
                  height={288}
                  unoptimized
                  className="rounded-lg border border-line"
                />
                <a
                  href={qr}
                  download={`promptpay-${view.orderNumber}.png`}
                  className="inline-flex min-h-11 items-center rounded-full border border-brand px-5 font-semibold text-brand hover:bg-sunken"
                >
                  บันทึกรูป QR
                </a>
              </div>
            ) : (
              <p role="alert" className="mt-3 rounded-lg border border-danger-ink bg-danger-bg p-3 text-danger-ink">
                ไม่สามารถสร้าง QR ได้ในขณะนี้ กรุณาลองรีเฟรชหน้านี้ หรือติดต่อร้านค้า
              </p>
            )}
            <p className="mt-3 text-sm text-ink-soft">
              สแกน QR จากแอปธนาคาร หรือกด “บันทึกรูป QR” แล้วเปิดรูปจากแอปธนาคารในเครื่องเดียวกัน
              เมื่อโอนแล้วให้แนบสลิปด้านล่าง
            </p>
            <div className="mt-3">
              <OrderCountdown expiresAt={view.expiresAt} />
            </div>
          </Panel>

          <Panel label="แนบสลิป">
            <h2 className="mb-3 text-lg font-semibold">แนบสลิปการโอนเงิน</h2>
            <SlipUploadForm token={token} />
          </Panel>
        </>
      ) : null}

      {view.status === "payment_review" ? (
        <Panel label="รอตรวจสลิป">
          <p>ร้านได้รับสลิปของคุณแล้วและกำลังตรวจสอบ เมื่อตรวจเสร็จสถานะในหน้านี้จะเปลี่ยน กดตรวจสอบสถานะล่าสุดหรือโหลดหน้าใหม่เพื่อดู</p>
        </Panel>
      ) : null}

      {view.status === "paid" ? (
        <Panel label="ชำระเงินแล้ว">
          <p>ร้านยืนยันการชำระเงินแล้ว เมื่อจัดส่งสินค้า เลขพัสดุจะแสดงในหน้านี้</p>
        </Panel>
      ) : null}

      {view.status === "shipped" ? (
        <Panel label="เลขพัสดุ">
          <p>
            เลขพัสดุ: <strong data-testid="tracking-number">{view.trackingNumber ?? "-"}</strong>
          </p>
        </Panel>
      ) : null}

      {view.status === "expired" ? (
        <Panel label="คำสั่งซื้อหมดอายุ">
          <p>คำสั่งซื้อนี้เกินเวลาชำระเงินแล้ว สินค้าที่จองไว้ถูกคืนเข้าสต็อก สั่งซื้อใหม่ได้จากหน้าร้าน</p>
          <p className="mt-2">หากคุณโอนเงินไปแล้ว กรุณาติดต่อร้านค้าพร้อมแจ้งเลขคำสั่งซื้อ {view.orderNumber}</p>
          <Link href="/" className={`mt-4 ${LINK_BUTTON}`}>
            กลับไปสั่งซื้อ
          </Link>
        </Panel>
      ) : null}

      {view.status === "cancelled" ? (
        <Panel label="คำสั่งซื้อถูกยกเลิก">
          <p>คำสั่งซื้อนี้ถูกยกเลิกแล้ว หากมีข้อสงสัยกรุณาติดต่อร้านค้าพร้อมแจ้งเลขคำสั่งซื้อ {view.orderNumber}</p>
          <Link href="/" className={`mt-4 ${LINK_BUTTON}`}>
            กลับไปดูสินค้า
          </Link>
        </Panel>
      ) : null}

      <Panel label="รายการสินค้า">
        <h2 className="text-lg font-semibold">รายการสินค้า</h2>
        <ul className="mt-2 space-y-2">
          {view.items.map((item, index) => (
            <li key={`${item.name}-${index}`} className="flex justify-between gap-3">
              <span>
                {item.name} × {item.quantity}
              </span>
              <span>{formatBaht(item.unitPriceSatang * item.quantity)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 space-y-2 border-t border-line pt-3">
          <div className="flex justify-between">
            <dt>ค่าสินค้า</dt>
            <dd>{formatBaht(view.subtotalSatang)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>ค่าจัดส่ง</dt>
            <dd>{formatBaht(view.shippingFeeSatang)}</dd>
          </div>
          <div className="flex justify-between text-xl font-bold">
            <dt>ยอดรวมทั้งหมด</dt>
            <dd>{formatBaht(view.totalSatang)}</dd>
          </div>
        </dl>
        <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm text-ink-soft">
          <div className="flex justify-between gap-3">
            <dt>ผู้รับ</dt>
            <dd>{view.maskedName}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>ที่อยู่จัดส่ง</dt>
            <dd>{view.maskedAddress}</dd>
          </div>
        </dl>
      </Panel>

      {open ? (
        <Panel label="บันทึกลิงก์">
          <h2 className="text-lg font-semibold">บันทึกลิงก์นี้ไว้</h2>
          <p className="mt-1 text-sm text-ink-soft">
            เราไม่ส่งอีเมลหรือข้อความแจ้งเตือน ลิงก์นี้เป็นทางเดียวที่ใช้ดูสถานะคำสั่งซื้อ
            หากลิงก์หายจะเปิดดูอีกไม่ได้ และอย่าส่งลิงก์ให้ผู้อื่น
          </p>
          <div className="mt-3">
            <CopyLinkButton />
          </div>
        </Panel>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {open ? <RefreshButton /> : null}
        {contact}
      </div>
    </>
  );
}
