import type { Metadata } from "next";
import { AdminSignOutButton } from "@/components/admin-sign-out-button";
import { requireAdminPage } from "@/features/admin/auth";

export const metadata: Metadata = { title: { default: "หลังร้าน", template: "%s | หลังร้าน" } };

export default async function ProtectedAdminLayout({ children }: LayoutProps<"/admin">) {
  await requireAdminPage();
  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <p className="text-xl font-bold tracking-tight text-brand">หลังร้าน</p>
          <AdminSignOutButton />
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:py-10">
        {children}
      </main>
    </>
  );
}
