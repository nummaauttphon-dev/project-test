import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const rpc = vi.fn();
  return {
    rpc,
    requireAdmin: vi.fn(),
    createAdminClient: vi.fn(() => ({ rpc })),
    refresh: vi.fn(),
  };
});

vi.mock("@/features/admin/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("next/cache", () => ({ refresh: mocks.refresh }));

import {
  approveSlipAction,
  cancelOrderAction,
  rejectSlipAction,
  setTrackingAction,
  shipOrderAction,
} from "@/features/admin/order-actions";

const ORDER_ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const ADMIN_ID = "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
const THAI = /[฀-๿]/;

function answer(data: unknown, error: unknown = null) {
  mocks.rpc.mockResolvedValue({ data, error });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ ok: true, userId: ADMIN_ID });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("calls into the database", () => {
  it("approves as the signed-in admin and refreshes the page", async () => {
    answer({ ok: true, status: "paid" });
    expect(await approveSlipAction(ORDER_ID)).toEqual({ ok: true, data: { status: "paid" } });
    expect(mocks.rpc).toHaveBeenCalledWith("transition_order", {
      p_order_id: ORDER_ID,
      p_to: "paid",
      p_actor: ADMIN_ID,
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("rejects with the normalized reason as the signed-in admin", async () => {
    answer({ ok: true, status: "awaiting_payment" });
    const result = await rejectSlipAction(ORDER_ID, "  ยอดเงิน  ไม่ตรง\n\t<b>โอนขาด</b>　 ");
    expect(result).toEqual({ ok: true, data: { status: "awaiting_payment" } });
    expect(mocks.rpc).toHaveBeenCalledWith("transition_order", {
      p_order_id: ORDER_ID,
      p_to: "awaiting_payment",
      p_actor: ADMIN_ID,
      p_reason: "ยอดเงิน ไม่ตรง <b>โอนขาด</b>",
    });
  });

  it("cancels as the signed-in admin", async () => {
    answer({ ok: true, status: "cancelled" });
    expect(await cancelOrderAction(ORDER_ID)).toMatchObject({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith("transition_order", {
      p_order_id: ORDER_ID,
      p_to: "cancelled",
      p_actor: ADMIN_ID,
    });
  });

  it("ships with the trimmed tracking number", async () => {
    answer({ ok: true, status: "shipped" });
    expect(await shipOrderAction(ORDER_ID, "  TH1234567890 ")).toMatchObject({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith("transition_order", {
      p_order_id: ORDER_ID,
      p_to: "shipped",
      p_actor: ADMIN_ID,
      p_tracking_number: "TH1234567890",
    });
  });

  it("corrects the tracking number through set_tracking_number", async () => {
    answer({ ok: true, status: "shipped" });
    expect(await setTrackingAction(ORDER_ID, " TH0987654321 ")).toMatchObject({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith("set_tracking_number", {
      p_order_id: ORDER_ID,
      p_tracking_number: "TH0987654321",
    });
  });
});

describe("input checks", () => {
  it.each([
    ["empty", ""],
    ["only whitespace and NBSP", "   \n "],
    ["501 characters", "ก".repeat(501)],
    ["not a string", 42],
  ])("refuses a reject reason that is %s without calling the database", async (_, reason) => {
    const result = await rejectSlipAction(ORDER_ID, reason as string);
    expect(result).toMatchObject({ ok: false, code: "INVALID_REASON" });
    if (!result.ok) {
      expect(result.message).toMatch(THAI);
      expect(result.fieldErrors?.reason).toMatch(THAI);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("accepts a reason of exactly 500 characters after collapsing whitespace", async () => {
    answer({ ok: true, status: "awaiting_payment" });
    const reason = `  ${"ก".repeat(250)}   ${"ข".repeat(249)}  `;
    expect(await rejectSlipAction(ORDER_ID, reason)).toMatchObject({ ok: true });
    expect(mocks.rpc.mock.calls[0][1].p_reason).toHaveLength(500);
  });

  it.each([
    ["ship", (tracking: unknown) => shipOrderAction(ORDER_ID, tracking as string)],
    ["set tracking", (tracking: unknown) => setTrackingAction(ORDER_ID, tracking as string)],
  ])("%s refuses a blank, overlong or non-string tracking number", async (_, call) => {
    for (const tracking of ["", "   ", "A".repeat(101), undefined]) {
      const result = await call(tracking);
      expect(result).toMatchObject({ ok: false, code: "INVALID_TRACKING" });
      if (!result.ok) expect(result.fieldErrors?.tracking).toMatch(THAI);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("accepts a tracking number of exactly 100 characters", async () => {
    answer({ ok: true, status: "shipped" });
    expect(await shipOrderAction(ORDER_ID, ` ${"A".repeat(100)} `)).toMatchObject({ ok: true });
  });

  it("answers a malformed order id as not found without calling the database", async () => {
    for (const id of ["", "not-a-uuid", `${ORDER_ID}x`, 7]) {
      expect(await approveSlipAction(id as string)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("result codes", () => {
  it.each(["NOT_FOUND", "INVALID_TRANSITION", "INVALID_STATUS", "REASON_REQUIRED", "TRACKING_REQUIRED"])(
    "maps %s to Thai text and keeps the code",
    async (code) => {
      answer({ ok: false, code });
      const result = await cancelOrderAction(ORDER_ID);
      expect(result).toMatchObject({ ok: false, code });
      if (!result.ok) expect(result.message).toMatch(THAI);
      expect(mocks.refresh).not.toHaveBeenCalled();
    },
  );

  it("answers an unknown code with a generic Thai error and logs the code only", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    answer({ ok: false, code: "SOMETHING_NEW" });
    const result = await approveSlipAction(ORDER_ID);
    expect(result).toMatchObject({ ok: false, code: "ACTION_FAILED" });
    if (!result.ok) expect(result.message).toMatch(THAI);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]).toEqual(["transition_order refused", "SOMETHING_NEW"]);
  });

  it("does not log an unexpected value in place of a code", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    answer({ ok: false, code: "0812345678 123 ถนนทดสอบ" });
    expect(await approveSlipAction(ORDER_ID)).toMatchObject({ ok: false, code: "ACTION_FAILED" });
    expect(error.mock.calls.flat().join(" ")).not.toContain("0812345678");
  });

  it("answers a database error with a generic Thai error and logs its code only", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    answer(null, { code: "22P02", message: "invalid input syntax near 0812345678" });
    const result = await shipOrderAction(ORDER_ID, "TH1");
    expect(result).toMatchObject({ ok: false, code: "ACTION_FAILED" });
    expect(error.mock.calls.flat().join(" ")).not.toContain("0812345678");
    expect(error.mock.calls[0]).toEqual(["transition_order failed", "22P02"]);
  });

  it("answers a thrown request with a generic Thai error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockRejectedValue(new Error("fetch failed"));
    expect(await setTrackingAction(ORDER_ID, "TH1")).toMatchObject({ ok: false, code: "ACTION_FAILED" });
  });
});
