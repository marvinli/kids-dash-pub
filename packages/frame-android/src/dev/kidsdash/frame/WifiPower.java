package dev.kidsdash.frame;

import java.io.File;
import java.util.Arrays;

/**
 * Runs the AIC Wi-Fi driver with power saving off.
 *
 * The frame's Wi-Fi chip goes quiet some minutes into sleep (docs/device/frameo.md),
 * and power saving is the prime suspect: the drops only happen while the
 * frame is idle. The driver cannot change power saving at runtime (iwconfig
 * and nl80211 both answer "not supported"); it only reads `ps_on` when it
 * loads, and toggling Wi-Fi does not reload it. So once per boot this reloads
 * the driver module with ps_on=0, inside a Wi-Fi off/on (about 10 s offline).
 * If the reload fails, a plain reload is tried, and a failure is remembered
 * so it is never attempted again on that frame.
 */
final class WifiPower {
    static final String MODULE = "/vendor/lib/modules/wifi/aic8800_fdrv.ko";
    static final String PS_PARAM = "/sys/module/aic8800_fdrv/parameters/ps_on";
    /**
     * The Wi-Fi chip's SDIO bus clock (debugfs). The kernel runs it at 50 MHz;
     * a Rockchip board with the same kind of SDIO Wi-Fi was made stable by
     * halving it (linux-rockchip, Sonoff iHost, 2025), so this tries 25 MHz.
     * Loading the driver resets it, and changing it under traffic drops the
     * link, so it is set after insmod and before Wi-Fi comes back on.
     */
    static final String SDIO_CLOCK = "/sys/kernel/debug/mmc1/clock";
    static final long SDIO_HZ = 25_000_000L;
    /**
     * Android mounts debugfs at boot and opens it to 0755. Mounting it again
     * re-applies the default 0700 to the one shared debugfs, and then every
     * new WebView renderer dies at birth (webview_zygote cannot reopen
     * tracing/trace_marker: "Unable to reopen whitelisted descriptors"), so
     * the dashboard goes blank. So: mount only when it is not mounted, at
     * 0755, and put 0755 back in case an earlier version took it away.
     */
    static final String DEBUGFS_READY = "[ -e " + SDIO_CLOCK + " ] || "
            + "mount -t debugfs -o mode=755 none /sys/kernel/debug 2>/dev/null; "
            + "chmod 755 /sys/kernel/debug; ";
    private static final long RELOAD_TIMEOUT_S = 60;
    /**
     * Debugfs can be left inaccessible by an earlier app version or system
     * maintenance, even when power saving is already off and no driver reload
     * is needed. Check permissions at every start before creating the WebView.
     */
    static final String DEBUGFS = "/sys/kernel/debug";

    private WifiPower() {}

    /** Whether this app can no longer enter debugfs (0700), which kills every new WebView renderer. */
    static boolean debugfsClosed(File debugfs) {
        return debugfs.isDirectory() && !debugfs.canExecute();
    }

    /** Puts Android's 0755 back. Blocking (about 0.1 s); returns what `ls -ld` printed after. */
    static String reopenDebugfs(File scratchDir) {
        String out = SystemLog.capture(Arrays.asList("su", "-c", "chmod 755 " + DEBUGFS + "; ls -ld " + DEBUGFS),
                scratchDir, 5);
        return out == null ? "no answer" : out.trim();
    }

    /** What `cat PS_PARAM` printed: "Y" needs a reload; anything else (N, missing, no root) does not. */
    static boolean needsReload(String psOn) {
        return psOn != null && psOn.trim().equals("Y");
    }

    /** Whether the reload left the driver loaded with power saving off. */
    static boolean reloaded(String psOnAfter) {
        return psOnAfter != null && psOnAfter.trim().endsWith("N");
    }

    /**
     * Wi-Fi off, the driver out and back in without power saving (or plain,
     * if that fails), the bus slowed while nothing is talking over it, Wi-Fi
     * on again whatever happened, then ps_on as it now is.
     */
    static String reloadScript() {
        return "svc wifi disable; sleep 3; "
                + "if rmmod aic8800_fdrv; then "
                + "insmod " + MODULE + " ps_on=0 || insmod " + MODULE + "; fi; "
                + "sleep 1; " + DEBUGFS_READY
                + "echo " + SDIO_HZ + " > " + SDIO_CLOCK + " 2>/dev/null; "
                + "sleep 1; svc wifi enable; cat " + PS_PARAM;
    }

    /**
     * Reloads the driver whatever its power setting: what revives the chip
     * after it goes quiet (OutagePolicy). "reloaded" or "failed". Blocking.
     */
    static String reloadDriver(File scratchDir) {
        String after = SystemLog.capture(Arrays.asList("su", "-c", reloadScript()), scratchDir, RELOAD_TIMEOUT_S);
        return driverLoaded(after) ? "reloaded" : "failed";
    }

    /** Whether `cat PS_PARAM` after a reload shows the driver loaded (either setting). */
    static boolean driverLoaded(String psOnAfter) {
        if (psOnAfter == null) return false;
        String t = psOnAfter.trim();
        return t.endsWith("N") || t.endsWith("Y");
    }

    /** "already" (nothing to do), "off" (reloaded), or "failed". Blocking: a worker thread. */
    static String ensureOff(File scratchDir) {
        String before = SystemLog.capture(Arrays.asList("su", "-c", "cat " + PS_PARAM), scratchDir, 10);
        if (!needsReload(before)) return "already";
        String after = SystemLog.capture(Arrays.asList("su", "-c", reloadScript()), scratchDir, RELOAD_TIMEOUT_S);
        return reloaded(after) ? "off" : "failed";
    }
}
