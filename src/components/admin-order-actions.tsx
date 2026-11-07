"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import {
  approveSlipAction,
  cancelOrderAction,
  rejectSlipAction,
  setTrackingAction,
  shipOrderAction,
} from "@/features/admin/order-actions";
import type { OrderStatus } from "@/features/orders/queries";
import { ActionError, DANGER, FIELD, FieldError, PRIMARY, SECONDARY, useAdminAction } from "./admin-ui";

/**
 * Every component takes `status`, the order's status as this page showed it. Actions send it along,
 * and the database refuses if the order has changed since the admin looked.
 */
type Shown = { orderId: string; status: OrderStatus };

export function ApproveSlipButton({ orderId, status }: Shown) {
  const { pending, failure, run } = useAdminAction();
  return (
    <div className="space-y-3">
      <button type="button" disabled={pending} className={`${PRIMARY} w-full`} onClick={() => run(() => approveSlipAction(orderId, status))}>
        {pending ? "กำลังบันทึก…" : "ยืนยันการชำระเงิน"}
      </button>
      <ActionError failure={failure} />
    </div>
  );
}

export function RejectSlipForm({ orderId, status }: Shown) {
  const { pending, failure, run } = useAdminAction();
  const [reason, setReason] = useState("");
  const id = useId();
  const error = failure?.fields?.reason;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run(() => rejectSlipAction(orderId, reason, status), () => setReason(""));
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3">
      <div>
        <label htmlFor={`${id}-reason`} className="font-medium">
          เหตุผลที่ปฏิเสธสลิป
        </label>
        <p id={`${id}-hint`} className="text-sm text-ink-soft">
          ลูกค้าจะเห็นข้อความนี้ตามที่พิมพ์ และแนบสลิปใหม่ได้จากหน้าคำสั่งซื้อ (ไม่เกิน 500 ตัวอักษร)
        </p>
        <textarea
          id={`${id}-reason`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-hint ${id}-error` : `${id}-hint`}
          className={FIELD}
        />
        <FieldError id={`${id}-error`} testId="reason-error" message={error} />
      </div>
      <ActionError failure={failure} />
      <button type="submit" disabled={pending} className={`${SECONDARY} w-full`}>
        {pending ? "กำลังบันทึก…" : "ปฏิเสธสลิป"}
      </button>
    </form>
  );
}

/** Ships a paid order, or with `correct` fixes the tracking number of a shipped one. */
export function TrackingForm({ orderId, status, correct = false }: Shown & { correct?: boolean }) {
  const { pending, failure, run } = useAdminAction();
  const [tracking, setTracking] = useState("");
  const id = useId();
  const error = failure?.fields?.tracking;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A correction changes no status, so set_tracking_number needs no expected status.
    run(
      () => (correct ? setTrackingAction(orderId, tracking) : shipOrderAction(orderId, tracking, status)),
      () => setTracking(""),
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3">
      <div>
        <label htmlFor={`${id}-tracking`} className="font-medium">
          เลขพัสดุ
        </label>
        <input
          id={`${id}-tracking`}
          type="text"
          value={tracking}
          onChange={(event) => setTracking(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`${FIELD} min-h-12`}
        />
        <FieldError id={`${id}-error`} testId="tracking-error" message={error} />
      </div>
      <ActionError failure={failure} />
      <button type="submit" disabled={pending} className={PRIMARY}>
        {pending ? "กำลังบันทึก…" : correct ? "บันทึกเลขพัสดุใหม่" : "บันทึกการจัดส่ง"}
      </button>
    </form>
  );
}

/**
 * Cancelling always asks first: it returns the stock and cannot be undone. For money the store may
 * already hold, the question says plainly that the refund is the admin's to make.
 */
export function CancelOrderButton({ orderId, status, totalText }: Shown & { totalText: string }) {
  // "paid": money received; "maybe": a slip is waiting, so money may have been sent.
  const refund = status === "paid" ? "paid" : status === "payment_review" ? "maybe" : "none";
  const { pending, failure, run } = useAdminAction();
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();

  return (
    <>
      <button type="button" className={DANGER} onClick={() => dialog.current?.showModal()}>
        ยกเลิกคำสั่งซื้อ
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
        className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-card border border-line bg-surface p-5 text-ink backdrop:bg-ink/50"
      >
        <h2 id={`${id}-title`} className="text-xl font-bold">
          ยืนยันการยกเลิกคำสั่งซื้อ
        </h2>
        <div id={`${id}-body`} className="mt-3 space-y-2">
          {refund === "paid" ? (
            <p className="rounded-lg border border-danger-ink bg-danger-bg p-3 font-semibold text-danger-ink">
              คำสั่งซื้อนี้ชำระเงินแล้ว ระบบไม่คืนเงินให้อัตโนมัติ คุณต้องโอนเงินคืน {totalText}{" "}
              ให้ลูกค้าเองนอกระบบ
            </p>
          ) : null}
          {refund === "maybe" ? (
            <p className="rounded-lg border border-notice-line bg-notice-bg p-3 text-notice-ink">
              ลูกค้าแนบสลิปแล้ว หากได้รับเงินเข้าบัญชีจริง ระบบไม่คืนเงินให้อัตโนมัติ คุณต้องโอนเงินคืน {totalText}{" "}
              ให้ลูกค้าเองนอกระบบ
            </p>
          ) : null}
          <p>สินค้าในคำสั่งซื้อจะถูกคืนเข้าสต็อก และยกเลิกแล้วย้อนกลับไม่ได้</p>
        </div>
        <div className="mt-4">
          <ActionError failure={failure} />
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={pending}
            className={DANGER}
            onClick={() => run(() => cancelOrderAction(orderId, status), () => dialog.current?.close())}
          >
            {pending ? "กำลังยกเลิก…" : "ยืนยันการยกเลิก"}
          </button>
          <button type="button" disabled={pending} className={SECONDARY} onClick={() => dialog.current?.close()}>
            ไม่ยกเลิก
          </button>
        </div>
      </dialog>
    </>
  );
}
