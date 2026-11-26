package com.nutritionapp.mobile;

import static org.junit.Assert.*;
import android.content.Context;
import androidx.work.ListenableWorker;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class PendingOutboxWorkerTest {
    private static JSONObject sampleOp(String id, String recordId, long holdUntil) throws Exception {
        JSONObject op = new JSONObject();
        op.put("id", id);
        op.put("kind", "entry");
        op.put("recordId", recordId);
        op.put("expectedRevision", 0);
        op.put("delete", false);
        if (holdUntil > 0) op.put("holdUntil", holdUntil);
        op.put("data", new JSONObject().put("date", "2026-11-26").put("name", "Nasi lemak").put("calories", 500));
        return op;
    }

    @Test public void drainsHeldMutationWhenAppIsBackgroundedAndRecordsAppliedOutcome() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        PendingOutboxStore store = new PendingOutboxStore(context);
        store.clearAccount("alice");
        JSONArray queue = new JSONArray().put(sampleOp("op-1", "rec-1", 99_999L));
        store.syncQueue("alice", "https://nutrition-diary-app.vercel.app", queue);

        List<String> sentBodies = new ArrayList<>();
        PendingOutboxWorker.Transport transport = new PendingOutboxWorker.Transport() {
            @Override public String getCookie(String origin) { return "nutrition-session=secret"; }
            @Override public PendingOutboxWorker.Response post(String origin, String accountId, String cookie, String body) {
                sentBodies.add(body);
                return new PendingOutboxWorker.Response(200, "{\"revision\":12}", null);
            }
        };

        // While foregrounded, an active undo hold waits for the UI toast.
        PendingOutboxWorker.Clock foregroundClock = new PendingOutboxWorker.Clock() {
            @Override public long nowMs() { return 1000L; }
            @Override public boolean isForeground() { return true; }
            @Override public boolean isStopped() { return false; }
        };
        assertEquals(ListenableWorker.Result.success(), PendingOutboxWorker.runSync(store, transport, foregroundClock));
        assertTrue(sentBodies.isEmpty());
        assertTrue(store.hasPendingWork());

        // Once backgrounded, holdUntil is waived and the mutation is sent without holdUntil on the wire.
        PendingOutboxWorker.Clock backgroundClock = new PendingOutboxWorker.Clock() {
            @Override public long nowMs() { return 1000L; }
            @Override public boolean isForeground() { return false; }
            @Override public boolean isStopped() { return false; }
        };
        assertEquals(ListenableWorker.Result.success(), PendingOutboxWorker.runSync(store, transport, backgroundClock));
        assertEquals(1, sentBodies.size());
        assertFalse(new JSONObject(sentBodies.get(0)).has("holdUntil"));
        assertFalse(store.hasPendingWork());

        // Re-syncing a stale queue from JS must not resurrect an already-applied operation.
        store.syncQueue("alice", "https://nutrition-diary-app.vercel.app", queue);
        assertFalse(store.hasPendingWork());

        JSONArray applied = store.consumeApplied("alice");
        assertEquals(1, applied.length());
        assertEquals("op-1", applied.getJSONObject(0).getString("id"));
        assertEquals("acked", applied.getJSONObject(0).getString("outcome"));
        assertEquals(12L, applied.getJSONObject(0).getLong("revision"));
    }

    @Test public void retriesTransientFailuresAndRetainsWorkOnUnauthorized() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        PendingOutboxStore store = new PendingOutboxStore(context);
        store.clearAccount("alice");
        store.syncQueue("alice", "https://nutrition-diary-app.vercel.app", new JSONArray().put(sampleOp("op-2", "rec-2", 0)));

        PendingOutboxWorker.Clock clock = new PendingOutboxWorker.Clock() {
            @Override public long nowMs() { return 1000L; }
            @Override public boolean isForeground() { return false; }
            @Override public boolean isStopped() { return false; }
        };

        PendingOutboxWorker.Transport unavailable = new PendingOutboxWorker.Transport() {
            @Override public String getCookie(String origin) { return "nutrition-session=secret"; }
            @Override public PendingOutboxWorker.Response post(String origin, String accountId, String cookie, String body) throws IOException {
                throw new IOException("offline");
            }
        };
        assertEquals(ListenableWorker.Result.retry(), PendingOutboxWorker.runSync(store, unavailable, clock));
        assertTrue(store.hasPendingWork());
        assertEquals(6000L, store.peekHead("alice").getLong("retryAt"));

        // Clear retryAt as if time passed and test 401 preserves queue without burning retries.
        store.markRetry("alice", "op-2", 0);
        PendingOutboxWorker.Transport unauthorized = new PendingOutboxWorker.Transport() {
            @Override public String getCookie(String origin) { return "nutrition-session=secret"; }
            @Override public PendingOutboxWorker.Response post(String origin, String accountId, String cookie, String body) {
                return new PendingOutboxWorker.Response(401, "{}", null);
            }
        };
        assertEquals(ListenableWorker.Result.success(), PendingOutboxWorker.runSync(store, unauthorized, clock));
        assertTrue(store.hasPendingWork());
    }
}
