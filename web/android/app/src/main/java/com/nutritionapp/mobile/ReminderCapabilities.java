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
        NotificationChannel channel = Build.VERSION.SDK_INT >= 26
                ? manager.getNotificationChannel(context.getString(R.string.nutrition_push_channel_id)) : null;
        JSObject result = new JSObject();
        result.put("appPermission", manager.areNotificationsEnabled());
        result.put("channelExists", Build.VERSION.SDK_INT < 26 || channel != null);
        result.put("channelDisabled", channel != null && channel.getImportance() == NotificationManager.IMPORTANCE_NONE);
        result.put("channelImportance", channel == null ? -1 : channel.getImportance());
        result.put("soundConfigured", Build.VERSION.SDK_INT < 26 || channel != null && channel.getSound() != null);
        result.put("appSettingsAvailable", settings(context, false).resolveActivity(context.getPackageManager()) != null);
        result.put("channelSettingsAvailable", Build.VERSION.SDK_INT >= 26 && settings(context, true).resolveActivity(context.getPackageManager()) != null);
        return result;
    }
}
