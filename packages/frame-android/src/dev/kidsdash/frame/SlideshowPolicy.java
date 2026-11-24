package dev.kidsdash.frame;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Random;

/**
 * When the slideshow starts and in what order it plays. Pure Java so it is
 * tested on the plain JVM (test/SlideshowPolicyTest.java).
 */
final class SlideshowPolicy {
    /** Untouched this long (outside sleep hours) and the photos come on. */
    static final long IDLE_MS = 5 * 60_000;
    /** How long each screen of photos stays up; videos play to the end. */
    static final long PHOTO_MS = 10_000;
    /** Crossfade between screens. */
    static final long FADE_MS = 1_200;
    /** Photos narrower than this (width / height) share the screen in pairs. */
    static final float PAIR_BELOW_ASPECT = 0.9f;
    /** A lone photo at least this wide fills the screen; narrower ones sit on a blurred copy. */
    static final float FILL_FROM_ASPECT = 1.2f;
    /** Where to centre a crop when no face is found: middle, a little high. */
    static final float DEFAULT_FOCUS_X = 0.5f;
    static final float DEFAULT_FOCUS_Y = 0.42f;

    private SlideshowPolicy() {}

    /** A slide the frame has on disk, named by its sha256. */
    static final class Slide {
        final String sha256;
        final boolean video;

        Slide(String sha256, boolean video) {
            this.sha256 = sha256;
            this.video = video;
        }
    }

    /**
     * `lastActivityMs` is the later of the last touch and the end of sleep, so
     * the frame greets the morning with the dashboard, not photos.
     */
    static boolean shouldStart(long nowMs, long lastActivityMs, boolean asleep, int slideCount) {
        return !asleep && slideCount > 0 && nowMs - lastActivityMs >= IDLE_MS;
    }

    /**
     * A shuffled play order over `count` slides that does not begin with
     * `avoidFirst` (the slide just shown), so a new round never repeats it.
     */
    static List<Integer> order(int count, int avoidFirst, Random random) {
        List<Integer> order = new ArrayList<>(count);
        for (int i = 0; i < count; i++) order.add(i);
        Collections.shuffle(order, random);
        if (count > 1 && order.get(0) == avoidFirst) Collections.swap(order, 0, 1);
        return order;
    }

    /**
     * Groups a play order into screens: each pairable photo (a portrait) shares
     * the screen with the next unused pairable one in the order, everything else
     * plays alone. Indices past `pairable.length` are dropped.
     */
    static List<int[]> plan(List<Integer> order, boolean[] pairable) {
        List<int[]> screens = new ArrayList<>();
        boolean[] used = new boolean[pairable.length];
        for (int i = 0; i < order.size(); i++) {
            int a = order.get(i);
            if (a < 0 || a >= used.length || used[a]) continue;
            used[a] = true;
            int partner = -1;
            for (int j = i + 1; pairable[a] && j < order.size(); j++) {
                int b = order.get(j);
                if (b >= 0 && b < used.length && !used[b] && pairable[b]) {
                    partner = b;
                    break;
                }
            }
            if (partner >= 0) {
                used[partner] = true;
                screens.add(new int[] {a, partner});
            } else {
                screens.add(new int[] {a});
            }
        }
        return screens;
    }

    /**
     * The part {left, top, width, height} of a srcW x srcH image that fills a
     * dstW x dstH panel, centred on the focus (fractions of the source) as far
     * as the image edges allow.
     */
    static int[] coverCrop(int srcW, int srcH, int dstW, int dstH, float focusX, float focusY) {
        double scale = Math.max((double) dstW / srcW, (double) dstH / srcH);
        int w = (int) Math.min(srcW, Math.round(dstW / scale));
        int h = (int) Math.min(srcH, Math.round(dstH / scale));
        int left = clamp(Math.round(focusX * srcW - w / 2f), 0, srcW - w);
        int top = clamp(Math.round(focusY * srcH - h / 2f), 0, srcH - h);
        return new int[] {left, top, w, h};
    }

    /**
     * A slow zoom on a panel (pivot at its centre, translation in px): one end
     * is close and drifts the focus toward the middle, the other is wide and
     * drifts a little at random. Translation never uncovers the panel's edge.
     */
    static Motion kenBurns(Random random, int w, int h, float focusX, float focusY) {
        float close = 1.10f + random.nextFloat() * 0.06f;
        float wide = 1.02f;
        float closeX = clampF((0.5f - focusX) * w * close, -(close - 1) * w / 2, (close - 1) * w / 2);
        float closeY = clampF((0.5f - focusY) * h * close, -(close - 1) * h / 2, (close - 1) * h / 2);
        float wideX = (random.nextFloat() * 2 - 1) * (wide - 1) * w / 2;
        float wideY = (random.nextFloat() * 2 - 1) * (wide - 1) * h / 2;
        return random.nextBoolean()
                ? new Motion(wide, wideX, wideY, close, closeX, closeY)
                : new Motion(close, closeX, closeY, wide, wideX, wideY);
    }

    /** Start and end of a pan-and-zoom. */
    static final class Motion {
        final float fromScale, fromX, fromY, toScale, toX, toY;

        Motion(float fromScale, float fromX, float fromY, float toScale, float toX, float toY) {
            this.fromScale = fromScale;
            this.fromX = fromX;
            this.fromY = fromY;
            this.toScale = toScale;
            this.toX = toX;
            this.toY = toY;
        }
    }

    /**
     * Blurs ARGB pixels in place: three passes of a separable box blur, close
     * to a Gaussian. Run on a tiny copy and scaled up, it makes the soft
     * backdrop behind a photo that does not fill the screen.
     */
    static void blur(int[] pixels, int w, int h, int radius) {
        int[] tmp = new int[pixels.length];
        for (int pass = 0; pass < 3; pass++) {
            boxPass(pixels, tmp, w, h, radius, true);
            boxPass(tmp, pixels, w, h, radius, false);
        }
    }

    private static void boxPass(int[] src, int[] dst, int w, int h, int r, boolean horizontal) {
        int lines = horizontal ? h : w;
        int length = horizontal ? w : h;
        for (int line = 0; line < lines; line++) {
            for (int i = 0; i < length; i++) {
                int a = 0, red = 0, green = 0, blue = 0, n = 0;
                for (int k = Math.max(0, i - r); k <= Math.min(length - 1, i + r); k++) {
                    int p = src[horizontal ? line * w + k : k * w + line];
                    a += p >>> 24;
                    red += (p >> 16) & 0xff;
                    green += (p >> 8) & 0xff;
                    blue += p & 0xff;
                    n++;
                }
                dst[horizontal ? line * w + i : i * w + line] =
                        (a / n) << 24 | (red / n) << 16 | (green / n) << 8 | (blue / n);
            }
        }
    }

    private static int clamp(int v, int lo, int hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    private static float clampF(float v, float lo, float hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    /** Today's forecast for the slideshow corner. */
    static final class Weather {
        final String sky;
        final int high;
        final int low;
        /** Temperature now; null when the bundle does not say. */
        final Integer current;

        Weather(String sky, int high, int low, Integer current) {
            this.sky = sky;
            this.high = high;
            this.low = low;
            this.current = current;
        }
    }

    /** WMO weather code to sky art (assets web/art/wx-<sky>.webp); mirrors core's skyFromCode. */
    static String sky(int code) {
        if (code >= 95) return "stormy";
        if ((code >= 71 && code <= 77) || code == 85 || code == 86) return "snowy";
        if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rainy";
        if (code == 45 || code == 48) return "foggy";
        if (code >= 3) return "cloudy";
        if (code >= 1) return "partly";
        return "sunny";
    }

    /** Hex sha256 names only, so a bundle can never point the frame at another file. */
    static boolean isSlideName(String name) {
        return name != null && name.matches("[0-9a-f]{64}");
    }
}
