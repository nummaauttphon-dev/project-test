"use client";

import { useEffect, useRef, useState } from "react";

type State = { kind: "idle" } | { kind: "copied" } | { kind: "failed"; href: string };

/** Copies the current page address. If the browser refuses, the address is shown to copy by hand. */
export function CopyLinkButton() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const fallbackRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.kind === "failed") {
      fallbackRef.current?.focus();
      fallbackRef.current?.select();
    }
  }, [state]);

  async function copy() {
    const href = window.location.href;
    try {
      await navigator.clipboard.writeText(href);
      setState({ kind: "copied" });
    } catch {
      setState({ kind: "failed", href });
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={copy}
        className="inline-flex min-h-11 items-center rounded-full border border-brand px-5 font-semibold text-brand hover:bg-sunken"
      >
        คัดลอกลิงก์คำสั่งซื้อ
      </button>
      <div role="status" data-testid="copy-status" className="mt-2">
        {state.kind === "copied" ? <p className="text-sm">คัดลอกลิงก์แล้ว</p> : null}
        {state.kind === "failed" ? (
          <p className="text-sm text-danger-ink">คัดลอกอัตโนมัติไม่สำเร็จ กรุณาคัดลอกลิงก์ด้านล่างด้วยตนเอง</p>
        ) : null}
      </div>
      {state.kind === "failed" ? (
        <div className="mt-1">
          <label htmlFor="order-link" className="text-sm font-medium">
            ลิงก์คำสั่งซื้อ
          </label>
          <input
            id="order-link"
            ref={fallbackRef}
            readOnly
            value={state.href}
            onFocus={(event) => event.currentTarget.select()}
            className="mt-1 block min-h-12 w-full rounded-lg border border-line-strong bg-surface px-3 text-base"
          />
        </div>
      ) : null}
    </div>
  );
}
