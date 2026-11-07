import "server-only";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "../env";
import { authCookieOptions } from "./cookie-options";

/**
 * Refreshes the session before the page renders, because Server Components cannot save cookies.
 * This is not an authorization check: pages and actions decide access through getAdminContext.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const env = serverEnv();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: authCookieOptions(),
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet, headers) => {
          // On the request for the page rendered next, on the response for the browser.
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
          for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
        },
      },
    },
  );

  try {
    await supabase.auth.getClaims();
  } catch {
    // The page's own check still runs and fails closed.
    console.error("session refresh failed");
  }
  return response;
}
