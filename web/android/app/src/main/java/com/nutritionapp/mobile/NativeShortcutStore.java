package com.nutritionapp.mobile;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import java.util.UUID;
import org.json.JSONException;

final class NativeShortcutStore {
    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences("incoming-shortcut", Context.MODE_PRIVATE);
    }

    static synchronized boolean capture(Context context, Intent intent) {
        if (!"com.nutritionapp.mobile.SHORTCUT".equals(intent.getAction())) return false;
        String action = intent.getStringExtra("nutrition_action");
        if (!"log-food".equals(action) && !"scan-barcode".equals(action) && !"log-weight".equals(action)) return false;
        JSObject record = new JSObject();
        record.put("schemaVersion", 1);
        record.put("id", UUID.randomUUID().toString());
        record.put("action", action);
        record.put("atMs", System.currentTimeMillis());
        if (!preferences(context).edit().putString("pending", record.toString()).commit()) return false;
        intent.removeExtra("nutrition_action");
        return true;
    }

    static synchronized JSObject read(Context context) {
        String json = preferences(context).getString("pending", null);
        if (json == null) return null;
        try {
            JSObject record = new JSObject(json);
            long age = System.currentTimeMillis() - record.getLong("atMs");
            if (age >= -120000 && age <= 1800000) return record;
        } catch (JSONException ignored) { /* Invalid local metadata cannot dispatch navigation. */ }
        preferences(context).edit().remove("pending").commit();
        return null;
    }

    static synchronized void acknowledge(Context context, String id) {
        JSObject record = read(context);
        if (record != null && id != null && id.equals(record.optString("id")))
            if (!preferences(context).edit().remove("pending").commit()) throw new IllegalStateException("shortcut_save_failed");
    }
}
