import Link from "next/link";

// The same page for a wrong, malformed or deleted link: it must not reveal whether an order exists.
export default function OrderNotFound() {
  return (
    <section className="rounded-card border border-line bg-surface p-8 text-center">
      <h1 className="text-2xl font-bold">ไม่พบหน้าที่ต้องการ</h1>
      <p className="mt-2 text-ink-soft">ลิงก์ไม่ถูกต้อง กรุณาตรวจสอบลิงก์อีกครั้ง</p>
      <Link
        href="/"
        className="mt-6 inline-flex min-h-11 items-center rounded-full bg-brand px-6 font-semibold text-on-brand hover:bg-brand-hover"
      >
        กลับไปหน้าร้าน
      </Link>
    </section>
  );
}
