// Creates the store's admin account, or grants admin rights to an existing account with that email.
// Safe to run again. An existing account keeps its password.
//
//   node --env-file=.env.local scripts/create-admin.mjs
//
// Required environment: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, ADMIN_EMAIL, ADMIN_PASSWORD.
// The admin then enrolls TOTP at /admin/mfa on first sign-in. This script prints no secrets.
import { createClient } from "@supabase/supabase-js";

const MIN_PASSWORD_LENGTH = 12;

function stop(message) {
  console.error(message);
  process.exit(1);
}

// A password on the command line would end up in shell history and process listings.
if (process.argv.length > 2) stop("This script takes no arguments; set values in the environment.");

const names = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "ADMIN_EMAIL", "ADMIN_PASSWORD"];
const missing = names.filter((name) => !process.env[name]);
if (missing.length > 0) stop(`Missing environment variables: ${missing.join(", ")}`);

const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SECRET_KEY: secretKey, ADMIN_EMAIL: email, ADMIN_PASSWORD: password } =
  process.env;
if (password.length < MIN_PASSWORD_LENGTH) stop(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);

const db = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUserId(address) {
  const wanted = address.toLowerCase();
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage });
    if (error) stop(`Could not list users (${error.code ?? error.status}).`);
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === wanted);
    if (user) return user.id;
    if (data.users.length < perPage) return null;
  }
}

const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error && created.error.code !== "email_exists") {
  stop(`Could not create the user (${created.error.code ?? created.error.status}).`);
}

const userId = created.error ? await findUserId(email) : created.data.user.id;
if (!userId) stop("The user exists but could not be found.");

const granted = await db.from("admins").upsert({ user_id: userId }, { onConflict: "user_id" });
if (granted.error) stop(`Could not grant admin rights (${granted.error.code}).`);

console.log(created.error ? "User already existed; password unchanged; admin rights are in place." : "Admin created.");
