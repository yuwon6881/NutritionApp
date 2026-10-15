package com.nutritionapp.mobile;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.Intent;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class NativeShortcutStoreTest {
    @Test public void coldAndWarmIntentsPersistOnceAndAcknowledgeOnlyTheirOwnIdentity() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        Intent intent = new Intent("com.nutritionapp.mobile.SHORTCUT").putExtra("nutrition_action", "scan-barcode");
        assertTrue(NativeShortcutStore.capture(context, intent));
        String id = NativeShortcutStore.read(context).getString("id");
        assertFalse(NativeShortcutStore.capture(context, intent));
        assertEquals(id, NativeShortcutStore.read(context).getString("id"));
        NativeShortcutStore.acknowledge(context, "other");
        assertNotNull(NativeShortcutStore.read(context));
        NativeShortcutStore.acknowledge(context, id);
        assertNull(NativeShortcutStore.read(context));
    }

    @Test public void rejectsArbitraryNavigation() {
        Context context = RuntimeEnvironment.getApplication();
        assertFalse(NativeShortcutStore.capture(context, new Intent("com.nutritionapp.mobile.SHORTCUT")
                .putExtra("nutrition_action", "delete-account")));
        assertNull(NativeShortcutStore.read(context));
    }
}
