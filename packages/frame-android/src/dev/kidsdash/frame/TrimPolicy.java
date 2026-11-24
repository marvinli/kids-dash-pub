package dev.kidsdash.frame;

/**
 * Which of Android's onTrimMemory levels reach the WebView (FrameApp).
 *
 * Android 8.1 rates memory by how few apps sit cached in the background, not
 * by free RAM. This kiosk runs almost nothing else, so the dashboard is told
 * RUNNING_CRITICAL (15) with hundreds of MB free, for as long as it runs.
 * Chromium's MemoryPressureMonitor then reports critical pressure and, while
 * the last report was critical, asks again every 60 seconds (getMyMemoryState
 * still says 15), so it reports it again: each report throws away the page's
 * drawn tiles, and the dashboard flashes cream for half a second while the
 * painting and cards redraw.
 *
 * The RUNNING_* levels (5, 10, 15) only say other apps are being squeezed while
 * this one is in front; here that is a false alarm, and the kernel's
 * low-memory killer still frees memory for real. Every other level (UI hidden,
 * background, complete) is passed on.
 * Pure Java so it is tested on the plain JVM (test/TrimPolicyTest.java).
 */
final class TrimPolicy {
    /** ComponentCallbacks2 levels (android.content.ComponentCallbacks2). */
    static final int RUNNING_MODERATE = 5;
    static final int RUNNING_LOW = 10;
    static final int RUNNING_CRITICAL = 15;
    static final int UI_HIDDEN = 20;

    private TrimPolicy() {}

    /** Whether this onTrimMemory level is passed on to the WebView. */
    static boolean forward(int level) {
        return level >= UI_HIDDEN;
    }
}
