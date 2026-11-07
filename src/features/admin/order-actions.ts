"use server";

import { refresh } from "next/cache";
import { fail, ok, type ActionResult } from "@/lib/result";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "./auth";
import { isOrderId } from "./queries";

/**
 * Admin order actions. Each one's first statement is requireAdmin(), before any argument is read:
 * tests/unit/admin-guards.test.ts holds every action to that.
 */

type Status = "paid" | "awaiting_payment" | "shipped" | "cancelled";

const MESSAGES = {
  NOT_FOUND: "ไม่พบคำสั่งซื้อนี้ กรุณากลับไปที่รายการคำสั่งซื้อ",
  INVALID_TRANSITION:
    "สถานะคำสั่งซื้อเปลี่ยนไปแล้ว จึงทำรายการนี้ไม่ได้ อาจมีการดำเนินการจากหน้าอื่นไปก่อน กรุณาโหลดหน้าใหม่เพื่อดูสถานะล่าสุด",
  INVALID_STATUS: "แก้เลขพัสดุได้เฉพาะคำสั่งซื้อที่จัดส่งแล้ว กรุณาโหลดหน้าใหม่เพื่อดูสถานะล่าสุด",
  REASON_REQUIRED: "กรุณากรอกเหตุผลที่ปฏิเสธสลิป",
  TRACKING_REQUIRED: "กรุณากรอกเลขพัสดุ",
  INVALID_REASON: "กรุณากรอกเหตุผลที่ปฏิเสธสลิป ไม่เกิน 500 ตัวอักษร",
  INVALID_TRACKING: "กรุณากรอกเลขพัสดุ ไม่เกิน 100 ตัวอักษร",
  ACTION_FAILED: "ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
} as const;

type KnownCode = "NOT_FOUND" | "INVALID_TRANSITION" | "INVALID_STATUS" | "REASON_REQUIRED" | "TRACKING_REQUIRED";

const KNOWN_CODES: readonly string[] = [
  "NOT_FOUND",
  "INVALID_TRANSITION",
  "INVALID_STATUS",
  "REASON_REQUIRED",
  "TRACKING_REQUIRED",
];

const MAX_REASON = 500;
const MAX_TRACKING = 100;

/** Only a short, code-shaped value is logged; anything else could carry customer data. */
function loggable(code: unknown): string {
  return typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code) ? code : "unexpected";
}

function length(text: string): number {
  return [...text].length;
}

/** Trims and collapses every run of Unicode whitespace (NBSP included) into one space. */
function normalizeReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reason = value.replace(/\s+/gu, " ").trim();
  return reason && length(reason) <= MAX_REASON ? reason : null;
}

function normalizeTracking(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const tracking = value.trim();
  return tracking && length(tracking) <= MAX_TRACKING ? tracking : null;
}

/** Calls a lifecycle function and turns its answer into an ActionResult with Thai text. */
async function callDatabase(
  fn: "transition_order" | "set_tracking_number",
  args: Record<string, string>,
): Promise<ActionResult<{ status: Status }>> {
  try {
    const { data, error } = await createAdminClient().rpc(fn, args);
    if (error) {
      console.error(`${fn} failed`, loggable(error.code));
      return fail("ACTION_FAILED", MESSAGES.ACTION_FAILED);
    }
    const result = data as { ok?: unknown; code?: unknown; status?: unknown } | null;
    if (result?.ok === true) {
      refresh();
      return ok({ status: result.status as Status });
    }
    if (typeof result?.code === "string" && KNOWN_CODES.includes(result.code)) {
      const code = result.code as KnownCode;
      return fail(code, MESSAGES[code]);
    }
    console.error(`${fn} refused`, loggable(result?.code));
    return fail("ACTION_FAILED", MESSAGES.ACTION_FAILED);
  } catch {
    console.error(`${fn} threw`);
    return fail("ACTION_FAILED", MESSAGES.ACTION_FAILED);
  }
}

function notFound(): ActionResult<never> {
  return fail("NOT_FOUND", MESSAGES.NOT_FOUND);
}

export async function approveSlipAction(orderId: string): Promise<ActionResult<{ status: Status }>> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;
  if (!isOrderId(orderId)) return notFound();
  return callDatabase("transition_order", { p_order_id: orderId, p_to: "paid", p_actor: admin.userId });
}

/** The reason is shown to the customer as plain text, exactly as stored. */
export async function rejectSlipAction(orderId: string, reason: string): Promise<ActionResult<{ status: Status }>> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;
  if (!isOrderId(orderId)) return notFound();
  const normalized = normalizeReason(reason);
  if (!normalized) return fail("INVALID_REASON", MESSAGES.INVALID_REASON, { reason: MESSAGES.INVALID_REASON });
  return callDatabase("transition_order", {
    p_order_id: orderId,
    p_to: "awaiting_payment",
    p_actor: admin.userId,
    p_reason: normalized,
  });
}

export async function shipOrderAction(orderId: string, tracking: string): Promise<ActionResult<{ status: Status }>> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;
  if (!isOrderId(orderId)) return notFound();
  const normalized = normalizeTracking(tracking);
  if (!normalized) {
    return fail("INVALID_TRACKING", MESSAGES.INVALID_TRACKING, { tracking: MESSAGES.INVALID_TRACKING });
  }
  return callDatabase("transition_order", {
    p_order_id: orderId,
    p_to: "shipped",
    p_actor: admin.userId,
    p_tracking_number: normalized,
  });
}

/** Cancelling a paid order refunds nothing: the page warns the admin before calling this. */
export async function cancelOrderAction(orderId: string): Promise<ActionResult<{ status: Status }>> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;
  if (!isOrderId(orderId)) return notFound();
  return callDatabase("transition_order", { p_order_id: orderId, p_to: "cancelled", p_actor: admin.userId });
}

export async function setTrackingAction(orderId: string, tracking: string): Promise<ActionResult<{ status: Status }>> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;
  if (!isOrderId(orderId)) return notFound();
  const normalized = normalizeTracking(tracking);
  if (!normalized) {
    return fail("INVALID_TRACKING", MESSAGES.INVALID_TRACKING, { tracking: MESSAGES.INVALID_TRACKING });
  }
  return callDatabase("set_tracking_number", { p_order_id: orderId, p_tracking_number: normalized });
}
