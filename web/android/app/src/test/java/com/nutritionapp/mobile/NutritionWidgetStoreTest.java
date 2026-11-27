package com.nutritionapp.mobile;

import static org.junit.Assert.*;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.RemoteViews;
import android.widget.TextView;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class NutritionWidgetStoreTest {
    private Context context;

    @Before
    public void setUp() {
        context = RuntimeEnvironment.getApplication();
        NutritionWidgetStore.clear(context);
    }

    @Test
    public void saveReadAndClearRoundTrip() {
        assertNull(NutritionWidgetStore.read(context));
        assertTrue(NutritionWidgetStore.save(
            context,
            "user-1",
            "2026-11-27",
            "1,450 kcal",
            "of 2,100 kcal · 650 kcal left",
            "P 110/160g · C 140/210g · F 45/70g"
        ));
        NutritionWidgetStore.Snapshot snapshot = NutritionWidgetStore.read(context);
        assertNotNull(snapshot);
        assertEquals("user-1", snapshot.accountId);
        assertEquals("2026-11-27", snapshot.date);
        assertEquals("1,450 kcal", snapshot.caloriesText);
        assertEquals("of 2,100 kcal · 650 kcal left", snapshot.caloriesSubtext);
        assertEquals("P 110/160g · C 140/210g · F 45/70g", snapshot.macrosText);

        NutritionWidgetStore.clear(context);
        assertNull(NutritionWidgetStore.read(context));
    }

    @Test
    public void rejectsInvalidPayloadsWithoutClobbering() {
        assertFalse(NutritionWidgetStore.save(context, "", "2026-11-27", "1,450 kcal", "", ""));
        assertFalse(NutritionWidgetStore.save(context, "user-1", "bad-date", "1,450 kcal", "", ""));
        assertFalse(NutritionWidgetStore.save(context, "user-1", "2026-11-27", "", "", ""));
        assertNull(NutritionWidgetStore.read(context));
    }

    @Test
    public void handlesCorruptedPreferencesGracefully() {
        context.getSharedPreferences("nutrition-widget", Context.MODE_PRIVATE)
            .edit().putString("summary", "{broken json").commit();
        assertNull(NutritionWidgetStore.read(context));
    }

    @Test
    public void rendersSignedOutStaleAndTodayStatesWithActionShortcuts() {
        FrameLayout parent = new FrameLayout(context);

        RemoteViews signedOut = NutritionWidgetProvider.buildRemoteViews(context, "2026-11-27");
        View signedOutView = signedOut.apply(context, parent);
        assertEquals("Nutrition", ((TextView) signedOutView.findViewById(R.id.widget_calories)).getText().toString());
        assertEquals(View.GONE, signedOutView.findViewById(R.id.widget_macros).getVisibility());

        NutritionWidgetStore.save(context, "user-1", "2026-11-26", "1,800 kcal", "of 2,000 kcal", "P 120g");
        RemoteViews stale = NutritionWidgetProvider.buildRemoteViews(context, "2026-11-27");
        View staleView = stale.apply(context, parent);
        assertTrue(((TextView) staleView.findViewById(R.id.widget_subtext)).getText().toString().contains("2026-11-26"));
        assertEquals(View.GONE, staleView.findViewById(R.id.widget_macros).getVisibility());

        NutritionWidgetStore.save(context, "user-1", "2026-11-27", "1,250 kcal", "of 2,000 kcal · 750 kcal left", "P 95g · C 120g · F 35g");
        RemoteViews current = NutritionWidgetProvider.buildRemoteViews(context, "2026-11-27");
        View currentView = current.apply(context, parent);
        assertEquals("1,250 kcal", ((TextView) currentView.findViewById(R.id.widget_calories)).getText().toString());
        assertEquals(View.VISIBLE, currentView.findViewById(R.id.widget_macros).getVisibility());

        currentView.findViewById(R.id.widget_btn_log_food).performClick();
        Intent next = Shadows.shadowOf((android.app.Application) context).getNextStartedActivity();
        assertNotNull(next);
        assertEquals("com.nutritionapp.mobile.SHORTCUT", next.getAction());
        assertEquals("log-food", next.getStringExtra("nutrition_action"));
    }
}
