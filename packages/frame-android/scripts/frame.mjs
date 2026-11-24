// Operator commands for the physical frame over (root) adb.
//
//   node scripts/frame.mjs install     install the APK, make it Home, launch it
//   node scripts/frame.mjs provision   hand the frame its device token
//   node scripts/frame.mjs screenshot  save what the frame shows to build/screen.png
//   node scripts/frame.mjs owner       make the app device owner (once; enables self-updates)
//   node scripts/frame.mjs publish     upload build/kids-dash-frame.apk as the release every
//                                      frame installs on its own (no adb needed)
//
// FRAME_ADB must select the device for adb commands (see docs/device/frameo.md).
// FRAME_DEVICE names the token file for provision:
// local/frame/<FRAME_DEVICE>.json (default "device"). Uses the existing adb
// server; never restarts it. publish needs AWS_PROFILE and KIDS_DASH_API_URL,
// like the admin CLI (packages/mcp).
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toolPaths } from "./config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");
const PACKAGE = "dev.kidsdash.frame";
const ACTIVITY = `${PACKAGE}/.MainActivity`;
const target = process.env.FRAME_ADB;

const adb = (args, options = {}) =>
  execFileSync("adb", ["-s", target, ...args], { encoding: "utf8", ...options });

const commands = {
  install() {
    console.log(adb(["install", "-r", join(here, "../build/kids-dash-frame.apk")]).trim());
    console.log(adb(["shell", "cmd", "package", "set-home-activity", ACTIVITY]).trim());
    adb(["shell", "am", "start", "-W", "-n", ACTIVITY]);
    console.log(`launched ${ACTIVITY} on ${target}`);
  },

  /**
   * Gets the token into the app's private files dir without it appearing in a
   * command line: a 0600 temp file is pushed under a random name, moved into
   * place as root, and chowned to the app. The app moves it into private prefs
   * and deletes it on start. The token comes from local/frame/device.json
   * (written when the device was registered; never committed). `adb exec-in`
   * would avoid the temp file but does not work on this Android 8.1 adbd.
   */
  provision() {
    const name = process.env.FRAME_DEVICE ?? "device";
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Bad FRAME_DEVICE: ${name}`);
    const { token } = JSON.parse(readFileSync(join(root, `local/frame/${name}.json`), "utf8"));
    const dir = `/data/data/${PACKAGE}/files`;
    const uid = adb(["shell", `su -c 'stat -c %u /data/data/${PACKAGE}'`]).trim();
    if (!/^\d+$/.test(uid)) throw new Error(`App not installed or no root: ${uid}`);

    const local = join(mkdtempSync(join(tmpdir(), "kids-dash-")), "token");
    const remote = `/data/local/tmp/kd-${randomBytes(8).toString("hex")}`;
    try {
      writeFileSync(local, token, { mode: 0o600 });
      adb(["push", local, remote]);
      adb([
        "shell",
        `su -c 'mkdir -p ${dir} && mv ${remote} ${dir}/provision-token && chown ${uid}:${uid} ${dir} ${dir}/provision-token && chmod 600 ${dir}/provision-token && restorecon -R ${dir}'`,
      ]);
    } finally {
      rmSync(dirname(local), { recursive: true, force: true });
      adb(["shell", `su -c 'rm -f ${remote}'`]);
    }
    adb(["shell", "am", "force-stop", PACKAGE]);
    adb(["shell", "am", "start", "-W", "-n", ACTIVITY]);
    console.log("provisioned and restarted");
  },

  /**
   * Device owner lets the app install its own updates silently (and read the
   * Wi-Fi name for the settings panel); the overlay permission puts a
   * "← Dashboard" button over Android's Wi-Fi settings. Android only
   * allows it while no accounts are on the device (true for these frames).
   * Undo with: adb shell dpm remove-active-admin dev.kidsdash.frame/.FrameAdmin
   * (only works from the app itself once owner; a factory reset always does).
   */
  owner() {
    const policy = adb(["shell", "dumpsys", "device_policy"]);
    if (!/Device Owner:[\s\S]*?admin=ComponentInfo\{dev\.kidsdash\.frame\//.test(policy)) {
      console.log(adb(["shell", "dpm", "set-device-owner", `${PACKAGE}/.FrameAdmin`]).trim());
    }
    // The "← Dashboard" button over Wi-Fi settings.
    adb(["shell", "appops", "set", PACKAGE, "SYSTEM_ALERT_WINDOW", "allow"]);
    adb(["shell", "am", "force-stop", PACKAGE]);
    adb(["shell", "am", "start", "-W", "-n", ACTIVITY]);
  },

  /**
   * Publishes the built APK; every frame on an older versionCode downloads,
   * verifies and installs it within a minute or two. versionCode/Name are
   * read back from the APK itself.
   */
  async publish() {
    const apk = join(here, "../build/kids-dash-frame.apk");
    const { sdk } = toolPaths();
    const badging = execFileSync(join(sdk, "build-tools/36.0.0/aapt2"), ["dump", "badging", apk], {
      encoding: "utf8",
    });
    const match = /versionCode='(\d+)' versionName='([^']+)'/.exec(badging);
    if (!match) throw new Error("Could not read the APK's version");
    const [, versionCode, versionName] = match;
    // The APK goes straight to storage (it is over the API's ~6 MB request
    // limit as base64); the API then checks it against its hash and publishes.
    const bytes = readFileSync(apk);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const cli = join(root, "packages/mcp/dist/cli.js");
    const call = (method, path, body) =>
      JSON.parse(
        execFileSync("node", [cli, "call", method, path, JSON.stringify(body)], {
          encoding: "utf8",
        }),
      );
    await uploadArt(apk, call);
    const { url, contentType } = call("POST", "/admin/app/upload", { sha256 });
    const upload = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: bytes,
    });
    if (!upload.ok) throw new Error(`Upload failed: ${upload.status} ${await upload.text()}`);
    const { release } = call("PUT", "/admin/app", {
      versionCode: Number(versionCode),
      versionName,
      sha256,
    });
    console.log(
      `published ${release.versionName} (versionCode ${release.versionCode}, ${bytes.length} bytes)`,
    );
  },

  screenshot() {
    const png = execFileSync("adb", ["-s", target, "exec-out", "screencap", "-p"]);
    const file = join(here, "../build/screen.png");
    writeFileSync(file, png);
    console.log(file);
  },
};

/**
 * The backdrop paintings the APK downloads instead of carrying (its
 * assets/web/art-remote.txt, see frame-web's build): each goes to storage
 * by hash before the release, so no frame asks for one that is not there.
 * Only the ones storage lacks are sent.
 */
async function uploadArt(apk, call) {
  const list = execFileSync("unzip", ["-p", apk, "assets/web/art-remote.txt"], {
    encoding: "utf8",
  });
  const files = new Map(
    list
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split(" ").reverse()),
  );
  if (files.size === 0) return;
  const { contentType, uploads } = call("POST", "/admin/art/upload", {
    sha256s: [...new Set(files.values())],
  });
  const byHash = new Map([...files].map(([name, sha]) => [sha, name]));
  for (const { sha256, url } of uploads) {
    const name = byHash.get(sha256);
    const bytes = readFileSync(join(root, "assets/art/web", name));
    if (createHash("sha256").update(bytes).digest("hex") !== sha256) {
      throw new Error(`assets/art/web/${name} changed since the build; rebuild first`);
    }
    const put = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: bytes,
    });
    if (!put.ok) throw new Error(`Uploading ${name} failed: ${put.status} ${await put.text()}`);
  }
  console.log(
    `art: ${uploads.length} of ${byHash.size} paintings uploaded, the rest already stored`,
  );
}

const command = commands[process.argv[2]];
if (!command) {
  console.error("usage: node scripts/frame.mjs install | provision | screenshot | owner | publish");
  process.exit(2);
}
if (process.argv[2] !== "publish" && !target?.trim()) {
  console.error(
    "Set FRAME_ADB to your device serial or <frame-ip>:5555 before using adb commands.",
  );
  process.exit(2);
}
await command();
