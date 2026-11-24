# The frame: Frameo 159K

The reference hardware is a Bigasuo 15.6" Frameo photo frame (model `159K`,
Rockchip RK3326). These notes describe tested hardware behavior and routine
operation with authenticated Wi-Fi ADB and root via the vendor `su`. Verify
firmware and hardware details on your own device.

A stock Frameo does not provide ADB or root. Enabling them is firmware-specific
and is not covered by this repository. The connection instructions below assume
you have already enabled ADB and authorized your computer. Keep any recovery
images, bootloader backups and authorization material private and out of Git.

## Hardware and software

| Property   | Value                                                                            |
| ---------- | -------------------------------------------------------------------------------- |
| SoC        | RK3326 (`ro.board.platform`), `rk30board` hardware                               |
| Display    | 1920×1080, density 160 (1 CSS px = 1 device px), 60 Hz                           |
| Android    | 8.1.0, API 27, arm64-v8a                                                         |
| WebView    | 113.0.5672.136                                                                   |
| ADB        | Authenticated Wi-Fi ADB on TCP port 5555 (requires prior setup)                  |
| Wi-Fi chip | AIC8800 on SDIO (`aic8800_fdrv`, driver `aicwf_sdio`), power save on (`ps_on=Y`) |

## Wi-Fi reliability

The AIC8800 can stop seeing networks while the screen is dark or during large
transfers. A window brightness override (`BRIGHTNESS_OVERRIDE_OFF`) can trigger
this within minutes; write the backlight directly instead. Wi-Fi off/on alone
may not recover the chip. A driver reload or reboot can restore connectivity.

The shell's `WifiPower` and `OutagePolicy` handle recovery: they reload the driver
with power saving disabled (`ps_on=0`) and lower the SDIO clock to 25 MHz before
bringing Wi-Fi back. Reloads retry with backoff and can run with the screen dark;
a reboot is a fallback only with the screen lit. These mitigations do not
eliminate every drop. Use `list_incidents`, `get_incident` and the `Watchdog:` log
lines to inspect your own device's behavior.

Keep debugfs permissions at 0755. Remounting it can reset them to 0700 and prevent
WebView renderers from accessing `tracing/trace_marker`, leaving the page blank.
The shell checks access before creating the WebView. For a blank page, inspect
`ls -ld /sys/kernel/debug` and `start timeout` lines in logcat.

The stock Frameo app can compete with the dashboard. Disable it after installing
the dashboard with `pm disable-user --user 0 net.frameo.frame`; restore it with
`pm enable net.frameo.frame`. Disabling keeps its data.

Performance budget: the GPU is weak. Measured on the first WebView prototype,
scrolling a list produced 95% janky frames (median 26 ms). The dashboard design
therefore never scrolls; see `docs/architecture.md`.

## Connecting

Connect your computer and frame to the same trusted LAN. Find the frame's IP in
Android **Settings → Wi-Fi → network details** or your router's device list;
DHCP can change it. Set `FRAME_ADB` to that address and always target it
explicitly, because other Android devices may be connected:

```sh
export FRAME_ADB="<frame-ip>:5555"
adb connect "$FRAME_ADB"
adb -s "$FRAME_ADB" shell id            # uid=2000(shell)
adb -s "$FRAME_ADB" shell su -c id      # uid=0(root)
```

Keep your authorized ADB key pair (`~/.android/adbkey*`). Do not regenerate it,
run ADB under `sudo` (which uses a different key), or disable `ro.adb.secure`.
Authorize another computer through the device's approval dialog, if available,
or append its public key to `/data/misc/adb/adb_keys` over an existing trusted
connection, preserving every existing entry.

### macOS: start the ADB server from Terminal

ADB launched by an agent or desktop app can fail with **No route to host** while
`ping` and `nc` reach the frame fine. That is macOS Local Network privacy
attributing the connection to the launching app. Start the server from
Terminal.app instead; agents can then reuse it:

```sh
adb kill-server
adb start-server
adb connect "$FRAME_ADB"
adb devices -l
```

Do not kill a working Terminal-started server from an agent; that recreates the
problem and drops other sessions.

## Installing an app

```sh
adb -s "$FRAME_ADB" install -r path/to/app.apk
adb -s "$FRAME_ADB" shell am start -W -n <package>/<activity>
adb -s "$FRAME_ADB" shell cmd package set-home-activity <package>/<activity>
adb -s "$FRAME_ADB" exec-out screencap -p > screen.png
```

Updates must be signed with the same key as the installed app. Restore Frameo as
Home from Android Settings → Apps → Default apps → Home app.

## The WebView and Android's "memory critical"

Android 8.1 rates memory by how few apps are cached, not by free RAM. This
frame runs almost nothing else (and its low-memory killer evicts cached apps
early), so the system sits at memory level CRITICAL (`dumpsys activity
processes`: `mLastMemoryLevel=3`) and the dashboard at `trimMemoryLevel=15`
with hundreds of MB free. Chromium's MemoryPressureMonitor turned that into
critical pressure once a minute (it re-polls `getMyMemoryState()` every 60 s
after a critical report), and each report evicted the page's frame: the
dashboard went cream for half a second while the painting and cards redrew,
once a minute at the WebView's start time plus n minutes. The shell
(`FrameApp`, `TrimPolicy`) prevents RUNNING_* trim levels from reaching the
WebView, by callback or by polling.

To look inside the page: WebView DevTools is on, reachable only over
adb: `adb -s "$FRAME_ADB" forward tcp:9333 localabstract:webview_devtools_remote_<app pid>`, then
`http://localhost:9333/json`. Chromium traces are buffered in the app's own
process: keep them short with a capped `traceBufferSizeInKb`, stay connected
until `Tracing.tracingComplete`, and watch `dumpsys meminfo`. A trace left
running grew the app to 450 MB and the low-memory killer restarted it.
To catch a flash, screen-record (`screenrecord --size 960x540`) and look for
frames where a strip of the painting turns cream (luma above 200).

## Do not

- Never invalidate the eMMC bootloader headers (LBAs `0x40`, `0x440`, `0x840`,
  `0xc40`, `0x1040`) to force maskrom. This can brick the device.
- Never use firmware-specific recovery or ADB enablement scripts for routine
  access. Verify firmware compatibility and identify physical media before
  any recovery write.
- Never expose port 5555 beyond the LAN.
