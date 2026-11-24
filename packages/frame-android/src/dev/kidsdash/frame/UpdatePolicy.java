package dev.kidsdash.frame;

/**
 * Whether to install the app release a bundle names. Pure Java so it is
 * tested on the plain JVM (test/UpdatePolicyTest.java).
 */
final class UpdatePolicy {
    /** A release that failed to install is retried after this long. */
    static final long RETRY_MS = 6 * 60 * 60_000L;

    /**
     * Download pace for app updates. Pulling a 36 MB APK flat out has made
     * the reference hardware lose Wi-Fi mid-download;
     * at this pace it takes about a minute and a half. A download cut short
     * keeps what it has and resumes from there (HTTP Range) at the next poll.
     */
    static final long DOWNLOAD_BYTES_PER_S = 384L * 1024;

    private UpdatePolicy() {}

    /** The `app` entry of a verified bundle. */
    static final class Release {
        final int versionCode;
        final String versionName;
        final String sha256;

        Release(int versionCode, String versionName, String sha256) {
            this.versionCode = versionCode;
            this.versionName = versionName;
            this.sha256 = sha256;
        }
    }

    /** The partial download of a release, named by its hash so a stale one is never resumed. */
    static String partName(String sha256) {
        return "update-" + sha256 + ".part";
    }

    /** The Range header asking for the rest of a file `have` bytes in; null to start over. */
    static String rangeHeader(long have) {
        return have > 0 ? "bytes=" + have + "-" : null;
    }

    /**
     * Where to write the response from: 206 (the rest) after what we have,
     * 200 (the server sent it all) from the start, anything else is an error (-1).
     */
    static long writeFrom(int status, long have) {
        if (status == 206) return have;
        if (status == 200) return 0;
        return -1;
    }

    /** How long to pause so `bytes` read in `elapsedMs` stays at `bytesPerSecond`. */
    static long pauseMs(long bytes, long elapsedMs, long bytesPerSecond) {
        return Math.max(0, bytes * 1000 / bytesPerSecond - elapsedMs);
    }

    /**
     * Install a release only when it is newer than what runs, names a file by a
     * proper sha256, and has not just failed (a bad build must not loop).
     */
    static boolean shouldInstall(int installed, Release release, String failedSha, long failedAtMs, long nowMs) {
        if (release == null || release.versionCode <= installed) return false;
        if (!SlideshowPolicy.isSlideName(release.sha256)) return false;
        return !(release.sha256.equals(failedSha) && nowMs - failedAtMs < RETRY_MS);
    }
}
