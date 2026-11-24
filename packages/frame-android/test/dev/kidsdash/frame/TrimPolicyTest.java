package dev.kidsdash.frame;

/** Plain-JVM tests: `node build.mjs --test`. */
public final class TrimPolicyTest {
    private static int passed;

    public static void main(String[] args) {
        check("running critical is a false alarm here (the cream flashes)",
                !TrimPolicy.forward(TrimPolicy.RUNNING_CRITICAL));
        check("running low and moderate likewise",
                !TrimPolicy.forward(TrimPolicy.RUNNING_LOW) && !TrimPolicy.forward(TrimPolicy.RUNNING_MODERATE));
        check("UI hidden is passed on", TrimPolicy.forward(TrimPolicy.UI_HIDDEN));
        check("background, moderate and complete are passed on",
                TrimPolicy.forward(40) && TrimPolicy.forward(60) && TrimPolicy.forward(80));
        System.out.println("TrimPolicyTest: " + passed + " passed");
    }

    private static void check(String what, boolean ok) {
        if (!ok) throw new AssertionError(what);
        passed++;
    }
}
