import type { Metadata } from "next";
import { AdminNav } from "@/components/admin-nav";
import { AdminSignOutButton } from "@/components/admin-sign-out-button";
import { requireAdminPage } from "@/features/admin/auth";

export const metadata: Metadata = { title: { default: "หลังร้าน", template: "%s | หลังร้าน" } };

export default async function ProtectedAdminLayout({ children }: LayoutProps<"/admin">) {
  await requireAdminPage();
  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="text-xl font-bold tracking-tight text-brand">หลังร้าน</p>
            <AdminNav />
          </div>
          <AdminSignOutButton />
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:py-10">
        {children}
      </main>
    </>
  );
}
