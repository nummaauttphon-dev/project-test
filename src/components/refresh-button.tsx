"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/** The page does not poll: this (or a reload) fetches the latest state. */
export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
      className="inline-flex min-h-11 items-center rounded-full border border-line-strong px-5 font-semibold hover:bg-sunken disabled:opacity-60"
    >
      {pending ? "กำลังตรวจสอบ…" : "ตรวจสอบสถานะล่าสุด"}
    </button>
  );
}
