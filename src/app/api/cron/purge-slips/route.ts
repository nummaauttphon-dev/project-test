import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { purgeExpiredSlips } from "@/features/orders/purge-slips";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

// A cron run must never be prerendered or served from a cache.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function unauthorized(): Response {
  return new Response(null, { status: 401, headers: NO_STORE });
}

/** Vercel Cron sends GET with `Authorization: Bearer <CRON_SECRET>` when that variable is set. */
function isAuthorized(request: Request, secret: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  // Hash both sides so the comparison is constant time and length-independent.
  const given = createHash("sha256").update(header).digest();
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(given, expected);
}

export async function GET(request: Request): Promise<Response> {
  let secret: string;
  try {
    secret = serverEnv().CRON_SECRET;
  } catch {
    console.error("purge-slips: server environment invalid");
    return unauthorized();
  }
  if (!isAuthorized(request, secret)) return unauthorized();

  try {
    const result = await purgeExpiredSlips(createAdminClient(), new Date());
    console.info("purge-slips", result);
    return Response.json(result, { headers: NO_STORE });
  } catch {
    console.error("purge-slips: run failed");
    return Response.json({ error: "failed" }, { status: 500, headers: NO_STORE });
  }
}

// Every other method is refused the same way as a bad secret.
export const HEAD = async (): Promise<Response> => unauthorized();
export const POST = HEAD;
export const PUT = HEAD;
export const PATCH = HEAD;
export const DELETE = HEAD;
export const OPTIONS = HEAD;
