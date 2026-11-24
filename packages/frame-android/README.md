# frame-android

The Android shell that runs on the frame (`dev.kidsdash.frame`): a full-screen
kiosk WebView for `packages/frame-web`, plus the parts a web page should not do.

- **Fetches** `GET /v1/bundle` every minute with the device token (backing off to
  five minutes when offline), and right after each chore check-off.
- **Verifies** every bundle with `SHA256withECDSA` against the public key compiled
  in from `frame.config.json`, and refuses unknown key ids. Nothing unverified
  reaches the page.
- **Caches** the last verified envelope (re-verified on load), so after a reboot
  the frame shows the day before Wi-Fi is back.
- **Photos**: follows the API's redirect to S3 by hand (the token never goes to
  S3), checks each photo's SHA-256 against the bundle, caches by hash.
- **Serves** the page from `https://frame.kidsdash.local/` out of the APK's
  assets. Every other request is refused, file access is off, navigation is
  blocked, so the page cannot reach the network.

`MainActivity` is the only component, registered for HOME so the frame boots
into it. There is no exported way to hand the app a token.

## Build

JDK 17 and the Android SDK (build-tools 36.0.0, platform android-36) at the
Homebrew paths, or set `JAVA_17_HOME` / `JAVA_HOME` and
`ANDROID_SDK` / `ANDROID_HOME` / `ANDROID_SDK_ROOT`. JVM tests need only the JDK,
with no SDK or deployment config.

```sh
pnpm turbo run build --filter=@kids-dash/frame-android  # from the repo root
pnpm --filter @kids-dash/frame-android test   # JVM tests for the verifier
```

The APK is `build/kids-dash-frame.apk`, versioned by git commit count. It is
signed with `local/frame/frame-signing.p12` (created on first build, git-ignored).
**Keep that keystore:** Android only installs updates signed with the same key;
losing it means uninstalling (and re-provisioning) to update.

Copy `frame.config.example.json` to the git-ignored `frame.config.json` and fill
in your deployment values. `frame.config.json` holds the API URL and the bundle signing public key (not
secrets). After rotating the KMS key, refresh it with
`kids-dash-admin signing-key` and rebuild.

## Install and provision

Read the [frame guide](../../docs/device/frameo.md) first. Set `FRAME_ADB` explicitly to your device:

```sh
export FRAME_ADB="<frame-ip>:5555"
```

```sh
pnpm --filter @kids-dash/frame-android frame:install     # install, set as Home, launch
pnpm --filter @kids-dash/frame-android frame:provision   # once per install
pnpm --filter @kids-dash/frame-android frame:screenshot  # build/screen.png
```

Provisioning takes the token from `local/frame/device.json` (from
`register_device` / `POST /admin/devices`), pushes it as a 0600 temp file, and
moves it into the app's private files as root; the app moves it into private
preferences and deletes the file. Re-provision after an uninstall. To retire a
frame, revoke its device in the admin API.

## Sleep

The bundle's `sleep` window (from settings) blacks the screen out. The display
stays on, with a black cover over the page, and `Backlight` writes 0 to the
backlight device through the vendor `su` (again every minute while asleep);
waking writes the user's brightness setting back. Never use a window
brightness override for this: on this frame `BRIGHTNESS_OVERRIDE_OFF` kills
the Wi-Fi chip within minutes (see `docs/device/frameo.md`), and Android
clamps it to a visible glow anyway. The display isn't switched off, because that powers down the
touchscreen too, and the point is that any tap wakes the dashboard. A tap shows it at normal brightness for two minutes after the last
touch; the waking tap itself never reaches the page. An exact `RTC_WAKEUP`
alarm fires at each boundary. If someone switches the display off with the
power button, the end-of-window alarm lights it again with a wake lock; the
same alarm also ends a sleep started with the page's power button. A
malformed window is ignored (the screen stays on). The window logic is
`SleepSchedule`, tested on the JVM.

Logs: `adb -s <ip>:5555 logcat -s KidsDash`.
