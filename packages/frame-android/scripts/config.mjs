import { createPublicKey } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

/** Standard SDK/JDK environment variables work on Linux and macOS. */
export function toolPaths(env = process.env) {
  return {
    jdk: env.JAVA_17_HOME || env.JAVA_HOME || "/opt/homebrew/opt/openjdk@17",
    sdk:
      env.ANDROID_SDK ||
      env.ANDROID_HOME ||
      env.ANDROID_SDK_ROOT ||
      "/opt/homebrew/share/android-commandlinetools",
  };
}

/** Reject unfinished config before compiling or signing an APK. */
export function readFrameConfig(path) {
  if (!existsSync(path)) {
    throw new Error(
      "Copy frame.config.example.json to frame.config.json and fill in your deployment values",
    );
  }
  const config = JSON.parse(readFileSync(path, "utf8"));
  let url;
  try {
    url = new URL(config.apiUrl);
  } catch {
    throw new Error("frame.config.json: apiUrl must be your HTTPS API URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /[<>\s]/.test(config.apiUrl) ||
    typeof config.keyId !== "string" ||
    !config.keyId.trim() ||
    /[<>]/.test(config.keyId)
  ) {
    throw new Error("frame.config.json: fill in your HTTPS apiUrl and signing keyId");
  }
  let key;
  try {
    key = createPublicKey(config.publicKeyPem);
  } catch {
    throw new Error(
      "frame.config.json: publicKeyPem must be the PEM from kids-dash-admin signing-key",
    );
  }
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails.namedCurve !== "prime256v1") {
    throw new Error("frame.config.json: publicKeyPem must be an ECDSA P-256 public key");
  }
  return {
    ...config,
    publicKey: key.export({ type: "spki", format: "der" }).toString("base64"),
  };
}
