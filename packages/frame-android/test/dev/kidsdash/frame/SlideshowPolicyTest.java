package dev.kidsdash.frame;

import java.util.HashSet;
import java.util.List;
import java.util.Random;

/** Plain-JVM tests: `node build.mjs --test`. */
public final class SlideshowPolicyTest {
    private static int passed;

    public static void main(String[] args) {
        long idle = SlideshowPolicy.IDLE_MS;
        check("starts after the idle time", SlideshowPolicy.shouldStart(idle, 0, false, 3));
        check("not before", !SlideshowPolicy.shouldStart(idle - 1, 0, false, 3));
        check("never during sleep", !SlideshowPolicy.shouldStart(idle * 5, 0, true, 3));
        check("never without slides", !SlideshowPolicy.shouldStart(idle * 5, 0, false, 0));
        check("counts from the latest activity", !SlideshowPolicy.shouldStart(idle * 2, idle + 1, false, 3));

        for (int seed = 0; seed < 50; seed++) {
            List<Integer> order = SlideshowPolicy.order(5, 2, new Random(seed));
            check("plays every slide once", order.size() == 5 && new HashSet<>(order).size() == 5);
            check("never repeats the last slide first", order.get(0) != 2);
        }
        check("a single slide is fine", SlideshowPolicy.order(1, 0, new Random(1)).equals(List.of(0)));
        check("no slides is fine", SlideshowPolicy.order(0, -1, new Random(1)).isEmpty());

        check("accepts sha256 names", SlideshowPolicy.isSlideName("a".repeat(64)));
        check("rejects paths", !SlideshowPolicy.isSlideName("../" + "a".repeat(61)));
        check("rejects upper case and null", !SlideshowPolicy.isSlideName("A".repeat(64))
                && !SlideshowPolicy.isSlideName(null));
        // Portraits (1, 3, 4) pair in play order; landscapes and videos play alone.
        boolean[] pairable = {false, true, false, true, true};
        List<int[]> screens = SlideshowPolicy.plan(List.of(1, 0, 3, 4, 2), pairable);
        check("pairs portraits in order", screens.size() == 4
                && java.util.Arrays.equals(screens.get(0), new int[] {1, 3})
                && java.util.Arrays.equals(screens.get(1), new int[] {0})
                && java.util.Arrays.equals(screens.get(2), new int[] {4})
                && java.util.Arrays.equals(screens.get(3), new int[] {2}));
        check("drops indices past the list", SlideshowPolicy.plan(List.of(7, 0), new boolean[] {true}).size() == 1);

        int[] crop = SlideshowPolicy.coverCrop(1920, 1440, 1920, 1080, 0.5f, 0.5f);
        check("a 4:3 photo loses top and bottom", java.util.Arrays.equals(crop, new int[] {0, 180, 1920, 1080}));
        crop = SlideshowPolicy.coverCrop(1920, 1440, 1920, 1080, 0.5f, 0.1f);
        check("a high face keeps the top", crop[1] == 0);
        crop = SlideshowPolicy.coverCrop(1440, 1920, 954, 1080, 0.5f, 0.2f);
        check("a portrait in a half panel keeps a high face", crop[0] == 0 && crop[2] == 1440 && crop[1] == 0);
        crop = SlideshowPolicy.coverCrop(1920, 1080, 954, 1080, 0.9f, 0.5f);
        check("a wide crop follows the face sideways", crop[0] + crop[2] == 1920 && crop[3] == 1080);

        for (int seed = 0; seed < 200; seed++) {
            float fx = new Random(seed).nextFloat(), fy = new Random(seed + 1).nextFloat();
            SlideshowPolicy.Motion m = SlideshowPolicy.kenBurns(new Random(seed), 1920, 1080, fx, fy);
            check("starts covered", covered(m.fromScale, m.fromX, m.fromY, 1920, 1080));
            check("ends covered", covered(m.toScale, m.toX, m.toY, 1920, 1080));
            check("zooms", Math.abs(m.fromScale - m.toScale) >= 0.08f);
        }

        String[][] skies = {{"0", "sunny"}, {"2", "partly"}, {"3", "cloudy"}, {"45", "foggy"},
                {"61", "rainy"}, {"81", "rainy"}, {"73", "snowy"}, {"86", "snowy"}, {"95", "stormy"}};
        for (String[] s : skies) check("sky " + s[0], SlideshowPolicy.sky(Integer.parseInt(s[0])).equals(s[1]));

        int[] pixels = new int[25];
        pixels[12] = 0xffffffff;
        SlideshowPolicy.blur(pixels, 5, 5, 1);
        check("blur spreads a bright pixel", (pixels[12] & 0xff) < 255 && (pixels[0] & 0xff) > 0);

        System.out.println("SlideshowPolicyTest: " + passed + " passed");
    }

    private static boolean covered(float scale, float x, float y, int w, int h) {
        return scale >= 1 && Math.abs(x) <= (scale - 1) * w / 2 + 0.01f && Math.abs(y) <= (scale - 1) * h / 2 + 0.01f;
    }

    private static void check(String what, boolean ok) {
        if (!ok) throw new AssertionError(what);
        passed++;
    }
}
