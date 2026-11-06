import Link from "next/link";
import { CartLink } from "@/components/cart-link";
import { STORE_NAME } from "@/lib/store-config";

export default function StoreLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-brand focus:px-4 focus:py-3 focus:text-on-brand"
      >
        ข้ามไปยังเนื้อหาหลัก
      </a>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="inline-flex min-h-11 items-center text-xl font-bold tracking-tight text-brand">
            {STORE_NAME}
          </Link>
          <CartLink />
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:py-10">
        {children}
      </main>
      <footer className="border-t border-line bg-surface">
        <p className="mx-auto w-full max-w-5xl px-4 py-6 text-sm text-ink-soft">
          {STORE_NAME} · ชำระเงินด้วยพร้อมเพย์
        </p>
      </footer>
    </>
  );
}
