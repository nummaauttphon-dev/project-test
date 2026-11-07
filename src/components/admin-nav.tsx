"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "แดชบอร์ด", match: (path: string) => path === "/admin" },
  { href: "/admin/orders", label: "คำสั่งซื้อ", match: (path: string) => path.startsWith("/admin/orders") },
] as const;

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="เมนูหลังร้าน">
      <ul className="flex flex-wrap gap-1">
        {LINKS.map(({ href, label, match }) => {
          const current = match(pathname);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                className="inline-flex min-h-11 items-center rounded-full px-4 font-medium hover:bg-sunken aria-[current=page]:bg-sunken aria-[current=page]:font-semibold"
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
