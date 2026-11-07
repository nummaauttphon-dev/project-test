import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminLoginForm } from "@/components/admin-login-form";
import { adminPathFor, getAdminContext } from "@/features/admin/auth";
import { ADMIN_MESSAGES } from "@/features/admin/auth-messages";

export const metadata: Metadata = { title: "เข้าสู่ระบบแอดมิน" };

export default async function AdminLoginPage({ searchParams }: PageProps<"/admin/login">) {
  const { state } = await getAdminContext();
  if (state !== "anonymous") redirect(adminPathFor(state));

  const { error } = await searchParams;
  return (
    <main id="main" className="mx-auto w-full max-w-md flex-1 px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold">เข้าสู่ระบบแอดมิน</h1>
      <AdminLoginForm initialError={error === "denied" ? ADMIN_MESSAGES.LOGIN_FAILED : undefined} />
    </main>
  );
}
