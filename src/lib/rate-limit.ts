import "server-only";
import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type RateLimitAction = "place_order" | "submit_slip";

export const RATE_LIMITS: Record<RateLimitAction, { limit: number; windowSeconds: number }> = {
  place_order: { limit: 10, windowSeconds: 3600 },
  submit_slip: { limit: 10, windowSeconds: 3600 },
};

/**
 * Counts one attempt and returns whether it is allowed. Only an HMAC of the subject (an IP or an
 * order id) reaches the database. Fails closed: any error denies, and nothing is logged, because
 * the error could echo the key.
 */
export async function isAllowed(
  client: SupabaseClient,
  action: RateLimitAction,
  subject: string,
  salt: string,
): Promise<boolean> {
  const { limit, windowSeconds } = RATE_LIMITS[action];
  const keyHash = createHmac("sha256", salt).update(subject).digest("hex");
  try {
    const { data, error } = await client.rpc("check_rate_limit", {
      p_key_hash: keyHash,
      p_action: action,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    return !error && data === true;
  } catch {
    return false;
  }
}
