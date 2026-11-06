import type { SupabaseClient } from "@supabase/supabase-js";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAllowed, RATE_LIMITS } from "@/lib/rate-limit";
import { connect } from "../helpers/pg";
import { adminClient, resetData } from "../helpers/supabase";

let observer: pg.Client;
const client = adminClient();

beforeAll(async () => {
  observer = await connect();
});
afterAll(async () => {
  await observer.end();
});
beforeEach(resetData);
afterEach(() => {
  vi.restoreAllMocks();
});

async function cronCommand(name: string): Promise<{ schedule: string; command: string } | undefined> {
  const { rows } = await observer.query<{ schedule: string; command: string }>(
    "select schedule, command from cron.job where jobname = $1",
    [name],
  );
  return rows[0];
}

describe("rate limiting", () => {
  it("uses the specified limits", () => {
    expect(RATE_LIMITS.place_order).toEqual({ limit: 10, windowSeconds: 3600 });
    expect(RATE_LIMITS.submit_slip).toEqual({ limit: 10, windowSeconds: 3600 });
  });

  it("allows up to the limit, then blocks", async () => {
    const results = await Promise.all(
      Array.from({ length: 11 }, () => isAllowed(client, "place_order", "1.2.3.4", "salt")),
    );
    expect(results.filter(Boolean)).toHaveLength(10);
  });

  it("separates subjects and actions", async () => {
    for (let i = 0; i < 10; i++) await isAllowed(client, "place_order", "1.2.3.4", "salt");
    expect(await isAllowed(client, "place_order", "1.2.3.4", "salt")).toBe(false);
    expect(await isAllowed(client, "place_order", "5.6.7.8", "salt")).toBe(true);
    expect(await isAllowed(client, "submit_slip", "1.2.3.4", "salt")).toBe(true);
    expect(await isAllowed(client, "place_order", "1.2.3.4", "other-salt")).toBe(true);
  });

  it("denies when the database call fails, without logging the subject", async () => {
    const spies = [
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "log").mockImplementation(() => {}),
    ];
    const failing = {
      rpc: async () => ({ data: null, error: { message: "boom", code: "XX000" } }),
    } as unknown as SupabaseClient;
    expect(await isAllowed(failing, "place_order", "9.9.9.9", "salt")).toBe(false);
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain("9.9.9.9");
  });

  it("resets in a new window", async () => {
    for (let i = 0; i < 10; i++) await isAllowed(client, "place_order", "1.2.3.4", "salt");
    expect(await isAllowed(client, "place_order", "1.2.3.4", "salt")).toBe(false);
    await observer.query("update public.rate_limits set window_start = window_start - interval '1 hour'");
    expect(await isAllowed(client, "place_order", "1.2.3.4", "salt")).toBe(true);
    const { rows } = await observer.query<{ count: number }>(
      "select count from public.rate_limits order by window_start desc",
    );
    expect(rows.map((r) => r.count)).toEqual([1, 10]);
  });

  it("stores a hash, never the raw subject", async () => {
    await isAllowed(client, "place_order", "1.2.3.4", "salt");
    const { data } = await client.from("rate_limits").select("key_hash");
    expect(data).toHaveLength(1);
    expect(JSON.stringify(data)).not.toContain("1.2.3.4");
  });

  it("aligns the window start to the window", async () => {
    await isAllowed(client, "place_order", "1.2.3.4", "salt");
    const { rows } = await observer.query<{ ok: boolean }>(
      "select (extract(epoch from window_start)::bigint % 3600 = 0) as ok from public.rate_limits",
    );
    expect(rows).toEqual([{ ok: true }]);
  });

  it("is not callable by anon or authenticated", async () => {
    const { rows } = await observer.query<{ anon: boolean; auth: boolean; svc: boolean }>(
      `select has_function_privilege('anon', 'public.check_rate_limit(text,text,integer,integer)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.check_rate_limit(text,text,integer,integer)', 'execute') as auth,
              has_function_privilege('service_role', 'public.check_rate_limit(text,text,integer,integer)', 'execute') as svc`,
    );
    expect(rows[0]).toEqual({ anon: false, auth: false, svc: true });
  });
});

describe("admin client", () => {
  it("talks to the database with the secret key", async () => {
    const { error } = await createAdminClient().from("rate_limits").select("key_hash").limit(1);
    expect(error).toBeNull();
  });
});

describe("scheduled jobs", () => {
  it("schedules expire_orders every 5 minutes", async () => {
    const job = await cronCommand("expire-orders");
    expect(job?.schedule).toBe("*/5 * * * *");
    expect(job?.command).toContain("public.expire_orders()");
  });

  it("purges old rate limit rows daily", async () => {
    const job = await cronCommand("purge-rate-limits");
    expect(job?.schedule).toBe("0 3 * * *");
    expect(job?.command).toContain("public.rate_limits");
  });

  it("runs the purge command, deleting only rows older than a day", async () => {
    await observer.query(
      `insert into public.rate_limits (key_hash, action, window_start, count) values
       ('old', 'place_order', now() - interval '2 days', 1),
       ('new', 'place_order', now(), 1)`,
    );
    const job = await cronCommand("purge-rate-limits");
    await observer.query(job!.command);
    const { rows } = await observer.query<{ key_hash: string }>("select key_hash from public.rate_limits");
    expect(rows).toEqual([{ key_hash: "new" }]);
  });
});
