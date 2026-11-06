import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const out = execSync("npx supabase status -o env", { encoding: "utf8" });
const status = {};
for (const line of out.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m) status[m[1]] = m[2];
}

const pick = (...names) => {
  for (const n of names) if (status[n]) return status[n];
  throw new Error(`supabase status is missing ${names.join(" / ")}`);
};
const secret = () => randomBytes(32).toString("hex");

const env = {
  NEXT_PUBLIC_SUPABASE_URL: pick("API_URL"),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: pick("PUBLISHABLE_KEY", "ANON_KEY"),
  SUPABASE_SECRET_KEY: pick("SECRET_KEY", "SERVICE_ROLE_KEY"),
  DATABASE_URL: pick("DB_URL"),
  PROMPTPAY_ID: "0812345678",
  ORDER_TOKEN_SECRET: secret(),
  RATE_LIMIT_SALT: secret(),
  CRON_SECRET: secret(),
};

writeFileSync(
  ".env.test.local",
  Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n",
);
console.log("Wrote .env.test.local");
