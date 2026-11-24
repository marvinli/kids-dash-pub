import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "happy-dom",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/dev.ts", "src/test-bundle.ts"],
      thresholds: { lines: 95, functions: 95, branches: 85, statements: 95 },
    },
  },
});
