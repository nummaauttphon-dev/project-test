export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; fieldErrors?: Record<string, string> };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail<T = never>(
  code: string,
  message: string,
  fieldErrors?: Record<string, string>,
): ActionResult<T> {
  return fieldErrors ? { ok: false, code, message, fieldErrors } : { ok: false, code, message };
}
