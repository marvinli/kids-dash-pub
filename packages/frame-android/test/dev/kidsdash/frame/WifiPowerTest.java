package dev.kidsdash.frame;

/** Plain-JVM tests: `node build.mjs --test`. */
public final class WifiPowerTest {
    private static int passed;

    public static void main(String[] args) {
        check("power saving on needs a reload", WifiPower.needsReload("Y\n"));
        check("already off", !WifiPower.needsReload("N\n"));
        check("no driver or no root: leave it", !WifiPower.needsReload("cat: No such file or directory"));
        check("nothing read", !WifiPower.needsReload(null) && !WifiPower.needsReload(""));

        check("reloaded without power saving", WifiPower.reloaded("N\n"));
        check("reload fell back to defaults", !WifiPower.reloaded("Y\n"));
        check("driver missing after reload",
                !WifiPower.reloaded("insmod: failed\ncat: " + WifiPower.PS_PARAM + ": No such file or directory\n"));

        check("driver loaded after a reload, either setting",
                WifiPower.driverLoaded("N\n") && WifiPower.driverLoaded("Y\n"));
        check("driver missing or no output", !WifiPower.driverLoaded(null)
                && !WifiPower.driverLoaded("cat: " + WifiPower.PS_PARAM + ": No such file or directory\n"));

        String script = WifiPower.reloadScript();
        check("asks for power saving off", script.contains("ps_on=0"));
        check("Wi-Fi comes back on whatever happened",
                script.indexOf("svc wifi enable") > script.lastIndexOf("fi;"));
        check("reports the result last", script.trim().endsWith("cat " + WifiPower.PS_PARAM));
        int clock = script.indexOf("echo 25000000 > " + WifiPower.SDIO_CLOCK);
        check("slows the bus after the driver loads, before Wi-Fi is back",
                clock > script.lastIndexOf("fi;") && clock < script.indexOf("svc wifi enable"));

        check("never remounts debugfs over Android's (that blanks the WebView)",
                script.contains("[ -e " + WifiPower.SDIO_CLOCK + " ] || mount")
                        && !script.contains("mount -t debugfs none"));
        check("debugfs left open as Android had it",
                script.indexOf("chmod 755 /sys/kernel/debug") < clock);

        check("checks the real debugfs", WifiPower.DEBUGFS.equals("/sys/kernel/debug"));
        try {
            java.io.File dir = java.nio.file.Files.createTempDirectory("debugfs").toFile();
            check("open debugfs is left alone", !WifiPower.debugfsClosed(dir));
            check("can close the test directory", dir.setExecutable(false, false));
            check("debugfs the app cannot enter is closed", WifiPower.debugfsClosed(dir));
            dir.setExecutable(true, false);
            check("no debugfs: nothing to reopen", !WifiPower.debugfsClosed(new java.io.File(dir, "missing")));
            dir.delete();
        } catch (java.io.IOException e) {
            throw new AssertionError(e);
        }

        System.out.println("WifiPowerTest: " + passed + " passed");
    }

    private static void check(String what, boolean ok) {
        if (!ok) throw new AssertionError(what);
        passed++;
    }
}
