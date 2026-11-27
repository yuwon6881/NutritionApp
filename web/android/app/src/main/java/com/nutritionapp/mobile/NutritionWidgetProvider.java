package com.nutritionapp.mobile;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;

/**
 * Android home-screen widget showing today's cached calorie/macro summary with one-tap shortcuts
 * into Food Log, Barcode Scanner, and Weigh-In dialogs via MainActivity's shortcut contract.
 */
public class NutritionWidgetProvider extends AppWidgetProvider {
    private static final String ACTION_SHORTCUT = "com.nutritionapp.mobile.SHORTCUT";
    private static final String EXTRA_ACTION = "nutrition_action";
    private static final int REQUEST_OPEN_APP = 1000;
    private static final int REQUEST_LOG_FOOD = 1001;
    private static final int REQUEST_SCAN = 1002;
    private static final int REQUEST_LOG_WEIGHT = 1003;

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        String todayDate = NutritionWidgetStore.todayIso(context);
        for (int widgetId : appWidgetIds) {
            RemoteViews views = buildRemoteViews(context, todayDate);
            appWidgetManager.updateAppWidget(widgetId, views);
        }
    }

    static void refreshAll(Context context) {
        try {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            if (manager == null) return;
            ComponentName component = new ComponentName(context, NutritionWidgetProvider.class);
            int[] ids = manager.getAppWidgetIds(component);
            if (ids == null || ids.length == 0) return;
            String todayDate = NutritionWidgetStore.todayIso(context);
            RemoteViews views = buildRemoteViews(context, todayDate);
            for (int widgetId : ids) {
                manager.updateAppWidget(widgetId, views);
            }
        } catch (RuntimeException ignored) {
            // Do not fail bridge calls on headless or restricted environments without an AppWidget service.
        }
    }

    static RemoteViews buildRemoteViews(Context context, String todayDate) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.nutrition_widget);
        NutritionWidgetStore.Snapshot snapshot = NutritionWidgetStore.read(context);

        if (snapshot == null) {
            views.setTextViewText(R.id.widget_calories, "Nutrition");
            views.setTextViewText(R.id.widget_subtext, "Open the app to see today\u2019s progress");
            views.setViewVisibility(R.id.widget_macros, View.GONE);
        } else if (!todayDate.equals(snapshot.date)) {
            views.setTextViewText(R.id.widget_calories, "Today\u2019s diary");
            views.setTextViewText(R.id.widget_subtext, "Last synced " + snapshot.date + " \u00B7 Tap to update");
            views.setViewVisibility(R.id.widget_macros, View.GONE);
        } else {
            views.setTextViewText(R.id.widget_calories, snapshot.caloriesText);
            views.setTextViewText(
                R.id.widget_subtext,
                snapshot.caloriesSubtext.isEmpty() ? "Logged today" : snapshot.caloriesSubtext
            );
            if (snapshot.macrosText.isEmpty()) {
                views.setViewVisibility(R.id.widget_macros, View.GONE);
            } else {
                views.setTextViewText(R.id.widget_macros, snapshot.macrosText);
                views.setViewVisibility(R.id.widget_macros, View.VISIBLE);
            }
        }

        views.setOnClickPendingIntent(R.id.widget_summary_area, openAppPendingIntent(context));
        views.setOnClickPendingIntent(R.id.widget_btn_log_food, shortcutPendingIntent(context, REQUEST_LOG_FOOD, "log-food"));
        views.setOnClickPendingIntent(R.id.widget_btn_scan, shortcutPendingIntent(context, REQUEST_SCAN, "scan-barcode"));
        views.setOnClickPendingIntent(R.id.widget_btn_log_weight, shortcutPendingIntent(context, REQUEST_LOG_WEIGHT, "log-weight"));
        return views;
    }

    private static PendingIntent openAppPendingIntent(Context context) {
        Intent intent = new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(
            context,
            REQUEST_OPEN_APP,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static PendingIntent shortcutPendingIntent(Context context, int requestCode, String action) {
        Intent intent = new Intent(context, MainActivity.class)
            .setAction(ACTION_SHORTCUT)
            .putExtra(EXTRA_ACTION, action)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }
}
