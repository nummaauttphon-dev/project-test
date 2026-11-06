import type { Metadata } from "next";
import { CartView } from "@/components/cart-view";

export const metadata: Metadata = { title: "ตะกร้าสินค้า" };

export default function CartPage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">ตะกร้าสินค้า</h1>
      <CartView />
    </>
  );
}
