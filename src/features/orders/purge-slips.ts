import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "payment-slips";
const RETENTION_DAYS = 90;
const BATCH_SIZE = 100;
const MAX_BATCHES = 10;
const TERMINAL_STATUSES = ["shipped", "cancelled", "expired"];

type SlipRow = { id: string; path: string };

/** A code that is safe to log. Error messages can carry storage paths, so they are never logged. */
function codeOf(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const e = error as { code?: unknown; statusCode?: unknown };
    if (typeof e.code === "string") return e.code;
    if (typeof e.statusCode === "string" || typeof e.statusCode === "number") return String(e.statusCode);
  }
  return "unknown";
}

async function removeObjects(client: SupabaseClient, paths: string[]): Promise<boolean> {
  try {
    // Removing an object that is already gone is not an error: the result simply omits it.
    const { error } = await client.storage.from(BUCKET).remove(paths);
    if (error) {
      console.error("slip purge: storage remove failed", codeOf(error));
      return false;
    }
    return true;
  } catch {
    console.error("slip purge: storage remove threw");
    return false;
  }
}

/** Removes a batch in one call; if that fails, retries row by row so one bad object blocks only itself. */
async function removeBatch(client: SupabaseClient, rows: SlipRow[]): Promise<SlipRow[]> {
  if (await removeObjects(client, rows.map((r) => r.path))) return rows;
  if (rows.length === 1) return [];
  const removed: SlipRow[] = [];
  for (const row of rows) {
    if (await removeObjects(client, [row.path])) removed.push(row);
  }
  return removed;
}

/**
 * Deletes the files of payment slips whose order ended (shipped, cancelled, expired) at least 90 days
 * before `now`, then stamps file_deleted_at. Rows are never deleted. One run handles at most
 * BATCH_SIZE * MAX_BATCHES slips; the rest wait for the next run. Safe to repeat: stamped rows are
 * skipped, and a file whose stamp failed is simply removed again (a missing object counts as removed).
 */
export async function purgeExpiredSlips(
  client: SupabaseClient,
  now: Date,
): Promise<{ deleted: number; failed: number }> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 3600 * 1000).toISOString();
  let deleted = 0;
  let failed = 0;
  // Keyset cursor: rows that failed stay unstamped, and must not be picked up again within this run.
  let after = "";

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    let query = client
      .from("payment_slips")
      .select("id, storage_path, orders!inner(status, terminal_at)")
      .is("file_deleted_at", null)
      .in("orders.status", TERMINAL_STATUSES)
      .lte("orders.terminal_at", cutoff)
      .order("id", { ascending: true })
      .limit(BATCH_SIZE);
    if (after) query = query.gt("id", after);

    const { data, error } = await query;
    if (error) {
      console.error("slip purge: select failed", codeOf(error));
      throw new Error("slip purge select failed");
    }
    const rows: SlipRow[] = (data ?? []).map((r) => ({ id: String(r.id), path: String(r.storage_path) }));
    if (rows.length === 0) break;
    after = rows[rows.length - 1].id;

    const removed = await removeBatch(client, rows);
    failed += rows.length - removed.length;

    if (removed.length > 0) {
      const { error: stampError } = await client
        .from("payment_slips")
        .update({ file_deleted_at: now.toISOString() })
        .in("id", removed.map((r) => r.id))
        .is("file_deleted_at", null);
      if (stampError) {
        console.error("slip purge: stamp failed", codeOf(stampError));
        failed += removed.length;
      } else {
        deleted += removed.length;
      }
    }

    if (rows.length < BATCH_SIZE) break;
  }

  return { deleted, failed };
}
