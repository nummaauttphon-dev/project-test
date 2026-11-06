"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { MAX_LINE_QUANTITY } from "@/features/cart/cart-storage";
import { useCart } from "@/features/cart/use-cart";

export function AddToCart({ productId, stock }: { productId: string; stock: number }) {
  const { lines, ready, setLines } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState("");
  const selectId = useId();

  if (stock <= 0) {
    return (
      <div>
        <p className="inline-block rounded-md bg-ink px-3 py-1.5 font-semibold text-surface">สินค้าหมด</p>
        <button
          type="button"
          disabled
          className="mt-4 block min-h-12 w-full rounded-full bg-sunken px-6 font-semibold text-ink-soft"
        >
          เพิ่มลงตะกร้าไม่ได้
        </button>
      </div>
    );
  }

  const limit = Math.min(stock, MAX_LINE_QUANTITY);
  const inCart = lines.find((line) => line.productId === productId)?.quantity ?? 0;

  function add() {
    const next = Math.min(inCart + quantity, limit);
    if (next === inCart) {
      setMessage(`ในตะกร้ามีสินค้านี้ครบ ${limit} ชิ้นแล้ว ซึ่งเป็นจำนวนสูงสุดที่สั่งได้`);
      return;
    }
    const others = lines.filter((line) => line.productId !== productId);
    setLines([...others, { productId, quantity: next }]);
    setMessage(
      next < inCart + quantity
        ? `เพิ่มลงตะกร้าแล้ว รวม ${next} ชิ้น (สั่งได้สูงสุด ${limit} ชิ้น)`
        : `เพิ่มลงตะกร้าแล้ว รวม ${next} ชิ้น`,
    );
  }

  return (
    <div>
      <label htmlFor={selectId} className="block font-medium">
        จำนวน
      </label>
      <select
        id={selectId}
        value={quantity}
        onChange={(event) => {
          setQuantity(Number(event.target.value));
          setMessage("");
        }}
        className="mt-1 min-h-12 w-28 rounded-lg border border-line-strong bg-surface px-3 text-lg"
      >
        {Array.from({ length: limit }, (_, i) => (
          <option key={i + 1} value={i + 1}>
            {i + 1}
          </option>
        ))}
      </select>
      {stock <= 5 ? (
        <p className="mt-2 text-sm font-medium text-notice-ink">เหลือเพียง {stock} ชิ้น</p>
      ) : null}
      <button
        type="button"
        onClick={add}
        disabled={!ready}
        className="mt-4 block min-h-12 w-full rounded-full bg-brand px-6 text-lg font-semibold text-on-brand hover:bg-brand-hover disabled:cursor-wait disabled:opacity-60"
      >
        เพิ่มลงตะกร้า
      </button>
      <div role="status" className="mt-3">
        {message ? (
          <p className="rounded-lg border border-line bg-surface p-3">
            {message}{" "}
            <Link href="/cart" className="font-semibold text-brand underline">
              ดูตะกร้า
            </Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}
