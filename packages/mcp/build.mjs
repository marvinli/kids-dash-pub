// Bundles the two entry points (with @kids-dash/core) into dist/ so agents can
// run the MCP with plain `node`, no TypeScript toolchain at runtime.
import { build } from "esbuild";

await build({
  entryPoints: ["src/server.ts", "src/cli.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
