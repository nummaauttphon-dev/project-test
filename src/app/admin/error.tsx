"use client";

import Link from "next/link";

// No technical detail is shown or logged: the error may carry personal data.
export default function AdminError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
      <section role="alert" className="rounded-card border border-line bg-surface p-8 text-center">
        <h1 className="text-2xl font-bold">เกิดข้อผิดพลาด</h1>
        <p className="mt-2 text-ink-soft">ระบบหลังร้านทำงานผิดพลาดชั่วคราว กรุณาลองใหม่อีกครั้ง</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => retry()}
            className="inline-flex min-h-11 items-center rounded-full bg-brand px-6 font-semibold text-on-brand hover:bg-brand-hover"
          >
            ลองอีกครั้ง
          </button>
          <Link href="/admin" className="inline-flex min-h-11 items-center underline">
            กลับไปหน้าแรกหลังร้าน
          </Link>
        </div>
      </section>
    </main>
  );
}
