import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { adminPathFor, getAdminContext } from "@/features/admin/auth";
import { ADMIN_MESSAGES } from "@/features/admin/auth-messages";

export const metadata: Metadata = { title: "ระบบไม่พร้อมใช้งาน" };

/**
 * Shown when admin rights could not be checked. The session is left alone: the check failed, which
 * says nothing about the user's rights, so trying again may simply work.
 */
export default async function AdminUnavailablePage() {
  const { state } = await getAdminContext();
  if (state !== "unavailable") redirect(adminPathFor(state));

  return (
    <main id="main" className="mx-auto w-full max-w-md flex-1 space-y-6 px-4 py-10">
      <h1 className="text-2xl font-bold">ตรวจสอบสิทธิ์ไม่สำเร็จ</h1>
      <p role="alert" className="rounded-lg border border-danger-ink bg-danger-bg p-3 text-danger-ink">
        {ADMIN_MESSAGES.SERVICE_UNAVAILABLE}
      </p>
      <Link
        href="/admin"
        className="inline-flex min-h-12 items-center rounded-full bg-brand px-6 text-lg font-semibold text-on-brand hover:bg-brand-hover"
      >
        ลองใหม่อีกครั้ง
      </Link>
    </main>
  );
}
