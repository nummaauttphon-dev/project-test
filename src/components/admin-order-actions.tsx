"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import {
  approveSlipAction,
  cancelOrderAction,
  rejectSlipAction,
  setTrackingAction,
  shipOrderAction,
} from "@/features/admin/order-actions";
import type { ActionResult } from "@/lib/result";

const GENERIC_ERROR = "ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

const PRIMARY =
  "inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60";
const SECONDARY =
  "inline-flex min-h-12 items-center justify-center rounded-full border border-line-strong bg-surface px-6 font-semibold hover:bg-sunken disabled:opacity-60";
const DANGER =
  "inline-flex min-h-12 items-center justify-center rounded-full border border-danger-ink bg-danger-bg px-6 font-semibold text-danger-ink hover:bg-surface disabled:opacity-60";
const FIELD =
  "mt-1 block w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-base aria-[invalid=true]:border-danger-ink";

type Failure = { message: string; fields?: Record<string, string> };

/**
 * Runs an admin action. On success the action has already refreshed the page; an expired or
 * missing session goes back to login, since nothing on this page can work without one.
 */
function useAdminAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<Failure | null>(null);

  function run(call: () => Promise<ActionResult<unknown>>, onSuccess?: () => void) {
    setFailure(null);
    startTransition(async () => {
      let result: ActionResult<unknown>;
      try {
        result = await call();
      } catch {
        setFailure({ message: GENERIC_ERROR });
        return;
      }
      if (result.ok) {
        onSuccess?.();
        return;
      }
      if (result.code === "UNAUTHORIZED") {
        router.replace("/admin/login");
        return;
      }
      setFailure({ message: result.message, fields: result.fieldErrors });
    });
  }

  return { pending, failure, run };
}

/** Announced by screen readers; a field's own error is shown under the field instead. */
function ActionError({ failure }: { failure: Failure | null }) {
  const show = failure && !failure.fields;
  return (
    <div role="alert">
      {show ? (
        <p data-testid="action-error" className="rounded-lg border border-danger-ink bg-danger-bg p-3 text-danger-ink">
          {failure.message}
        </p>
      ) : null}
    </div>
  );
}

function FieldError({ id, testId, message }: { id: string; testId: string; message?: string }) {
  return message ? (
    <p id={id} data-testid={testId} className="mt-1 text-danger-ink">
      {message}
    </p>
  ) : null;
}

export function ApproveSlipButton({ orderId }: { orderId: string }) {
  const { pending, failure, run } = useAdminAction();
  return (
    <div className="space-y-3">
      <button type="button" disabled={pending} className={`${PRIMARY} w-full`} onClick={() => run(() => approveSlipAction(orderId))}>
        {pending ? "กำลังบันทึก…" : "ยืนยันการชำระเงิน"}
      </button>
      <ActionError failure={failure} />
    </div>
  );
}

export function RejectSlipForm({ orderId }: { orderId: string }) {
  const { pending, failure, run } = useAdminAction();
  const [reason, setReason] = useState("");
  const id = useId();
  const error = failure?.fields?.reason;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run(() => rejectSlipAction(orderId, reason), () => setReason(""));
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
export function TrackingForm({ orderId, correct = false }: { orderId: string; correct?: boolean }) {
  const { pending, failure, run } = useAdminAction();
  const [tracking, setTracking] = useState("");
  const id = useId();
  const error = failure?.fields?.tracking;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const action = correct ? setTrackingAction : shipOrderAction;
    run(() => action(orderId, tracking), () => setTracking(""));
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
export function CancelOrderButton({
  orderId,
  refund,
  totalText,
}: {
  orderId: string;
  /** "paid": money received; "maybe": a slip is waiting, so money may have been sent. */
  refund: "paid" | "maybe" | "none";
  totalText: string;
}) {
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
            onClick={() => run(() => cancelOrderAction(orderId), () => dialog.current?.close())}
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
