import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProductsByIds: vi.fn(),
  getStoreSettings: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));

import { getProductBySlug, getProductsByIds, getStoreSettings, listProducts } from "@/features/catalog/queries";

// Database error messages can quote the values that failed (a phone number, an address), so only
// the error code may reach a log or an error message.
const LEAK = "0812345678 123 ถนนทดสอบ";
const DB_ERROR = { code: "42501", message: `permission denied near ${LEAK}`, details: LEAK, hint: LEAK };

/** A query builder whose every call chains and which resolves to `result`. */
function clientAnswering(result: unknown): SupabaseClient {
  const builder: Record<string, unknown> = {};
  const chain = new Proxy(builder, {
    get(_, key) {
      if (key === "then") return (resolve: (value: unknown) => unknown) => resolve(result);
      return () => chain;
    },
  });
  return { from: () => chain } as unknown as SupabaseClient;
}

describe("catalog queries", () => {
  it.each([
    ["listProducts", (c: SupabaseClient) => listProducts(c)],
    ["getProductBySlug", (c: SupabaseClient) => getProductBySlug("mug", c)],
    ["getProductsByIds", (c: SupabaseClient) => getProductsByIds(["6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b"], c)],
    ["getStoreSettings", (c: SupabaseClient) => getStoreSettings(c)],
  ])("%s throws with the error code only", async (name, call) => {
    const thrown = await call(clientAnswering({ data: null, error: DB_ERROR })).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(`${name}: 42501`);
    expect((thrown as { code?: unknown }).code).toBe("42501");
  });

  it("getStoreSettings without a row throws without a database message", async () => {
    await expect(getStoreSettings(clientAnswering({ data: null, error: null }))).rejects.toThrow(
      "getStoreSettings: no row",
    );
  });
});

describe("getCartViewAction", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/features/catalog/queries", () => mocks);
  });

  afterEach(() => {
    vi.doUnmock("@/features/catalog/queries");
    vi.restoreAllMocks();
  });

  it.each([
    ["a query error with a code", Object.assign(new Error(`getProductsByIds: ${LEAK}`), { code: "42501" }), "42501"],
    ["any other error", new Error(`fetch failed for ${LEAK}`), "unknown"],
  ])("logs only the code of %s", async (_, error, logged) => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getProductsByIds.mockRejectedValue(error);
    mocks.getStoreSettings.mockResolvedValue({ shippingFeeSatang: 5000, paymentWindowMinutes: 1440, contactUrl: "" });
    const { getCartViewAction } = await import("@/features/cart/cart-actions");

    const result = await getCartViewAction([{ productId: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b", quantity: 1 }]);
    expect(result).toMatchObject({ ok: false, code: "cart_unavailable" });
    expect(consoleError.mock.calls).toEqual([["getCartViewAction failed", logged]]);
  });
});
