import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

for (const command of ["install", "provision", "screenshot", "owner"]) {
  test(`${command} refuses to contact a device without an explicit FRAME_ADB`, () => {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./frame.mjs", import.meta.url)), command],
      {
        env: { ...process.env, FRAME_ADB: "" },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Set FRAME_ADB/);
    assert.equal(result.stdout, "");
  });
}
