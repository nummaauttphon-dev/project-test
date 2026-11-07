"use client";

import Image from "next/image";
import { useState } from "react";
import { productImageUrl } from "@/features/catalog/image-url";

function Placeholder() {
  return (
    <div
      role="img"
      aria-label="ไม่มีรูปสินค้า"
      className="flex h-full w-full items-center justify-center bg-sunken text-line-strong"
    >
      <svg viewBox="0 0 24 24" className="h-1/3 w-1/3" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="9" cy="10" r="1.8" />
        <path d="m4 18 5-5 4 4 3-3 4 4" />
      </svg>
    </div>
  );
}

/** Fills its parent (which must be `relative` with a set size). A missing image shows a placeholder. */
export function ProductImage({
  imagePath,
  name,
  sizes,
  priority = false,
}: {
  imagePath: string | null;
  name: string;
  sizes: string;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const src = productImageUrl(imagePath);
  if (!src || failed) return <Placeholder />;
  return (
    <Image
      src={src}
      alt={name}
      fill
      sizes={sizes}
      // `priority` is deprecated in Next.js 16; an above-the-fold image loads eagerly at high
      // fetch priority instead (Lighthouse flagged the LCP image as missing fetchpriority=high).
      loading={priority ? "eager" : undefined}
      fetchPriority={priority ? "high" : undefined}
      onError={() => setFailed(true)}
      className="object-cover"
    />
  );
}
