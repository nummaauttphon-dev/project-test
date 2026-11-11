"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { submitSlipAction } from "@/features/orders/actions";
import { SLIP_MESSAGES } from "@/features/orders/slip-messages";
import { MAX_IMAGE_BYTES } from "@/lib/upload-limits";

const REFRESH_CODES = new Set(["EXPIRED", "INVALID_STATUS", "NOT_FOUND"]);

export function SlipUploadForm({ token }: { token: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const submittingRef = useRef(false);

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setError("");
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || submittingRef.current) return;
    // A quick answer for the common mistake; the server checks the real size again.
    if (file.size > MAX_IMAGE_BYTES) {
      setError(SLIP_MESSAGES.TOO_LARGE);
      return;
    }
    submittingRef.current = true;
    setPending(true);
    setError("");
    try {
      const body = new FormData();
      body.set("token", token);
      body.set("slip", file);
      const result = await submitSlipAction(body);
      if (result.ok) {
        setDone(true);
        router.refresh();
        return;
      }
      setError(result.message);
      if (REFRESH_CODES.has(result.code)) router.refresh();
    } catch {
      setError(SLIP_MESSAGES.UPLOAD_FAILED);
    } finally {
      submittingRef.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3">
      <div>
        <label htmlFor="slip" className="font-medium">
          เลือกรูปสลิปการโอนเงิน
        </label>
        <p id="slip-hint" className="text-sm text-ink-soft">
          รองรับ JPEG, PNG หรือ WebP ขนาดไม่เกิน 4 MB เลือกจากแกลเลอรีในมือถือได้
        </p>
        <input
          id="slip"
          name="slip"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={onChange}
          disabled={pending || done}
          aria-describedby={error ? "slip-hint slip-error" : "slip-hint"}
          aria-invalid={error ? true : undefined}
          className="mt-2 block w-full text-base file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-sm file:border-0 file:bg-sunken file:px-5 file:font-semibold file:text-ink"
        />
        <p className="mt-1 text-sm" data-testid="slip-file-name">
          {file ? `ไฟล์ที่เลือก: ${file.name}` : "ยังไม่ได้เลือกไฟล์"}
        </p>
      </div>
      <div role="alert" data-testid="slip-error">
        {error ? (
          <p id="slip-error" className="rounded-lg border border-danger-ink bg-danger-bg p-3 text-danger-ink">
            {error}
          </p>
        ) : null}
      </div>
      <div role="status" data-testid="slip-status">
        {done ? <p className="rounded-lg border border-line bg-sunken p-3">ส่งสลิปเรียบร้อยแล้ว กำลังอัปเดตสถานะ…</p> : null}
      </div>
      <button
        type="submit"
        disabled={!file || pending || done}
        className="flex min-h-12 w-full items-center justify-center rounded-sm bg-brand px-6 text-lg font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60"
      >
        {pending ? "กำลังส่งสลิป…" : error ? "ลองส่งสลิปอีกครั้ง" : "ส่งสลิป"}
      </button>
    </form>
  );
}
