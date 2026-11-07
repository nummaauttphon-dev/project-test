import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "ไม่พบหน้าที่ต้องการ" };

/** URLs that match no route. Same wording as the store's 404, so it reveals nothing more. */
export default function RootNotFound() {
  return (
    <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
      <section className="rounded-card border border-line bg-surface p-8 text-center">
        <h1 className="text-2xl font-bold">ไม่พบหน้าที่ต้องการ</h1>
        <p className="mt-2 text-ink-soft">ลิงก์นี้อาจไม่ถูกต้อง หรือหน้านี้ถูกนำออกแล้ว</p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-11 items-center rounded-full bg-brand px-6 font-semibold text-on-brand hover:bg-brand-hover"
        >
          กลับไปหน้าร้าน
        </Link>
      </section>
    </main>
  );
}
