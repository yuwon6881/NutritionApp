package com.nutritionapp.mobile;

import android.content.Context;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Durable atomic store for pending outbox mutations synced by WorkManager in the background. */
final class PendingOutboxStore {
    private final AtomicFile file;
    private static PendingOutboxStore instance;

    static synchronized PendingOutboxStore get(Context context) {
        if (instance == null) instance = new PendingOutboxStore(context.getApplicationContext());
        return instance;
    }

    PendingOutboxStore(Context context) {
        File directory = new File(context.getNoBackupFilesDir(), "pending-outbox");
        if (!directory.isDirectory() && !directory.mkdirs()) {
            throw new IllegalStateException("outbox_storage_unavailable");
        }
        file = new AtomicFile(new File(directory, "state.json"));
    }

    static boolean isSupportedOrigin(String origin) {
        if (origin == null) return false;
        return origin.startsWith("https://")
                || origin.startsWith("http://127.0.0.1")
                || origin.startsWith("http://localhost");
    }

    synchronized void syncQueue(String accountId, String origin, JSONArray incomingQueue) throws IOException {
        if (accountId == null || accountId.trim().isEmpty() || !isSupportedOrigin(origin)) {
            throw new IllegalArgumentException("Invalid outbox account or origin.");
        }
        JSONObject root = readRoot();
        JSONObject accounts = root.optJSONObject("accounts");
        if (accounts == null) {
            accounts = new JSONObject();
            try { root.put("accounts", accounts); } catch (JSONException ignored) {}
        }
        JSONObject account = accounts.optJSONObject(accountId);
        if (account == null) account = new JSONObject();
        JSONArray applied = account.optJSONArray("applied");
        if (applied == null) applied = new JSONArray();

        Set<String> appliedIds = new HashSet<>();
        for (int i = 0; i < applied.length(); i++) {
            JSONObject item = applied.optJSONObject(i);
            if (item != null) appliedIds.add(item.optString("id"));
        }

        JSONArray filtered = new JSONArray();
        for (int i = 0; i < incomingQueue.length(); i++) {
            JSONObject op = incomingQueue.optJSONObject(i);
            if (op == null) continue;
            String id = op.optString("id");
            if (id.isEmpty() || appliedIds.contains(id)) continue;
            for (int j = 0; j < applied.length(); j++) {
                JSONObject outcome = applied.optJSONObject(j);
                if (outcome == null || !"acked".equals(outcome.optString("outcome"))) continue;
                JSONObject completed = outcome.optJSONObject("mutation");
                if (completed != null) {
                    rebaseItem(op, completed, outcome.optLong("revision"), outcome.optJSONObject("ack"));
                }
            }
            filtered.put(op);
        }

        try {
            account.put("origin", origin);
            account.put("queue", filtered);
            account.put("applied", applied);
            if (filtered.length() == 0 && applied.length() == 0) {
                accounts.remove(accountId);
            } else {
                accounts.put(accountId, account);
            }
        } catch (JSONException failure) {
            throw new IOException("Could not serialize pending outbox.", failure);
        }
        writeRoot(root);
    }

    synchronized JSONObject readAllAccounts() {
        JSONObject root = readRoot();
        JSONObject accounts = root.optJSONObject("accounts");
        return accounts != null ? accounts : new JSONObject();
    }

    synchronized boolean hasPendingWork() {
        JSONObject accounts = readAllAccounts();
        Iterator<String> keys = accounts.keys();
        while (keys.hasNext()) {
            JSONObject account = accounts.optJSONObject(keys.next());
            if (account != null) {
                JSONArray queue = account.optJSONArray("queue");
                if (queue != null && queue.length() > 0) return true;
            }
        }
        return false;
    }

    synchronized long earliestDelayMs(long nowMs) {
        long minDelay = Long.MAX_VALUE;
        JSONObject accounts = readAllAccounts();
        Iterator<String> keys = accounts.keys();
        while (keys.hasNext()) {
            JSONObject account = accounts.optJSONObject(keys.next());
            if (account == null) continue;
            JSONArray queue = account.optJSONArray("queue");
            if (queue == null || queue.length() == 0) continue;
            JSONObject head = queue.optJSONObject(0);
            if (head == null) continue;
            long holdUntil = head.optLong("holdUntil", 0);
            long retryAt = head.optLong("retryAt", 0);
            long delay = Math.max(0, Math.max(holdUntil - nowMs, retryAt - nowMs));
            if (delay < minDelay) minDelay = delay;
        }
        return minDelay == Long.MAX_VALUE ? 0 : minDelay;
    }

    synchronized JSONObject peekHead(String accountId) {
        JSONObject account = readAllAccounts().optJSONObject(accountId);
        if (account == null) return null;
        JSONArray queue = account.optJSONArray("queue");
        if (queue == null || queue.length() == 0) return null;
        return queue.optJSONObject(0);
    }

    synchronized void recordOutcome(
            String accountId,
            JSONObject completedOp,
            String outcome,
            long revision,
            String message,
            JSONObject ack
    ) throws IOException {
        JSONObject root = readRoot();
        JSONObject accounts = root.optJSONObject("accounts");
        if (accounts == null) return;
        JSONObject account = accounts.optJSONObject(accountId);
        if (account == null) return;

        String opId = completedOp.optString("id");
        JSONArray existingQueue = account.optJSONArray("queue");
        JSONArray nextQueue = new JSONArray();
        if (existingQueue != null) {
            for (int i = 0; i < existingQueue.length(); i++) {
                JSONObject item = existingQueue.optJSONObject(i);
                if (item == null || opId.equals(item.optString("id"))) continue;
                if ("acked".equals(outcome)) {
                    rebaseItem(item, completedOp, revision, ack);
                }
                nextQueue.put(item);
            }
        }

        JSONArray applied = account.optJSONArray("applied");
        if (applied == null) applied = new JSONArray();
        try {
            JSONObject entry = new JSONObject();
            entry.put("id", opId);
            entry.put("mutation", wireMutation(completedOp));
            entry.put("outcome", outcome);
            if ("acked".equals(outcome)) {
                entry.put("revision", revision);
                if (ack != null) entry.put("ack", ack);
            } else if (message != null) {
                entry.put("message", message);
            }
            applied.put(entry);

            account.put("queue", nextQueue);
            account.put("applied", applied);
            accounts.put(accountId, account);
        } catch (JSONException failure) {
            throw new IOException("Could not record outbox outcome.", failure);
        }
        writeRoot(root);
    }

    synchronized void markRetry(String accountId, String opId, long retryAtMs) throws IOException {
        JSONObject root = readRoot();
        JSONObject accounts = root.optJSONObject("accounts");
        if (accounts == null) return;
        JSONObject account = accounts.optJSONObject(accountId);
        if (account == null) return;
        JSONArray queue = account.optJSONArray("queue");
        if (queue == null) return;
        for (int i = 0; i < queue.length(); i++) {
            JSONObject item = queue.optJSONObject(i);
            if (item != null && opId.equals(item.optString("id"))) {
                try { item.put("retryAt", retryAtMs); } catch (JSONException ignored) {}
                break;
            }
        }
        writeRoot(root);
    }

    synchronized JSONArray readApplied(String accountId) {
        JSONObject account = readAllAccounts().optJSONObject(accountId);
        JSONArray applied = account == null ? null : account.optJSONArray("applied");
        return applied == null ? new JSONArray() : applied;
    }

    synchronized void retireApplied(String accountId, JSONArray ids) throws IOException {
        JSONObject root = readRoot();
        JSONObject accounts = root.optJSONObject("accounts");
        if (accounts == null) return;
        JSONObject account = accounts.optJSONObject(accountId);
        if (account == null) return;
        JSONArray applied = account.optJSONArray("applied");
        if (applied == null || applied.length() == 0) return;

        Set<String> retired = new HashSet<>();
        for (int i = 0; i < ids.length(); i++) retired.add(ids.optString(i));
        JSONArray remaining = new JSONArray();
        for (int i = 0; i < applied.length(); i++) {
            JSONObject outcome = applied.optJSONObject(i);
            if (outcome != null && !retired.contains(outcome.optString("id"))) remaining.put(outcome);
        }

        JSONArray queue = account.optJSONArray("queue");
        try {
            if (remaining.length() == 0 && (queue == null || queue.length() == 0)) {
                accounts.remove(accountId);
            } else {
                account.put("applied", remaining);
                accounts.put(accountId, account);
            }
        } catch (JSONException failure) {
            throw new IOException("Could not clear applied outcomes.", failure);
        }
        writeRoot(root);
    }

    synchronized void clearAccount(String accountId) throws IOException {
        if (accountId == null) return;
        JSONObject root = readRoot();
        JSONObject accounts = root.optJSONObject("accounts");
        if (accounts == null || !accounts.has(accountId)) return;
        accounts.remove(accountId);
        writeRoot(root);
    }

    static JSONObject wireMutation(JSONObject op) {
        JSONObject wire = new JSONObject();
        Iterator<String> keys = op.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            if ("error".equals(key) || "holdUntil".equals(key) || "retryAt".equals(key)) continue;
            try { wire.put(key, op.get(key)); } catch (JSONException ignored) {}
        }
        return wire;
    }

    private static void rebaseItem(JSONObject item, JSONObject completed, long revision, JSONObject ack) {
        try {
            String completedKind = completed.optString("kind");
            String completedRecordId = completed.optString("recordId");
            String kind = item.optString("kind");
            String recordId = item.optString("recordId");
            if ("settings".equals(completedKind) && "settings".equals(kind)) {
                advanceRevision(item, "expectedRevision", revision);
                return;
            }
            boolean weightWrite = "weight".equals(completedKind) || "weight_move".equals(completedKind);
            if (!weightWrite && kind.equals(completedKind) && recordId.equals(completedRecordId)) {
                advanceRevision(item, "expectedRevision", revision);
            }
            if (ack != null && "day".equals(kind)) {
                JSONArray days = ack.optJSONArray("days");
                JSONObject data = item.optJSONObject("data");
                String itemDate = data != null ? data.optString("date", "") : "";
                if (days != null && !itemDate.isEmpty()) {
                    for (int j = 0; j < days.length(); j++) {
                        JSONObject saved = days.optJSONObject(j);
                        if (saved != null && itemDate.equals(saved.optString("date"))) {
                            item.put("recordId", saved.optString("id", recordId));
                            advanceRevision(item, "expectedRevision", saved.optLong("revision", revision));
                            break;
                        }
                    }
                }
            }
            if (ack != null && ("weight".equals(kind) || "weight_move".equals(kind))) {
                JSONArray weights = ack.optJSONArray("weights");
                JSONObject data = item.optJSONObject("data");
                String itemDate = data != null ? data.optString("date", "") : "";
                if (weights != null) {
                    JSONObject source = null;
                    JSONObject destination = null;
                    // A move's source and destination have independent revision checks.
                    JSONObject completedData = completed.optJSONObject("data");
                    for (int j = 0; j < weights.length(); j++) {
                        JSONObject saved = weights.optJSONObject(j);
                        if (saved == null) continue;
                        if (recordId.equals(saved.optString("id")) ||
                                ("weight_move".equals(kind) && "weight".equals(completedKind) &&
                                 recordId.equals(completedRecordId) && completedData != null &&
                                 completedData.optString("date").equals(saved.optString("date")))) {
                            source = saved;
                        }
                        if (itemDate.equals(saved.optString("date"))) destination = saved;
                    }
                    if (!"weight_move".equals(kind) && source == null) source = destination;
                    if (source != null) {
                        item.put("recordId", source.optString("id", recordId));
                        advanceRevision(item, "expectedRevision", source.optLong("revision", revision));
                    }
                    if ("weight_move".equals(kind) && data != null && destination != null &&
                            !item.optString("recordId").equals(destination.optString("id"))) {
                        data.put("destinationId", destination.optString("id"));
                        advanceRevision(data, "destinationRevision", destination.optLong("revision", revision));
                    }
                }
            }
        } catch (JSONException ignored) { /* Best-effort rebase; server receipt remains authoritative. */ }
    }

    private static void advanceRevision(JSONObject value, String key, long revision) throws JSONException {
        if (revision > value.optLong(key, -1)) value.put(key, revision);
    }

    private JSONObject readRoot() {
        if (!file.getBaseFile().exists()) return new JSONObject();
        try {
            return new JSONObject(new String(file.readFully(), StandardCharsets.UTF_8));
        } catch (IOException | JSONException invalid) {
            return new JSONObject();
        }
    }

    private void writeRoot(JSONObject root) throws IOException {
        FileOutputStream output = null;
        try {
            output = file.startWrite();
            output.write(root.toString().getBytes(StandardCharsets.UTF_8));
            file.finishWrite(output);
        } catch (IOException failure) {
            file.failWrite(output);
            throw failure;
        }
    }
}
