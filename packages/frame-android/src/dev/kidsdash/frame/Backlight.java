package dev.kidsdash.frame;

import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * Sets the panel's backlight directly through the vendor `su`: 0 for
 * night-time sleep (fully dark), the user's brightness on waking.
 *
 * Sleep must not use a window brightness override (BRIGHTNESS_OVERRIDE_OFF):
 * on the Frameo 159K the Wi-Fi chip dies 4 to 10 minutes after one is set and
 * stays dead until a reboot (see docs/device/frameo.md).
 * Android also clamps that override to a visible glow (10 of 255). Writing
 * the backlight device leaves Android's own brightness untouched, so nothing
 * on the system restores it either way: waking must set it back.
 * Plain Java so it is tested on the JVM.
 */
final class Backlight {
    static final String DEVICE = "/sys/class/backlight/backlight/brightness";

    /** Runs a command and returns its exit code. */
    interface Shell {
        int run(List<String> command) throws IOException, InterruptedException;
    }

    static final Shell SYSTEM = command -> {
        Process p = new ProcessBuilder(command).redirectErrorStream(true).start();
        p.getOutputStream().close();
        if (!p.waitFor(5, TimeUnit.SECONDS)) {
            p.destroyForcibly();
            return -1;
        }
        return p.exitValue();
    };

    private final Shell shell;

    Backlight(Shell shell) {
        this.shell = shell;
    }

    static final int MAX = 255;

    static List<String> command(int level) {
        int clamped = Math.max(0, Math.min(MAX, level));
        return Arrays.asList("su", "-c", "echo " + clamped + " > " + DEVICE);
    }

    /** True when the backlight was switched off; false (never throws) otherwise. */
    boolean off() {
        return set(0);
    }

    /** True when the backlight was set to `level` (clamped to 0..255); false (never throws) otherwise. */
    boolean set(int level) {
        try {
            return shell.run(command(level)) == 0;
        } catch (IOException e) {
            return false;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }
}
