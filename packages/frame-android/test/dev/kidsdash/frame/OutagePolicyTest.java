package dev.kidsdash.frame;

import java.util.Arrays;

/** Plain-JVM tests: `node build.mjs --test`. */
public final class OutagePolicyTest {
    private static int passed;

    public static void main(String[] args) {
        OutagePolicy.Wifi connected = OutagePolicy.Wifi.CONNECTED;
        OutagePolicy.Wifi dead = OutagePolicy.Wifi.NO_NETWORKS;

        check("associated is connected", OutagePolicy.classify(true, true, 0, true) == connected);
        check("no fresh networks is the dead chip", OutagePolicy.classify(true, false, 0, true) == dead);
        check("networks around but none joined",
                OutagePolicy.classify(true, false, 3, true) == OutagePolicy.Wifi.DISCONNECTED);
        check("Wi-Fi switched off is not the chip",
                OutagePolicy.classify(false, false, 0, true) == OutagePolicy.Wifi.DISCONNECTED);
        check("unreadable scans prove nothing",
                OutagePolicy.classify(true, false, 0, false) == OutagePolicy.Wifi.DISCONNECTED);

        check("worst wins", connected.worst(dead) == dead && dead.worst(connected) == dead);
        check("worst of null", connected.worst(null) == connected);
        check("wire names round-trip", OutagePolicy.Wifi.fromWire("no-networks") == dead);
        check("odd wire name", OutagePolicy.Wifi.fromWire("??") == OutagePolicy.Wifi.UNKNOWN);

        long min = 60_000L;
        check("a blip is not reported", !OutagePolicy.worthReporting(0, 4 * min));
        check("five minutes is", OutagePolicy.worthReporting(0, 5 * min));

        long now = 1_800_000_000_000L;
        check("reboots a dead chip after 15 minutes",
                OutagePolicy.shouldReboot(dead, 15 * min, 60 * min, false, false, now, 0, 5 * min));
        check("not before", !OutagePolicy.shouldReboot(dead, 14 * min, 60 * min, false, false, now, 0, 5 * min));
        check("not right after boot",
                !OutagePolicy.shouldReboot(dead, 600 * min, 14 * min, false, false, now, 0, 5 * min));
        check("never with the screen dark",
                !OutagePolicy.shouldReboot(dead, 60 * min, 60 * min, true, false, now, 0, 5 * min));
        check("never while someone picks a network",
                !OutagePolicy.shouldReboot(dead, 60 * min, 60 * min, false, true, now, 0, 5 * min));
        check("stuck disconnected, reloads tried lit: reboot",
                OutagePolicy.shouldReboot(OutagePolicy.Wifi.DISCONNECTED, 60 * min, 60 * min, false, false, now, 0, 5 * min));
        check("stuck disconnected: never dark either",
                !OutagePolicy.shouldReboot(OutagePolicy.Wifi.DISCONNECTED, 60 * min, 60 * min, true, false, now, 0, 5 * min));
        check("never without evidence",
                !OutagePolicy.shouldReboot(OutagePolicy.Wifi.UNKNOWN, 60 * min, 60 * min, false, false, now, 0, 5 * min));
        check("never while connected (the internet is down, not the frame)",
                !OutagePolicy.shouldReboot(connected, 60 * min, 60 * min, false, false, now, 0, 5 * min));
        check("at most once an hour",
                !OutagePolicy.shouldReboot(dead, 60 * min, 60 * min, false, false, now, now - 59 * min, 5 * min));
        check("again after an hour",
                OutagePolicy.shouldReboot(dead, 60 * min, 60 * min, false, false, now, now - 60 * min, 5 * min));
        check("a clock that went backwards does not block it",
                OutagePolicy.shouldReboot(dead, 60 * min, 60 * min, false, false, now, now + 5 * min, 5 * min));

        check("no reboot before a driver reload has been tried",
                !OutagePolicy.shouldReboot(dead, 60 * min, 60 * min, false, false, now, 0, -1));
        check("nor while a reload is still settling",
                !OutagePolicy.shouldReboot(dead, 60 * min, 60 * min, false, false, now, 0, 2 * min));

        long sec = 1_000L;
        check("woken after a dead night: reload once Android has had its grace",
                OutagePolicy.shouldReloadDriver(dead, false, false, 22 * sec, 300 * min, -1, 0));
        check("not inside the grace",
                !OutagePolicy.shouldReloadDriver(dead, false, false, 10 * sec, 300 * min, -1, 0));
        check("in the dark too (a reload is silent), after a minute of no networks",
                OutagePolicy.shouldReloadDriver(dead, true, false, 0, 1 * min, -1, 0)
                        && !OutagePolicy.shouldReloadDriver(dead, true, false, 0, 50 * sec, -1, 0));
        check("never while someone picks a network",
                !OutagePolicy.shouldReloadDriver(dead, false, true, 300 * min, 300 * min, -1, 0));
        OutagePolicy.Wifi stuck = OutagePolicy.Wifi.DISCONNECTED;
        check("dark, a short disconnect is left to Android",
                !OutagePolicy.shouldReloadDriver(stuck, true, false, 0, 50 * sec, -1, 0));
        check("dark, stuck disconnected a minute: reload",
                OutagePolicy.shouldReloadDriver(stuck, true, false, 0, 1 * min, -1, 0));
        check("lit a while, a short disconnect is left to Android",
                !OutagePolicy.shouldReloadDriver(stuck, false, false, 60 * min, 50 * sec, -1, 0)
                        && OutagePolicy.shouldReloadDriver(stuck, false, false, 60 * min, 1 * min, -1, 0));
        check("woken after a night stuck: reload after the wake grace",
                !OutagePolicy.shouldReloadDriver(stuck, false, false, 10 * sec, 300 * min, -1, 0)
                        && OutagePolicy.shouldReloadDriver(stuck, false, false, 22 * sec, 300 * min, -1, 0));
        check("stuck: never while someone picks a network",
                !OutagePolicy.shouldReloadDriver(stuck, true, true, 0, 300 * min, -1, 0));
        check("stuck: backs off like the dead chip",
                !OutagePolicy.shouldReloadDriver(stuck, true, false, 0, 30 * min, 7 * min, 4)
                        && OutagePolicy.shouldReloadDriver(stuck, true, false, 0, 30 * min, 8 * min, 4));
        check("not without evidence",
                !OutagePolicy.shouldReloadDriver(OutagePolicy.Wifi.UNKNOWN, true, false, 0, 300 * min, -1, 0));
        check("acts on dead or stuck only", OutagePolicy.needsHelp(dead) && OutagePolicy.needsHelp(stuck)
                && !OutagePolicy.needsHelp(connected) && !OutagePolicy.needsHelp(OutagePolicy.Wifi.UNKNOWN));
        check("lit a while: the chip must look dead for a minute",
                !OutagePolicy.shouldReloadDriver(dead, false, false, 60 * min, 50 * sec, -1, 0)
                        && OutagePolicy.shouldReloadDriver(dead, false, false, 60 * min, 1 * min, -1, 0));
        check("a reload that came back and died again: retry a minute later",
                !OutagePolicy.shouldReloadDriver(dead, false, false, 60 * min, 1 * min, 50 * sec, 0)
                        && OutagePolicy.shouldReloadDriver(dead, false, false, 60 * min, 1 * min, 1 * min, 0));
        check("failing reloads back off: 1, 1, 2, 4, 8, then every 10 minutes",
                OutagePolicy.reloadGap(0) == 1 * min && OutagePolicy.reloadGap(1) == 1 * min
                        && OutagePolicy.reloadGap(2) == 2 * min && OutagePolicy.reloadGap(3) == 4 * min
                        && OutagePolicy.reloadGap(4) == 8 * min && OutagePolicy.reloadGap(5) == 10 * min
                        && OutagePolicy.reloadGap(50) == 10 * min);
        check("the backoff holds",
                !OutagePolicy.shouldReloadDriver(dead, true, false, 0, 30 * min, 7 * min, 4)
                        && OutagePolicy.shouldReloadDriver(dead, true, false, 0, 30 * min, 8 * min, 4));

        check("watchdog reboot", OutagePolicy.reboot(true, 20, 10).equals("watchdog"));
        check("a watchdog reboot that never happened", OutagePolicy.reboot(true, 5, 10).equals("none"));
        check("booted since the outage began", OutagePolicy.reboot(false, 20, 10).equals("other"));
        check("no reboot", OutagePolicy.reboot(false, 5, 10).equals("none"));

        String logcat = "11-17 09:55 I KidsDash: Refresh failed\n11-17 09:55 I Chatty: noise\n"
                + "11-17 09:55 D wpa_supplicant: wlan0: CTRL-EVENT-DISCONNECTED reason=1\n";
        String excerpt = OutagePolicy.excerpt(logcat, "[1.0] aicwf_sdio: tx timeout\n[1.1] usb 1-1: hub\n");
        check("keeps network lines", excerpt.contains("CTRL-EVENT-DISCONNECTED") && excerpt.contains("aicwf_sdio"));
        check("drops the rest", !excerpt.contains("Chatty") && !excerpt.contains("usb 1-1"));
        check("headings", excerpt.startsWith("== logcat ==\n") && excerpt.contains("\n== dmesg ==\n"));
        check("no input", OutagePolicy.networkLines(null).isEmpty());
        String kernel = "<4>[ 3013.7] roc_elem == null\n<4>[ 3173.9] deinit:macaddr:88,0,33,c,d,7e\n"
                + "[ 1172.0] type=1400 audit(1:2): avc: denied { getattr } dev=\"mmcblk2p16\" scontext=u:r:toolbox:s0\n"
                + "[ 2.0] mmc1: new high speed SDIO card\n";
        check("keeps the Wi-Fi driver's lines", OutagePolicy.networkLines(kernel).size() == 3);
        check("drops SELinux audit noise", !OutagePolicy.excerpt("", kernel).contains("avc:"));

        StringBuilder big = new StringBuilder();
        for (int i = 0; i < 5000; i++) big.append("wlan0 line ").append(i).append(" ").append("x".repeat(30)).append('\n');
        String capped = OutagePolicy.excerpt(big.toString(), big.toString());
        check("fits the cap", capped.length() <= OutagePolicy.MAX_LOG_CHARS);
        check("keeps the newest lines", capped.contains("wlan0 line 4999 ") && !capped.contains("wlan0 line 0 "));
        check("log kept ten minutes in", !OutagePolicy.shouldCaptureLog(9 * min, false)
                && OutagePolicy.shouldCaptureLog(10 * min, false) && !OutagePolicy.shouldCaptureLog(600 * min, true));
        String early = OutagePolicy.excerpt("11-19 20:41:00 wpa_supplicant: CTRL-EVENT-DISCONNECTED\n", "");
        String both = OutagePolicy.combine(early, "11-19 06:00:20 KidsDash: Watchdog: reloading\n", "");
        check("reboot log keeps the early one",
                both.startsWith(early) && both.contains("== later ==") && both.contains("06:00:20"));
        check("no early log: plain excerpt", OutagePolicy.combine(null, "wlan0 x\n", "").equals(OutagePolicy.excerpt("wlan0 x\n", "")));
        String bothBig = OutagePolicy.combine(capped, big.toString(), big.toString());
        check("combined fits the cap", bothBig.length() <= OutagePolicy.MAX_LOG_CHARS);
        check("early one keeps its end (the outage's start)",
                bothBig.indexOf("wlan0 line 4999 ") < bothBig.indexOf("== later =="));
        check("tail keeps whole lines", OutagePolicy.tail(Arrays.asList("aaaa", "bb"), 6).equals("bb\n"));

        System.out.println("OutagePolicyTest: " + passed + " passed");
    }

    private static void check(String what, boolean ok) {
        if (!ok) throw new AssertionError(what);
        passed++;
    }
}
