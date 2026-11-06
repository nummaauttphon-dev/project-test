import { describe, expect, it } from "vitest";
import { readCart, reconcileCart, writeCart } from "@/features/cart/cart-storage";

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
    writeCart(storage, [{ productId: otherId, quantity: 3 }]);
    expect(readCart(storage)).toEqual([{ productId: otherId, quantity: 3 }]);
  });

  it("does not throw when storage is full or blocked", () => {
    expect(() =>
      writeCart(
        {
          setItem: () => {
            throw new Error("quota");
          },
        },
        [{ productId: otherId, quantity: 1 }],
      ),
    ).not.toThrow();
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
