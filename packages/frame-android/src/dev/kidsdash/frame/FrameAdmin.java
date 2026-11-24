package dev.kidsdash.frame;

import android.app.admin.DeviceAdminReceiver;

/**
 * The device-owner component (set once over adb: scripts/frame.mjs owner).
 * Device ownership lets the app install its own updates without a prompt;
 * it uses no policies.
 */
public final class FrameAdmin extends DeviceAdminReceiver {}
