import Link from "next/link";

/** Unknown admin URLs, shown inside the admin layout (which owns the main landmark). */
export default function AdminNotFound() {
  return (
    <section className="rounded-card border border-line bg-surface p-8 text-center">
      <h1 className="text-2xl font-bold">ไม่พบหน้าที่ต้องการ</h1>
      <p className="mt-2 text-ink-soft">ลิงก์นี้อาจไม่ถูกต้อง หรือข้อมูลถูกนำออกแล้ว</p>
      <Link
        href="/admin"
        className="mt-6 inline-flex min-h-11 items-center rounded-sm bg-brand px-6 font-semibold text-on-brand hover:bg-brand-hover"
      >
        กลับไปหน้าแรกหลังร้าน
      </Link>
    </section>
  );
}
