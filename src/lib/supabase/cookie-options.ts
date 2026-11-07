import type { CookieOptionsWithName } from "@supabase/ssr";

/**
 * Options for the auth cookies. Only the admin area has a session and every Supabase call happens
 * on the server, so the cookies stay on `/admin` and out of reach of browser scripts. The path also
 * keeps storefront pages from seeing a session: their cookie-aware client would refresh an expired
 * token during render, where the rotated token cannot be saved, and end the admin's session.
 */
export function authCookieOptions(): CookieOptionsWithName {
  return {
    path: "/admin",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  };
}
