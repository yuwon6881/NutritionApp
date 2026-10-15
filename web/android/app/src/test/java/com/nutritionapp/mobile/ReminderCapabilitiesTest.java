package com.nutritionapp.mobile;

import static org.junit.Assert.*;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.provider.Settings;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 33)
public class ReminderCapabilitiesTest {
    @Test @Config(sdk = 24)
    public void legacyAndroidReportsAppPermissionWithoutChannels() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        var capabilities = ReminderCapabilities.read(context);
        assertTrue(capabilities.getBoolean("appPermission"));
        assertTrue(capabilities.getBoolean("channelExists"));
        assertFalse(capabilities.getBoolean("channelDisabled"));
        assertEquals(-1, capabilities.getInt("channelImportance"));
        assertTrue(capabilities.getBoolean("soundConfigured"));
        assertFalse(capabilities.getBoolean("channelSettingsAvailable"));
        assertEquals(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, ReminderCapabilities.settings(context, true).getAction());
        Shadows.shadowOf(manager).setNotificationsEnabled(false);
        assertFalse(ReminderCapabilities.read(context).getBoolean("appPermission"));
    }

    @Test @Config(sdk = 26)
    public void firstChannelApiReportsImportanceAndDisabledState() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        String id = context.getString(R.string.nutrition_push_channel_id);
        assertEquals(-1, ReminderCapabilities.read(context).getInt("channelImportance"));
        manager.createNotificationChannel(new NotificationChannel(id, "Reminders", NotificationManager.IMPORTANCE_NONE));
        assertTrue(ReminderCapabilities.read(context).getBoolean("channelDisabled"));
        assertEquals(NotificationManager.IMPORTANCE_NONE, ReminderCapabilities.read(context).getInt("channelImportance"));
    }

    @Test public void readsMissingAndDisabledChannelsWithoutCreatingOne() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        String id = context.getString(R.string.nutrition_push_channel_id);
        assertFalse(ReminderCapabilities.read(context).getBoolean("channelExists"));
        assertNull(manager.getNotificationChannel(id));
        NotificationChannel channel = new NotificationChannel(id, "Reminders", NotificationManager.IMPORTANCE_NONE);
        manager.createNotificationChannel(channel);
        assertTrue(ReminderCapabilities.read(context).getBoolean("channelDisabled"));
    }

    @Test public void reportsAChannelWithoutSound() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        String id = context.getString(R.string.nutrition_push_channel_id);
        NotificationChannel channel = new NotificationChannel(id, "Silent", NotificationManager.IMPORTANCE_DEFAULT);
        channel.setSound(null, null);
        manager.createNotificationChannel(channel);
        assertFalse(ReminderCapabilities.read(context).getBoolean("soundConfigured"));
        assertFalse(ReminderCapabilities.read(context).getBoolean("channelDisabled"));
    }

    @Test public void reportsAnAudibleChannel() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(context.getString(R.string.nutrition_push_channel_id),
                "Reminders", NotificationManager.IMPORTANCE_HIGH));
        assertTrue(ReminderCapabilities.read(context).getBoolean("soundConfigured"));
    }

    @Test public void permissionDenialIsReportedWithoutChangingSubscriptionState() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        Shadows.shadowOf(manager).setNotificationsEnabled(false);
        assertFalse(ReminderCapabilities.read(context).getBoolean("appPermission"));
        assertEquals(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS, ReminderCapabilities.settings(context, true).getAction());
        assertEquals(context.getPackageName(), ReminderCapabilities.settings(context, false).getStringExtra(Settings.EXTRA_APP_PACKAGE));
    }
}
