import Link from "next/link";

export default function NotFound() {
  return (
    <section className="rounded-card border border-line bg-surface p-8 text-center">
      <h1 className="text-2xl font-bold">ไม่พบหน้าที่ต้องการ</h1>
      <p className="mt-2 text-ink-soft">สินค้านี้อาจถูกนำออกจากร้านแล้ว หรือลิงก์ไม่ถูกต้อง</p>
      <Link
        href="/"
        className="mt-6 inline-flex min-h-11 items-center rounded-full bg-brand px-6 font-semibold text-on-brand hover:bg-brand-hover"
      >
        กลับไปดูสินค้า
      </Link>
    </section>
  );
}
