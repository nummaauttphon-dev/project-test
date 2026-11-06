import { loadEnvFile } from "node:process";

// Integration tests run against the local Supabase stack.
loadEnvFile(".env.test.local");
