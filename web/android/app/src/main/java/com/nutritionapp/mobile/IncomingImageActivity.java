package com.nutritionapp.mobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.TextView;
import com.getcapacitor.JSObject;
import java.io.InputStream;

/** A narrow SEND receiver; no arbitrary paths, URLs, multiple images or automatic analysis. */
public class IncomingImageActivity extends Activity {
    private IncomingImageStore store;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        TextView message = new TextView(this);
        message.setText("Preparing shared photo…");
        setContentView(message);
        store = IncomingImageStore.get(this);
        Intent intent = getIntent();
        if (!validIntent(intent)) { fail("Share one JPEG, PNG or WebP image from Gallery."); return; }
        Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        new Thread(() -> {
            try (InputStream input = getContentResolver().openInputStream(uri)) {
                if (input == null) throw new java.io.IOException("This photo could not be read.");
                JSObject candidate = store.stage(input);
                JSObject existing = store.peek();
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) { store.discardCandidate(candidate.optString("id")); return; }
                    if (existing == null) accept(candidate, null);
                    else new AlertDialog.Builder(this).setTitle("Replace waiting photo?")
                            .setMessage("Another shared photo is waiting to be attached. Keep it or replace it with this photo.")
                            .setNegativeButton("Keep existing", (dialog, which) -> { store.discardCandidate(candidate.optString("id")); finish(); })
                            .setPositiveButton("Replace", (dialog, which) -> accept(candidate, existing.optString("id")))
                            .setOnCancelListener(dialog -> { store.discardCandidate(candidate.optString("id")); finish(); }).show();
                });
            } catch (Exception failure) { runOnUiThread(() -> fail("The image could not be saved. Share one readable image smaller than 20 MB.")); }
        }, "incoming-photo-copy").start();
    }

    static boolean validIntent(Intent intent) {
        if (!Intent.ACTION_SEND.equals(intent.getAction())) return false;
        String mime = intent.getType();
        if (!"image/jpeg".equals(mime) && !"image/png".equals(mime) && !"image/webp".equals(mime) && !"image/*".equals(mime)) return false;
        if (intent.getClipData() != null && intent.getClipData().getItemCount() != 1) return false;
        Object stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        return stream instanceof Uri && "content".equals(((Uri) stream).getScheme());
    }

    private void accept(JSObject candidate, String previousId) {
        try {
            store.accept(candidate, previousId);
            startActivity(new Intent(this, MainActivity.class).putExtra("incoming_photo", true)
                    .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP));
            finish();
        } catch (Exception failure) { store.discardCandidate(candidate.optString("id")); fail("The waiting photo changed. Share the image again."); }
    }

    private void fail(String message) {
        new AlertDialog.Builder(this).setTitle("Photo could not be shared").setMessage(message)
                .setPositiveButton("Close", (dialog, which) -> finish()).setOnCancelListener(dialog -> finish()).show();
    }
}
