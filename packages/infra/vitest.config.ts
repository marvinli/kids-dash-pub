import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    // Synthesizing bundles every Lambda with esbuild; give it room. The synth
    // runs in beforeAll, so hooks need the room too (CI runners are slower).
    testTimeout: 60_000,
    hookTimeout: 120_000,
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      exclude: ["lib/**/*.test.ts"],
      thresholds: { lines: 95, functions: 95, branches: 85, statements: 95 },
    },
  },
});
