package com.nutritionapp.mobile;

import android.content.Intent;
import com.getcapacitor.Plugin;
import com.getcapacitor.JSObject;
import org.json.JSONObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NutritionDevice")
public class NutritionDevicePlugin extends Plugin {
    @PluginMethod public void checkApkUpdate(PluginCall call) {
        new Thread(() -> call.resolve(ApkUpdates.check(getContext(), Boolean.TRUE.equals(call.getBoolean("manual", false)))), "apk-update-check").start();
    }

    @PluginMethod public void openApkRelease(PluginCall call) {
        try {
            getActivity().startActivity(new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(
                    AndroidReleaseContract.releaseUrl(BuildConfig.DISTRIBUTION_CHANNEL))));
            call.resolve();
        } catch (RuntimeException failure) { call.reject("The release page could not be opened.", "release_page_unavailable"); }
    }
    @PluginMethod public void getDeviceDiagnostics(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try { call.resolve(AndroidDeviceInfo.read(getActivity())); }
            catch (RuntimeException failure) { call.reject("Device diagnostics could not be checked.", "diagnostics_unavailable"); }
        });
    }
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
}
