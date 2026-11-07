import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminSignOutButton } from "@/components/admin-sign-out-button";
import { MfaCodeForm, MfaEnrollment } from "@/components/admin-mfa-forms";
import { adminPathFor, getAdminContext } from "@/features/admin/auth";
import { ADMIN_MESSAGES } from "@/features/admin/auth-messages";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "ยืนยันตัวตนสองขั้นตอน" };

export default async function AdminMfaPage() {
  const { state } = await getAdminContext();
  if (state !== "mfa_required") redirect(adminPathFor(state));

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.mfa.listFactors();

  return (
    <main id="main" className="mx-auto w-full max-w-md flex-1 space-y-6 px-4 py-10">
      <h1 className="text-2xl font-bold">ยืนยันตัวตนสองขั้นตอน</h1>
      {error ? (
        <p role="alert" className="rounded-lg border border-danger-ink bg-danger-bg p-3 text-danger-ink">
          {ADMIN_MESSAGES.SERVICE_UNAVAILABLE}
        </p>
      ) : data.totp.length > 0 ? (
        <>
          <p>กรอกรหัส 6 หลักจากแอปยืนยันตัวตนของคุณ</p>
          <MfaCodeForm />
        </>
      ) : (
        <MfaEnrollment />
      )}
      <AdminSignOutButton />
    </main>
  );
}
