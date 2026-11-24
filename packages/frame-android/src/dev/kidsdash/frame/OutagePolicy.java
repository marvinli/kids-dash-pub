package dev.kidsdash.frame;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Decisions about stretches when the frame cannot reach the API: what the
 * Wi-Fi looks like, when an outage is worth reporting, when the watchdog
 * restarts the frame, and which log lines go with the report.
 *
 * The watchdog exists for one failure (docs/device/frameo.md): the Wi-Fi chip
 * goes quiet, the router drops the frame and every scan comes back empty. It
 * happens some minutes into a dark screen, and sometimes seconds after a
 * reload. Toggling Wi-Fi does not help; reloading the driver does (back about
 * 10 s later, often only for a while), and a reboot always does. So it acts
 * only on that signature (not on a network that is simply down or unknown, as
 * after a move). A reload is silent, so it runs dark or lit: after a minute of
 * no networks (lit, once Android has had WAKE_GRACE_MS after a wake to
 * reconnect by itself), then again a minute later if the chip is still dead,
 * backing off to every 10 minutes while reloads keep failing. A reboot lights
 * the screen, so it never runs while dark; it
 * comes only once reloads with the screen lit have had RELOAD_SETTLE_MS and not
 * helped, at most once an hour.
 *
 * Another failure mode: prolonged "disconnected" rather than
 * "no networks" (Wi-Fi off, scans unreadable, or networks seen but never
 * joined). A frame stuck that way
 * gets the same reloads after the same minute (a healthy rejoin takes
 * seconds, and once associated the frame counts as connected) (the reload also turns
 * Wi-Fi back on) and, lit, the same reboot. And every outage that lasts
 * LOG_AFTER_MS keeps a log excerpt, so a report has evidence even when
 * someone power-cycles the frame.
 * Pure Java so it is tested on the plain JVM (test/OutagePolicyTest.java).
 */
final class OutagePolicy {
    /** Shorter outages are not reported. */
    static final long REPORT_AFTER_MS = 5 * 60_000L;
    /** How long the chip must look dead (and the app been up) before the watchdog reboots. */
    static final long REBOOT_AFTER_MS = 15 * 60_000L;
    /** At most one watchdog reboot per this long, whatever happens. */
    static final long MIN_REBOOT_GAP_MS = 60 * 60_000L;
    /** After the screen lights, how long Android gets to reconnect before the driver is reloaded. */
    static final long WAKE_GRACE_MS = 20_000L;
    /** How long the chip must look dead or stuck before a reload (lit: or since the screen lit, if sooner). */
    static final long RELOAD_AFTER_MS = 60_000L;
    /** An outage this long gets its log excerpt captured (the start is what explains it). */
    static final long LOG_AFTER_MS = 10 * 60_000L;
    /** The wait after a reload before the next; it doubles with each reload that fails, up to MAX_RELOAD_GAP_MS. */
    static final long RELOAD_RETRY_MS = 60_000L;
    static final long MAX_RELOAD_GAP_MS = 10 * 60_000L;
    /** How long a reload gets to bring the Wi-Fi back before a reboot is allowed. */
    static final long RELOAD_SETTLE_MS = 3 * 60_000L;
    /** A scan result older than this does not count as a network seen now. */
    static final long FRESH_SCAN_MS = 5 * 60_000L;
    /** The longest log excerpt sent with a report (the server takes up to 60,000). */
    static final int MAX_LOG_CHARS = 56_000;

    /** How the Wi-Fi looks, least to most alarming (the names are the API's). */
    enum Wifi {
        UNKNOWN("unknown"),
        CONNECTED("connected"),
        DISCONNECTED("disconnected"),
        NO_NETWORKS("no-networks");

        final String wire;

        Wifi(String wire) {
            this.wire = wire;
        }

        static Wifi fromWire(String value) {
            for (Wifi w : values()) {
                if (w.wire.equals(value)) return w;
            }
            return UNKNOWN;
        }

        /** The more alarming of the two: an outage reports the worst it saw. */
        Wifi worst(Wifi other) {
            return other != null && other.ordinal() > ordinal() ? other : this;
        }
    }

    private OutagePolicy() {}

    /**
     * `freshNetworks` is how many networks scans saw in the last FRESH_SCAN_MS;
     * `scansReadable` says whether this app has ever been shown a scan result
     * (if not, an empty list proves nothing). Wi-Fi switched off by someone is
     * just "disconnected": nothing to fix.
     */
    static Wifi classify(boolean enabled, boolean associated, int freshNetworks, boolean scansReadable) {
        if (associated) return Wifi.CONNECTED;
        if (!enabled || !scansReadable) return Wifi.DISCONNECTED;
        return freshNetworks == 0 ? Wifi.NO_NETWORKS : Wifi.DISCONNECTED;
    }

    static boolean worthReporting(long sinceMs, long untilMs) {
        return untilMs - sinceMs >= REPORT_AFTER_MS;
    }

    /**
     * Whether to reload the Wi-Fi driver now. `litForMs`: how long the screen
     * has been lit (ignored while dark); `deadForMs`: how long the watchdog has
     * seen `wifi` (no networks, or disconnected; after a night this is long); `sinceReloadMs`: since the
     * last reload (negative: none since boot); `failedReloads`: reloads since
     * the Wi-Fi last connected.
     */
    static boolean shouldReloadDriver(
            Wifi wifi,
            boolean screenDark,
            boolean changingWifi,
            long litForMs,
            long deadForMs,
            long sinceReloadMs,
            int failedReloads) {
        if (!needsHelp(wifi) || changingWifi) return false;
        if (screenDark) {
            if (deadForMs < RELOAD_AFTER_MS) return false;
        } else if (litForMs < WAKE_GRACE_MS || deadForMs < Math.min(RELOAD_AFTER_MS, litForMs)) {
            return false;
        }
        return sinceReloadMs < 0 || sinceReloadMs >= reloadGap(failedReloads);
    }

    /** The states the watchdog acts on: not "unknown" (no evidence) and not connected. */
    static boolean needsHelp(Wifi wifi) {
        return wifi == Wifi.NO_NETWORKS || wifi == Wifi.DISCONNECTED;
    }

    /** Whether to keep a log excerpt now: offline LOG_AFTER_MS and none kept this outage. */
    static boolean shouldCaptureLog(long offlineForMs, boolean haveLog) {
        return !haveLog && offlineForMs >= LOG_AFTER_MS;
    }

    /** The wait after a reload: a minute, doubling with each failed one, at most MAX_RELOAD_GAP_MS. */
    static long reloadGap(int failedReloads) {
        int doublings = Math.max(0, Math.min(failedReloads, 10) - 1);
        return Math.min(MAX_RELOAD_GAP_MS, RELOAD_RETRY_MS << doublings);
    }

    /**
     * `offlineForMs` counts from the last good poll; `uptimeMs` from boot, so a
     * frame that was off for hours does not reboot the moment it starts.
     * `lastRebootMs` is the wall-clock time of the previous watchdog reboot (0: none).
     * `reloadTriedForMs`: how long ago the first reload with the screen lit was,
     * this outage (negative: none yet); reloads go first.
     */
    static boolean shouldReboot(
            Wifi wifi,
            long offlineForMs,
            long uptimeMs,
            boolean screenDark,
            boolean changingWifi,
            long nowMs,
            long lastRebootMs,
            long reloadTriedForMs) {
        if (!needsHelp(wifi) || screenDark || changingWifi) return false;
        if (reloadTriedForMs < RELOAD_SETTLE_MS) return false;
        if (Math.min(offlineForMs, uptimeMs) < REBOOT_AFTER_MS) return false;
        return lastRebootMs <= 0 || nowMs - lastRebootMs >= MIN_REBOOT_GAP_MS || nowMs < lastRebootMs;
    }

    /**
     * "none" unless the frame booted after the outage began; then "watchdog"
     * if the watchdog asked for that reboot, else "other" (someone cut the power).
     */
    static String reboot(boolean byWatchdog, long bootedAtMs, long sinceMs) {
        if (bootedAtMs <= sinceMs) return "none";
        return byWatchdog ? "watchdog" : "other";
    }

    private static final Pattern NETWORK_LINE = Pattern.compile(
            "(?i)wifi|wlan|wpa|supplicant|aic|dhcp|connectivity|netd|networkmonitor|rfkill|sdio|\\bmmc\\d|"
                    + "scan|disconnect|assoc|auth|KidsDash|"
                    // The AIC Wi-Fi driver's own lines (rwnx_*, deinit:macaddr, roc_elem, remain:).
                    + "rwnx|macaddr|roc_elem|remain:");
    /** SELinux audit lines mention block devices (dev="mmcblk…") and drown the rest. */
    private static final Pattern NOISE = Pattern.compile("avc: +denied");

    /**
     * The lines of `logcat` and `dmesg` output about the network, newest kept
     * when they do not fit, under two headings, at most MAX_LOG_CHARS in all.
     */
    static String excerpt(String logcat, String dmesg) {
        return excerpt(logcat, dmesg, MAX_LOG_CHARS);
    }

    static String excerpt(String logcat, String dmesg, int maxChars) {
        String kernel = tail(networkLines(dmesg), maxChars / 3);
        String system = tail(networkLines(logcat), maxChars - kernel.length() - 40);
        return "== logcat ==\n" + system + "\n== dmesg ==\n" + kernel;
    }

    /**
     * The excerpt kept early in an outage (`earlier`, may be null) and one
     * taken now, together under MAX_LOG_CHARS: the early one keeps at most half.
     */
    static String combine(String earlier, String logcat, String dmesg) {
        if (earlier == null || earlier.isEmpty()) return excerpt(logcat, dmesg);
        // Its end is the outage's start, so that is what stays.
        int keep = MAX_LOG_CHARS / 2;
        String head = earlier.length() > keep ? "…\n" + earlier.substring(earlier.length() - keep + 2) : earlier;
        String marker = "\n== later ==\n";
        return head + marker + excerpt(logcat, dmesg, MAX_LOG_CHARS - head.length() - marker.length());
    }

    static List<String> networkLines(String text) {
        List<String> lines = new ArrayList<>();
        if (text == null) return lines;
        for (String line : text.split("\n")) {
            if (NETWORK_LINE.matcher(line).find() && !NOISE.matcher(line).find()) lines.add(line);
        }
        return lines;
    }

    /** The last lines that fit in `max` characters (newline-separated). */
    static String tail(List<String> lines, int max) {
        StringBuilder out = new StringBuilder();
        for (int i = lines.size() - 1; i >= 0; i--) {
            String line = lines.get(i);
            if (out.length() + line.length() + 1 > max) break;
            out.insert(0, line + "\n");
        }
        return out.toString();
    }
}
