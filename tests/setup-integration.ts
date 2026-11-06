import { loadEnvFile } from "node:process";
import { connect } from "./helpers/pg";
import { adminClient, required } from "./helpers/supabase";

// Integration tests run against the local Supabase stack.
loadEnvFile(".env.test.local");

// `supabase db reset` restarts Postgres, and PostgREST keeps dead pooled connections and retries
// with backoff, so requests fail for some seconds afterwards. Going wider than the pool flushes
// every dead connection before the first test.
const db = adminClient();
const deadline = Date.now() + 60000;
for (;;) {
  const results = await Promise.all(
    Array.from({ length: 20 }, () => db.from("store_settings").select("id")),
  );
  const failed = results.find((result) => result.error);
  if (!failed) break;
  if (Date.now() > deadline) throw new Error(`API not ready: ${failed.error?.message}`);
  await new Promise((resolve) => setTimeout(resolve, 500));
}

// PostgREST can also keep serving its schema cache from before the reset for some seconds, so a
// new migration's functions are missing even though requests succeed. Waits until the API knows
// every table and function the database has.
const client = await connect();
const { rows } = await client.query<{ path: string }>(
  `select '/' || c.relname as path from pg_class as c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
   union all
   select '/rpc/' || p.proname from pg_proc as p
   where p.pronamespace = 'public'::regnamespace and p.prorettype <> 'trigger'::regtype`,
);
await client.end();

const secretKey = required("SUPABASE_SECRET_KEY");
for (;;) {
  const response = await fetch(`${required("NEXT_PUBLIC_SUPABASE_URL")}/rest/v1/`, {
    headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}` },
  });
  const { paths } = (await response.json()) as { paths: Record<string, unknown> };
  const missing = rows.map((row) => row.path).filter((path) => !(path in paths));
  if (missing.length === 0) break;
  if (Date.now() > deadline) throw new Error(`API schema cache is stale: ${missing.join(", ")}`);
  await new Promise((resolve) => setTimeout(resolve, 500));
}
