import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddToCart } from "@/components/add-to-cart";
import { ProductImage } from "@/components/product-image";
import { getProductBySlug } from "@/features/catalog/queries";
import { formatBaht } from "@/lib/money";

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
      <Link href="/" className="inline-flex min-h-11 items-center text-brand underline">
        ← กลับไปดูสินค้าทั้งหมด
      </Link>
      <div className="mt-2 grid gap-6 md:grid-cols-2 md:gap-10">
        <div className="relative aspect-square overflow-hidden rounded-card border border-line bg-sunken">
          <ProductImage
            imagePath={product.image_path}
            name={product.name}
            sizes="(min-width: 768px) 480px, 100vw"
            priority
          />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{product.name}</h1>
          <p className={`mt-2 text-3xl font-bold ${soldOut ? "text-ink-soft" : "text-brand"}`}>
            {formatBaht(product.price_satang)}
          </p>
          {product.description ? (
            <p className="mt-4 whitespace-pre-line text-ink-soft">{product.description}</p>
          ) : null}
          <div className="mt-6">
            <AddToCart productId={product.id} stock={product.stock_quantity} />
          </div>
        </div>
      </div>
    </article>
  );
}
