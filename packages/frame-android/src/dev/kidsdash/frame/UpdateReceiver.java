package dev.kidsdash.frame;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.util.Log;

/**
 * Install results. A successful self-update usually kills the app before this
 * runs; failures are logged and the release is held off for a while.
 */
public final class UpdateReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) {
            // Back to the dashboard after an update.
            context.startActivity(new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            return;
        }
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_SUCCESS) {
            Log.i("KidsDash", "Update installed");
            return;
        }
        Log.w("KidsDash", "Update not installed (" + status + "): "
                + intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE));
        String sha = intent.getStringExtra(Updater.EXTRA_SHA);
        if (sha != null) Updater.recordFailure(context, sha);
    }
}
