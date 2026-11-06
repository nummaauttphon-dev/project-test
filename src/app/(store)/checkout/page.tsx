import type { Metadata } from "next";
import { CheckoutForm } from "@/components/checkout-form";

export const metadata: Metadata = { title: "ชำระเงิน" };

export default function CheckoutPage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">สั่งซื้อสินค้า</h1>
      <CheckoutForm />
    </>
  );
}
