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
// new migration's functions are missing even though requests succeed, and the OpenAPI listing is
// no proof that RPC calls work. So: ask for a reload, then call every public function through the
// API until none answers PGRST202 (function not in the schema cache) several times in a row.
//
// The probes cannot change data. They run as anon, which has EXECUTE on none of the functions, so
// PostgREST answers 42501 after resolving the function. A function that anon can execute is only
// probed with a deliberately invalid argument (a failed cast), and skipped if it has none.
type Fn = { name: string; args: string[]; anon: boolean; invalid: string | null };

const pgClient = await connect();
let functions: Fn[];
try {
  await pgClient.query("notify pgrst, 'reload schema'");
  const { rows } = await pgClient.query<{
    name: string;
    args: string[] | null;
    types: string[];
    anon: boolean;
  }>(
    `select p.proname as name, p.proargnames[1:p.pronargs] as args,
            array(select format_type(t, null) from unnest(p.proargtypes::oid[]) as t) as types,
            has_function_privilege('anon', p.oid, 'execute') as anon
     from pg_proc as p
     where p.pronamespace = 'public'::regnamespace and p.prorettype <> 'trigger'::regtype
       and p.prokind = 'f'`,
  );
  functions = rows.map((row) => {
    const args = row.args ?? [];
    const at = row.types.findIndex((t) => !["text", "character varying", "json", "jsonb"].includes(t));
    return { name: row.name, args, anon: row.anon, invalid: at >= 0 ? (args[at] ?? null) : null };
  });
} finally {
  await pgClient.end();
}

const publishableKey = required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const apiUrl = required("NEXT_PUBLIC_SUPABASE_URL");

/** Returns why the function is not callable yet, or null when the API resolves it. */
async function probe(fn: Fn): Promise<string | null> {
  const body: Record<string, string | null> = Object.fromEntries(fn.args.map((a) => [a, null]));
  if (fn.anon) {
    if (fn.invalid === null) return null;
    body[fn.invalid] = "not-a-valid-value";
  }
  try {
    const response = await fetch(`${apiUrl}/rest/v1/rpc/${fn.name}`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as { code?: string };
    return payload.code === "PGRST202" || response.status >= 500
      ? `${fn.name}: ${payload.code ?? response.status}`
      : null;
  } catch (error) {
    return `${fn.name}: ${error instanceof Error ? error.message : "request failed"}`;
  }
}

const REQUIRED_CLEAN_ROUNDS = 5;
let clean = 0;
while (clean < REQUIRED_CLEAN_ROUNDS) {
  const round = await Promise.all(Array.from({ length: 4 }, () => functions.map(probe)).flat());
  const failing = [...new Set(round.filter((r): r is string => r !== null))];
  clean = failing.length === 0 ? clean + 1 : 0;
  if (clean >= REQUIRED_CLEAN_ROUNDS) break;
  if (Date.now() > deadline) {
    throw new Error(`API schema cache is stale; still failing: ${failing.join(", ")}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
