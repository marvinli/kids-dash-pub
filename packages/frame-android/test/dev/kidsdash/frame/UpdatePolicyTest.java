package dev.kidsdash.frame;

/** Plain-JVM tests: `node build.mjs --test`. */
public final class UpdatePolicyTest {
    private static int passed;

    public static void main(String[] args) {
        String sha = "a".repeat(64);
        UpdatePolicy.Release next = new UpdatePolicy.Release(40, "1.0.40", sha);
        long now = 1_000_000_000L;
        check("installs a newer release", UpdatePolicy.shouldInstall(39, next, null, 0, now));
        check("not the same version", !UpdatePolicy.shouldInstall(40, next, null, 0, now));
        check("never downgrades", !UpdatePolicy.shouldInstall(41, next, null, 0, now));
        check("nothing to install", !UpdatePolicy.shouldInstall(39, null, null, 0, now));
        check("refuses a malformed hash",
                !UpdatePolicy.shouldInstall(39, new UpdatePolicy.Release(40, "x", "../evil"), null, 0, now));
        check("holds off a release that just failed", !UpdatePolicy.shouldInstall(39, next, sha, now - 1000, now));
        check("retries it later",
                UpdatePolicy.shouldInstall(39, next, sha, now - UpdatePolicy.RETRY_MS, now));
        check("an older failure does not block a new release",
                UpdatePolicy.shouldInstall(39, next, "b".repeat(64), now, now));

        check("a part is named by its release", UpdatePolicy.partName(sha).equals("update-" + sha + ".part"));
        check("nothing yet: no Range", UpdatePolicy.rangeHeader(0) == null);
        check("some: ask for the rest", "bytes=1048576-".equals(UpdatePolicy.rangeHeader(1_048_576)));
        check("206 appends", UpdatePolicy.writeFrom(206, 500) == 500);
        check("200 starts over", UpdatePolicy.writeFrom(200, 500) == 0);
        check("anything else is an error", UpdatePolicy.writeFrom(403, 500) == -1);
        long rate = UpdatePolicy.DOWNLOAD_BYTES_PER_S;
        check("ahead of pace: wait", UpdatePolicy.pauseMs(rate, 250, rate) == 750);
        check("on or behind pace: no wait", UpdatePolicy.pauseMs(rate, 1000, rate) == 0
                && UpdatePolicy.pauseMs(rate, 3000, rate) == 0);
        check("36 MB takes over a minute",
                UpdatePolicy.pauseMs(36L * 1024 * 1024, 0, rate) > 60_000);
        System.out.println("UpdatePolicyTest: " + passed + " passed");
    }

    private static void check(String what, boolean ok) {
        if (!ok) throw new AssertionError(what);
        passed++;
    }
}
