"use server";

import { revalidatePath } from "next/cache";
import { fail, ok, type ActionResult } from "@/lib/result";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "./auth";
import { validateSettingsInput } from "./validation";

const MESSAGES = {
  INVALID_INPUT: "กรุณาตรวจสอบข้อมูลที่กรอก แล้วลองบันทึกอีกครั้ง",
  SAVE_FAILED: "บันทึกการตั้งค่าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
} as const;

export type SettingsInput = {
  /** Baht as typed, up to two decimals. */
  shippingFee: string;
  /** Whole minutes as typed. */
  paymentWindowMinutes: string;
  contactUrl: string;
};

/** There is no PromptPay field on purpose: the receiving account lives in a server environment variable. */
export async function saveSettingsAction(input: SettingsInput): Promise<ActionResult<{ saved: true }>> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;

  const checked = validateSettingsInput(input);
  if (!checked.ok) return fail("INVALID_INPUT", MESSAGES.INVALID_INPUT, checked.fieldErrors);

  try {
    const { data, error } = await createAdminClient()
      .from("store_settings")
      .update({
        shipping_fee_satang: checked.value.shippingFeeSatang,
        payment_window_minutes: checked.value.paymentWindowMinutes,
        contact_url: checked.value.contactUrl,
      })
      .eq("id", 1)
      .select("id")
      .maybeSingle();
    if (error || !data) {
      console.error("saveSettings failed", error?.code ?? "no row");
      return fail("SAVE_FAILED", MESSAGES.SAVE_FAILED);
    }
    revalidatePath("/cart");
    revalidatePath("/checkout");
    revalidatePath("/admin/settings");
    return ok({ saved: true });
  } catch {
    console.error("saveSettings threw");
    return fail("SAVE_FAILED", MESSAGES.SAVE_FAILED);
  }
}
