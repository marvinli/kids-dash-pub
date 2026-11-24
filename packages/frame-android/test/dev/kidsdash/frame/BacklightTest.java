package dev.kidsdash.frame;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Plain-JVM tests (no Android runtime needed): `node build.mjs --test`. */
public final class BacklightTest {
    private static int passed;

    public static void main(String[] args) {
        List<List<String>> ran = new ArrayList<>();
        Backlight ok = new Backlight(command -> {
            ran.add(command);
            return 0;
        });
        check("reports success when su exits 0", ok.off());
        check("writes 0 to the backlight device as root",
                ran.size() == 1 && ran.get(0).equals(Arrays.asList(
                        "su", "-c", "echo 0 > /sys/class/backlight/backlight/brightness")));

        ran.clear();
        check("sets a level", ok.set(217));
        check("writes the level to the backlight device as root",
                ran.size() == 1 && ran.get(0).equals(Arrays.asList(
                        "su", "-c", "echo 217 > /sys/class/backlight/backlight/brightness")));
        check("clamps levels to 0..255",
                Backlight.command(400).get(2).startsWith("echo 255 ")
                        && Backlight.command(-5).get(2).startsWith("echo 0 "));
        check("reports failure when setting a level fails", !new Backlight(command -> 1).set(100));

        check("reports failure when su exits non-zero", !new Backlight(command -> 1).off());
        check("reports failure when su is missing", !new Backlight(command -> {
            throw new IOException("No such file");
        }).off());
        check("reports failure and keeps the interrupt when interrupted", !new Backlight(command -> {
            throw new InterruptedException();
        }).off() && Thread.interrupted());

        System.out.println("BacklightTest: " + passed + " passed");
    }

    private static void check(String name, boolean ok) {
        if (!ok) throw new AssertionError("FAILED: " + name);
        passed++;
    }
}
