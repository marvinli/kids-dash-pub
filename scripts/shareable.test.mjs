import assert from "node:assert/strict";
import { test } from "node:test";
import { deploymentFindings, privatePath } from "./shareable.mjs";

test("local deployment files stay private while setup examples remain shareable", () => {
  for (const path of [
    "local/frame/device.json",
    ".mcp.json",
    "packages/frame-android/frame.config.json",
    ".env",
    "nested/.env.prod",
    "adbkey.pub",
    "release.apk",
  ]) {
    assert.equal(privatePath(path), true, path);
  }
  for (const path of [
    ".mcp.example.json",
    "packages/frame-android/frame.config.example.json",
    ".env.example",
    "packages/api/src/services/ports.ts",
  ]) {
    assert.equal(privatePath(path), false, path);
  }
});

test("deployment data is detected without returning its contents", () => {
  const secrets = [
    `AKIA${"A".repeat(16)}`,
    ["-----BEGIN", "PRIVATE KEY-----"].join(" "),
    `https://${"a".repeat(10)}.execute-api.us-east-1.amazonaws.com`,
    ["192", "168", "1", "2"].join("."),
    ["/Users", "example-person", "project"].join("/"),
    ["arn:aws:kms:us-east-1", "9".repeat(12), "key/example"].join(":"),
  ];
  for (const secret of secrets) {
    const findings = deploymentFindings(secret);
    assert.ok(findings.length > 0);
    assert.ok(findings.every((finding) => !finding.includes(secret)));
  }
  assert.deepEqual(
    deploymentFindings(
      "https://<api-id>.execute-api.<region>.amazonaws.com 192.0.2.10 parent@example.com",
    ),
    [],
  );
});
