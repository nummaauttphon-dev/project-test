import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const rpc = vi.fn();
  const from = vi.fn();
  const storageFrom = vi.fn();
  return {
    rpc,
    from,
    storageFrom,
    requireAdmin: vi.fn(),
    createAdminClient: vi.fn(() => ({ rpc, from, storage: { from: storageFrom } })),
    createServerSupabase: vi.fn(async () => ({ rpc, from, storage: { from: storageFrom } })),
    refresh: vi.fn(),
  };
});

vi.mock("@/features/admin/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: mocks.createServerSupabase }));
vi.mock("next/cache", () => ({ refresh: mocks.refresh, revalidatePath: vi.fn(), updateTag: vi.fn() }));

import { adjustStockAction, saveProductAction, setProductActiveAction } from "@/features/admin/product-actions";
import { saveSettingsAction } from "@/features/admin/settings-actions";
import {
  approveSlipAction,
  cancelOrderAction,
  rejectSlipAction,
  setTrackingAction,
  shipOrderAction,
} from "@/features/admin/order-actions";

const ORDER_ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const PRODUCT_ID = "7a2d3b4c-5e6f-4a71-8b8c-0d1e2f3a4b5c";
const SLIP_ID = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";

/**
 * Every admin Server Action with valid sample arguments, so a refusal can only come from the
 * guard.
 */
const allAdminActions: [name: string, call: () => Promise<unknown>][] = [
  ["approveSlipAction", () => approveSlipAction(ORDER_ID, "payment_review", SLIP_ID)],
  ["rejectSlipAction", () => rejectSlipAction(ORDER_ID, "ยอดเงินไม่ตรงกับคำสั่งซื้อ", "payment_review", SLIP_ID)],
  ["shipOrderAction", () => shipOrderAction(ORDER_ID, "TH1234567890", "paid")],
  ["cancelOrderAction", () => cancelOrderAction(ORDER_ID, "paid")],
  ["setTrackingAction", () => setTrackingAction(ORDER_ID, "TH0987654321")],
  [
    "saveProductAction",
    () =>
      saveProductAction(
        { slug: "mug", name: "แก้ว", description: "", price: "10", stock: "1" },
        new File(["x"], "a.png", { type: "image/png" }),
      ),
  ],
  ["setProductActiveAction", () => setProductActiveAction(PRODUCT_ID, false)],
  ["adjustStockAction", () => adjustStockAction(PRODUCT_ID, 5)],
  [
    "saveSettingsAction",
    () => saveSettingsAction({ shippingFee: "50", paymentWindowMinutes: "1440", contactUrl: "" }),
  ],
];

const actionModules = [
  "@/features/admin/order-actions",
  "@/features/admin/product-actions",
  "@/features/admin/settings-actions",
] as const;

const UNAUTHORIZED = { ok: false, code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบอีกครั้ง" };
const UNAVAILABLE = {
  ok: false,
  code: "SERVICE_UNAVAILABLE",
  message: "ระบบไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่อีกครั้ง",
};

function expectNoDataCall() {
  expect(mocks.createAdminClient).not.toHaveBeenCalled();
  expect(mocks.createServerSupabase).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.from).not.toHaveBeenCalled();
  expect(mocks.storageFrom).not.toHaveBeenCalled();
  expect(mocks.refresh).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("admin action guards", () => {
  it.each(actionModules)("covers every export of %s", async (module) => {
    const actions = await import(/* @vite-ignore */ module);
    const names = new Set(allAdminActions.map(([name]) => name));
    for (const name of Object.keys(actions)) expect(names, name).toContain(name);
  });

  it.each(allAdminActions)("%s refuses unauthorized callers", async (_, action) => {
    mocks.requireAdmin.mockResolvedValue(UNAUTHORIZED);
    expect(await action()).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
    expect(mocks.requireAdmin).toHaveBeenCalledTimes(1);
    expectNoDataCall();
  });

  it.each(allAdminActions)("%s passes on a failed admin lookup without touching data", async (_, action) => {
    mocks.requireAdmin.mockResolvedValue(UNAVAILABLE);
    expect(await action()).toEqual(UNAVAILABLE);
    expectNoDataCall();
  });

  it.each(allAdminActions)("%s checks the caller before reading its input", async (name) => {
    mocks.requireAdmin.mockResolvedValue(UNAUTHORIZED);
    const modules = await Promise.all(actionModules.map((module) => import(/* @vite-ignore */ module)));
    const actions = Object.assign({}, ...modules) as Record<string, (...args: unknown[]) => Promise<unknown>>;
    expect(await actions[name](null, { toString: () => "x" }, 7)).toMatchObject({ code: "UNAUTHORIZED" });
    expectNoDataCall();
  });
});
