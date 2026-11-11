"use client";

import Image from "next/image";
import { useActionState } from "react";
import { startTotpEnrollmentAction, verifyTotpAction } from "@/features/admin/actions";

const BUTTON_CLASS =
  "flex min-h-12 w-full items-center justify-center rounded-sm bg-brand px-6 text-lg font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60";

function ErrorMessage({ id, message }: { id: string; message?: string }) {
  return (
    <div role="alert">
      {message ? (
        <p id={id} className="rounded-lg border border-danger-ink bg-danger-bg p-3 text-danger-ink">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function MfaCodeForm() {
  const [state, action, pending] = useActionState(verifyTotpAction, null);
  const error = state && !state.ok ? state.message : undefined;

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="code" className="font-medium">
          รหัส 6 หลัก
        </label>
        <input
          id="code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "code-error" : undefined}
          className="mt-1 block min-h-12 w-full rounded-lg border border-line-strong bg-surface px-3 text-base tracking-widest aria-[invalid=true]:border-danger-ink"
        />
      </div>
      <ErrorMessage id="code-error" message={error} />
      <button type="submit" disabled={pending} className={BUTTON_CLASS}>
        {pending ? "กำลังตรวจสอบ…" : "ยืนยันรหัส"}
      </button>
    </form>
  );
}

/** The secret exists only in this component's state, after the admin asks to start. */
export function MfaEnrollment() {
  const [state, start, starting] = useActionState(startTotpEnrollmentAction, null);

  if (state?.ok) {
    return (
      <div className="space-y-4">
        <p>สแกน QR Code ด้วยแอปยืนยันตัวตน เช่น Google Authenticator แล้วกรอกรหัส 6 หลักจากแอป</p>
        <Image
          src={state.data.qrCode}
          alt="QR Code สำหรับตั้งค่าแอปยืนยันตัวตน"
          width={240}
          height={240}
          unoptimized
          className="mx-auto rounded-lg border border-line"
        />
        <div>
          <p className="font-medium">สแกนไม่ได้? กรอกรหัสนี้ในแอปแทน</p>
          <code data-testid="totp-secret" className="mt-1 block break-all rounded-lg bg-sunken p-3 text-base">
            {state.data.secret}
          </code>
        </div>
        <MfaCodeForm />
      </div>
    );
  }

  return (
    <form action={start} className="space-y-4">
      <p>บัญชีแอดมินต้องใช้แอปยืนยันตัวตนทุกครั้งที่เข้าสู่ระบบ กรุณาเตรียมแอปในมือถือให้พร้อมก่อนเริ่ม</p>
      <ErrorMessage id="enroll-error" message={state && !state.ok ? state.message : undefined} />
      <button type="submit" disabled={starting} className={BUTTON_CLASS}>
        {starting ? "กำลังเตรียม…" : "เริ่มตั้งค่า"}
      </button>
    </form>
  );
}
