package dev.kidsdash.frame;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * Reads the system log and kernel messages through the vendor `su` (an app
 * may otherwise only read its own log lines), for the watchdog's report.
 * Output goes through a file so a command that hangs cannot block a pipe.
 */
final class SystemLog {
    private static final long TIMEOUT_S = 10;
    /** Only the end of each is kept; the excerpt is much smaller still. */
    private static final int MAX_BYTES = 2 * 1024 * 1024;

    private SystemLog() {}

    static String logcat(File scratchDir) {
        return capture(Arrays.asList("su", "-c", "logcat -d -v threadtime -b main,system -t 8000"), scratchDir);
    }

    static String dmesg(File scratchDir) {
        return capture(Arrays.asList("su", "-c", "dmesg"), scratchDir);
    }

    /** The command's output (its tail, if long), or "" when it could not run. */
    static String capture(List<String> command, File scratchDir) {
        return capture(command, scratchDir, TIMEOUT_S);
    }

    static String capture(List<String> command, File scratchDir, long timeoutS) {
        File out = new File(scratchDir, "capture-" + System.nanoTime() + ".txt");
        try {
            Process p = new ProcessBuilder(command).redirectErrorStream(true).redirectOutput(out).start();
            p.getOutputStream().close();
            if (!p.waitFor(timeoutS, TimeUnit.SECONDS)) p.destroyForcibly();
            return readTail(out);
        } catch (IOException e) {
            return "";
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return "";
        } finally {
            //noinspection ResultOfMethodCallIgnored
            out.delete();
        }
    }

    private static String readTail(File file) throws IOException {
        try (RandomAccessFile f = new RandomAccessFile(file, "r")) {
            long start = Math.max(0, f.length() - MAX_BYTES);
            byte[] bytes = new byte[(int) (f.length() - start)];
            f.seek(start);
            f.readFully(bytes);
            return new String(bytes, StandardCharsets.UTF_8);
        }
    }
}
