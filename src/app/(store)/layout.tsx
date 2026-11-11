import Link from "next/link";
import { CartLink } from "@/components/cart-link";
import { STORE_NAME } from "@/lib/store-config";

export default function StoreLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="storefront flex min-h-full flex-1 flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-sm focus:bg-brand focus:px-4 focus:py-3 focus:text-on-brand"
      >
        ข้ามไปยังเนื้อหาหลัก
      </a>
      <header className="border-b border-line">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-4 sm:px-6">
          <span aria-hidden="true" />
          <Link
            href="/"
            className="inline-flex min-h-11 items-center font-display text-lg tracking-[0.22em] text-ink sm:text-xl sm:tracking-[0.32em]"
          >
            {STORE_NAME}
          </Link>
          <div className="justify-self-end">
            <CartLink />
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-14">
        {children}
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-10 text-sm text-ink-soft sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <div>
            <p className="font-display text-base tracking-[0.32em] text-ink">{STORE_NAME}</p>
            <p className="mt-2">ของใช้เรียบง่าย ทำด้วยมือ · ชำระเงินด้วยพร้อมเพย์</p>
          </div>
          <Link href="/privacy" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-ink">
            ความเป็นส่วนตัว
          </Link>
        </div>
      </footer>
    </div>
  );
}
