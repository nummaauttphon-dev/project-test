import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const alias = {
  "@": path.resolve(import.meta.dirname, "src"),
  "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
};

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        resolve: { alias },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.{ts,tsx}"],
          environment: "node",
        },
      },
      {
        extends: true,
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          fileParallelism: false,
          testTimeout: 30000,
          setupFiles: ["tests/setup-integration.ts"],
        },
      },
    ],
  },
});
