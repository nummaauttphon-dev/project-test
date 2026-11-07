import { notFound } from "next/navigation";
import { requireAdminPage } from "@/features/admin/auth";

/** Unknown admin URLs answer like every other admin route, so visitors cannot probe which exist. */
export default async function UnknownAdminPage() {
  await requireAdminPage();
  notFound();
}
