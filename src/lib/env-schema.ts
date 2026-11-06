import { z } from "zod";

const required = z.string().min(1);

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: required,
  SUPABASE_SECRET_KEY: required,
  DATABASE_URL: required,
  PROMPTPAY_ID: required,
  ORDER_TOKEN_SECRET: required,
  RATE_LIMIT_SALT: required,
  CRON_SECRET: required,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(
  source: Record<string, string | undefined>,
): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    // Name the offending variables only; never echo their values.
    const names = [
      ...new Set(result.error.issues.map((i) => String(i.path[0]))),
    ];
    throw new Error(`Invalid server environment: ${names.join(", ")}`);
  }
  return result.data;
}
