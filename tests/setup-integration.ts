import { loadEnvFile } from "node:process";
import { waitForApiReady } from "./helpers/ready";

// Integration tests run against the local Supabase stack.
loadEnvFile(".env.test.local");

await waitForApiReady();
