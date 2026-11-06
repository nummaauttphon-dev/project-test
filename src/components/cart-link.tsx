"use client";

import Link from "next/link";
import { useCart } from "@/features/cart/use-cart";

export function CartLink() {
  const { lines, ready } = useCart();
  const count = lines.reduce((sum, line) => sum + line.quantity, 0);
  return (
    <Link
      href="/cart"
      className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line-strong px-4 font-medium hover:bg-sunken"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M3 4h2l2.2 10.2a1 1 0 0 0 1 .8h8.6a1 1 0 0 0 1-.8L19 8H6.2" />
        <circle cx="9" cy="19" r="1.3" />
        <circle cx="17" cy="19" r="1.3" />
      </svg>
      <span>ตะกร้า</span>
      {ready && count > 0 ? (
        <span className="min-w-6 rounded-full bg-brand px-2 text-center text-sm text-on-brand">
          {count}
          <span className="sr-only"> ชิ้น</span>
        </span>
      ) : null}
    </Link>
  );
}
