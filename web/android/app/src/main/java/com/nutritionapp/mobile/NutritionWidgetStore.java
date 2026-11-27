package com.nutritionapp.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Arrays;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Caches today's formatted nutrition summary for the Android home-screen widget.
 * Cleared on sign-out or local wipe so a shared device never keeps another user's numbers.
 */
final class NutritionWidgetStore {
    private static final String PREFS_NAME = "nutrition-widget";
    private static final String KEY_SUMMARY = "summary";

    static final class Snapshot {
        final String accountId;
        final String date;
        final String caloriesText;
        final String caloriesSubtext;
        final String macrosText;
        final String timeZone;
        final long updatedAtMs;

        Snapshot(String accountId, String date, String caloriesText, String caloriesSubtext, String macrosText, String timeZone, long updatedAtMs) {
            this.accountId = accountId;
            this.date = date;
            this.caloriesText = caloriesText;
            this.caloriesSubtext = caloriesSubtext;
            this.macrosText = macrosText;
            this.timeZone = timeZone;
            this.updatedAtMs = updatedAtMs;
        }
    }

    private NutritionWidgetStore() {}

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    /**
     * Today in the profile's time zone, which is how the app dates the diary; the device zone is
     * only a fallback, so a phone set to another zone (or travelling) never marks today as stale.
     */
    static String todayIso(String timeZoneId) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        if (isKnownTimeZone(timeZoneId)) format.setTimeZone(TimeZone.getTimeZone(timeZoneId));
        return format.format(Calendar.getInstance().getTime());
    }

    static String todayIso(Context context) {
        Snapshot snapshot = read(context);
        return todayIso(snapshot == null ? null : snapshot.timeZone);
    }

    // TimeZone.getTimeZone silently answers GMT for an unknown id, so check the id first.
    private static boolean isKnownTimeZone(String timeZoneId) {
        return timeZoneId != null && !timeZoneId.isEmpty() && Arrays.asList(TimeZone.getAvailableIDs()).contains(timeZoneId);
    }

    private static String clamp(String value, int maxLen) {
        if (value == null) return "";
        String trimmed = value.trim();
        return trimmed.length() <= maxLen ? trimmed : trimmed.substring(0, maxLen);
    }

    static synchronized boolean save(
        Context context,
        String accountId,
        String date,
        String caloriesText,
        String caloriesSubtext,
        String macrosText,
        String timeZone
    ) {
        String cleanAccount = clamp(accountId, 120);
        String cleanDate = clamp(date, 16);
        String cleanCalories = clamp(caloriesText, 64);
        String cleanSubtext = clamp(caloriesSubtext, 120);
        String cleanMacros = clamp(macrosText, 120);
        String cleanTimeZone = clamp(timeZone, 64);
        if (cleanAccount.isEmpty() || !cleanDate.matches("\\d{4}-\\d{2}-\\d{2}") || cleanCalories.isEmpty()) {
            return false;
        }
        try {
            JSONObject record = new JSONObject();
            record.put("schemaVersion", 1);
            record.put("accountId", cleanAccount);
            record.put("date", cleanDate);
            record.put("caloriesText", cleanCalories);
            record.put("caloriesSubtext", cleanSubtext);
            record.put("macrosText", cleanMacros);
            record.put("timeZone", cleanTimeZone);
            record.put("updatedAtMs", System.currentTimeMillis());
            return preferences(context).edit().putString(KEY_SUMMARY, record.toString()).commit();
        } catch (JSONException failure) {
            return false;
        }
    }

    static synchronized Snapshot read(Context context) {
        String raw = preferences(context).getString(KEY_SUMMARY, null);
        if (raw == null || raw.isEmpty()) return null;
        try {
            JSONObject record = new JSONObject(raw);
            if (record.optInt("schemaVersion", 0) != 1) return null;
            String accountId = record.optString("accountId", "");
            String date = record.optString("date", "");
            String caloriesText = record.optString("caloriesText", "");
            if (accountId.isEmpty() || date.isEmpty() || caloriesText.isEmpty()) return null;
            return new Snapshot(
                accountId,
                date,
                caloriesText,
                record.optString("caloriesSubtext", ""),
                record.optString("macrosText", ""),
                record.optString("timeZone", ""),
                record.optLong("updatedAtMs", 0L)
            );
        } catch (JSONException failure) {
            return null;
        }
    }

    static synchronized void clear(Context context) {
        preferences(context).edit().clear().commit();
    }
}
