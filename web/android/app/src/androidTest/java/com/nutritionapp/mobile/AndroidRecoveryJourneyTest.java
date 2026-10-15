package com.nutritionapp.mobile;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.SystemClock;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class AndroidRecoveryJourneyTest {
    @Test public void shortcutColdLaunchAndRecreationConsumeOnlyOnce() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("com.nutritionapp.mobile", context.getPackageName());
        Intent intent = new Intent(context, MainActivity.class).setAction("com.nutritionapp.mobile.SHORTCUT")
                .putExtra("nutrition_action", "log-food");
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(intent)) {
            // The native receiver removes the intent extra; React retains it through authentication.
            scenario.onActivity(activity -> assertFalse(activity.getIntent().hasExtra("nutrition_action")));
            scenario.recreate();
            scenario.onActivity(activity -> assertFalse(activity.getIntent().hasExtra("nutrition_action")));
        }
    }

    @Test public void imageSurvivesRecreationUntilExplicitAttachmentOrDiscard() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        IncomingImageStore store = IncomingImageStore.get(context);
        JSObject previous = store.peek();
        if (previous != null) store.discard(previous.getString("id"));
        Bitmap bitmap = Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, output);
        bitmap.recycle();
        JSObject image = store.stage(new ByteArrayInputStream(output.toByteArray()));
        store.accept(image, null);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.recreate();
            assertEquals(image.getString("id"), store.peek().getString("id"));
            assertFalse(store.read(image.getString("id")).isEmpty());
        } finally { store.discard(image.getString("id")); }
    }

    @Test public void actualRendererTerminationCreatesAFreshBridge() throws Exception {
        org.junit.Assume.assumeTrue(Build.VERSION.SDK_INT >= 29);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> original = new AtomicReference<>();
            CountDownLatch loaded = new CountDownLatch(1);
            scenario.onActivity(activity -> {
                original.set(activity.getBridge().getWebView());
                original.get().evaluateJavascript("document.readyState", ignored -> loaded.countDown());
            });
            assertTrue(loaded.await(20, TimeUnit.SECONDS));
            scenario.onActivity(activity -> {
                assertNotNull(original.get().getWebViewRenderProcess());
                assertTrue(original.get().getWebViewRenderProcess().terminate());
            });
            long deadline = SystemClock.elapsedRealtime() + 20000;
            AtomicReference<WebView> restored = new AtomicReference<>(original.get());
            while (restored.get() == original.get() && SystemClock.elapsedRealtime() < deadline) {
                SystemClock.sleep(100);
                try { scenario.onActivity(activity -> restored.set(activity.getBridge().getWebView())); }
                catch (IllegalStateException recreating) { /* Await new activity. */ }
            }
            assertNotSame(original.get(), restored.get());
        }
    }
}
