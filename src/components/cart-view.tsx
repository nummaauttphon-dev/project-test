"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ProductImage } from "@/components/product-image";
import { getCartViewAction, type CartView as CartData } from "@/features/cart/cart-actions";
import { MAX_LINE_QUANTITY, reconcileCart, type CartLine } from "@/features/cart/cart-storage";
import { useCart } from "@/features/cart/use-cart";
import { formatBaht } from "@/lib/money";

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "done"; data: CartData };

const SAVE_ERROR = "บันทึกตะกร้าไม่สำเร็จ เบราว์เซอร์อาจปิดการเก็บข้อมูลไว้ การเปลี่ยนแปลงนี้จะไม่ถูกจดจำ";

export function CartView() {
  const { lines, ready, setLines } = useCart();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [notices, setNotices] = useState<string[]>([]);
  const [action, setAction] = useState("");
  const [saveError, setSaveError] = useState("");
  const linesRef = useRef<CartLine[]>(lines);
  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  useEffect(() => {
    if (!ready) return;
    const requested = linesRef.current;
    if (requested.length === 0) {
      setLoad({ state: "done", data: { products: [], shippingFeeSatang: 0 } });
      return;
    }
    let cancelled = false;
    setLoad({ state: "loading" });
    getCartViewAction(requested)
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setLoad({ state: "error", message: result.message });
          return;
        }
        const { lines: kept, removed, adjusted } = reconcileCart(requested, result.data.products);
        const names = new Map(result.data.products.map((p) => [p.id, p.name]));
        const next: string[] = [];
        if (removed.length > 0) {
          next.push(`นำสินค้า ${removed.length} รายการที่หมดหรือไม่มีจำหน่ายแล้วออกจากตะกร้า`);
        }
        for (const id of adjusted) {
          const quantity = kept.find((line) => line.productId === id)?.quantity;
          next.push(`ปรับจำนวน ${names.get(id) ?? "สินค้า"} เหลือ ${quantity} ชิ้น ตามสต็อกที่มีอยู่`);
        }
        setNotices(next);
        if ((removed.length > 0 || adjusted.length > 0) && !setLines(kept)) setSaveError(SAVE_ERROR);
        setLoad({ state: "done", data: result.data });
      })
      .catch(() => {
        if (!cancelled) setLoad({ state: "error", message: "โหลดตะกร้าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" });
      });
    return () => {
      cancelled = true;
    };
    // Reload only when storage becomes readable and on retry; local edits must not refetch.
  }, [ready, attempt, setLines]);

  const changeQuantity = useCallback(
    (productId: string, quantity: number) => {
      const saved = setLines(
        linesRef.current.map((l) => (l.productId === productId ? { ...l, quantity } : l)),
      );
      setSaveError(saved ? "" : SAVE_ERROR);
      setAction("");
    },
    [setLines],
  );

  const remove = useCallback(
    (productId: string, name: string) => {
      const saved = setLines(linesRef.current.filter((l) => l.productId !== productId));
      setSaveError(saved ? "" : SAVE_ERROR);
      setAction(saved ? `นำ ${name} ออกจากตะกร้าแล้ว` : "");
    },
    [setLines],
  );

  const messages = [...notices, ...(action ? [action] : [])];
  // One live region stays mounted for the whole life of the page, so screen readers register it
  // before any text is added to it. Never move it inside a branch below.
  const liveRegions = (
    <>
      <div role="alert" data-testid="cart-alert">
        {saveError ? (
          <p className="mt-4 rounded-lg border border-danger-ink bg-danger-bg p-3 text-danger-ink">{saveError}</p>
        ) : null}
      </div>
      <div role="status" data-testid="cart-status">
        {messages.map((text) => (
          <p key={text} className="mt-4 rounded-lg border border-notice-line bg-notice-bg p-3 text-notice-ink">
            {text}
          </p>
        ))}
      </div>
    </>
  );

  return (
    <>
      {liveRegions}
      {renderBody()}
    </>
  );

  function renderBody() {
  if (!ready || load.state === "loading") {
    return (
      <div aria-busy="true" className="mt-6">
        <span className="sr-only">กำลังโหลดตะกร้า</span>
        <div aria-hidden="true" className="space-y-3">
          <div className="skeleton h-28" />
          <div className="skeleton h-28" />
          <div className="skeleton h-32" />
        </div>
      </div>
    );
  }

  if (load.state === "error") {
    return (
      <div role="alert" className="mt-6 rounded-card border border-danger-ink bg-danger-bg p-4 text-danger-ink">
        <p>{load.message}</p>
        <button
          type="button"
          onClick={() => setAttempt((n) => n + 1)}
          className="mt-3 min-h-11 rounded-full bg-danger-ink px-5 font-semibold text-surface"
        >
          ลองใหม่
        </button>
      </div>
    );
  }

  const rows = lines.flatMap((line) => {
    const product = load.data.products.find((p) => p.id === line.productId);
    return product ? [{ line, product }] : [];
  });

  if (rows.length === 0) {
    return (
      <>
        <section className="mt-6 rounded-card border border-dashed border-line-strong bg-surface p-8 text-center">
          <h2 className="text-lg font-semibold">ตะกร้าของคุณยังว่างอยู่</h2>
          <p className="mt-2 text-ink-soft">เลือกสินค้าที่ถูกใจ แล้วเพิ่มลงตะกร้าได้เลย</p>
          <Link
            href="/"
            className="mt-6 inline-flex min-h-11 items-center rounded-full bg-brand px-6 font-semibold text-on-brand hover:bg-brand-hover"
          >
            เลือกดูสินค้า
          </Link>
        </section>
      </>
    );
  }

  const shipping = load.data.shippingFeeSatang;
  const subtotal = rows.reduce((sum, { line, product }) => sum + product.price_satang * line.quantity, 0);

  return (
    <>
      <ul className="mt-4 space-y-3">
        {rows.map(({ line, product }) => {
          const max = Math.min(product.stock_quantity, MAX_LINE_QUANTITY);
          return (
            <li key={product.id} className="flex gap-3 rounded-card border border-line bg-surface p-3">
              <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-sunken">
                <ProductImage imagePath={product.image_path} name={product.name} sizes="96px" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Link href={`/products/${product.slug}`} className="font-medium leading-snug hover:underline">
                  {product.name}
                </Link>
                <p className="text-ink-soft">{formatBaht(product.price_satang)} ต่อชิ้น</p>
                <div className="mt-auto flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2">
                    <span>จำนวน</span>
                    <select
                      aria-label={`จำนวน ${product.name}`}
                      value={line.quantity}
                      onChange={(e) => changeQuantity(product.id, Number(e.target.value))}
                      className="min-h-11 rounded-lg border border-line-strong bg-surface px-3"
                    >
                      {Array.from({ length: max }, (_, i) => (
                        <option key={i + 1} value={i + 1}>
                          {i + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => remove(product.id, product.name)}
                    aria-label={`ลบ ${product.name} ออกจากตะกร้า`}
                    className="min-h-11 rounded-lg px-3 font-medium text-danger-ink underline"
                  >
                    ลบ
                  </button>
                  <p className="ml-auto font-bold">{formatBaht(product.price_satang * line.quantity)}</p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <section aria-label="สรุปยอด" className="mt-6 rounded-card border border-line bg-surface p-4">
        <dl className="space-y-2">
          <div className="flex justify-between">
            <dt>ราคาสินค้า</dt>
            <dd>{formatBaht(subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>ค่าจัดส่ง</dt>
            <dd>{formatBaht(shipping)}</dd>
          </div>
          <div className="flex justify-between border-t border-line pt-2 text-xl font-bold">
            <dt>ยอดรวมทั้งหมด</dt>
            <dd data-testid="cart-total">{formatBaht(subtotal + shipping)}</dd>
          </div>
        </dl>
        <Link
          href="/checkout"
          className="mt-4 flex min-h-12 w-full items-center justify-center rounded-full bg-brand px-6 text-lg font-semibold text-on-brand hover:bg-brand-hover"
        >
          ไปหน้าชำระเงิน
        </Link>
      </section>
    </>
  );
  }
}
