/**
 * Helpers for what may reach a log or a thrown message. Database and Storage error messages can
 * quote the values that failed (phone numbers, addresses, storage paths), so only codes go out.
 */

/** Only a short, code-shaped value is logged; anything else could carry customer data. */
export function loggable(code: unknown): string {
  return typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code) ? code : "unexpected";
}

/** The code of a Supabase, PostgREST or Storage error. Its message is never used. */
export function codeOf(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const e = error as { code?: unknown; statusCode?: unknown };
    if (typeof e.code === "string") return e.code;
    if (typeof e.statusCode === "string" || typeof e.statusCode === "number") return String(e.statusCode);
  }
  return "unknown";
}

/** An Error for a failed query that names where it failed and carries the code, never the message. */
export function queryError(where: string, error: unknown): Error & { code: string } {
  const code = codeOf(error);
  return Object.assign(new Error(`${where}: ${code}`), { code });
}
