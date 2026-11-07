import type { Metadata } from "next";
import Link from "next/link";
import { ActiveToggle, StockAdjuster } from "@/components/admin-product-controls";
import { ProductImage } from "@/components/product-image";
import { requireAdminPage } from "@/features/admin/auth";
import { listAdminProducts } from "@/features/admin/queries";
import { formatBaht } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "สินค้า" };

const ADD_LINK =
  "inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-on-brand hover:bg-brand-hover";

export default async function AdminProductsPage() {
  await requireAdminPage();
  const products = await listAdminProducts(createAdminClient());

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">สินค้า</h1>
        <Link href="/admin/products/new" className={ADD_LINK}>
          เพิ่มสินค้า
        </Link>
      </div>
      <p className="mt-2 text-sm text-ink-soft">
        สินค้าที่ซ่อนจะไม่แสดงในร้าน แต่ประวัติคำสั่งซื้อยังอยู่ครบ ระบบไม่มีการลบสินค้า
      </p>

      {products.length === 0 ? (
        <p className="mt-4 rounded-card border border-line bg-surface p-4">ยังไม่มีสินค้า กด “เพิ่มสินค้า” เพื่อเริ่มต้น</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {products.map((product) => (
            <li
              key={product.id}
              data-testid="product-row"
              className="rounded-card border border-line bg-surface p-3"
            >
              <div className="flex gap-3">
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-line">
                  <ProductImage imagePath={product.imagePath} name={product.name} sizes="80px" />
                </div>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/admin/products/${product.id}`}
                    className="inline-flex min-h-11 items-center break-words font-semibold underline"
                  >
                    {product.name}
                  </Link>
                  <p className="truncate text-sm text-ink-soft">/{product.slug}</p>
                  <p className="font-semibold tabular-nums">{formatBaht(product.priceSatang)}</p>
                </div>
              </div>
              <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
                <div>
                  <dt className="text-sm text-ink-soft">สต็อก</dt>
                  <dd data-testid="product-stock" className="font-semibold tabular-nums">
                    {product.stockQuantity} ชิ้น
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-ink-soft">สถานะ</dt>
                  <dd data-testid="product-status" className="font-semibold">
                    {product.isActive ? "แสดงในร้าน" : "ซ่อนอยู่"}
                  </dd>
                </div>
              </dl>
              <div className="mt-3 grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
                <StockAdjuster productId={product.id} name={product.name} />
                <div>
                  <ActiveToggle productId={product.id} name={product.name} isActive={product.isActive} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
