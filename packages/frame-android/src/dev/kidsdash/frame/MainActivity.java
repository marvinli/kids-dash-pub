package dev.kidsdash.frame;

import android.app.Activity;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.ScanResult;
import android.net.wifi.SupplicantState;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.provider.Settings;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.GeneralSecurityException;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Collections;
import org.json.JSONObject;

/**
 * Full-screen kiosk host for the dashboard page (packages/frame-web). The page
 * is served from assets under an app-only https origin; every other request is
 * refused, so the page cannot reach the network. All data comes through
 * FrameController, signature-verified.
 */
public class MainActivity extends Activity implements FrameController.Ui, FrameController.Environment {
    private static final String TAG = "KidsDash";
    static final String ORIGIN_HOST = "frame.kidsdash.local";
    private static final String START_URL = "https://" + ORIGIN_HOST + "/index.html";
    private static final String PREFS = "device";
    private static final String TOKEN_KEY = "token";

    /** How long the screen stays on after someone wakes it during sleep hours. */
    static final long WAKE_GRACE_MS = 2 * 60_000;

    private WebView web;
    /** Black cover shown during sleep hours; a tap on it wakes the dashboard. */
    private View sleepCover;
    /** Read by the outage tracking off the main thread. */
    private volatile boolean dimmed;
    /** Read by the WebView's resource thread. */
    private volatile ArtLibrary art;
    private final Backlight backlight = new Backlight(Backlight.SYSTEM);
    /** While dimmed the backlight is switched off, and again every minute in case anything lit it. */
    static final long BACKLIGHT_RECHECK_MS = 60_000;
    private final Runnable backlightOff = new Runnable() {
        @Override
        public void run() {
            if (!dimmed) return;
            new Thread(() -> {
                if (!backlight.off()) Log.w(TAG, "Sleep: could not switch the backlight off");
            }, "backlight").start();
            handler.postDelayed(this, BACKLIGHT_RECHECK_MS);
        }
    };
    /** Blacked out by the power button: stays dark until a touch, whatever the schedule says. */
    private boolean sleepingOnRequest;
    private FrameController controller;

    // Slideshow state (main thread).
    private Slideshow slideshow;
    /** elapsedRealtime of the last touch or the end of sleep. */
    private long lastActivity = SystemClock.elapsedRealtime();
    /** True from the touch that closed the slideshow until that finger lifts. */
    private boolean swallowGesture;
    private final Runnable idleCheck = new Runnable() {
        @Override
        public void run() {
            maybeStartSlideshow();
            handler.postDelayed(this, 60_000);
        }
    };

    // Sleep state (main thread).
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable sleepCheck = () -> applySleep(false);
    private volatile SleepSchedule sleep;
    private boolean alarmPending;
    private long awakeUntil;
    private final BroadcastReceiver screenOn = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            stayAwake();
            applySleep(false);
        }
    };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        hideSystemUi();

        String token = loadToken();
        try {
            BundleVerifier verifier = new BundleVerifier(Config.PUBLIC_KEY, Config.KEY_ID);
            int version = installedVersion();
            ApiClient api = token == null ? null : new ApiClient(Config.API_URL, token, version);
            Updater updater = api == null ? null : new Updater(this, api, version);
            controller = new FrameController(getFilesDir(), verifier, api, this, updater, this, version);
            art = loadArt();
            controller.useArt(art);
            grantOwnPermissions();
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Bad compiled-in signing key", e);
        }

        // Before the first renderer starts: see WifiPower.DEBUGFS.
        if (WifiPower.debugfsClosed(new File(WifiPower.DEBUGFS))) {
            Log.w(TAG, "debugfs closed, reopening it: " + WifiPower.reopenDebugfs(getCacheDir()));
        }
        // DevTools over adb only (the socket admits the shell and root, both
        // already behind the frame's adb key): how rendering is traced on the frame.
        WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        web.setBackgroundColor(0xfffff7ee);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setDomStorageEnabled(false);
        s.setGeolocationEnabled(false);
        s.setSupportZoom(false);
        s.setTextZoom(100);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.addJavascriptInterface(new Bridge(), "KidsDashNative");
        web.setWebViewClient(new LocalAssetClient());
        sleepCover = new View(this);
        sleepCover.setBackgroundColor(0xff000000);
        sleepCover.setVisibility(View.GONE);
        sleepCover.setOnTouchListener((v, event) -> {
            if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
                if (sleepingOnRequest) Log.i(TAG, "Sleep on request: woken by a touch");
                sleepingOnRequest = false;
                stayAwake();
                applySleep(false);
            }
            return true; // the waking tap never reaches the page
        });
        FrameLayout root = new FrameLayout(this);
        slideshow = new Slideshow(this, FrameController.slideDir(getFilesDir()));
        root.addView(web);
        root.addView(slideshow.view());
        root.addView(sleepCover);
        setContentView(root);
        web.loadUrl(START_URL);
        registerReceiver(screenOn, new IntentFilter(Intent.ACTION_SCREEN_ON));
        // An earlier run (an update installed mid-sleep) may have left the
        // backlight off. Start lit; the schedule dims again as soon as it arrives.
        backlightOn();
        alarmPending = getIntent().getBooleanExtra(SleepAlarmReceiver.EXTRA_SLEEP_ALARM, false);
        controller.start();
        handler.postDelayed(idleCheck, 60_000);
        handler.postDelayed(watchdog, WATCHDOG_CHECK_MS);
        wifiPowerSaveOff();
        watchForNetwork();
    }

    /** Whenever a network comes up (after a drop, a reload, a boot), poll at once. */
    private void watchForNetwork() {
        ConnectivityManager cm = getSystemService(ConnectivityManager.class);
        if (cm == null) return;
        networkBack = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                // Back on a network: the reloads worked; the next outage starts afresh.
                failedReloads = 0;
                litReloadAt = -1;
                if (controller != null) controller.networkBack();
            }
        };
        try {
            cm.registerDefaultNetworkCallback(networkBack, handler);
        } catch (RuntimeException e) {
            Log.w(TAG, "Network callback: " + e.getMessage());
            networkBack = null;
        }
    }

    /** See WifiPower: once per boot, unless it failed on this frame before or Wi-Fi is off. */
    private void wifiPowerSaveOff() {
        SharedPreferences prefs = getSharedPreferences(WATCHDOG_PREFS, MODE_PRIVATE);
        if (prefs.getBoolean("wifiPowerFailed", false)) return;
        WifiManager wm = getApplicationContext().getSystemService(WifiManager.class);
        if (wm == null || !wm.isWifiEnabled()) return;
        File scratch = getCacheDir();
        new Thread(() -> {
            String result = WifiPower.ensureOff(scratch);
            if (!result.equals("already")) Log.i(TAG, "Wi-Fi power saving: " + result);
            if (result.equals("failed")) prefs.edit().putBoolean("wifiPowerFailed", true).apply();
        }, "wifi-power").start();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent.getBooleanExtra(SleepAlarmReceiver.EXTRA_SLEEP_ALARM, false)) applySleep(true);
    }

    /** Touches during sleep hours keep a woken screen on a little longer. */
    @Override
    public boolean dispatchTouchEvent(MotionEvent event) {
        stayAwake();
        lastActivity = SystemClock.elapsedRealtime();
        int action = event.getActionMasked();
        if (action == MotionEvent.ACTION_DOWN && slideshow.isShowing()) {
            // A tap on the photos only closes them; it never lands on the page.
            setSlideshow(false);
            swallowGesture = true;
        }
        if (swallowGesture) {
            if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) swallowGesture = false;
            return true;
        }
        return super.dispatchTouchEvent(event);
    }

    /**
     * The token arrives once as files/provision-token (written over root adb by
     * scripts/provision.mjs), moves into private prefs, and the file is deleted.
     */
    private String loadToken() {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        File provision = new File(getFilesDir(), "provision-token");
        if (provision.exists()) {
            try {
                String token = new String(Files.readAllBytes(provision.toPath()), StandardCharsets.UTF_8).trim();
                if (BundleVerifier.isValidToken(token)) {
                    prefs.edit().putString(TOKEN_KEY, token).commit();
                    Log.i(TAG, "Device token provisioned");
                } else {
                    Log.e(TAG, "Ignoring malformed provision-token");
                }
            } catch (IOException e) {
                Log.e(TAG, "Could not read provision-token: " + e.getMessage());
            }
            //noinspection ResultOfMethodCallIgnored
            provision.delete();
        }
        String token = prefs.getString(TOKEN_KEY, null);
        return BundleVerifier.isValidToken(token) ? token : null;
    }

    @Override
    protected void onResume() {
        super.onResume();
        stopWatchingWifi();
        hideSystemUi();
        if (controller != null) controller.refreshSoon();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    @Override
    public void onBackPressed() {
        // A kiosk: back does nothing.
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(sleepCheck);
        handler.removeCallbacks(idleCheck);
        handler.removeCallbacks(watchdog);
        handler.removeCallbacks(backlightOff);
        slideshow.hide();
        unregisterReceiver(screenOn);
        stopWatchingWifi();
        handler.removeCallbacks(wakeCheck);
        if (networkBack != null) {
            ConnectivityManager cm = getSystemService(ConnectivityManager.class);
            if (cm != null) cm.unregisterNetworkCallback(networkBack);
        }
        if (controller != null) controller.stop();
        if (web != null) web.destroy();
        super.onDestroy();
    }

    private void hideSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    // ---- FrameController.Ui (main thread) ----

    @Override
    public void render(String bundleJson) {
        call("render", JSONObject.quote(bundleJson));
    }

    @Override
    public void setArt(String namesJson) {
        call("setArt", JSONObject.quote(namesJson));
    }

    @Override
    public void setPhotos(String photosJson) {
        call("setPhotos", JSONObject.quote(photosJson));
    }

    @Override
    public void choreSaved(String kidId, String choreId, String date) {
        call("choreSaved", JSONObject.quote(kidId) + "," + JSONObject.quote(choreId) + "," + JSONObject.quote(date));
    }

    @Override
    public void choreFailed(String kidId, String choreId, String date) {
        call("choreFailed", JSONObject.quote(kidId) + "," + JSONObject.quote(choreId) + "," + JSONObject.quote(date));
    }

    @Override
    public void eventSaved(String requestId, String eventId) {
        call("eventSaved", JSONObject.quote(requestId) + "," + JSONObject.quote(eventId));
    }

    @Override
    public void eventFailed(String requestId, String reason) {
        call("eventFailed", JSONObject.quote(requestId) + "," + JSONObject.quote(reason));
    }

    @Override
    public void choreAdded(String requestId, String choreJson) {
        call("choreAdded", JSONObject.quote(requestId) + "," + JSONObject.quote(choreJson));
    }

    @Override
    public void choreAddFailed(String requestId, String reason) {
        call("choreAddFailed", JSONObject.quote(requestId) + "," + JSONObject.quote(reason));
    }

    @Override
    public void setStatus(boolean online, String updatedAt) {
        String json = "{\"online\":" + online + ",\"updatedAt\":"
                + (updatedAt == null ? "null" : JSONObject.quote(updatedAt)) + "}";
        call("setStatus", JSONObject.quote(json));
    }

    @Override
    public void setSleep(SleepSchedule schedule) {
        sleep = schedule;
        applySleep(alarmPending);
    }

    @Override
    public void setWeather(SlideshowPolicy.Weather weather) {
        slideshow.setWeather(weather);
    }

    @Override
    public void setSlides(List<SlideshowPolicy.Slide> slides) {
        slideshow.setSlides(slides);
        if (!slideshow.isShowing() && web != null && !dimmed) web.setVisibility(View.VISIBLE);
    }

    // ---- Slideshow ----

    private void maybeStartSlideshow() {
        if (slideshow.isShowing()) return;
        boolean asleep = dimmed || (sleep != null && sleep.isAsleep(ZonedDateTime.now()));
        if (SlideshowPolicy.shouldStart(SystemClock.elapsedRealtime(), lastActivity, asleep, slideshow.count())) {
            setSlideshow(true);
        }
    }

    private void setSlideshow(boolean on) {
        if (on) {
            slideshow.show();
        } else {
            slideshow.hide();
        }
        // The page under full-screen photos need not be composited.
        if (web != null && !dimmed) web.setVisibility(slideshow.isShowing() ? View.INVISIBLE : View.VISIBLE);
    }

    // ---- Sleep ----

    private void stayAwake() {
        awakeUntil = SystemClock.uptimeMillis() + WAKE_GRACE_MS;
    }

    /**
     * Puts the screen where the schedule says and arms the alarm for the next
     * change. Sleep keeps the display on but black with the backlight switched
     * off, so the touchscreen stays live and any tap wakes the
     * dashboard for WAKE_GRACE_MS. (Switching the display off would also power
     * down touch.) `atBoundary` is true when the alarm fired: only then is a
     * screen someone switched off (with the hardware power button, or the
     * page's) turned back on, so the morning always starts lit.
     */
    private void applySleep(boolean atBoundary) {
        handler.removeCallbacks(sleepCheck);
        if (atBoundary && sleepingOnRequest) {
            Log.i(TAG, "Sleep on request: ended by the schedule");
            sleepingOnRequest = false;
        }
        PendingIntent alarm = PendingIntent.getBroadcast(
                this, 0, new Intent(this, SleepAlarmReceiver.class), PendingIntent.FLAG_UPDATE_CURRENT);
        AlarmManager alarms = (AlarmManager) getSystemService(ALARM_SERVICE);
        if (sleep == null) {
            alarms.cancel(alarm);
            setDimmed(false);
            return; // keep alarmPending until a schedule arrives
        }
        alarmPending = false;
        ZonedDateTime now = ZonedDateTime.now();
        alarms.setExactAndAllowWhileIdle(
                AlarmManager.RTC_WAKEUP, sleep.nextChange(now).toInstant().toEpochMilli(), alarm);

        if (!sleep.isAsleep(now)) {
            setDimmed(false);
            PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
            if (atBoundary && !power.isInteractive()) wakeScreen(power);
            return;
        }
        long left = awakeUntil - SystemClock.uptimeMillis();
        if (left > 0) {
            setDimmed(false);
            handler.postDelayed(sleepCheck, left);
            return;
        }
        setDimmed(true);
    }

    /**
     * The page's power button: the same black, backlight-off cover as
     * night-time sleep, until a touch or the next schedule boundary (the
     * morning wake-up). Either hands back to the schedule (a touch during
     * sleep hours gives the usual WAKE_GRACE_MS).
     */
    private void sleepNow() {
        Log.i(TAG, "Sleep on request");
        sleepingOnRequest = true;
        setDimmed(true);
    }

    private void setDimmed(boolean dim) {
        // Bundle polls, grace-period checks and screen-on events never undo the power button; only a touch or a schedule boundary does.
        if (sleepingOnRequest) dim = true;
        if (dim == dimmed) return;
        dimmed = dim;
        handler.removeCallbacks(backlightOff);
        if (dim) {
            setSlideshow(false);
            handler.post(backlightOff);
        } else {
            lastActivity = SystemClock.elapsedRealtime(); // the morning starts on the dashboard
            backlightOn();
            // Woken (a touch or the morning): if the chip died in the dark, fix it now.
            litSince = SystemClock.elapsedRealtime();
            failedReloads = 0; // a wake gets a reload at once, whatever the night's backoff
            handler.removeCallbacks(wakeCheck);
            handler.postDelayed(wakeCheck, OutagePolicy.WAKE_GRACE_MS + 2_000);
        }
        Log.i(TAG, dim ? "Sleep: dimmed" : "Sleep: awake");
        sleepCover.setVisibility(dim ? View.VISIBLE : View.GONE);
        // The page under a black cover need not be composited at all.
        if (web != null) web.setVisibility(dim ? View.INVISIBLE : View.VISIBLE);
        // No window brightness override here: on this frame it kills the Wi-Fi (see Backlight).
    }

    /** Back to the user's brightness setting. */
    private void backlightOn() {
        int level = Settings.System.getInt(getContentResolver(), Settings.System.SCREEN_BRIGHTNESS, Backlight.MAX);
        new Thread(() -> {
            if (!backlight.set(level)) Log.w(TAG, "Sleep: could not switch the backlight on");
        }, "backlight").start();
    }

    @SuppressWarnings("deprecation") // the only way for an app to light the screen on API 27
    private static void wakeScreen(PowerManager power) {
        Log.i(TAG, "Sleep over: screen on");
        PowerManager.WakeLock lock = power.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK
                        | PowerManager.ACQUIRE_CAUSES_WAKEUP
                        | PowerManager.ON_AFTER_RELEASE,
                "kidsdash:wake");
        lock.acquire(3_000); // FLAG_KEEP_SCREEN_ON holds it from here
    }

    private void call(String method, String args) {
        if (web == null) return;
        web.evaluateJavascript("window.kidsDash&&window.kidsDash." + method + "(" + args + ")", null);
    }

    /** Called by the page from its JS thread; hands off to the controller. */
    private final class Bridge {
        @JavascriptInterface
        public void ready() {
            controller.onPageReady();
        }

        @JavascriptInterface
        public void setChore(String kidId, String choreId, String date, boolean done) {
            controller.setChore(kidId, choreId, date, done);
        }

        /** The week screen's "+": save an event (JSON per core FrameEventInput). */
        @JavascriptInterface
        public void addEvent(String requestId, String json) {
            controller.addEvent(requestId, json);
        }

        /** An event's "Edit" sheet: save it (JSON per core FrameEventEdit). */
        @JavascriptInterface
        public void editEvent(String requestId, String eventId, String json) {
            controller.editEvent(requestId, eventId, json);
        }

        /** An event's "Edit" sheet: delete it ("one" day or "all" of a repeating event). */
        @JavascriptInterface
        public void deleteEvent(String requestId, String eventId, String scope) {
            controller.deleteEvent(requestId, eventId, scope);
        }

        /** The Chores screen's "Add chore": save a chore (JSON per core FrameChoreInput). */
        @JavascriptInterface
        public void addChore(String requestId, String json) {
            controller.addChore(requestId, json);
        }

        /** The settings panel's facts about this frame, as JSON. */
        @JavascriptInterface
        public String deviceInfo() {
            return deviceInfoJson();
        }

        /** Today's power button: black the screen out until the next touch. */
        @JavascriptInterface
        public void sleepNow() {
            handler.post(MainActivity.this::sleepNow);
        }

        /** The settings panel's Wi-Fi button. */
        @JavascriptInterface
        public void openWifiSettings() {
            handler.post(MainActivity.this::openWifi);
        }

        /** The Photos button: start the slideshow now if there is anything to show. */
        @JavascriptInterface
        public void showPhotos() {
            handler.post(() -> {
                if (!dimmed && slideshow.count() > 0 && !slideshow.isShowing()) {
                    setSlideshow(true);
                }
            });
        }
    }

    // ---- Outages and the Wi-Fi watchdog ----

    private static final long WATCHDOG_CHECK_MS = 60_000;
    private static final String WATCHDOG_PREFS = "watchdog";
    private boolean rebooting;
    private boolean reloading;
    private ConnectivityManager.NetworkCallback networkBack;
    /** elapsedRealtime when the screen last lit (the app starts lit). */
    private long litSince = SystemClock.elapsedRealtime();
    /** elapsedRealtime since the watchdog has seen `deadState` (no networks or disconnected); -1: neither. */
    private long deadSince = -1;
    private OutagePolicy.Wifi deadState;
    /** elapsedRealtime of the last driver reload; -1: none since boot. */
    private long lastReload = -1;
    /** Reloads since the Wi-Fi last came back (or the screen lit): the backoff. */
    private int failedReloads;
    /** elapsedRealtime of this outage's first reload with the screen lit; -1: none. */
    private long litReloadAt = -1;
    private final Runnable wakeCheck = this::checkWatchdog;
    /** Once any scan result has been readable, an empty list means no networks rather than no access. */
    private static volatile boolean scansReadable;
    private boolean loggedWifi;
    private final Runnable watchdog = new Runnable() {
        @Override
        public void run() {
            checkWatchdog();
            handler.postDelayed(this, WATCHDOG_CHECK_MS);
        }
    };

    /** FrameController.Environment; WifiManager may be called from any thread. */
    @Override
    public OutagePolicy.Wifi wifi() {
        try {
            WifiManager wm = getApplicationContext().getSystemService(WifiManager.class);
            if (wm == null) return OutagePolicy.Wifi.UNKNOWN;
            WifiInfo info = wm.getConnectionInfo();
            boolean associated = info != null && info.getSupplicantState() == SupplicantState.COMPLETED;
            List<ScanResult> results = wm.getScanResults();
            int fresh = 0;
            long cutoffUs = (SystemClock.elapsedRealtime() - OutagePolicy.FRESH_SCAN_MS) * 1000;
            if (results != null) {
                if (!results.isEmpty()) scansReadable = true;
                for (ScanResult r : results) {
                    if (r.timestamp >= cutoffUs) fresh++;
                }
            }
            return OutagePolicy.classify(wm.isWifiEnabled(), associated, fresh, scansReadable);
        } catch (RuntimeException e) {
            Log.w(TAG, "Wi-Fi state: " + e.getMessage());
            return OutagePolicy.Wifi.UNKNOWN;
        }
    }

    @Override
    public boolean screenDark() {
        SleepSchedule schedule = sleep;
        return dimmed || (schedule != null && schedule.isAsleep(ZonedDateTime.now()));
    }

    /**
     * Once a minute, and WAKE_GRACE_MS after the screen lights: if the Wi-Fi
     * chip has gone quiet or the frame is stuck off its network (see
     * OutagePolicy), reload the driver; if that has not helped, capture the
     * network log and reboot. Reloads are silent and run
     * dark or lit; a reboot lights the screen, so never while it is dark.
     */
    private void checkWatchdog() {
        OutagePolicy.Wifi wifi = wifi();
        if (!loggedWifi) {
            loggedWifi = true;
            Log.i(TAG, "Watchdog: Wi-Fi " + wifi.wire + ", scans readable " + scansReadable);
        }
        long elapsed = SystemClock.elapsedRealtime();
        if (!OutagePolicy.needsHelp(wifi)) {
            deadSince = -1;
        } else if (deadSince < 0 || wifi != deadState) {
            deadSince = elapsed;
        }
        deadState = wifi;
        if (controller != null) controller.captureOutageLogIfDue();
        if (rebooting || reloading) return;
        boolean dark = screenDark();
        boolean changingWifi = wifiWatch != null;
        // Lit, only reloads since the screen lit count toward the wait: a wake retries at once.
        long sinceReload = lastReload < 0 || (!dark && lastReload < litSince) ? -1 : elapsed - lastReload;
        if (OutagePolicy.shouldReloadDriver(wifi, dark, changingWifi, elapsed - litSince,
                deadSince < 0 ? 0 : elapsed - deadSince, sinceReload, failedReloads)) {
            reloadDriver(wifi, dark);
            return;
        }
        long since = controller == null ? 0 : controller.offlineSince();
        if (since == 0) return;
        long now = System.currentTimeMillis();
        SharedPreferences prefs = getSharedPreferences(WATCHDOG_PREFS, MODE_PRIVATE);
        long last = prefs.getLong("lastReboot", 0);
        long reloadTriedFor = litReloadAt >= litSince ? elapsed - litReloadAt : -1;
        if (!OutagePolicy.shouldReboot(wifi, now - since, elapsed, dark, changingWifi, now, last, reloadTriedFor)) {
            return;
        }
        Log.w(TAG, "Watchdog: offline " + (now - since) / 60_000 + " min, Wi-Fi " + wifi.wire + "; rebooting");
        rebooting = true;
        prefs.edit().putLong("lastReboot", now).commit();
        controller.prepareReboot(this::rebootNow);
    }

    /**
     * See WifiPower.reloadDriver: about 10 s offline. No poll here: Wi-Fi has not
     * rejoined yet when the reload returns; the network callback polls once it has.
     */
    private void reloadDriver(OutagePolicy.Wifi wifi, boolean dark) {
        reloading = true;
        lastReload = SystemClock.elapsedRealtime();
        failedReloads++;
        if (!dark && litReloadAt < litSince) litReloadAt = lastReload;
        Log.w(TAG, "Watchdog: Wi-Fi " + wifi.wire + "; reloading the Wi-Fi driver (" + failedReloads
                + (dark ? ", dark)" : ", lit)"));
        File scratch = getCacheDir();
        new Thread(() -> {
            String result = WifiPower.reloadDriver(scratch);
            Log.i(TAG, "Watchdog: Wi-Fi driver " + result);
            handler.post(() -> reloading = false);
        }, "wifi-reload").start();
    }

    private void rebootNow() {
        try {
            if (Updater.isDeviceOwner(this)) {
                getSystemService(DevicePolicyManager.class).reboot(new ComponentName(this, FrameAdmin.class));
                return;
            }
        } catch (RuntimeException e) {
            Log.w(TAG, "Watchdog: device-owner reboot failed: " + e.getMessage());
        }
        new Thread(() -> {
            try {
                Backlight.SYSTEM.run(java.util.Arrays.asList("su", "-c", "reboot"));
            } catch (IOException | InterruptedException e) {
                Log.e(TAG, "Watchdog: reboot failed: " + e.getMessage());
            }
            handler.post(() -> rebooting = false);
        }, "reboot").start();
    }

    // ---- Settings panel ----

    /** No Home or Back key on this frame: Wi-Fi settings hands back on its own. */
    private static final long WIFI_SETTINGS_MAX_MS = 10 * 60_000;
    private ConnectivityManager.NetworkCallback wifiWatch;
    private final Runnable returnFromWifi = this::returnToDashboard;
    /** "← Dashboard" floating over Wi-Fi settings (needs the overlay permission). */
    private View backPill;

    private int installedVersion() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionCode;
        } catch (PackageManager.NameNotFoundException e) {
            return 0;
        }
    }

    /** As device owner, allow reading the Wi-Fi name (Android 8.1 ties it to location). */
    private void grantOwnPermissions() {
        if (!Updater.isDeviceOwner(this)) return;
        DevicePolicyManager dpm = getSystemService(DevicePolicyManager.class);
        try {
            dpm.setPermissionGrantState(new ComponentName(this, FrameAdmin.class), getPackageName(),
                    android.Manifest.permission.ACCESS_COARSE_LOCATION,
                    DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED);
        } catch (RuntimeException e) {
            Log.w(TAG, "Could not grant location: " + e.getMessage());
        }
    }

    private String deviceInfoJson() {
        JSONObject info = new JSONObject();
        try {
            android.content.pm.PackageInfo p = getPackageManager().getPackageInfo(getPackageName(), 0);
            info.put("versionName", p.versionName);
            info.put("versionCode", p.versionCode);
            info.put("autoUpdates", Updater.isDeviceOwner(this));
            WifiManager wifi = getApplicationContext().getSystemService(WifiManager.class);
            WifiInfo connection = wifi == null ? null : wifi.getConnectionInfo();
            String ssid = connection == null ? null : connection.getSSID();
            if (ssid != null && ssid.startsWith("\"") && ssid.endsWith("\"")) ssid = ssid.substring(1, ssid.length() - 1);
            info.put("network", ssid == null || ssid.contains("unknown ssid") ? JSONObject.NULL : ssid);
            int ip = connection == null ? 0 : connection.getIpAddress();
            info.put("ip", ip == 0 ? JSONObject.NULL
                    : (ip & 0xff) + "." + (ip >> 8 & 0xff) + "." + (ip >> 16 & 0xff) + "." + (ip >> 24 & 0xff));
        } catch (Exception e) {
            Log.w(TAG, "Device info: " + e.getMessage());
        }
        return info.toString();
    }

    /**
     * Opens Android's Wi-Fi settings. The frame has no Home or Back key, so the
     * dashboard returns by itself once a different network is up, or after
     * WIFI_SETTINGS_MAX_MS.
     */
    private void openWifi() {
        stopWatchingWifi();
        ConnectivityManager cm = getSystemService(ConnectivityManager.class);
        Network before = cm == null ? null : cm.getActiveNetwork();
        if (cm != null) {
            wifiWatch = new ConnectivityManager.NetworkCallback() {
                @Override
                public void onCapabilitiesChanged(Network network, NetworkCapabilities caps) {
                    if (!network.equals(before) && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) {
                        handler.postDelayed(returnFromWifi, 3_000); // let "Connected" show briefly
                    }
                }
            };
            cm.registerDefaultNetworkCallback(wifiWatch, handler);
        }
        handler.postDelayed(returnFromWifi, WIFI_SETTINGS_MAX_MS);
        try {
            startActivity(new Intent(Settings.ACTION_WIFI_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            showBackPill();
        } catch (RuntimeException e) {
            Log.w(TAG, "No Wi-Fi settings: " + e.getMessage());
            stopWatchingWifi();
        }
    }

    private void returnToDashboard() {
        stopWatchingWifi();
        // What the Home key would do: the dashboard is the home activity.
        startActivity(new Intent(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_HOME)
                .setPackage(getPackageName())
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }

    private void showBackPill() {
        if (backPill != null || !Settings.canDrawOverlays(this)) return;
        android.widget.TextView pill = new android.widget.TextView(this);
        pill.setText("\u2190  Dashboard");
        pill.setTextColor(0xffffffff);
        pill.setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, 34);
        pill.setTypeface(android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.BOLD));
        pill.setPadding(44, 22, 48, 24);
        android.graphics.drawable.GradientDrawable bg = new android.graphics.drawable.GradientDrawable();
        bg.setColor(0xff4a3a3a);
        bg.setCornerRadius(60);
        pill.setBackground(bg);
        pill.setElevation(12);
        pill.setOnClickListener(v -> returnToDashboard());
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                android.graphics.PixelFormat.TRANSLUCENT);
        lp.gravity = android.view.Gravity.BOTTOM | android.view.Gravity.END;
        lp.x = 48;
        lp.y = 48;
        try {
            getSystemService(WindowManager.class).addView(pill, lp);
            backPill = pill;
        } catch (RuntimeException e) {
            Log.w(TAG, "No back button over settings: " + e.getMessage());
        }
    }

    private void stopWatchingWifi() {
        handler.removeCallbacks(returnFromWifi);
        if (backPill != null) {
            try {
                getSystemService(WindowManager.class).removeView(backPill);
            } catch (RuntimeException ignored) {
                // already gone
            }
            backPill = null;
        }
        if (wifiWatch == null) return;
        ConnectivityManager cm = getSystemService(ConnectivityManager.class);
        try {
            if (cm != null) cm.unregisterNetworkCallback(wifiWatch);
        } catch (RuntimeException ignored) {
            // already gone
        }
        wifiWatch = null;
    }

    /** The paintings that come with the app and the ones it downloads (ArtLibrary). */
    private ArtLibrary loadArt() {
        List<String> inApp = new java.util.ArrayList<>();
        String manifest = null;
        try {
            String[] names = getAssets().list("web/art");
            if (names != null) inApp.addAll(java.util.Arrays.asList(names));
            try (InputStream in = getAssets().open(ArtLibrary.MANIFEST_ASSET)) {
                manifest = new String(readAll(in), StandardCharsets.UTF_8);
            }
        } catch (IOException e) {
            Log.w(TAG, "Art: no download list in this build: " + e.getMessage());
        }
        return new ArtLibrary(inApp, ArtLibrary.parseManifest(manifest), FrameController.artDir(getFilesDir()));
    }

    private static byte[] readAll(InputStream in) throws IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buffer = new byte[16 * 1024];
        int n;
        while ((n = in.read(buffer)) != -1) out.write(buffer, 0, n);
        return out.toByteArray();
    }

    /** Serves assets/web under the app-only origin and refuses everything else. */
    private final class LocalAssetClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (!"https".equals(url.getScheme()) || !ORIGIN_HOST.equals(url.getHost())) {
                return refuse(403, "Forbidden");
            }
            String path = url.getPath() == null || url.getPath().equals("/") ? "/index.html" : url.getPath();
            if (path.contains("..")) return refuse(404, "Not Found");
            try {
                InputStream in = open(path);
                WebResourceResponse response = new WebResourceResponse(mimeType(path), null, in);
                response.setResponseHeaders(Collections.singletonMap("Cache-Control", "no-cache"));
                return response;
            } catch (IOException e) {
                return refuse(404, "Not Found");
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return true; // no navigation away from the dashboard
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            Log.e(TAG, "WebView renderer gone; recreating");
            web = null;
            recreate();
            return true;
        }

        /** The app's own file, or a painting downloaded since (ArtLibrary). */
        private InputStream open(String path) throws IOException {
            try {
                return getAssets().open("web" + path);
            } catch (IOException notInApp) {
                ArtLibrary library = art;
                File file = library != null && path.startsWith("/art/")
                        ? library.downloaded(path.substring("/art/".length()))
                        : null;
                if (file == null) throw notInApp;
                return new java.io.FileInputStream(file);
            }
        }

        private WebResourceResponse refuse(int status, String reason) {
            return new WebResourceResponse("text/plain", "utf-8", status, reason,
                    Collections.<String, String>emptyMap(), new ByteArrayInputStream(new byte[0]));
        }
    }

    static String mimeType(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "text/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".webp")) return "image/webp";
        if (path.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }
}
