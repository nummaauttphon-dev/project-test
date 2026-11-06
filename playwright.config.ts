import { loadEnvFile } from "node:process";
import { defineConfig, devices } from "@playwright/test";

// Seeding helpers read the Supabase variables from the environment.
loadEnvFile(".env.test.local");

const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: `http://localhost:${PORT}`, locale: "th-TH" },
  // Mobile first: every spec runs at a phone viewport.
  projects: [{ name: "mobile-chromium", use: { ...devices["Pixel 7"] } }],
  webServer: {
    // Env comes from loadEnvFile above (inherited by the child); node --env-file breaks next build workers.
    command: `node node_modules/next/dist/bin/next build && node node_modules/next/dist/bin/next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 300000,
  },
});
