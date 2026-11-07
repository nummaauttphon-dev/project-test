import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { fail, type ActionResult } from "@/lib/result";
import { createAdminClient } from "@/lib/supabase/admin";
import { authCookieOptions } from "@/lib/supabase/cookie-options";
import { createServerSupabase } from "@/lib/supabase/server";
import { ADMIN_MESSAGES } from "./auth-messages";

export type AdminState = "anonymous" | "not_admin" | "unavailable" | "mfa_required" | "ok";

export type AdminLookup = "admin" | "not_admin" | "error";

/**
 * Whether the user has an admins row. A failed lookup is "error", which is neither: it must not be
 * taken as allowed, and must not be taken as "no rights" either, which would sign a real admin out.
 */
export async function lookupAdmin(client: SupabaseClient, userId: string): Promise<AdminLookup> {
  try {
    const { data, error } = await client.from("admins").select("user_id").eq("user_id", userId).maybeSingle();
    if (error) {
      console.error("admins lookup failed", error.code);
      return "error";
    }
    return data === null ? "not_admin" : "admin";
  } catch {
    console.error("admins lookup failed");
    return "error";
  }
}

/** A failed lookup counts as not admin, never as allowed. */
export async function isAdminUser(client: SupabaseClient, userId: string): Promise<boolean> {
  return (await lookupAdmin(client, userId)) === "admin";
}

export async function getAdminContext(): Promise<{ state: AdminState; userId?: string }> {
  // Outside the try: cookies() signals dynamic rendering by throwing, which must reach Next.js.
  const supabase = await createServerSupabase();
  let claims;
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error) return { state: "anonymous" };
    claims = data?.claims;
  } catch (error) {
    unstable_rethrow(error);
    console.error("session check failed");
    return { state: "anonymous" };
  }
  if (!claims?.sub) return { state: "anonymous" };

  const userId = claims.sub;
  const lookup = await lookupAdmin(createAdminClient(), userId);
  if (lookup === "error") return { state: "unavailable", userId };
  if (lookup === "not_admin") return { state: "not_admin", userId };
  if (claims.aal !== "aal2") return { state: "mfa_required", userId };
  return { state: "ok", userId };
}

/** The first line of every admin Server Action. */
export async function requireAdmin(): Promise<
  { ok: true; userId: string } | Extract<ActionResult<never>, { ok: false }>
> {
  const { state, userId } = await getAdminContext();
  if (state === "ok" && userId) return { ok: true, userId };
  if (state === "unavailable") {
    return fail("SERVICE_UNAVAILABLE", ADMIN_MESSAGES.SERVICE_UNAVAILABLE) as Extract<
      ActionResult<never>,
      { ok: false }
    >;
  }
  return fail("UNAUTHORIZED", ADMIN_MESSAGES.UNAUTHORIZED) as Extract<ActionResult<never>, { ok: false }>;
}

/**
 * Where each state belongs. `/admin/not-admin` signs the user out, which a page render cannot do;
 * `/admin/unavailable` asks to try again and leaves the session alone.
 */
export function adminPathFor(state: AdminState): string {
  switch (state) {
    case "anonymous":
      return "/admin/login";
    case "not_admin":
      return "/admin/not-admin";
    case "unavailable":
      return "/admin/unavailable";
    case "mfa_required":
      return "/admin/mfa";
    case "ok":
      return "/admin";
  }
}

/**
 * The guard for protected layouts and pages. The layout's call is not enough for a page: a layout
 * does not run again on client-side navigation, so a page that reads data must call this itself.
 */
export async function requireAdminPage(): Promise<{ userId: string }> {
  const { state, userId } = await getAdminContext();
  if (state !== "ok" || !userId) redirect(adminPathFor(state));
  return { userId };
}

/**
 * Ends the session. "local" ends only this browser's session and is the one to use for a user
 * without admin rights; "global" also ends the user's sessions elsewhere. Supabase leaves the
 * cookies in place when it cannot be reached, so they are then removed here: this browser must be
 * signed out either way.
 */
export async function signOutCurrentSession(scope: "local" | "global"): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signOut({ scope });
  if (!error) return;
  console.error("sign out failed", error.code);
  const cookieStore = await cookies();
  for (const { name } of cookieStore.getAll()) {
    if (name.startsWith("sb-")) cookieStore.delete({ name, path: authCookieOptions().path });
  }
}
