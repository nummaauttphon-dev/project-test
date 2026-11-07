import { requireAdminPage } from "@/features/admin/auth";

/** Placeholder: Task 11 replaces this with the real dashboard. */
export default async function AdminDashboardPage() {
  await requireAdminPage();
  return <h1 className="text-2xl font-bold">แดชบอร์ด</h1>;
}
