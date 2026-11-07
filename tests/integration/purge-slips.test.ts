import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { purgeExpiredSlips } from "@/features/orders/purge-slips";
import * as route from "@/app/api/cron/purge-slips/route";
import { adminClient, resetData } from "../helpers/supabase";
import { seedOrderWithToken, seedPendingSlip, slipObjects } from "../helpers/orders";

const client = adminClient();
const DAY = 24 * 3600 * 1000;
const NOW = new Date("2026-11-07T00:00:00.000Z");
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

beforeEach(resetData);
afterEach(() => {
  vi.restoreAllMocks();
});

function daysAgo(days: number, extraMs = 0): string {
  return new Date(NOW.getTime() - days * DAY + extraMs).toISOString();
}

/** An order in `status` that ended `days` ago (or never, for in-progress ones), with one uploaded slip. */
async function seedSlip(status: string, days: number | null, extraMs = 0) {
  const { order } = await seedOrderWithToken({
    status,
    terminal_at: days === null ? null : daysAgo(days, extraMs),
  });
  const path = await seedPendingSlip(order.id, PNG);
  return { orderId: order.id, path };
}

async function slipRow(orderId: string) {
  const { data, error } = await client
    .from("payment_slips")
    .select("id, file_deleted_at")
    .eq("order_id", orderId)
    .single();
  if (error || !data) throw new Error(error?.message);
  return data as { id: string; file_deleted_at: string | null };
}

type RemoveResult = Promise<{ data: unknown; error: { message: string; statusCode: string } | null }>;

/** The real client, with storage.remove replaced. */
function withRemove(remove: (paths: string[], real: () => RemoveResult) => RemoveResult): SupabaseClient {
  return new Proxy(client, {
    get(target, prop) {
      if (prop === "storage") {
        return {
          from: (bucket: string) => ({
            remove: (paths: string[]) =>
              remove(paths, () => target.storage.from(bucket).remove(paths) as unknown as RemoveResult),
          }),
        };
      }
      const value = Reflect.get(target, prop) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as SupabaseClient;
}

const boom = (): RemoveResult => Promise.resolve({ data: null, error: { message: "boom", statusCode: "500" } });

describe("purgeExpiredSlips", () => {
  it("deletes slip files 90 days after terminal status", async () => {
    const shipped = await seedSlip("shipped", 90);
    const cancelled = await seedSlip("cancelled", 120);
    const expired = await seedSlip("expired", 91);

    expect(await purgeExpiredSlips(client, NOW)).toEqual({ deleted: 3, failed: 0 });

    for (const s of [shipped, cancelled, expired]) {
      expect(await slipObjects(s.orderId)).toEqual([]);
      const row = await slipRow(s.orderId); // the row stays
      expect(row.file_deleted_at).not.toBeNull();
    }
  });

  it("keeps slips at 89 days", async () => {
    const young = await seedSlip("shipped", 89);
    const justUnder = await seedSlip("cancelled", 90, 1000); // one second short of 90 days

    expect(await purgeExpiredSlips(client, NOW)).toEqual({ deleted: 0, failed: 0 });

    for (const s of [young, justUnder]) {
      expect(await slipObjects(s.orderId)).toEqual([s.path]);
      expect((await slipRow(s.orderId)).file_deleted_at).toBeNull();
    }
  });

  it("keeps slips of orders still in progress at any age", async () => {
    const kept = [];
    for (const status of ["awaiting_payment", "payment_review", "paid"]) {
      kept.push(await seedSlip(status, null));
    }
    expect(await purgeExpiredSlips(client, new Date(NOW.getTime() + 1000 * DAY))).toEqual({
      deleted: 0,
      failed: 0,
    });
    for (const s of kept) {
      expect(await slipObjects(s.orderId)).toEqual([s.path]);
      expect((await slipRow(s.orderId)).file_deleted_at).toBeNull();
    }
  });

  it("is safe to run twice", async () => {
    const s = await seedSlip("shipped", 100);
    expect(await purgeExpiredSlips(client, NOW)).toEqual({ deleted: 1, failed: 0 });
    const first = (await slipRow(s.orderId)).file_deleted_at;
    expect(await purgeExpiredSlips(client, NOW)).toEqual({ deleted: 0, failed: 0 });
    expect((await slipRow(s.orderId)).file_deleted_at).toBe(first);
  });

  it("counts a missing object as removed", async () => {
    const s = await seedSlip("shipped", 100);
    await client.storage.from("payment-slips").remove([s.path]);
    expect(await purgeExpiredSlips(client, NOW)).toEqual({ deleted: 1, failed: 0 });
    expect((await slipRow(s.orderId)).file_deleted_at).not.toBeNull();
  });

  it("leaves file_deleted_at null when storage delete fails", async () => {
    const s = await seedSlip("shipped", 100);

    expect(await purgeExpiredSlips(withRemove(boom), NOW)).toEqual({ deleted: 0, failed: 1 });
    expect((await slipRow(s.orderId)).file_deleted_at).toBeNull();
    expect(await slipObjects(s.orderId)).toEqual([s.path]);

    // The next run picks it up again.
    expect(await purgeExpiredSlips(client, NOW)).toEqual({ deleted: 1, failed: 0 });
    expect(await slipObjects(s.orderId)).toEqual([]);
  });

  it("marks only the rows whose object removal succeeded", async () => {
    const good = await seedSlip("shipped", 100);
    const bad = await seedSlip("shipped", 100);
    const partial = withRemove((paths, real) => (paths.includes(bad.path) ? boom() : real()));

    expect(await purgeExpiredSlips(partial, NOW)).toEqual({ deleted: 1, failed: 1 });
    expect((await slipRow(good.orderId)).file_deleted_at).not.toBeNull();
    expect((await slipRow(bad.orderId)).file_deleted_at).toBeNull();
    expect(await slipObjects(bad.orderId)).toEqual([bad.path]);
  });
});

describe("purge-slips route", () => {
  const secret = process.env.CRON_SECRET ?? "";
  const url = "http://localhost/api/cron/purge-slips";
  const call = (handler: (r: Request) => Promise<Response>, headers: Record<string, string> = {}, method = "GET") =>
    handler(new Request(url, { method, headers }));

  it("route returns 401 without the correct CRON_SECRET", async () => {
    expect(secret.length).toBeGreaterThan(0);
    const s = await seedSlip("shipped", 100);
    const bad: Record<string, string>[] = [
      {},
      { authorization: "Bearer wrong" },
      { authorization: secret },
      { authorization: `Basic ${secret}` },
      { authorization: `Bearer ${secret}x` },
      { authorization: `Bearer ${secret.slice(0, -1)}` },
    ];
    for (const headers of bad) {
      const res = await call(route.GET, headers);
      expect(res.status).toBe(401);
      expect(await res.text()).toBe("");
    }
    for (const handler of [route.POST, route.PUT, route.PATCH, route.DELETE, route.OPTIONS, route.HEAD]) {
      const res = await call(handler, { authorization: `Bearer ${secret}` }, "POST");
      expect(res.status).toBe(401);
    }
    expect(await slipObjects(s.orderId)).toEqual([s.path]); // nothing ran
  });

  it("runs the purge and returns counts only with the correct secret", async () => {
    const s = await seedSlip("shipped", 100);
    // The route uses the real clock, and NOW is the fixed date above, so age the order from today.
    const { error } = await client
      .from("orders")
      .update({ terminal_at: new Date(Date.now() - 100 * DAY).toISOString() })
      .eq("id", s.orderId);
    if (error) throw new Error(error.message);

    const res = await call(route.GET, { authorization: `Bearer ${secret}` });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual({ deleted: 1, failed: 0 });
    expect(await slipObjects(s.orderId)).toEqual([]);
  });
});
