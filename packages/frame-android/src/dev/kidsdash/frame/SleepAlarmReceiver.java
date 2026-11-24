package dev.kidsdash.frame;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** A sleep window starts or ends: hand over to the (singleTask) activity. */
public final class SleepAlarmReceiver extends BroadcastReceiver {
    static final String EXTRA_SLEEP_ALARM = "dev.kidsdash.frame.SLEEP_ALARM";

    @Override
    public void onReceive(Context context, Intent intent) {
        context.startActivity(new Intent(context, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra(EXTRA_SLEEP_ALARM, true));
    }
}
