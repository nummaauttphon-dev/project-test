const BUCKET = "product-images";

/** Public URL of a product image, or null when the product has none. */
export function productImageUrl(imagePath: string | null): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!imagePath || !base) return null;
  const encoded = imagePath.split("/").map(encodeURIComponent).join("/");
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/${BUCKET}/${encoded}`;
}
