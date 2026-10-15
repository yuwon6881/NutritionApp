package com.nutritionapp.mobile;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;

final class ReminderCapabilities {
    static Intent settings(Context context, boolean channel) {
        if (Build.VERSION.SDK_INT >= 26) {
            Intent intent = new Intent(channel ? Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS : Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
            if (channel) intent.putExtra(Settings.EXTRA_CHANNEL_ID, context.getString(R.string.nutrition_push_channel_id));
            return intent;
        }
        return new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).setData(Uri.parse("package:" + context.getPackageName()));
    }

    static JSObject read(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) throw new IllegalStateException("notification_manager_unavailable");
        boolean channelExists = true;
        int channelImportance = -1;
        boolean soundConfigured = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = manager.getNotificationChannel(context.getString(R.string.nutrition_push_channel_id));
            channelExists = channel != null;
            if (channel != null) channelImportance = channel.getImportance();
            soundConfigured = channel != null && channel.getSound() != null;
        }
        JSObject result = new JSObject();
        result.put("appPermission", manager.areNotificationsEnabled());
        result.put("channelExists", channelExists);
        result.put("channelDisabled", channelImportance == NotificationManager.IMPORTANCE_NONE);
        result.put("channelImportance", channelImportance);
        result.put("soundConfigured", soundConfigured);
        result.put("appSettingsAvailable", settings(context, false).resolveActivity(context.getPackageManager()) != null);
        result.put("channelSettingsAvailable", Build.VERSION.SDK_INT >= 26 && settings(context, true).resolveActivity(context.getPackageManager()) != null);
        return result;
    }
}
