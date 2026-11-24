import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readFrameConfig, toolPaths } from "./config.mjs";

test("tool paths support standard environment variables and explicit overrides", () => {
  assert.deepEqual(toolPaths({ JAVA_HOME: "/jdk", ANDROID_HOME: "/sdk" }), {
    jdk: "/jdk",
    sdk: "/sdk",
  });
  assert.equal(toolPaths({ ANDROID_SDK_ROOT: "/sdk-root" }).sdk, "/sdk-root");
  assert.deepEqual(
    toolPaths({
      JAVA_17_HOME: "/jdk17",
      JAVA_HOME: "/other-jdk",
      ANDROID_SDK: "/custom-sdk",
      ANDROID_HOME: "/other-sdk",
    }),
    { jdk: "/jdk17", sdk: "/custom-sdk" },
  );
});

test("frame config rejects placeholders and incompatible keys before building", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "kids-dash-config-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "frame.config.json");
  assert.throws(() => readFrameConfig(path), /Copy frame.config.example.json/);
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const config = {
    apiUrl: "https://api.example.com",
    keyId: "example-key-id",
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
  };
  const read = (overrides = {}) => {
    writeFileSync(path, JSON.stringify({ ...config, ...overrides }));
    return readFrameConfig(path);
  };
  assert.equal(
    read().publicKey,
    publicKey.export({ type: "spki", format: "der" }).toString("base64"),
  );
  for (const apiUrl of [
    "<ApiUrl>",
    "https://<api-id>.execute-api.<region>.amazonaws.com",
    "http://api.example.com",
  ]) {
    assert.throws(() => read({ apiUrl }), /apiUrl/);
  }
  for (const keyId of ["<keyId>", "", 42, null]) {
    assert.throws(() => read({ keyId }), /keyId/);
  }
  assert.throws(() => read({ publicKeyPem: "<publicKeyPem>" }), /PEM/);
  const other = generateKeyPairSync("ec", { namedCurve: "secp384r1" });
  assert.throws(
    () => read({ publicKeyPem: other.publicKey.export({ type: "spki", format: "pem" }) }),
    /P-256/,
  );
});
