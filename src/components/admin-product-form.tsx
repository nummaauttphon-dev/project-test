"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { saveProductAction } from "@/features/admin/product-actions";
import { MAX_DESCRIPTION, MAX_NAME, MAX_SLUG } from "@/features/admin/validation";
import { ProductImage } from "./product-image";
import { ActionError, FIELD, FormField, PRIMARY, SECONDARY, useAdminAction } from "./admin-ui";

const MAX_IMAGE_BYTES = 4_194_304;
const IMAGE_TOO_LARGE = "รูปใหญ่เกิน 4 MB กรุณาเลือกรูปที่เล็กลง";

export type ProductFormValues = {
  id: string;
  slug: string;
  name: string;
  description: string;
  /** Baht as an input shows it, e.g. "120.50". */
  price: string;
  imagePath: string | null;
};

/** Adds a product when `product` is absent, edits it otherwise. Stock is set here only on creation. */
export function ProductForm({ product }: { product?: ProductFormValues }) {
  const router = useRouter();
  const { pending, failure, run } = useAdminAction();
  const formId = useId();
  const imageInput = useRef<HTMLInputElement>(null);
  const [slug, setSlug] = useState(product?.slug ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [price, setPrice] = useState(product?.price ?? "");
  const [stock, setStock] = useState("0");
  const [imageError, setImageError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const errors: Record<string, string | undefined> = { ...failure?.fields, image: imageError ?? failure?.fields?.image };

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const image = imageInput.current?.files?.[0] ?? null;
    if (image && image.size > MAX_IMAGE_BYTES) {
      setImageError(IMAGE_TOO_LARGE);
      return;
    }
    setImageError(undefined);
    run(
      () =>
        saveProductAction(
          { id: product?.id, slug, name, description, price, ...(product ? {} : { stock }) },
          image,
        ),
      () => {
        if (!product) {
          router.push("/admin/products");
          return;
        }
        if (imageInput.current) imageInput.current.value = "";
        setSaved(true);
      },
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <FormField
        id={`${formId}-name`}
        label="ชื่อสินค้า"
        hint={`ไม่เกิน ${MAX_NAME} ตัวอักษร`}
        error={errors.name}
        errorTestId="name-error"
      >
        {(control) => (
          <input
            {...control}
            name="name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
            className={`${FIELD} min-h-12`}
          />
        )}
      </FormField>

      <FormField
        id={`${formId}-slug`}
        label="ชื่อในลิงก์ (slug)"
        hint={`ตัวอักษรอังกฤษพิมพ์เล็ก ตัวเลข และขีดกลาง ไม่เกิน ${MAX_SLUG} ตัวอักษร เช่น ceramic-mug ลิงก์สินค้าคือ /products/ตามด้วยชื่อนี้`}
        error={errors.slug}
        errorTestId="slug-error"
      >
        {(control) => (
          <input
            {...control}
            name="slug"
            type="text"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className={`${FIELD} min-h-12`}
          />
        )}
      </FormField>

      <FormField
        id={`${formId}-description`}
        label="คำอธิบาย"
        hint={`แสดงเป็นข้อความธรรมดา ไม่เกิน ${MAX_DESCRIPTION.toLocaleString("en-US")} ตัวอักษร (ไม่บังคับ)`}
        error={errors.description}
        errorTestId="description-error"
      >
        {(control) => (
          <textarea
            {...control}
            name="description"
            rows={5}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className={FIELD}
          />
        )}
      </FormField>

      <FormField
        id={`${formId}-price`}
        label="ราคา (บาท)"
        hint="ทศนิยมไม่เกิน 2 ตำแหน่ง ไม่เกิน 10,000,000 บาท เช่น 120 หรือ 120.50"
        error={errors.price}
        errorTestId="price-error"
      >
        {(control) => (
          <input
            {...control}
            name="price"
            type="text"
            inputMode="decimal"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            autoComplete="off"
            className={`${FIELD} min-h-12`}
          />
        )}
      </FormField>

      {product ? (
        <p className="text-sm text-ink-soft">ปรับสต็อกได้จากหน้ารายการสินค้า เพื่อไม่ให้ทับการขายที่เกิดขึ้นระหว่างนั้น</p>
      ) : (
        <FormField
          id={`${formId}-stock`}
          label="สต็อกเริ่มต้น (ชิ้น)"
          hint="จำนวนเต็ม 0-1,000,000 ภายหลังปรับเพิ่มลดได้จากหน้ารายการสินค้า"
          error={errors.stock}
          errorTestId="stock-error"
        >
          {(control) => (
            <input
              {...control}
              name="stock"
              type="text"
              inputMode="numeric"
              value={stock}
              onChange={(event) => setStock(event.target.value)}
              autoComplete="off"
              className={`${FIELD} min-h-12`}
            />
          )}
        </FormField>
      )}

      <div className="space-y-3">
        {product ? (
          <div className="flex items-center gap-3">
            <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-line">
              <ProductImage imagePath={product.imagePath} name={product.name} sizes="96px" />
            </div>
            <p className="text-sm text-ink-soft">
              {product.imagePath ? "รูปปัจจุบัน เลือกรูปใหม่เพื่อแทนที่" : "ยังไม่มีรูป"}
            </p>
          </div>
        ) : null}
        <FormField
          id={`${formId}-image`}
          label="รูปสินค้า"
          hint="JPEG, PNG หรือ WebP ขนาดไม่เกิน 4 MB (ไม่บังคับ)"
          error={errors.image}
          errorTestId="image-error"
        >
          {(control) => (
            <input
              {...control}
              ref={imageInput}
              name="image"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={() => setImageError(undefined)}
              className="mt-2 block w-full text-base file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-full file:border-0 file:bg-sunken file:px-5 file:font-semibold file:text-ink"
            />
          )}
        </FormField>
      </div>

      <ActionError failure={failure} always />
      <div role="status">
        {saved ? (
          <p data-testid="saved" className="rounded-lg border border-line-strong bg-sunken p-3">
            บันทึกสินค้าแล้ว
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending} className={PRIMARY}>
          {pending ? "กำลังบันทึก…" : product ? "บันทึกการแก้ไข" : "เพิ่มสินค้า"}
        </button>
        <Link href="/admin/products" className={SECONDARY}>
          กลับไปรายการสินค้า
        </Link>
      </div>
    </form>
  );
}
