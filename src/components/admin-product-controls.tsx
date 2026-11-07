"use client";

import { useId, useState, type FormEvent } from "react";
import { adjustStockAction, setProductActiveAction } from "@/features/admin/product-actions";
import { ActionError, FIELD, SECONDARY, useAdminAction } from "./admin-ui";

const AMOUNT_ERROR = "กรอกจำนวนเต็ม 1-1,000";

/** Adds to or removes from the stock. The database applies the change, so busy sales cannot be overwritten. */
export function StockAdjuster({ productId, name }: { productId: string; name: string }) {
  const { pending, failure, run } = useAdminAction();
  const id = useId();
  const [amount, setAmount] = useState("");
  const [localError, setLocalError] = useState<string>();
  const [result, setResult] = useState<string>();

  function apply(sign: 1 | -1) {
    setResult(undefined);
    const trimmed = amount.trim();
    const n = /^\d{1,4}$/.test(trimmed) ? Number(trimmed) : 0;
    if (n < 1 || n > 1000) {
      setLocalError(AMOUNT_ERROR);
      return;
    }
    setLocalError(undefined);
    run(
      () => adjustStockAction(productId, sign * n),
      ({ stock }) => {
        setAmount("");
        setResult(`สต็อกของ ${name} เหลือ ${stock} ชิ้น`);
      },
    );
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  const error = localError;
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium">
        ปรับสต็อก {name} (ชิ้น)
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`${FIELD} mt-0 min-h-11 w-24`}
        />
        <button type="button" disabled={pending} className={`${SECONDARY} min-h-11 px-4`} onClick={() => apply(1)}>
          เพิ่ม
        </button>
        <button type="button" disabled={pending} className={`${SECONDARY} min-h-11 px-4`} onClick={() => apply(-1)}>
          ลด
        </button>
      </div>
      {error ? (
        <p id={`${id}-error`} data-testid="stock-amount-error" className="text-danger-ink">
          {error}
        </p>
      ) : null}
      <ActionError failure={failure} always />
      <div role="status">{result ? <p data-testid="stock-result" className="text-sm">{result}</p> : null}</div>
    </form>
  );
}

/** Hiding keeps the product and its order history; it can be shown again at any time. */
export function ActiveToggle({ productId, name, isActive }: { productId: string; name: string; isActive: boolean }) {
  const { pending, failure, run } = useAdminAction();
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        className={`${SECONDARY} min-h-11 px-4`}
        onClick={() => run(() => setProductActiveAction(productId, !isActive))}
      >
        {isActive ? `ซ่อน ${name} จากร้าน` : `แสดง ${name} ในร้าน`}
      </button>
      <ActionError failure={failure} always />
    </div>
  );
}
