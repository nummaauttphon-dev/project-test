import Link from "next/link";
import { Suspense } from "react";
import { ProductImage } from "@/components/product-image";
import { listProducts } from "@/features/catalog/queries";
import { formatBaht } from "@/lib/money";

function ProductListSkeleton() {
  return (
    <div role="status" aria-busy="true" className="mt-6">
      <span className="sr-only">กำลังโหลดสินค้า</span>
      <div aria-hidden="true" className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="skeleton aspect-[4/5]" />
        ))}
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">สินค้าทั้งหมด</h1>
      <Suspense fallback={<ProductListSkeleton />}>
        <ProductList />
      </Suspense>
    </>
  );
}

async function ProductList() {
  const products = await listProducts();

  if (products.length === 0) {
    return (
      <section className="mt-8 rounded-card border border-dashed border-line-strong bg-surface p-8 text-center">
        <h2 className="text-lg font-semibold">ยังไม่มีสินค้าในร้านตอนนี้</h2>
        <p className="mt-2 text-ink-soft">กรุณากลับมาดูใหม่ภายหลัง เรากำลังเตรียมสินค้าใหม่</p>
      </section>
    );
  }

  return (
    <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
      {products.map((product, index) => {
        const soldOut = product.stock_quantity <= 0;
        return (
          <li key={product.id}>
            <Link
              href={`/products/${product.slug}`}
              className="group flex h-full flex-col overflow-hidden rounded-card border border-line bg-surface hover:border-line-strong"
            >
              <div className="relative aspect-square bg-sunken">
                <ProductImage
                  imagePath={product.image_path}
                  name={product.name}
                  sizes="(min-width: 1024px) 256px, (min-width: 640px) 33vw, 50vw"
                  priority={index < 2}
                />
                {soldOut ? (
                  <span className="absolute left-2 top-2 rounded-md bg-ink px-2 py-1 text-sm font-semibold text-surface">
                    สินค้าหมด
                  </span>
                ) : null}
              </div>
              <div className="flex flex-1 flex-col gap-1 p-3">
                <h2 className="font-medium leading-snug group-hover:underline">{product.name}</h2>
                <p className={`mt-auto text-lg font-bold ${soldOut ? "text-ink-soft" : "text-brand"}`}>
                  {formatBaht(product.price_satang)}
                </p>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
