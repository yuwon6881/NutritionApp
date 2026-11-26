package com.nutritionapp.mobile;

import android.content.Context;
import android.webkit.CookieManager;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import org.json.JSONException;
import org.json.JSONObject;

/** Drains retained mutations via WorkManager when the Android app is backgrounded or offline. */
public final class PendingOutboxWorker extends Worker {
    static final String UNIQUE_WORK_NAME = "nutrition-outbox-sync";

    interface Transport {
        Response post(String origin, String accountId, String cookie, String body) throws IOException;
        String getCookie(String origin);
    }

    static final class Response {
        final int status;
        final String body;
        final String retryAfterHeader;

        Response(int status, String body, String retryAfterHeader) {
            this.status = status;
            this.body = body;
            this.retryAfterHeader = retryAfterHeader;
        }
    }

    interface Clock {
        long nowMs();
        boolean isForeground();
        boolean isStopped();
    }

    private static final class DefaultTransport implements Transport {
        @Override
        public String getCookie(String origin) {
            CookieManager manager = CookieManager.getInstance();
            return manager != null ? manager.getCookie(origin) : null;
        }

        @Override
        public Response post(String origin, String accountId, String cookie, String body) throws IOException {
            HttpURLConnection connection = (HttpURLConnection) new URL(origin + "/api/sync").openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(20_000);
            connection.setReadTimeout(20_000);
            connection.setDoOutput(true);
            connection.setUseCaches(false);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Origin", origin);
            connection.setRequestProperty("Cookie", cookie);
            connection.setRequestProperty("X-Nutrition-Request", "1");
            connection.setRequestProperty("X-Nutrition-Account", accountId);
            connection.setRequestProperty("X-Fitness-Integration-Dispatch", "deferred");
            byte[] payload = body.getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(payload.length);
            try {
                try (OutputStream out = connection.getOutputStream()) {
                    out.write(payload);
                }
                int status = connection.getResponseCode();
                InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                String responseBody = readFully(stream);
                String retryAfter = connection.getHeaderField("Retry-After");
                return new Response(status, responseBody, retryAfter);
            } finally {
                connection.disconnect();
            }
        }

        private static String readFully(InputStream stream) throws IOException {
            if (stream == null) return "";
            try (InputStream in = stream; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096];
                int count;
                while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
                return out.toString(StandardCharsets.UTF_8.name());
            }
        }
    }

    public PendingOutboxWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        return runSync(
                PendingOutboxStore.get(getApplicationContext()),
                new DefaultTransport(),
                new Clock() {
                    @Override public long nowMs() { return System.currentTimeMillis(); }
                    @Override public boolean isForeground() { return MainActivity.isForeground(); }
                    @Override public boolean isStopped() { return PendingOutboxWorker.this.isStopped(); }
                }
        );
    }

    static Result runSync(PendingOutboxStore store, Transport transport, Clock clock) {
        JSONObject accounts = store.readAllAccounts();
        List<String> accountIds = new ArrayList<>();
        Iterator<String> keys = accounts.keys();
        while (keys.hasNext()) accountIds.add(keys.next());

        boolean needsRetry = false;
        for (String accountId : accountIds) {
            if (clock.isStopped()) return Result.retry();
            JSONObject account = accounts.optJSONObject(accountId);
            if (account == null) continue;
            String origin = account.optString("origin", "");
            if (!PendingOutboxStore.isSupportedOrigin(origin)) continue;

            String cookie = transport.getCookie(origin);
            if (cookie == null || !cookie.contains("nutrition-session=")) continue;

            for (;;) {
                if (clock.isStopped()) return Result.retry();
                JSONObject op = store.peekHead(accountId);
                if (op == null) break;

                long now = clock.nowMs();
                if (clock.isForeground() && op.optLong("holdUntil", 0) > now) break;
                if (op.optLong("retryAt", 0) > now) {
                    needsRetry = true;
                    break;
                }

                String opId = op.optString("id");
                Response response;
                try {
                    response = transport.post(origin, accountId, cookie, PendingOutboxStore.wireMutation(op).toString());
                } catch (IOException failure) {
                    try { store.markRetry(accountId, opId, now + 5000); } catch (IOException ignored) {}
                    needsRetry = true;
                    break;
                }

                if (response.status >= 200 && response.status < 300) {
                    try {
                        JSONObject ack = new JSONObject(response.body);
                        long revision = ack.optLong("revision", 0);
                        store.recordOutcome(accountId, op, "acked", revision, null, ack);
                    } catch (JSONException | IOException failure) {
                        needsRetry = true;
                        break;
                    }
                    continue;
                }

                if (response.status == 401) {
                    // Session expired: stop retrying until the user signs in again.
                    break;
                }

                if (response.status == 409) {
                    String message = parseErrorMessage(response.body, "This change conflicts with saved data.");
                    try { store.recordOutcome(accountId, op, "conflict", 0, message, null); } catch (IOException ignored) {}
                    continue;
                }

                if (response.status == 400 || response.status == 403 || response.status == 404 || response.status == 413 || response.status == 422) {
                    String message = parseErrorMessage(response.body, "The service could not apply this edit.");
                    try { store.recordOutcome(accountId, op, "rejected", 0, message, null); } catch (IOException ignored) {}
                    continue;
                }

                long retryDelay = parseRetryAfterMs(response.retryAfterHeader, 5000);
                try { store.markRetry(accountId, opId, now + retryDelay); } catch (IOException ignored) {}
                needsRetry = true;
                break;
            }
        }
        return needsRetry ? Result.retry() : Result.success();
    }

    private static String parseErrorMessage(String body, String fallback) {
        if (body == null || body.isEmpty()) return fallback;
        try {
            String message = new JSONObject(body).optString("message", "");
            return message.isEmpty() ? fallback : message;
        } catch (JSONException ignored) {
            return fallback;
        }
    }

    private static long parseRetryAfterMs(String raw, long fallbackMs) {
        if (raw == null) return fallbackMs;
        String trimmed = raw.trim();
        if (trimmed.matches("\\d+")) {
            long seconds = Math.min(300L, Long.parseLong(trimmed));
            return Math.max(0L, seconds * 1000L);
        }
        return fallbackMs;
    }
}
