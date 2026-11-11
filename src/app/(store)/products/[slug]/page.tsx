import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddToCart } from "@/components/add-to-cart";
import { ProductImage } from "@/components/product-image";
import { getProductBySlug } from "@/features/catalog/queries";
import { formatBaht } from "@/lib/money";
import { STORE_NAME } from "@/lib/store-config";

export async function generateMetadata({ params }: PageProps<"/products/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  return product ? { title: product.name } : { title: "ไม่พบสินค้า" };
}

export default async function ProductPage({ params }: PageProps<"/products/[slug]">) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  const soldOut = product.stock_quantity <= 0;

  return (
    <article>
      <Link href="/" className="inline-flex min-h-11 items-center text-sm text-ink-soft underline-offset-4 hover:text-ink hover:underline">
        ← กลับไปดูสินค้าทั้งหมด
      </Link>
      <div className="mt-4 grid gap-8 md:grid-cols-2 md:gap-14">
        <div className="relative aspect-[4/5] overflow-hidden bg-sunken">
          <ProductImage
            imagePath={product.image_path}
            name={product.name}
            sizes="(min-width: 768px) 480px, 100vw"
            priority
          />
        </div>
        <div className="md:pt-6">
          <p className="eyebrow tracking-[0.3em]">{STORE_NAME}</p>
          <h1 className="mt-3 text-3xl leading-tight sm:text-4xl">{product.name}</h1>
          <p className={`mt-4 text-xl ${soldOut ? "text-ink-soft" : "text-ink"}`}>
            {formatBaht(product.price_satang)}
          </p>
          {product.description ? (
            <p className="mt-6 whitespace-pre-line border-t border-line pt-6 leading-relaxed text-ink-soft">
              {product.description}
            </p>
          ) : null}
          <div className="mt-8">
            <AddToCart productId={product.id} stock={product.stock_quantity} />
          </div>
        </div>
      </div>
    </article>
  );
}
