package com.nutritionapp.mobile;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.AtomicFile;
import android.util.Base64;
import com.getcapacitor.JSObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.json.JSONException;

/** One unassigned image in private, non-backed-up storage. Publication follows a complete copy. */
final class IncomingImageStore {
    static final long MAX_BYTES = 20_000_000;
    private final File directory;
    private final AtomicFile metadata;
    private static IncomingImageStore instance;

    static synchronized IncomingImageStore get(Context context) {
        if (instance == null) instance = new IncomingImageStore(context.getApplicationContext());
        return instance;
    }

    IncomingImageStore(Context context) {
        directory = new File(context.getNoBackupFilesDir(), "incoming-photo");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("share_storage_unavailable");
        metadata = new AtomicFile(new File(directory, "pending.json"));
    }

    synchronized JSObject stage(InputStream input) throws IOException {
        String id = UUID.randomUUID().toString();
        File file = new File(directory, id + ".image");
        boolean complete = false;
        try {
            long size = 0;
            try (FileOutputStream output = new FileOutputStream(file)) {
                byte[] buffer = new byte[16384];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    size += count;
                    if (size > MAX_BYTES) throw new IOException("Choose a photo smaller than 20 MB.");
                    output.write(buffer, 0, count);
                }
                output.getFD().sync();
            }
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(file.getAbsolutePath(), bounds);
            String mime = bounds.outMimeType;
            if (!("image/jpeg".equals(mime) || "image/png".equals(mime) || "image/webp".equals(mime)) ||
                    bounds.outWidth <= 0 || bounds.outHeight <= 0 || (long) bounds.outWidth * bounds.outHeight > 100_000_000)
                throw new IOException("Share one readable JPEG, PNG or WebP image.");
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = Math.max(1, Math.max(bounds.outWidth, bounds.outHeight) / 512);
            Bitmap decoded = BitmapFactory.decodeFile(file.getAbsolutePath(), options);
            if (decoded == null) throw new IOException("This image could not be decoded.");
            decoded.recycle();
            JSObject record = new JSObject();
            record.put("schemaVersion", 1);
            record.put("id", id);
            record.put("mime", mime);
            record.put("size", size);
            record.put("createdAt", System.currentTimeMillis());
            complete = true;
            return record;
        } finally { if (!complete) file.delete(); }
    }

    synchronized JSObject peek() throws IOException {
        cleanupOrphans();
        if (!metadata.getBaseFile().exists()) return null;
        try {
            JSObject record = new JSObject(new String(metadata.readFully(), StandardCharsets.UTF_8));
            long age = System.currentTimeMillis() - record.getLong("createdAt");
            if (age >= 0 && age <= 24L * 60 * 60 * 1000 && image(record.optString("id")).isFile()) return record;
            discard(record.optString("id"));
        } catch (JSONException | IllegalArgumentException invalid) { metadata.delete(); }
        return null;
    }

    synchronized void accept(JSObject record, String expectedId) throws IOException {
        JSObject current = peek();
        String currentId = current == null ? null : current.optString("id");
        if (!java.util.Objects.equals(currentId, expectedId)) throw new IOException("The waiting image changed. Review it again.");
        if (!image(record.optString("id")).isFile()) throw new IOException("The shared image is no longer available.");
        FileOutputStream output = null;
        try {
            output = metadata.startWrite();
            output.write(record.toString().getBytes(StandardCharsets.UTF_8));
            metadata.finishWrite(output);
        } catch (IOException failure) { metadata.failWrite(output); throw failure; }
        if (currentId != null) image(currentId).delete();
        cleanupOrphans();
    }

    synchronized String read(String id) throws IOException {
        JSObject current = peek();
        if (current == null || !current.optString("id").equals(id)) throw new IOException("The shared image is no longer available.");
        // Bounded at capture; refuse changed files too.
        File file = image(id);
        if (file.length() > MAX_BYTES) throw new IOException("The shared image is too large.");
        try (InputStream input = new FileInputStream(file); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16384];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            return Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
        }
    }

    synchronized void discard(String id) throws IOException {
        // Read metadata directly to allow expiry to clear it without recursing through peek().
        try {
            if (metadata.getBaseFile().exists()) {
                JSObject record = new JSObject(new String(metadata.readFully(), StandardCharsets.UTF_8));
                if (record.optString("id").equals(id)) metadata.delete();
            }
        } catch (JSONException invalid) { metadata.delete(); }
        image(id).delete();
    }

    synchronized void discardCandidate(String id) { image(id).delete(); }

    private File image(String id) {
        if (id == null || !id.matches("[0-9a-fA-F-]{36}")) throw new IllegalArgumentException("invalid_image_id");
        return new File(directory, id + ".image");
    }

    private void cleanupOrphans() {
        File[] files = directory.listFiles();
        if (files == null) return;
        long cutoff = System.currentTimeMillis() - 24L * 60 * 60 * 1000;
        for (File file : files) if (file.getName().endsWith(".image") && file.lastModified() < cutoff) file.delete();
    }
}
