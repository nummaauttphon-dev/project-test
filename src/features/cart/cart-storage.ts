import { z } from "zod";

export type CartLine = { productId: string; quantity: number };

export const CART_STORAGE_KEY = "cart.v1";
export const MAX_CART_LINES = 50;
export const MAX_LINE_QUANTITY = 10;

// Same id rule as getCartViewAction, so a stored line the server would reject is dropped here.
const uuid = z.uuid();

function isValidLine(value: unknown): value is CartLine {
  if (typeof value !== "object" || value === null) return false;
  const { productId, quantity } = value as Record<string, unknown>;
  return (
    typeof productId === "string" &&
    uuid.safeParse(productId).success &&
    typeof quantity === "number" &&
    Number.isInteger(quantity) &&
    quantity >= 1
  );
}

/** Reads the cart; corrupted or unavailable storage yields an empty cart instead of throwing. */
export function readCart(storage: Pick<Storage, "getItem">): CartLine[] {
  let parsed: unknown;
  try {
    const raw = storage.getItem(CART_STORAGE_KEY);
    if (raw === null) return [];
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const merged = new Map<string, number>();
  for (const entry of parsed) {
    if (!isValidLine(entry)) continue;
    const quantity = Math.min(MAX_LINE_QUANTITY, (merged.get(entry.productId) ?? 0) + entry.quantity);
    merged.set(entry.productId, quantity);
  }
  return [...merged]
    .slice(0, MAX_CART_LINES)
    .map(([productId, quantity]) => ({ productId, quantity }));
}

/** Writes the cart. Returns false when storage is full or blocked, so callers can tell the customer. */
export function writeCart(storage: Pick<Storage, "setItem">, lines: CartLine[]): boolean {
  try {
    storage.setItem(CART_STORAGE_KEY, JSON.stringify(lines));
    return true;
  } catch {
    return false;
  }
}

export type AddResult =
  | { status: "added"; lines: CartLine[]; quantity: number }
  | { status: "at_limit" }
  | { status: "cart_full" };

/** Adds `quantity` of a product, capped at `limit` per line. Refuses a new line beyond 50 lines. */
export function addToLines(
  lines: CartLine[],
  productId: string,
  quantity: number,
  limit: number,
): AddResult {
  const inCart = lines.find((line) => line.productId === productId)?.quantity ?? 0;
  if (inCart === 0 && lines.length >= MAX_CART_LINES) return { status: "cart_full" };
  const next = Math.min(inCart + quantity, limit);
  if (next <= inCart) return { status: "at_limit" };
  const others = lines.filter((line) => line.productId !== productId);
  return { status: "added", lines: [...others, { productId, quantity: next }], quantity: next };
}

export type ReconcileResult = {
  lines: CartLine[];
  /** Product ids dropped because they are missing, hidden or sold out. */
  removed: string[];
  /** Product ids whose quantity was lowered to the available stock. */
  adjusted: string[];
};

/** Aligns the cart with the latest stock. Missing or sold-out products are removed. */
export function reconcileCart(
  lines: CartLine[],
  products: { id: string; stock_quantity: number }[],
): ReconcileResult {
  const stock = new Map(products.map((p) => [p.id, p.stock_quantity]));
  const result: ReconcileResult = { lines: [], removed: [], adjusted: [] };
  for (const line of lines) {
    const available = stock.get(line.productId);
    if (available === undefined || available <= 0) {
      result.removed.push(line.productId);
      continue;
    }
    const quantity = Math.min(line.quantity, available, MAX_LINE_QUANTITY);
    if (quantity < line.quantity) result.adjusted.push(line.productId);
    result.lines.push({ productId: line.productId, quantity });
  }
  return result;
}
