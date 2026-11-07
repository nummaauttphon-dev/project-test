import type { Metadata } from "next";
import { ProductForm } from "@/components/admin-product-form";
import { requireAdminPage } from "@/features/admin/auth";

export const metadata: Metadata = { title: "เพิ่มสินค้า" };

export default async function NewProductPage() {
  await requireAdminPage();
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-4 text-2xl font-bold">เพิ่มสินค้า</h1>
      <ProductForm />
    </div>
  );
}
