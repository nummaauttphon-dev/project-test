import { loadEnvFile } from "node:process";
import { adminClient } from "./helpers/supabase";

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
