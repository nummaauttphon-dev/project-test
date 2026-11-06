"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const RETRY_MS = 10_000;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/** Whole minutes, rounded up, so the spoken value only changes once a minute. */
function spoken(ms: number): string {
  if (ms < 60_000) return "น้อยกว่า 1 นาที";
  const minutes = Math.ceil(ms / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} ชั่วโมง ${m} นาที` : `${m} นาที`;
}

/**
 * Counts down to expiresAt for sighted users every second. The ticking text is hidden from
 * assistive technology; a separate status region changes once a minute. The client clock is never
 * trusted for the outcome: at zero the page is re-fetched, and re-fetched again until the server
 * agrees the order has expired (the client clock may run ahead).
 */
export function OrderCountdown({ expiresAt }: { expiresAt: string }) {
  const router = useRouter();
  const target = Date.parse(expiresAt);
  // null until mounted: the server's clock must not leak into the first client render.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  const remaining = now === null ? null : Math.max(0, target - now);
  const atZero = remaining === 0;

  useEffect(() => {
    if (!atZero) return;
    router.refresh();
    const id = window.setInterval(() => router.refresh(), RETRY_MS);
    return () => window.clearInterval(id);
  }, [atZero, router]);

  // Updates when the minute changes only, so a screen reader announces it at most once a minute.
  const minuteText = remaining === null ? "" : atZero ? "หมดเวลาชำระเงินแล้ว" : `เหลือเวลาอีก ${spoken(remaining)}`;

  return (
    <div className="rounded-lg bg-sunken p-3">
      <p className="text-sm text-ink-soft">เวลาที่เหลือในการชำระเงิน</p>
      <p className="text-2xl font-bold tabular-nums" aria-hidden="true" data-testid="countdown">
        {remaining === null ? "--:--:--" : atZero ? "หมดเวลาแล้ว" : clock(remaining)}
      </p>
      <p className="sr-only" role="status" data-testid="countdown-spoken">
        {minuteText}
      </p>
      {atZero ? <p className="text-sm text-ink-soft">กำลังตรวจสอบสถานะล่าสุด…</p> : null}
    </div>
  );
}
