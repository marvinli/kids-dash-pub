package dev.kidsdash.frame;

import android.app.PendingIntent;
import android.app.admin.DevicePolicyManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInstaller;
import android.util.Log;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Over-the-air updates: when a verified bundle names a newer app release, the
 * APK is downloaded, checked against the sha256 the signed bundle carries, and
 * installed through PackageInstaller. As the device owner the app may install
 * without asking anyone; Android also refuses any APK not signed with this
 * app's key. A failed release is remembered and retried after a while.
 */
final class Updater {
    private static final String TAG = "KidsDash";
    private static final String PREFS = "updates";
    static final String EXTRA_SHA = "dev.kidsdash.frame.UPDATE_SHA";

    private final Context context;
    private final ApiClient api;
    private final int installed;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    /** sha256 of a release being downloaded or installed (worker thread). */
    private String busy;
    private boolean warnedNotOwner;

    Updater(Context context, ApiClient api, int installed) {
        this.context = context.getApplicationContext();
        this.api = api;
        this.installed = installed;
    }

    /** Called with each verified bundle's release (any thread). */
    void offer(UpdatePolicy.Release release) {
        if (release == null || api == null) return;
        worker.execute(() -> maybeInstall(release));
    }

    void stop() {
        worker.shutdownNow();
    }

    static boolean isDeviceOwner(Context context) {
        DevicePolicyManager dpm = context.getSystemService(DevicePolicyManager.class);
        return dpm != null && dpm.isDeviceOwnerApp(context.getPackageName());
    }

    private void maybeInstall(UpdatePolicy.Release release) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String failedSha = prefs.getString("failedSha", null);
        long failedAt = prefs.getLong("failedAt", 0);
        if (release.sha256.equals(busy)) return;
        if (!UpdatePolicy.shouldInstall(installed, release, failedSha, failedAt, System.currentTimeMillis())) return;
        if (!isDeviceOwner(context)) {
            if (!warnedNotOwner) Log.w(TAG, "Update " + release.versionName + " available, but not device owner");
            warnedNotOwner = true;
            return;
        }
        busy = release.sha256;
        File apk = new File(context.getCacheDir(), "update.apk");
        File part = new File(context.getCacheDir(), UpdatePolicy.partName(release.sha256));
        dropOtherParts(part);
        try {
            Log.i(TAG, "Updating " + installed + " -> " + release.versionCode + " (" + release.versionName + ")"
                    + (part.exists() ? ", resuming at " + part.length() / 1024 + " KB" : ""));
            api.fetchApp(release.sha256, part, apk);
            install(apk, release.sha256);
            // Success kills this process; the replaced-package receiver relaunches it.
        } catch (ApiClient.DownloadInterrupted e) {
            // Not a failure: the next bundle (the network callback polls as soon
            // as Wi-Fi is back) offers the release again and the download resumes.
            Log.w(TAG, "Update paused, " + e.getMessage());
            busy = null;
        } catch (IOException | RuntimeException e) {
            Log.w(TAG, "Update failed: " + e.getMessage());
            recordFailure(context, release.sha256);
            busy = null;
        } finally {
            //noinspection ResultOfMethodCallIgnored
            apk.delete();
        }
    }

    private void install(File apk, String sha256) throws IOException {
        PackageInstaller installer = context.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params =
                new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(context.getPackageName());
        int id = installer.createSession(params);
        try (PackageInstaller.Session session = installer.openSession(id)) {
            try (InputStream in = new FileInputStream(apk);
                    OutputStream out = session.openWrite("app.apk", 0, apk.length())) {
                byte[] buffer = new byte[64 * 1024];
                int n;
                while ((n = in.read(buffer)) != -1) out.write(buffer, 0, n);
                session.fsync(out);
            }
            Intent result = new Intent(context, UpdateReceiver.class).putExtra(EXTRA_SHA, sha256);
            PendingIntent pending = PendingIntent.getBroadcast(context, id, result, PendingIntent.FLAG_UPDATE_CURRENT);
            session.commit(pending.getIntentSender());
        }
    }

    /** A partial download of an older release is never resumed: free its space. */
    private void dropOtherParts(File keep) {
        File[] parts = context.getCacheDir().listFiles((dir, name) -> name.startsWith("update-") && name.endsWith(".part"));
        if (parts == null) return;
        for (File f : parts) {
            //noinspection ResultOfMethodCallIgnored
            if (!f.equals(keep)) f.delete();
        }
    }

    static void recordFailure(Context context, String sha256) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString("failedSha", sha256)
                .putLong("failedAt", System.currentTimeMillis())
                .apply();
    }
}
