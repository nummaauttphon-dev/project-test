const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A canonical UUID string. Ids from the browser are checked with this before any query. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
