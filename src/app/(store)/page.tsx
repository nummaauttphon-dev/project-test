import Link from "next/link";
import { Suspense } from "react";
import { ProductImage } from "@/components/product-image";
import { listProducts } from "@/features/catalog/queries";
import { formatBaht } from "@/lib/money";

function ProductListSkeleton() {
  return (
    <div role="status" aria-busy="true" className="mt-8">
      <span className="sr-only">กำลังโหลดสินค้า</span>
      <div aria-hidden="true" className="grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 sm:gap-x-6 lg:gap-x-8">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton aspect-[4/5]" />
        ))}
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      <section className="border-b border-line pb-14 pt-6 text-center sm:pb-20 sm:pt-12">
        <p className="eyebrow">คอลเลกชันของใช้ทำมือ</p>
        <h1 className="mx-auto mt-5 max-w-3xl text-4xl leading-tight text-ink sm:text-6xl sm:leading-tight">
          ของใช้เรียบง่าย
          <br />
          ที่อยู่กับคุณได้นาน
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-ink-soft sm:text-lg">
          คัดสรรงานไม้ เซรามิก และผ้า จากช่างฝีมือในประเทศ ผลิตทีละชิ้นในจำนวนจำกัด
        </p>
        <a
          href="#collection"
          className="mt-8 inline-flex min-h-11 items-center gap-2 border-b border-ink pb-1 text-sm hover:border-ink-soft hover:text-ink-soft"
        >
          เลือกชมสินค้า
          <span aria-hidden="true">↓</span>
        </a>
      </section>

      <section id="collection" aria-labelledby="collection-heading" className="scroll-mt-6 pt-12 sm:pt-16">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="collection-heading" className="text-2xl sm:text-3xl">
            สินค้าทั้งหมด
          </h2>
        </div>
        <Suspense fallback={<ProductListSkeleton />}>
          <ProductList />
        </Suspense>
      </section>
    </>
  );
}

async function ProductList() {
  const products = await listProducts();

  if (products.length === 0) {
    return (
      <section className="mt-8 border border-dashed border-line-strong p-10 text-center">
        <h2 className="text-xl">ยังไม่มีสินค้าในร้านตอนนี้</h2>
        <p className="mt-2 text-ink-soft">กรุณากลับมาดูใหม่ภายหลัง เรากำลังเตรียมสินค้าใหม่</p>
      </section>
    );
  }

  return (
    <ul className="mt-8 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 sm:gap-x-6 lg:gap-x-8">
      {products.map((product, index) => {
        const soldOut = product.stock_quantity <= 0;
        return (
          <li key={product.id}>
            <Link href={`/products/${product.slug}`} className="group flex h-full flex-col">
              <div className="relative aspect-[4/5] overflow-hidden bg-sunken">
                <div className="h-full w-full transition-transform duration-500 ease-out group-hover:scale-[1.03]">
                  <ProductImage
                    imagePath={product.image_path}
                    name={product.name}
                    sizes="(min-width: 1024px) 360px, (min-width: 640px) 33vw, 50vw"
                    priority={index < 2}
                  />
                </div>
                {soldOut ? (
                  <span className="absolute left-3 top-3 bg-surface px-2 py-1 text-xs text-ink">
                    สินค้าหมด
                  </span>
                ) : null}
              </div>
              <div className="flex flex-1 flex-col gap-1 pt-4">
                <h2 className="!font-sans text-[0.9375rem] font-normal leading-snug tracking-normal group-hover:underline group-hover:underline-offset-4">
                  {product.name}
                </h2>
                <p className={`text-sm ${soldOut ? "text-ink-soft" : "text-ink"}`}>{formatBaht(product.price_satang)}</p>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
