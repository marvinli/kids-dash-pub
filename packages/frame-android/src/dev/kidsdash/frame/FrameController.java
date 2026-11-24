package dev.kidsdash.frame;

import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Keeps the page fed. Everything network- or disk-bound runs on one worker
 * thread, so a chore save and the bundle fetch after it are naturally ordered;
 * UI calls hop to the main thread. The last verified envelope is cached on
 * disk (and re-verified on load) so the frame shows the day after a reboot
 * even before Wi-Fi is back.
 */
final class FrameController {
    interface Ui {
        void render(String bundleJson);

        void setPhotos(String photosJson);

        /** A check-off for `date` was saved (or failed): the page matches it to the tap. */
        void choreSaved(String kidId, String choreId, String date);

        void choreFailed(String kidId, String choreId, String date);

        /** An event added on the frame was saved (`eventId` as the bundle will name it). */
        void eventSaved(String requestId, String eventId);

        void eventFailed(String requestId, String reason);

        /** A chore added on the frame was saved (`choreJson` as the server stored it). */
        void choreAdded(String requestId, String choreJson);

        void choreAddFailed(String requestId, String reason);

        void setStatus(boolean online, String updatedAt);

        /** Null when the screen should stay on around the clock. */
        void setSleep(SleepSchedule sleep);

        /** Today's forecast for the slideshow, or null when the bundle has none. */
        void setWeather(SlideshowPolicy.Weather weather);

        /** Slides verified and on disk under slideDir(), newest first. */
        void setSlides(List<SlideshowPolicy.Slide> slides);

        /** The art files the page can load (ArtLibrary.readyJson). */
        void setArt(String namesJson);
    }

    /** What the outage tracking asks about the frame; callable from any thread. */
    interface Environment {
        OutagePolicy.Wifi wifi();

        /** Sleep hours or the power button: the screen is black. */
        boolean screenDark();
    }

    private static final String TAG = "KidsDash";
    static final long POLL_MS = 60_000;
    static final long MAX_BACKOFF_MS = 5 * 60_000;

    private final ScheduledExecutorService worker = Executors.newSingleThreadScheduledExecutor();
    /** Slide downloads (videos can take minutes) run apart from polls and chore saves. */
    private final ExecutorService slideWorker = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final File cacheFile;
    private final File photoDir;
    private final File slideDir;
    /** Downloaded backdrop paintings; null until the activity hands it over. */
    private volatile ArtLibrary art;
    /** An art pass is queued on the slide worker (one is enough). */
    private final AtomicBoolean artQueued = new AtomicBoolean();
    /** The slides the latest bundle lists; the slide worker catches up to it. */
    private volatile List<SlideshowPolicy.Slide> wantedSlides = new ArrayList<>();
    private final BundleVerifier verifier;
    private final ApiClient api;
    private final Ui ui;
    /** Installs newer app releases the bundle names; null in tests or without a token. */
    private final Updater updater;
    private final Environment env;
    private final int appVersion;
    /**
     * The outage in progress, if any, on disk so it survives a reboot:
     * {since, wifi, asleep, appVersion, watchdog, log}. Reported (then
     * deleted) at the first good poll if it lasted OutagePolicy.REPORT_AFTER_MS.
     */
    private final File outageFile;
    /** Wall-clock ms of a recent good poll, written every few minutes, for outages that start at boot. */
    private final File lastOkFile;
    private static final long LAST_OK_WRITE_MS = 5 * 60_000L;
    private long lastOkMs;
    private long lastOkWrittenMs;
    /** Wall-clock ms of the last good poll before the current outage; 0 while online. */
    private volatile long offlineSinceMs;

    // Worker-thread state.
    private String etag;
    private String payload;
    private String fetchedAt;
    private String photosJson = "{}";
    private long backoffMs = POLL_MS;
    /** The next scheduled poll; only touched on the worker thread. */
    private ScheduledFuture<?> nextPoll;
    private boolean online = true;

    FrameController(
            File filesDir,
            BundleVerifier verifier,
            ApiClient api,
            Ui ui,
            Updater updater,
            Environment env,
            int appVersion) {
        this.updater = updater;
        this.env = env;
        this.appVersion = appVersion;
        this.outageFile = new File(filesDir, "outage.json");
        this.lastOkFile = new File(filesDir, "last-ok");
        this.cacheFile = new File(filesDir, "bundle-envelope.json");
        this.photoDir = new File(filesDir, "photos");
        this.slideDir = slideDir(filesDir);
        this.verifier = verifier;
        this.api = api;
        this.ui = ui;
    }

    void start() {
        worker.execute(this::loadOutage);
        worker.execute(this::loadCache);
        worker.execute(this::poll);
    }

    void stop() {
        worker.shutdownNow();
        slideWorker.shutdownNow();
        if (updater != null) updater.stop();
    }

    static File slideDir(File filesDir) {
        return new File(filesDir, "slides");
    }

    static File artDir(File filesDir) {
        return new File(filesDir, "art");
    }

    /** The paintings this build downloads; set before start(). */
    void useArt(ArtLibrary library) {
        art = library;
    }

    /** The page loaded (or reloaded): give it what we have. */
    void onPageReady() {
        worker.execute(() -> {
            ArtLibrary library = art;
            if (library != null) {
                String ready = library.readyJson();
                main.post(() -> ui.setArt(ready));
            }
            if (payload != null) {
                String bundle = payload;
                String photos = photosJson;
                main.post(() -> {
                    ui.render(bundle);
                    ui.setPhotos(photos);
                });
            }
            reportStatus();
        });
    }

    void refreshSoon() {
        worker.execute(this::refreshQuietly);
    }

    void setChore(String kidId, String choreId, String date, boolean done) {
        worker.execute(() -> {
            if (api == null) {
                main.post(() -> ui.choreFailed(kidId, choreId, date));
                return;
            }
            try {
                api.setChore(kidId, choreId, date, done);
                main.post(() -> ui.choreSaved(kidId, choreId, date));
                refreshQuietly();
            } catch (IOException e) {
                Log.w(TAG, "Saving chore failed: " + e.getMessage());
                main.post(() -> ui.choreFailed(kidId, choreId, date));
            }
        });
    }

    /** Saves an event added on the week screen, then refreshes so it shows. */
    void addEvent(String requestId, String json) {
        worker.execute(() -> {
            if (api == null) {
                main.post(() -> ui.eventFailed(requestId, "offline"));
                return;
            }
            try {
                String id = api.addEvent(json);
                refreshQuietly();
                main.post(() -> ui.eventSaved(requestId, id));
            } catch (IOException e) {
                Log.w(TAG, "Adding event failed: " + e.getMessage());
                String reason = failureReason(e);
                main.post(() -> ui.eventFailed(requestId, reason));
            }
        });
    }

    /** Saves an edit to a calendar event, then refreshes so it shows. Answers like addEvent. */
    void editEvent(String requestId, String eventId, String json) {
        worker.execute(() -> {
            if (api == null) {
                main.post(() -> ui.eventFailed(requestId, "offline"));
                return;
            }
            try {
                api.editEvent(eventId, json);
                refreshQuietly();
                main.post(() -> ui.eventSaved(requestId, eventId));
            } catch (IOException e) {
                Log.w(TAG, "Editing event failed: " + e.getMessage());
                String reason = failureReason(e);
                main.post(() -> ui.eventFailed(requestId, reason));
            }
        });
    }

    /** Deletes an event; one already gone (404) counts as deleted. */
    void deleteEvent(String requestId, String eventId, String scope) {
        worker.execute(() -> {
            if (api == null) {
                main.post(() -> ui.eventFailed(requestId, "offline"));
                return;
            }
            try {
                try {
                    api.deleteEvent(eventId, scope);
                } catch (ApiClient.HttpException e) {
                    if (e.status != 404) throw e;
                }
                refreshQuietly();
                main.post(() -> ui.eventSaved(requestId, eventId));
            } catch (IOException e) {
                Log.w(TAG, "Deleting event failed: " + e.getMessage());
                String reason = failureReason(e);
                main.post(() -> ui.eventFailed(requestId, reason));
            }
        });
    }

    /**
     * What the page tells the user: "invalid" (400: fix the form), "refused"
     * (the server or Google said no: 403/404/409/429), else "offline".
     */
    static String failureReason(IOException e) {
        if (!(e instanceof ApiClient.HttpException)) return "offline";
        int status = ((ApiClient.HttpException) e).status;
        if (status == 400) return "invalid";
        if (status == 403 || status == 404 || status == 409 || status == 429) return "refused";
        return "offline";
    }

    /** Saves a chore added on the Chores screen, then refreshes so it shows. */
    void addChore(String requestId, String json) {
        worker.execute(() -> {
            if (api == null) {
                main.post(() -> ui.choreAddFailed(requestId, "offline"));
                return;
            }
            try {
                String chore = api.addChore(json);
                refreshQuietly();
                main.post(() -> ui.choreAdded(requestId, chore));
            } catch (IOException e) {
                Log.w(TAG, "Adding chore failed: " + e.getMessage());
                String reason = e instanceof ApiClient.HttpException && ((ApiClient.HttpException) e).status == 400
                        ? "invalid"
                        : "offline";
                main.post(() -> ui.choreAddFailed(requestId, reason));
            }
        });
    }

    private void poll() {
        boolean ok = refreshQuietly();
        backoffMs = ok ? POLL_MS : Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        if (!worker.isShutdown()) nextPoll = worker.schedule(this::poll, backoffMs, TimeUnit.MILLISECONDS);
    }

    /**
     * The network is back (Wi-Fi rejoined, the driver reloaded, a reboot):
     * poll now rather than waiting out the backoff, so the dashboard and the
     * "Offline" line catch up within seconds.
     */
    void networkBack() {
        if (worker.isShutdown()) return;
        worker.execute(() -> {
            if (nextPoll == null) return; // the first poll has not run yet
            Log.i(TAG, "Network up: polling now");
            nextPoll.cancel(false);
            backoffMs = POLL_MS;
            poll();
        });
    }

    private boolean refreshQuietly() {
        if (api == null) {
            Log.e(TAG, "No device token: provision the frame (see packages/frame-android/README.md)");
            setOnline(false);
            return false;
        }
        try {
            ApiClient.BundleResponse response = api.fetchBundle(etag);
            fetchedAt = Instant.now().toString();
            if (response.status == 200) accept(response.body, response.etag, true);
            setOnline(true);
            noteReachable();
            return true;
        } catch (IOException | JSONException | BundleVerifier.VerificationException e) {
            Log.w(TAG, "Refresh failed: " + e.getMessage());
            setOnline(false);
            noteUnreachable();
            return false;
        }
    }

    // ---- Outages (worker thread) ----

    /** Wall-clock ms since when the API has been unreachable, or 0 when it is not. */
    long offlineSince() {
        return offlineSinceMs;
    }

    private void loadOutage() {
        try {
            if (lastOkFile.exists()) {
                lastOkMs = Long.parseLong(new String(Files.readAllBytes(lastOkFile.toPath()), StandardCharsets.UTF_8).trim());
            }
        } catch (IOException | NumberFormatException e) {
            lastOkMs = 0;
        }
        JSONObject outage = readOutage();
        if (outage != null) offlineSinceMs = outage.optLong("since", 0);
    }

    private JSONObject readOutage() {
        if (!outageFile.exists()) return null;
        try {
            return new JSONObject(new String(Files.readAllBytes(outageFile.toPath()), StandardCharsets.UTF_8));
        } catch (IOException | JSONException e) {
            Log.w(TAG, "Discarding outage record: " + e.getMessage());
            //noinspection ResultOfMethodCallIgnored
            outageFile.delete();
            return null;
        }
    }

    private void writeOutage(JSONObject outage) {
        try {
            writeAtomically(outageFile, outage.toString().getBytes(StandardCharsets.UTF_8));
        } catch (IOException e) {
            Log.w(TAG, "Could not record outage: " + e.getMessage());
        }
    }

    /** A failed poll: start (or update) the outage record. */
    private void noteUnreachable() {
        long now = System.currentTimeMillis();
        OutagePolicy.Wifi wifi = env == null ? OutagePolicy.Wifi.UNKNOWN : env.wifi();
        JSONObject outage = readOutage();
        try {
            if (outage == null) {
                long since = lastOkMs > 0 ? lastOkMs : now;
                outage = new JSONObject();
                outage.put("since", since);
                outage.put("wifi", wifi.wire);
                outage.put("asleep", env != null && env.screenDark());
                outage.put("appVersion", appVersion);
                outage.put("watchdog", false);
                writeOutage(outage);
                offlineSinceMs = since;
                Log.w(TAG, "Outage: API unreachable, Wi-Fi " + wifi.wire);
            } else {
                offlineSinceMs = outage.optLong("since", now);
                OutagePolicy.Wifi seen = OutagePolicy.Wifi.fromWire(outage.optString("wifi"));
                if (seen.worst(wifi) != seen) {
                    outage.put("wifi", seen.worst(wifi).wire);
                    writeOutage(outage);
                    Log.w(TAG, "Outage: Wi-Fi now " + wifi.wire);
                }
            }
        } catch (JSONException e) {
            Log.w(TAG, "Outage record: " + e.getMessage());
        }
    }

    /** A good poll: remember it, and report the outage that just ended. */
    private void noteReachable() {
        long now = System.currentTimeMillis();
        lastOkMs = now;
        offlineSinceMs = 0;
        if (now - lastOkWrittenMs >= LAST_OK_WRITE_MS) {
            try {
                writeAtomically(lastOkFile, Long.toString(now).getBytes(StandardCharsets.UTF_8));
                lastOkWrittenMs = now;
            } catch (IOException e) {
                Log.w(TAG, "Could not record last poll: " + e.getMessage());
            }
        }
        JSONObject outage = readOutage();
        if (outage == null) return;
        long since = outage.optLong("since", now);
        if (!OutagePolicy.worthReporting(since, now) || api == null) {
            //noinspection ResultOfMethodCallIgnored
            outageFile.delete();
            return;
        }
        long bootedAt = now - SystemClock.elapsedRealtime();
        try {
            JSONObject report = new JSONObject();
            report.put("since", Instant.ofEpochMilli(since).toString());
            report.put("until", Instant.ofEpochMilli(now).toString());
            report.put("wifi", OutagePolicy.Wifi.fromWire(outage.optString("wifi")).wire);
            report.put("asleep", outage.optBoolean("asleep"));
            report.put("reboot", OutagePolicy.reboot(outage.optBoolean("watchdog"), bootedAt, since));
            report.put("appVersion", outage.optInt("appVersion", appVersion));
            report.put("log", outage.has("log") ? outage.getString("log") : JSONObject.NULL);
            api.reportIncident(report.toString());
            Log.i(TAG, "Outage reported: " + (now - since) / 60_000 + " min");
            //noinspection ResultOfMethodCallIgnored
            outageFile.delete();
        } catch (ApiClient.HttpException e) {
            // 400/403/404 will never be accepted; anything else is retried at the next good poll.
            if (e.status == 400 || e.status == 403 || e.status == 404) {
                Log.w(TAG, "Outage report refused: " + e.getMessage());
                //noinspection ResultOfMethodCallIgnored
                outageFile.delete();
            }
        } catch (IOException | JSONException e) {
            Log.w(TAG, "Outage report failed: " + e.getMessage());
        }
    }

    /**
     * Once an outage has lasted OutagePolicy.LOG_AFTER_MS, keep the network log
     * lines in its record (once), so the report explains it even if someone
     * power-cycles the frame. Called by the watchdog each minute; the capture
     * runs on the worker.
     */
    void captureOutageLogIfDue() {
        long since = offlineSinceMs;
        if (since == 0) return;
        worker.execute(() -> {
            JSONObject outage = readOutage();
            if (outage == null || !OutagePolicy.shouldCaptureLog(System.currentTimeMillis() - since, outage.has("log"))) {
                return;
            }
            try {
                outage.put("log", OutagePolicy.excerpt(SystemLog.logcat(cacheFile.getParentFile()),
                        SystemLog.dmesg(cacheFile.getParentFile())));
                writeOutage(outage);
                Log.i(TAG, "Outage: kept the network log");
            } catch (JSONException e) {
                Log.w(TAG, "Outage record: " + e.getMessage());
            }
        });
    }

    /**
     * The watchdog is about to reboot: note that in the outage record with the
     * network log lines, then run `reboot` on the main thread.
     */
    void prepareReboot(Runnable reboot) {
        worker.execute(() -> {
            JSONObject outage = readOutage();
            if (outage == null) outage = new JSONObject();
            try {
                if (!outage.has("since")) outage.put("since", offlineSinceMs > 0 ? offlineSinceMs : System.currentTimeMillis());
                if (!outage.has("asleep")) outage.put("asleep", false);
                if (!outage.has("appVersion")) outage.put("appVersion", appVersion);
                OutagePolicy.Wifi now = env == null ? OutagePolicy.Wifi.UNKNOWN : env.wifi();
                outage.put("wifi", OutagePolicy.Wifi.fromWire(outage.optString("wifi")).worst(now).wire);
                outage.put("watchdog", true);
                outage.put("log", OutagePolicy.combine(outage.optString("log", null),
                        SystemLog.logcat(cacheFile.getParentFile()), SystemLog.dmesg(cacheFile.getParentFile())));
            } catch (JSONException e) {
                Log.w(TAG, "Outage record: " + e.getMessage());
            }
            writeOutage(outage);
            main.post(reboot);
        });
    }

    /** Verifies an envelope, shows it, and (for fresh ones) caches it. */
    private void accept(String envelopeJson, String newEtag, boolean persist)
            throws JSONException, BundleVerifier.VerificationException, IOException {
        JSONObject envelope = new JSONObject(envelopeJson);
        String verified = verifier.verify(
                envelope.getString("payload"), envelope.getString("signature"), envelope.getString("keyId"));
        etag = newEtag;
        payload = verified;
        if (persist) {
            JSONObject cache = new JSONObject();
            cache.put("etag", newEtag == null ? JSONObject.NULL : newEtag);
            cache.put("fetchedAt", fetchedAt);
            cache.put("envelope", envelopeJson);
            writeAtomically(cacheFile, cache.toString().getBytes(StandardCharsets.UTF_8));
        }
        JSONObject bundle = new JSONObject(verified);
        SleepSchedule sleep = sleepFrom(bundle);
        SlideshowPolicy.Weather weather = weatherFrom(bundle);
        main.post(() -> {
            ui.render(verified);
            ui.setSleep(sleep);
            ui.setWeather(weather);
        });
        updatePhotos(bundle);
        wantedSlides = slidesFrom(bundle);
        slideWorker.execute(this::updateSlides);
        if (artQueued.compareAndSet(false, true)) slideWorker.execute(this::updateArt);
        if (updater != null) updater.offer(appFrom(bundle));
    }

    static List<SlideshowPolicy.Slide> slidesFrom(JSONObject bundle) {
        List<SlideshowPolicy.Slide> slides = new ArrayList<>();
        JSONArray list = bundle.optJSONArray("slides");
        if (list == null) return slides;
        for (int i = 0; i < list.length(); i++) {
            JSONObject slide = list.optJSONObject(i);
            if (slide == null) continue;
            String sha = slide.optString("sha256", null);
            if (!SlideshowPolicy.isSlideName(sha)) continue;
            slides.add(new SlideshowPolicy.Slide(sha, "video".equals(slide.optString("kind"))));
        }
        return slides;
    }

    /**
     * Brings slides/ in line with the latest bundle: downloads what is missing
     * (verified by hash, see ApiClient.fetchSlide), deletes what is no longer
     * listed, and tells the UI after each download so the show grows as files
     * arrive. A failed download is retried with the next bundle or restart,
     * a cut one from where it stopped.
     */
    private void updateSlides() {
        List<SlideshowPolicy.Slide> wanted = wantedSlides;
        if (!slideDir.exists() && !slideDir.mkdirs()) return;
        Set<String> names = new HashSet<>();
        for (SlideshowPolicy.Slide slide : wanted) {
            names.add(slide.sha256);
            names.add(slide.sha256 + ApiClient.PART_SUFFIX); // a cut download resumes
        }
        File[] existing = slideDir.listFiles();
        if (existing != null) {
            for (File f : existing) {
                //noinspection ResultOfMethodCallIgnored
                if (!names.contains(f.getName())) f.delete();
            }
        }
        publishSlides(wanted);
        for (SlideshowPolicy.Slide slide : wanted) {
            if (wantedSlides != wanted) return; // a newer bundle queued its own pass
            File file = new File(slideDir, slide.sha256);
            if (file.exists() || api == null) continue;
            try {
                api.fetchSlide(slide.sha256, file);
                publishSlides(wanted);
            } catch (IOException e) {
                Log.w(TAG, "Slide " + slide.sha256.substring(0, 8) + " unavailable: " + e.getMessage());
            }
        }
    }

    /**
     * Downloads the backdrop paintings this build lists and does not have yet,
     * after the slides (one download at a time keeps the Wi-Fi up), telling
     * the page after each so a painting joins once its last file is in. A
     * failure waits for the next bundle; a cut download resumes.
     */
    private void updateArt() {
        artQueued.set(false);
        ArtLibrary library = art;
        if (library == null || api == null) return;
        library.prune();
        List<String> missing = library.missing();
        if (missing.isEmpty()) return;
        if (!library.dir().exists() && !library.dir().mkdirs()) return;
        Log.i(TAG, "Art: downloading " + missing.size() + " files");
        int failed = 0;
        for (String sha : missing) {
            try {
                api.fetchArt(sha, new File(library.dir(), sha));
                String ready = library.readyJson();
                main.post(() -> ui.setArt(ready));
            } catch (IOException e) {
                Log.w(TAG, "Art " + sha.substring(0, 8) + " unavailable: " + e.getMessage());
                // Offline: the rest would fail too; try again with the next bundle.
                if (e instanceof ApiClient.DownloadInterrupted || ++failed >= 3) return;
            }
        }
        Log.i(TAG, "Art: all downloaded");
    }

    private void publishSlides(List<SlideshowPolicy.Slide> wanted) {
        List<SlideshowPolicy.Slide> ready = new ArrayList<>();
        for (SlideshowPolicy.Slide slide : wanted) {
            if (new File(slideDir, slide.sha256).exists()) ready.add(slide);
        }
        main.post(() -> ui.setSlides(ready));
    }

    /** A bad window is logged and ignored: better a lit screen than a dark one. */
    static UpdatePolicy.Release appFrom(JSONObject bundle) {
        JSONObject app = bundle.optJSONObject("app");
        if (app == null) return null;
        try {
            return new UpdatePolicy.Release(app.getInt("versionCode"), app.getString("versionName"), app.getString("sha256"));
        } catch (JSONException e) {
            return null;
        }
    }

    static SlideshowPolicy.Weather weatherFrom(JSONObject bundle) {
        JSONObject weather = bundle.optJSONObject("weather");
        if (weather == null) return null;
        try {
            return new SlideshowPolicy.Weather(
                    SlideshowPolicy.sky(weather.getInt("code")),
                    weather.getInt("high"),
                    weather.getInt("low"),
                    weather.isNull("current") || !weather.has("current") ? null : weather.getInt("current"));
        } catch (JSONException e) {
            return null;
        }
    }

    static SleepSchedule sleepFrom(JSONObject bundle) {
        JSONObject sleep = bundle.optJSONObject("sleep");
        if (sleep == null) return null;
        try {
            return new SleepSchedule(sleep.getString("start"), sleep.getString("end"), bundle.getString("timezone"));
        } catch (JSONException | RuntimeException e) {
            Log.w(TAG, "Ignoring sleep window: " + e.getMessage());
            return null;
        }
    }

    private void loadCache() {
        if (!cacheFile.exists()) return;
        try {
            JSONObject cache = new JSONObject(new String(Files.readAllBytes(cacheFile.toPath()), StandardCharsets.UTF_8));
            fetchedAt = cache.optString("fetchedAt", null);
            accept(cache.getString("envelope"), cache.isNull("etag") ? null : cache.getString("etag"), false);
        } catch (IOException | JSONException | BundleVerifier.VerificationException e) {
            Log.w(TAG, "Discarding cached bundle: " + e.getMessage());
            //noinspection ResultOfMethodCallIgnored
            cacheFile.delete();
        }
    }

    /** Downloads photos the bundle names, checks each hash, and drops stale ones. */
    private void updatePhotos(JSONObject bundle) throws JSONException {
        if (!photoDir.exists() && !photoDir.mkdirs()) return;
        JSONObject photos = new JSONObject();
        Set<String> keep = new HashSet<>();
        JSONArray kids = bundle.getJSONArray("kids");
        for (int i = 0; i < kids.length(); i++) {
            JSONObject kid = kids.getJSONObject(i);
            if (kid.isNull("photo")) continue;
            String sha = kid.getJSONObject("photo").getString("sha256");
            String kidId = kid.getString("id");
            File file = new File(photoDir, sha);
            try {
                if (!file.exists()) {
                    if (api == null) continue;
                    byte[] bytes = api.fetchPhoto(kidId);
                    if (!sha.equals(BundleVerifier.sha256Hex(bytes))) {
                        Log.w(TAG, "Photo for " + kidId + " does not match its hash");
                        continue;
                    }
                    writeAtomically(file, bytes);
                }
                byte[] bytes = Files.readAllBytes(file.toPath());
                photos.put(kidId, "data:" + sniffType(bytes) + ";base64," + Base64.getEncoder().encodeToString(bytes));
                keep.add(sha);
            } catch (IOException e) {
                Log.w(TAG, "Photo for " + kidId + " unavailable: " + e.getMessage());
            }
        }
        File[] existing = photoDir.listFiles();
        if (existing != null) {
            for (File f : existing) {
                //noinspection ResultOfMethodCallIgnored
                if (!keep.contains(f.getName())) f.delete();
            }
        }
        photosJson = photos.toString();
        String json = photosJson;
        main.post(() -> ui.setPhotos(json));
    }

    private void setOnline(boolean value) {
        online = value;
        reportStatus();
    }

    private void reportStatus() {
        boolean isOnline = online;
        String when = fetchedAt;
        main.post(() -> ui.setStatus(isOnline, when));
    }

    static String sniffType(byte[] b) {
        if (b.length > 3 && (b[0] & 0xff) == 0xff && (b[1] & 0xff) == 0xd8) return "image/jpeg";
        if (b.length > 8 && (b[0] & 0xff) == 0x89 && b[1] == 'P') return "image/png";
        return "image/webp";
    }

    private static void writeAtomically(File target, byte[] bytes) throws IOException {
        File tmp = new File(target.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(bytes);
            out.getFD().sync();
        }
        if (!tmp.renameTo(target)) throw new IOException("Could not write " + target.getName());
    }
}
