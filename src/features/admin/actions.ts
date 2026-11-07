"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { renderQrDataUrl } from "@/lib/promptpay";
import { fail, ok, type ActionResult } from "@/lib/result";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { STORE_NAME } from "@/lib/store-config";
import { adminPathFor, getAdminContext, lookupAdmin, signOutCurrentSession } from "./auth";
import { ADMIN_MESSAGES, loginFailure, mfaFailure } from "./auth-messages";

const DENIED_PATH = "/admin/login?error=denied";

const loginSchema = z.object({
  email: z.string().trim().max(254).pipe(z.email()),
  password: z.string().min(1).max(1024),
});

const codeSchema = z.string().regex(/^\d{6}$/);

function failure({ code, message }: { code: string; message: string }): ActionResult<never> {
  return fail(code, message);
}

export async function loginAction(_previous: ActionResult<never> | null, formData: FormData): Promise<ActionResult<never>> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return fail("INVALID_CREDENTIALS", ADMIN_MESSAGES.LOGIN_FAILED);

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return failure(loginFailure(error));

  const lookup = await lookupAdmin(createAdminClient(), data.user.id);
  if (lookup !== "admin") {
    // Only this new session ends; a failed lookup says nothing about the user's rights.
    await signOutCurrentSession("local");
    return lookup === "error"
      ? fail("SERVICE_UNAVAILABLE", ADMIN_MESSAGES.SERVICE_UNAVAILABLE)
      : fail("INVALID_CREDENTIALS", ADMIN_MESSAGES.LOGIN_FAILED);
  }
  redirect("/admin/mfa");
}

export async function signOutAction(): Promise<void> {
  await signOutCurrentSession("global");
  redirect("/admin/login");
}

/**
 * MFA actions run only for an admin who has passed the password step. The page checks too, but it
 * may have rendered before the state changed. Signing out happens here rather than through
 * `/admin/not-admin`: Next.js follows an action's redirect on the server, which would lose the
 * cookies that route clears.
 */
async function requireMfaPending(): Promise<void> {
  const { state } = await getAdminContext();
  if (state === "mfa_required") return;
  if (state === "not_admin") {
    await signOutCurrentSession("local");
    redirect(DENIED_PATH);
  }
  redirect(adminPathFor(state));
}

export type TotpEnrollment = { qrCode: string; secret: string };

/** Starts over on every visit: a secret cannot be read back, so an abandoned factor is useless. */
export async function startTotpEnrollmentAction(): Promise<ActionResult<TotpEnrollment>> {
  await requireMfaPending();

  const supabase = await createServerSupabase();
  const factors = await supabase.auth.mfa.listFactors();
  if (factors.error) return failure(mfaFailure(factors.error));
  // Enrolled in another tab: the page now shows the challenge instead.
  if (factors.data.totp.length > 0) redirect("/admin/mfa");

  for (const factor of factors.data.all) {
    if (factor.factor_type !== "totp") continue;
    const removed = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (removed.error) return failure(mfaFailure(removed.error));
  }

  const enrolled = await supabase.auth.mfa.enroll({ factorType: "totp", issuer: STORE_NAME });
  if (enrolled.error) return failure(mfaFailure(enrolled.error));

  const { secret, uri } = enrolled.data.totp;
  return ok({ secret, qrCode: await renderQrDataUrl(uri) });
}

/** Answers the verified factor's challenge or, during enrollment, verifies the newest factor. */
export async function verifyTotpAction(_previous: ActionResult<never> | null, formData: FormData): Promise<ActionResult<never>> {
  await requireMfaPending();

  const code = codeSchema.safeParse(String(formData.get("code") ?? "").replace(/\s/g, ""));
  if (!code.success) return fail("INVALID_CODE", ADMIN_MESSAGES.MFA_CODE_FORMAT);

  const supabase = await createServerSupabase();
  const factors = await supabase.auth.mfa.listFactors();
  if (factors.error) return failure(mfaFailure(factors.error));

  const pending = factors.data.all
    .filter((factor) => factor.factor_type === "totp")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const factorId = factors.data.totp[0]?.id ?? pending[0]?.id;
  if (!factorId) return fail("MFA_RESTART", ADMIN_MESSAGES.MFA_RESTART);

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.data });
  if (error) return failure(mfaFailure(error));
  redirect("/admin");
}
