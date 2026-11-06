"use server";

import { headers } from "next/headers";
import { serverEnv } from "@/lib/env";
import { fail, type ActionResult } from "@/lib/result";
import { createAdminClient } from "@/lib/supabase/admin";
import { placeOrder, type PlaceOrderData } from "./place-order";

export async function placeOrderAction(input: unknown): Promise<ActionResult<PlaceOrderData>> {
  try {
    const h = await headers();
    const ip = h.get("x-real-ip")?.trim() || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
    const env = serverEnv();
    return await placeOrder(input, {
      client: createAdminClient(),
      ip,
      tokenSecret: env.ORDER_TOKEN_SECRET,
      rateLimitSalt: env.RATE_LIMIT_SALT,
    });
  } catch {
    console.error("placeOrderAction failed");
    return fail("UNEXPECTED", "ไม่สามารถสั่งซื้อได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง");
  }
}
