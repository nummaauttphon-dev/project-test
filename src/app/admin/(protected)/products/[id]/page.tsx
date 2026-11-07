import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductForm } from "@/components/admin-product-form";
import { requireAdminPage } from "@/features/admin/auth";
import { getAdminProduct } from "@/features/admin/queries";
import { satangToBahtInput } from "@/features/admin/validation";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "แก้ไขสินค้า" };

export default async function EditProductPage({ params }: PageProps<"/admin/products/[id]">) {
  await requireAdminPage();
  const { id } = await params;
  const product = await getAdminProduct(createAdminClient(), id);
  if (!product) notFound();

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-4 text-2xl font-bold">แก้ไขสินค้า</h1>
      <ProductForm
        product={{
          id: product.id,
          slug: product.slug,
          name: product.name,
          description: product.description,
          price: satangToBahtInput(product.priceSatang),
          imagePath: product.imagePath,
        }}
      />
    </div>
  );
}
