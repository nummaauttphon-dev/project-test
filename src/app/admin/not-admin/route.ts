import { redirect } from "next/navigation";
import { getAdminContext, signOutCurrentSession } from "@/features/admin/auth";

/**
 * Pages cannot clear cookies, so they send a signed-in non-admin here. The state is checked again,
 * which leaves a link to this GET route unable to sign a real admin out.
 */
export async function GET() {
  const { state } = await getAdminContext();
  if (state !== "not_admin") redirect("/admin/login");
  await signOutCurrentSession("local");
  redirect("/admin/login?error=denied");
}
