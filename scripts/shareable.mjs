/** Paths that must never enter a shared source checkout. */
export function privatePath(path) {
  return (
    path === ".mcp.json" ||
    path === "packages/frame-android/frame.config.json" ||
    /(^|\/)local\//.test(path) ||
    /(^|\/)adbkey[^/]*$/.test(path) ||
    /\.(p12|pem|key|pass|img|bin|apk)$/.test(path) ||
    (/(^|\/)\.env(?:\.[^/]*)?$/.test(path) && !path.endsWith(".env.example"))
  );
}

/** Report categories only: never print credentials or private values. */
export function deploymentFindings(text) {
  const findings = [];
  if (
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bAIza[A-Za-z0-9_-]{35}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b/.test(
      text,
    )
  ) {
    findings.push("credential pattern");
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) findings.push("private key");
  if (/https:\/\/[a-z0-9]{10}\.execute-api\.[a-z0-9-]+\.amazonaws\.com\b/.test(text)) {
    findings.push("deployed API Gateway URL");
  }
  if (
    /\b(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/.test(
      text,
    )
  ) {
    findings.push("private LAN address (use a placeholder or RFC 5737 example)");
  }
  if (/\/(?:Users|home)\/[A-Za-z0-9._-]+\//.test(text)) findings.push("personal filesystem path");
  for (const match of text.matchAll(/arn:aws[a-z-]*:[^:\s]+:[^:\s]*:(\d{12}):/g)) {
    if (!["123456789012", "000000000000"].includes(match[1]))
      findings.push("AWS account identifier");
  }
  return findings;
}
