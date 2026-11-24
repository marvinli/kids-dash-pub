package dev.kidsdash.frame;

import android.app.ActivityManager;
import android.app.Application;
import android.util.Log;

import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;

/**
 * The app object, only to keep Android's false "memory critical" away from the
 * WebView (see TrimPolicy for why it makes the dashboard flash). Chromium hears
 * it two ways, and both are filtered in this process:
 *  - onTrimMemory, which it registers on the Application: overridden here;
 *  - ActivityManager.getMyMemoryState(), which its MemoryPressureMonitor polls
 *    every 60 s once it has seen "critical" (traced on the frame: a
 *    MemoryPressureMonitor task, then NotifyMemoryPressure CRITICAL and frame
 *    eviction, once a minute). That call goes through this process's
 *    IActivityManager binding, which is wrapped so a RUNNING_* trim level reads
 *    as 0. Everything else passes through untouched. Android 8.1 allows the
 *    reflection; if it ever fails, the app runs as before and logs why.
 */
public final class FrameApp extends Application {
    private static final String TAG = "KidsDash";

    @Override
    public void onCreate() {
        super.onCreate();
        try {
            hideRunningTrimLevels();
            Log.i(TAG, "Memory: WebView sees no RUNNING_* trim levels");
        } catch (ReflectiveOperationException | RuntimeException e) {
            Log.w(TAG, "Memory: could not wrap ActivityManager: " + e);
        }
    }

    @Override
    public void onTrimMemory(int level) {
        if (TrimPolicy.forward(level)) {
            super.onTrimMemory(level);
        } else {
            Log.i(TAG, "Memory: held back trim level " + level + " from the WebView");
        }
    }

    private static void hideRunningTrimLevels() throws ReflectiveOperationException {
        Field singletonField = ActivityManager.class.getDeclaredField("IActivityManagerSingleton");
        singletonField.setAccessible(true);
        Object singleton = singletonField.get(null);
        Class<?> singletonClass = Class.forName("android.util.Singleton");
        Method get = singletonClass.getDeclaredMethod("get");
        get.setAccessible(true);
        final Object real = get.invoke(singleton);
        Class<?> iam = Class.forName("android.app.IActivityManager");
        if (Proxy.isProxyClass(real.getClass())) return; // already wrapped
        Object wrapped = Proxy.newProxyInstance(iam.getClassLoader(), new Class<?>[] {iam}, (proxy, method, args) -> {
            Object result;
            try {
                result = method.invoke(real, args);
            } catch (InvocationTargetException e) {
                throw e.getCause();
            }
            if ("getMyMemoryState".equals(method.getName()) && args != null && args.length == 1
                    && args[0] instanceof ActivityManager.RunningAppProcessInfo) {
                ActivityManager.RunningAppProcessInfo info = (ActivityManager.RunningAppProcessInfo) args[0];
                if (!TrimPolicy.forward(info.lastTrimLevel)) info.lastTrimLevel = 0;
            }
            return result;
        });
        Field instance = singletonClass.getDeclaredField("mInstance");
        instance.setAccessible(true);
        instance.set(singleton, wrapped);
    }
}
