package com.nutritionapp.mobile;

import android.content.Intent;
import android.webkit.CookieManager;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import org.json.JSONArray;
import org.json.JSONObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "NutritionDevice")
public class NutritionDevicePlugin extends Plugin {
    void incomingPhotoReady() { notifyListeners("incomingPhotoReady", new JSObject(), true); }

    @PluginMethod public void getIncomingImage(PluginCall call) {
        try {
            JSObject result = new JSObject();
            JSObject pending = IncomingImageStore.get(getContext()).peek();
            result.put("image", pending == null ? JSONObject.NULL : pending);
            call.resolve(result);
        } catch (Exception failure) { call.reject("The shared image could not be checked.", "share_read_failed"); }
    }

    @PluginMethod public void readIncomingImage(PluginCall call) {
        try {
            JSObject result = new JSObject();
            result.put("base64", IncomingImageStore.get(getContext()).read(call.getString("id")));
            call.resolve(result);
        } catch (Exception failure) { call.reject("The shared image could not be read.", "share_read_failed"); }
    }

    @PluginMethod public void discardIncomingImage(PluginCall call) {
        try { IncomingImageStore.get(getContext()).discard(call.getString("id")); call.resolve(); }
        catch (Exception failure) { call.reject("The shared image could not be cleared.", "share_delete_failed"); }
    }
    void shortcutReady() { notifyListeners("shortcutReady", new JSObject(), true); }

    @PluginMethod public void getPendingShortcut(PluginCall call) {
        JSObject result = new JSObject();
        JSObject shortcut = NativeShortcutStore.read(getContext());
        result.put("shortcut", shortcut == null ? JSONObject.NULL : shortcut);
        call.resolve(result);
    }

    @PluginMethod public void acknowledgeShortcut(PluginCall call) {
        try { NativeShortcutStore.acknowledge(getContext(), call.getString("id")); call.resolve(); }
        catch (RuntimeException failure) { call.reject("The shortcut is still pending.", "shortcut_save_failed"); }
    }
    @PluginMethod public void getReminderCapabilities(PluginCall call) {
        try { call.resolve(ReminderCapabilities.read(getContext())); }
        catch (RuntimeException failure) { call.reject("Reminder readiness could not be checked.", "capabilities_unavailable"); }
    }

    @PluginMethod public void openReminderSettings(PluginCall call) {
        Intent intent = ReminderCapabilities.settings(getContext(), Boolean.TRUE.equals(call.getBoolean("channel", false)));
        try {
            getActivity().startActivity(intent);
            call.resolve();
        } catch (RuntimeException failure) { call.reject("These settings are not available on this phone.", "settings_unavailable"); }
    }

    @PluginMethod public void syncPendingMutations(PluginCall call) {
        String accountId = call.getString("accountId");
        String origin = call.getString("origin");
        JSArray queue = call.getArray("queue");
        boolean immediate = Boolean.TRUE.equals(call.getBoolean("immediate", false));
        try {
            PendingOutboxStore store = PendingOutboxStore.get(getContext());
            store.syncQueue(accountId, origin, queue == null ? new JSONArray() : queue);
            WorkManager work = WorkManager.getInstance(getContext());
            if (!store.hasPendingWork()) {
                work.cancelUniqueWork(PendingOutboxWorker.UNIQUE_WORK_NAME);
                call.resolve();
                return;
            }
            try {
                CookieManager cookies = CookieManager.getInstance();
                if (cookies != null) cookies.flush();
            } catch (Throwable ignored) { /* Best-effort cookie flush before potential process exit. */ }
            long delayMs = immediate ? 0L : store.earliestDelayMs(System.currentTimeMillis());
            OneTimeWorkRequest.Builder builder = new OneTimeWorkRequest.Builder(PendingOutboxWorker.class)
                    .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS);
            if (delayMs > 0) builder.setInitialDelay(delayMs, TimeUnit.MILLISECONDS);
            work.enqueueUniqueWork(PendingOutboxWorker.UNIQUE_WORK_NAME, ExistingWorkPolicy.REPLACE, builder.build());
            call.resolve();
        } catch (Exception failure) { call.reject("Could not schedule background sync.", "outbox_sync_failed"); }
    }

    @PluginMethod public void consumeSyncedMutations(PluginCall call) {
        String accountId = call.getString("accountId");
        try {
            JSObject result = new JSObject();
            JSONArray outcomes = accountId == null ? new JSONArray() : PendingOutboxStore.get(getContext()).consumeApplied(accountId);
            result.put("outcomes", outcomes);
            call.resolve(result);
        } catch (Exception failure) { call.reject("Could not read background sync outcomes.", "outbox_read_failed"); }
    }

    @PluginMethod public void clearPendingMutations(PluginCall call) {
        String accountId = call.getString("accountId");
        try {
            PendingOutboxStore store = PendingOutboxStore.get(getContext());
            store.clearAccount(accountId);
            if (!store.hasPendingWork()) {
                WorkManager.getInstance(getContext()).cancelUniqueWork(PendingOutboxWorker.UNIQUE_WORK_NAME);
            }
            call.resolve();
        } catch (Exception failure) { call.reject("Could not clear background sync state.", "outbox_clear_failed"); }
    }
}
