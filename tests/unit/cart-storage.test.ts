import { describe, expect, it } from "vitest";
import { addToLines, readCart, reconcileCart, writeCart } from "@/features/cart/cart-storage";

const hiddenId = "11111111-1111-4111-8111-111111111111";
const lowStockId = "22222222-2222-4222-8222-222222222222";
const otherId = "33333333-3333-4333-8333-333333333333";

function storageWith(value: string | null) {
  return { getItem: () => value };
}

describe("readCart", () => {
  it("returns an empty cart for broken or invalid storage", () => {
    expect(readCart(storageWith(null))).toEqual([]);
    expect(readCart(storageWith("{broken"))).toEqual([]);
    expect(readCart(storageWith('{"a":1}'))).toEqual([]);
    expect(readCart(storageWith(JSON.stringify([{ productId: "x", quantity: -1 }])))).toEqual([]);
  });

  it("drops well-formed lines whose product id is not a UUID", () => {
    const raw = JSON.stringify([
      { productId: "x", quantity: 1 },
      { productId: "not-a-uuid-at-all", quantity: 2 },
      { productId: otherId, quantity: 1 },
    ]);
    expect(readCart(storageWith(raw))).toEqual([{ productId: otherId, quantity: 1 }]);
    expect(readCart(storageWith(JSON.stringify([{ productId: "x", quantity: 1 }])))).toEqual([]);
  });

  it("returns an empty cart when storage itself throws", () => {
    expect(
      readCart({
        getItem: () => {
          throw new Error("denied");
        },
      }),
    ).toEqual([]);
  });

  it("keeps valid lines, drops invalid ones, merges duplicates and caps quantity at 10", () => {
    const raw = JSON.stringify([
      { productId: otherId, quantity: 2 },
      { productId: lowStockId, quantity: 0 },
      { productId: lowStockId, quantity: 1.5 },
      { productId: otherId, quantity: 9 },
      { productId: "", quantity: 1 },
      "junk",
    ]);
    expect(readCart(storageWith(raw))).toEqual([{ productId: otherId, quantity: 10 }]);
  });

  it("keeps at most 50 lines", () => {
    const lines = Array.from({ length: 60 }, (_, i) => ({
      productId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      quantity: 1,
    }));
    expect(readCart(storageWith(JSON.stringify(lines)))).toHaveLength(50);
  });
});

describe("writeCart", () => {
  it("round-trips through readCart", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    expect(writeCart(storage, [{ productId: otherId, quantity: 3 }])).toBe(true);
    expect(readCart(storage)).toEqual([{ productId: otherId, quantity: 3 }]);
  });

  it("returns false instead of throwing when storage is full or blocked", () => {
    const blocked = {
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(writeCart(blocked, [{ productId: otherId, quantity: 1 }])).toBe(false);
  });
});

describe("reconcileCart", () => {
  it("removes missing products and clamps quantity to stock", () => {
    const result = reconcileCart(
      [
        { productId: hiddenId, quantity: 1 },
        { productId: lowStockId, quantity: 5 },
      ],
      [{ id: lowStockId, stock_quantity: 2 }],
    );
    expect(result.removed).toEqual([hiddenId]);
    expect(result.lines).toEqual([{ productId: lowStockId, quantity: 2 }]);
    expect(result.adjusted).toEqual([lowStockId]);
  });

  it("removes sold-out products and leaves fitting lines untouched", () => {
    const result = reconcileCart(
      [
        { productId: hiddenId, quantity: 1 },
        { productId: otherId, quantity: 3 },
      ],
      [
        { id: hiddenId, stock_quantity: 0 },
        { id: otherId, stock_quantity: 50 },
      ],
    );
    expect(result.removed).toEqual([hiddenId]);
    expect(result.adjusted).toEqual([]);
    expect(result.lines).toEqual([{ productId: otherId, quantity: 3 }]);
  });
});

describe("addToLines", () => {
  const manyLines = Array.from({ length: 50 }, (_, i) => ({
    productId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    quantity: 1,
  }));

  it("adds a new line and merges into an existing one up to the limit", () => {
    const first = addToLines([], otherId, 2, 5);
    expect(first).toEqual({ status: "added", lines: [{ productId: otherId, quantity: 2 }], quantity: 2 });
    if (first.status !== "added") throw new Error("expected added");
    const second = addToLines(first.lines, otherId, 9, 5);
    expect(second).toEqual({ status: "added", lines: [{ productId: otherId, quantity: 5 }], quantity: 5 });
  });

  it("reports at_limit when the line is already full", () => {
    expect(addToLines([{ productId: otherId, quantity: 5 }], otherId, 1, 5)).toEqual({ status: "at_limit" });
  });

  it("refuses a 51st distinct product but still allows more of an existing one", () => {
    expect(addToLines(manyLines, otherId, 1, 10)).toEqual({ status: "cart_full" });
    const result = addToLines(manyLines, manyLines[0].productId, 1, 10);
    expect(result.status).toBe("added");
  });
});
