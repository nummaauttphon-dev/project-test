"use server";

import { serverEnv } from "@/lib/env";
import { fail, type ActionResult } from "@/lib/result";
import { createAdminClient } from "@/lib/supabase/admin";
import { SLIP_MESSAGES } from "./slip-messages";
import { submitSlip } from "./submit-slip";

/** Rate limiting here is per order, so unlike checkout this needs no client IP. */
export async function submitSlipAction(formData: FormData): Promise<ActionResult<{ status: "payment_review" }>> {
  try {
    const token = formData.get("token");
    const slip = formData.get("slip");
    if (typeof token !== "string" || !token) return fail("NOT_FOUND", SLIP_MESSAGES.NOT_FOUND);
    if (!(slip instanceof File)) return fail("UNSUPPORTED_TYPE", "กรุณาเลือกไฟล์สลิปก่อนกดส่ง");
    return await submitSlip(token, slip, {
      client: createAdminClient(),
      rateLimitSalt: serverEnv().RATE_LIMIT_SALT,
    });
  } catch {
    console.error("submitSlipAction failed");
    return fail("UPLOAD_FAILED", SLIP_MESSAGES.UPLOAD_FAILED);
  }
}
