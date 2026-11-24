import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Entry points only parse argv/env and connect stdio; covered by the smoke run.
      exclude: ["src/**/*.test.ts", "src/server.ts", "src/cli.ts"],
      thresholds: { lines: 95, functions: 95, branches: 85, statements: 95 },
    },
  },
});
