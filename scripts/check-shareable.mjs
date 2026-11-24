// Audit source files only; do not walk ignored configs, build outputs or local/.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deploymentFindings, privatePath } from "./shareable.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  {
    cwd: root,
    encoding: "utf8",
  },
)
  .split("\0")
  .filter(Boolean);
let failures = 0;
for (const file of new Set(files)) {
  if (privatePath(file)) {
    console.error(`${file}: private file must stay untracked`);
    failures++;
    continue;
  }
  let bytes;
  try {
    bytes = readFileSync(join(root, file));
  } catch (error) {
    if (error.code === "ENOENT") continue; // A working-tree deletion.
    throw error;
  }
  if (bytes.includes(0)) continue; // Binary art is inspected separately.
  for (const finding of deploymentFindings(bytes.toString("utf8"))) {
    console.error(`${file}: ${finding}`);
    failures++;
  }
}
if (failures) process.exitCode = 1;
else console.log("Shareability check passed (source files; no ignored private files read).");
