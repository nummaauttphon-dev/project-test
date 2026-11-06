"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { getCartViewAction, type CartView } from "@/features/cart/cart-actions";
import { reconcileCart, type CartLine } from "@/features/cart/cart-storage";
import { useCart } from "@/features/cart/use-cart";
import { placeOrderAction } from "@/features/checkout/actions";
import type { OrderChange } from "@/features/checkout/place-order";
import { generateIdempotencyKey } from "@/lib/idempotency";
import { formatBaht } from "@/lib/money";

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "done"; data: CartView };

type Fields = { customerName: string; phone: string; shippingAddress: string };
type FieldName = keyof Fields;

const FIELD_NAMES: FieldName[] = ["customerName", "phone", "shippingAddress"];
const UNKNOWN_OUTCOME =
  "ไม่ทราบผลการสั่งซื้อเนื่องจากการเชื่อมต่อมีปัญหา กรุณากดยืนยันสั่งซื้ออีกครั้ง ระบบจะไม่สร้างคำสั่งซื้อซ้ำ";
const INPUT_CLASS =
  "mt-1 block min-h-12 w-full rounded-lg border border-line-strong bg-surface px-3 text-base aria-[invalid=true]:border-danger-ink";

function describeChanges(changes: OrderChange[], names: Map<string, string>, total: number): string[] {
  const label = (id: string) => names.get(id) ?? "สินค้า";
  const messages: string[] = [];
  for (const change of changes) {
    if (change.reason === "unavailable") {
      messages.push(`${label(change.product_id)} หมดหรือไม่มีจำหน่ายแล้ว จึงนำออกจากตะกร้า`);
    } else if (change.reason === "insufficient_stock") {
      messages.push(`${label(change.product_id)} เหลือ ${change.available_quantity} ชิ้น จึงปรับจำนวนในตะกร้า`);
    }
  }
  // price_changed is reported on every line when the total differs, and the cause may be the
  // shipping fee, so it never claims that a particular product changed price.
  messages.push(`ยอดรวมทั้งหมดเปลี่ยนเป็น ${formatBaht(total)} กรุณาตรวจสอบยอดแล้วกดยืนยันสั่งซื้ออีกครั้ง`);
  return messages;
}

export function CheckoutForm() {
  const router = useRouter();
  const { lines, ready, setLines } = useCart();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [fields, setFields] = useState<Fields>({ customerName: "", phone: "", shippingAddress: "" });
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [formError, setFormError] = useState("");
  const [notices, setNotices] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  const linesRef = useRef<CartLine[]>(lines);
  const namesRef = useRef(new Map<string, string>());
  const submittingRef = useRef(false);
  // One key per distinct order (items + total). Reused while the order data is unchanged, so a
  // double click, a retry after a network failure and a reconfirm all map to the same order.
  const keyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const fieldRefs = useRef<Partial<Record<FieldName, HTMLInputElement | HTMLTextAreaElement | null>>>({});

  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  /** Loads the latest products and aligns the stored cart with them. */
  const refresh = useCallback(
    async (requested: CartLine[]): Promise<Load> => {
      if (requested.length === 0) return { state: "done", data: { products: [], shippingFeeSatang: 0 } };
      const result = await getCartViewAction(requested);
      if (!result.ok) return { state: "error", message: result.message };
      for (const p of result.data.products) namesRef.current.set(p.id, p.name);
      const { lines: kept, removed, adjusted } = reconcileCart(requested, result.data.products);
      if (removed.length > 0 || adjusted.length > 0) {
        setLines(kept);
        linesRef.current = kept;
      }
      return { state: "done", data: result.data };
    },
    [setLines],
  );

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    refresh(linesRef.current)
      .then((next) => {
        if (!cancelled) setLoad(next);
      })
      .catch(() => {
        if (!cancelled) setLoad({ state: "error", message: "โหลดตะกร้าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" });
      });
    return () => {
      cancelled = true;
    };
    // Reload only when storage becomes readable and on retry.
  }, [ready, attempt, refresh]);

  const rows =
    load.state === "done"
      ? lines.flatMap((line) => {
          const product = load.data.products.find((p) => p.id === line.productId);
          return product ? [{ line, product }] : [];
        })
      : [];
  const shipping = load.state === "done" ? load.data.shippingFeeSatang : 0;
  const subtotal = rows.reduce((sum, { line, product }) => sum + product.price_satang * line.quantity, 0);
  const total = subtotal + shipping;

  function focusFirstProblem(fieldErrors: Partial<Record<string, string>>) {
    const first = FIELD_NAMES.find((name) => fieldErrors[name]);
    (first ? fieldRefs.current[first] : summaryRef.current)?.focus();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || rows.length === 0) return;
    submittingRef.current = true;
    setPending(true);
    setErrors({});
    setFormError("");
    setNotices([]);

    const items = rows.map(({ line }) => ({ productId: line.productId, quantity: line.quantity }));
    const fingerprint = JSON.stringify({
      items: [...items].sort((a, b) => a.productId.localeCompare(b.productId)),
      total,
    });
    if (keyRef.current?.fingerprint !== fingerprint) {
      keyRef.current = { fingerprint, key: generateIdempotencyKey() };
    }

    let succeeded = false;
    try {
      const result = await placeOrderAction({
        ...fields,
        idempotencyKey: keyRef.current.key,
        expectedTotalSatang: total,
        items,
      });
      if (!result.ok) {
        const fieldErrors: Partial<Record<string, string>> = result.fieldErrors ?? {};
        setErrors(fieldErrors);
        const general = Object.entries(fieldErrors).filter(([name]) => !FIELD_NAMES.includes(name as FieldName));
        setFormError(
          result.code === "VALIDATION" && general.length === 0 ? "" : (general[0]?.[1] ?? result.message),
        );
        // Wait for the error elements to render before moving focus.
        requestAnimationFrame(() => focusFirstProblem(fieldErrors));
        return;
      }
      if (result.data.kind === "changed") {
        const messages = describeChanges(result.data.changes, namesRef.current, result.data.currentTotalSatang);
        const next = await refresh(linesRef.current).catch(
          (): Load => ({ state: "error", message: "โหลดตะกร้าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }),
        );
        setLoad(next);
        setNotices(messages);
        return;
      }
      succeeded = true;
      setDone(true);
      setLines([]); // clear the cart only now that the order exists
      router.push(`/orders/${result.data.token}`);
    } catch {
      setFormError(UNKNOWN_OUTCOME);
      requestAnimationFrame(() => summaryRef.current?.focus());
    } finally {
      if (!succeeded) {
        submittingRef.current = false;
        setPending(false);
      }
    }
  }

  const problems = [...(formError ? [formError] : []), ...FIELD_NAMES.flatMap((n) => (errors[n] ? [errors[n]] : []))];

  // The live regions stay mounted so that screen readers register them before text is added.
  const liveRegions = (
    <>
      <div
        ref={summaryRef}
        tabIndex={-1}
        role="alert"
        data-testid="checkout-alert"
        className="focus:outline-2 focus:outline-offset-2"
      >
        {problems.length > 0 ? (
          <div className="mt-4 rounded-lg border border-danger-ink bg-danger-bg p-3 text-danger-ink">
            <ul className="list-disc space-y-1 pl-5">
              {problems.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <div role="status" data-testid="checkout-status">
        {notices.map((text) => (
          <p key={text} className="mt-4 rounded-lg border border-notice-line bg-notice-bg p-3 text-notice-ink">
            {text}
          </p>
        ))}
      </div>
    </>
  );

  if (done) {
    return (
      <p role="status" className="mt-6">
        กำลังพาไปหน้าคำสั่งซื้อ…
      </p>
    );
  }

  if (!ready || load.state === "loading") {
    return (
      <div aria-busy="true" className="mt-6">
        <span className="sr-only">กำลังโหลดตะกร้า</span>
        <div aria-hidden="true" className="space-y-3">
          <div className="skeleton h-28" />
          <div className="skeleton h-48" />
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
          onClick={() => {
            setLoad({ state: "loading" });
            setAttempt((n) => n + 1);
          }}
          className="mt-3 min-h-11 rounded-full bg-danger-ink px-5 font-semibold text-surface"
        >
          ลองใหม่
        </button>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <>
        {liveRegions}
        <section className="mt-6 rounded-card border border-dashed border-line-strong bg-surface p-8 text-center">
          <h2 className="text-lg font-semibold">ตะกร้าของคุณยังว่างอยู่</h2>
          <p className="mt-2 text-ink-soft">เพิ่มสินค้าลงตะกร้าก่อนจึงจะสั่งซื้อได้</p>
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

  function field(name: FieldName, label: string, hint?: string) {
    const error = errors[name];
    const describedBy = [hint ? `${name}-hint` : "", error ? `${name}-error` : ""].filter(Boolean).join(" ");
    const common = {
      id: name,
      name,
      value: fields[name],
      onChange: (e: { target: { value: string } }) => setFields((f) => ({ ...f, [name]: e.target.value })),
      "aria-required": true as const,
      "aria-invalid": error ? (true as const) : undefined,
      "aria-describedby": describedBy || undefined,
      className: INPUT_CLASS,
    };
    return (
      <div>
        <label htmlFor={name} className="font-medium">
          {label}
        </label>
        {hint ? (
          <p id={`${name}-hint`} className="text-sm text-ink-soft">
            {hint}
          </p>
        ) : null}
        {name === "shippingAddress" ? (
          <textarea
            {...common}
            ref={(el) => {
              fieldRefs.current[name] = el;
            }}
            rows={4}
            autoComplete="street-address"
            className={`${INPUT_CLASS} py-2`}
          />
        ) : (
          <input
            {...common}
            ref={(el) => {
              fieldRefs.current[name] = el;
            }}
            type={name === "phone" ? "tel" : "text"}
            inputMode={name === "phone" ? "tel" : undefined}
            autoComplete={name === "phone" ? "tel" : "name"}
          />
        )}
        {error ? (
          <p id={`${name}-error`} className="mt-1 text-danger-ink">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <>
      {liveRegions}
      <section aria-label="สรุปคำสั่งซื้อ" className="mt-4 rounded-card border border-line bg-surface p-4">
        <ul className="space-y-2">
          {rows.map(({ line, product }) => (
            <li key={product.id} className="flex justify-between gap-3">
              <span>
                {product.name} × {line.quantity}
              </span>
              <span>{formatBaht(product.price_satang * line.quantity)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 space-y-2 border-t border-line pt-3">
          <div className="flex justify-between">
            <dt>ค่าจัดส่ง</dt>
            <dd>{formatBaht(shipping)}</dd>
          </div>
          <div className="flex justify-between text-xl font-bold">
            <dt>ยอดรวมทั้งหมด</dt>
            <dd data-testid="checkout-total">{formatBaht(total)}</dd>
          </div>
        </dl>
      </section>

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        {field("customerName", "ชื่อผู้รับ")}
        {field("phone", "เบอร์โทรศัพท์", "เช่น 081-234-5678")}
        {field("shippingAddress", "ที่อยู่จัดส่ง", "บ้านเลขที่ ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด และรหัสไปรษณีย์")}
        <p className="text-sm text-ink-soft">
          เราใช้ข้อมูลนี้เพื่อจัดส่งสินค้าและติดต่อเรื่องคำสั่งซื้อเท่านั้น อ่านเพิ่มเติมที่{" "}
          <Link href="/privacy" className="underline">
            นโยบายความเป็นส่วนตัว
          </Link>
        </p>
        <button
          type="submit"
          disabled={pending}
          className="flex min-h-12 w-full items-center justify-center rounded-full bg-brand px-6 text-lg font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60"
        >
          {pending ? "กำลังสั่งซื้อ…" : "ยืนยันสั่งซื้อ"}
        </button>
      </form>
    </>
  );
}
