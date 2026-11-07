"use server";

import { refresh } from "next/cache";
import { fail, ok, type ActionResult } from "@/lib/result";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "./auth";
import { isOrderId, isOrderStatus } from "./queries";

/**
 * Admin order actions. Each one's first statement is requireAdmin(), before any argument is read:
 * tests/unit/admin-guards.test.ts holds every action to that.
 *
 * Status changes also take `expectedStatus`, the status the page showed when the admin decided.
 * transition_order refuses with STATUS_CHANGED if the order has moved on since, so a decision is
 * never applied to a state the admin did not see (e.g. cancelling a paid order without the refund
 * warning).
 */

type Status = "paid" | "awaiting_payment" | "shipped" | "cancelled";

const MESSAGES = {
  NOT_FOUND: "ไม่พบคำสั่งซื้อนี้ กรุณากลับไปที่รายการคำสั่งซื้อ",
  INVALID_TRANSITION:
    "สถานะคำสั่งซื้อเปลี่ยนไปแล้ว จึงทำรายการนี้ไม่ได้ อาจมีการดำเนินการจากหน้าอื่นไปก่อน กรุณาโหลดหน้าใหม่เพื่อดูสถานะล่าสุด",
  INVALID_STATUS: "แก้เลขพัสดุได้เฉพาะคำสั่งซื้อที่จัดส่งแล้ว กรุณาโหลดหน้าใหม่เพื่อดูสถานะล่าสุด",
  REASON_REQUIRED: "กรุณากรอกเหตุผลที่ปฏิเสธสลิป",
  STATUS_CHANGED:
    "สถานะคำสั่งซื้อเปลี่ยนไปแล้วหลังจากที่หน้านี้แสดงผล จึงยังไม่ได้ทำรายการนี้ กรุณาโหลดหน้าใหม่ ตรวจสถานะล่าสุด แล้วทำรายการอีกครั้งถ้ายังต้องการ",
  TRACKING_REQUIRED: "กรุณากรอกเลขพัสดุ",
  INVALID_REASON: "กรุณากรอกเหตุผลที่ปฏิเสธสลิป ไม่เกิน 500 ตัวอักษร",
  INVALID_TRACKING: "กรุณากรอกเลขพัสดุ ไม่เกิน 100 ตัวอักษร",
  ACTION_FAILED: "ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
} as const;

type KnownCode =
  | "NOT_FOUND"
  | "INVALID_TRANSITION"
  | "INVALID_STATUS"
  | "REASON_REQUIRED"
  | "TRACKING_REQUIRED"
  | "STATUS_CHANGED";

const KNOWN_CODES: readonly string[] = [
  "NOT_FOUND",
  "INVALID_TRANSITION",
  "INVALID_STATUS",
  "REASON_REQUIRED",
  "TRACKING_REQUIRED",
  "STATUS_CHANGED",
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

/** A page always knows the status it showed; without a valid one, the admin must reload. */
function statusChanged(): ActionResult<never> {
  return fail("STATUS_CHANGED", MESSAGES.STATUS_CHANGED);
}

export async function approveSlipAction(
  orderId: string,
  expectedStatus: string,
): Promise<ActionResult<{ status: Status }>> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;
  if (!isOrderId(orderId)) return notFound();
  if (!isOrderStatus(expectedStatus)) return statusChanged();
  return callDatabase("transition_order", {
    p_order_id: orderId,
    p_to: "paid",
    p_actor: admin.userId,
    p_expected_status: expectedStatus,
  });
}

/** The reason is shown to the customer as plain text, exactly as stored. */
export async function rejectSlipAction(
  orderId: string,
  reason: string,
  expectedStatus: string,
): Promise<ActionResult<{ status: Status }>> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;
  if (!isOrderId(orderId)) return notFound();
  if (!isOrderStatus(expectedStatus)) return statusChanged();
  const normalized = normalizeReason(reason);
  if (!normalized) return fail("INVALID_REASON", MESSAGES.INVALID_REASON, { reason: MESSAGES.INVALID_REASON });
  return callDatabase("transition_order", {
    p_order_id: orderId,
    p_to: "awaiting_payment",
    p_actor: admin.userId,
    p_reason: normalized,
    p_expected_status: expectedStatus,
  });
}

export async function shipOrderAction(
  orderId: string,
  tracking: string,
  expectedStatus: string,
): Promise<ActionResult<{ status: Status }>> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;
  if (!isOrderId(orderId)) return notFound();
  if (!isOrderStatus(expectedStatus)) return statusChanged();
  const normalized = normalizeTracking(tracking);
  if (!normalized) {
    return fail("INVALID_TRACKING", MESSAGES.INVALID_TRACKING, { tracking: MESSAGES.INVALID_TRACKING });
  }
  return callDatabase("transition_order", {
    p_order_id: orderId,
    p_to: "shipped",
    p_actor: admin.userId,
    p_tracking_number: normalized,
    p_expected_status: expectedStatus,
  });
}

/**
 * Cancelling a paid order refunds nothing: the page warns the admin before calling this, and the
 * expected status makes sure that warning matched the order's real state.
 */
export async function cancelOrderAction(
  orderId: string,
  expectedStatus: string,
): Promise<ActionResult<{ status: Status }>> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;
  if (!isOrderId(orderId)) return notFound();
  if (!isOrderStatus(expectedStatus)) return statusChanged();
  return callDatabase("transition_order", {
    p_order_id: orderId,
    p_to: "cancelled",
    p_actor: admin.userId,
    p_expected_status: expectedStatus,
  });
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
