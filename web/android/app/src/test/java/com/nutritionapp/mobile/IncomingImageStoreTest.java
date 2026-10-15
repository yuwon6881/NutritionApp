package com.nutritionapp.mobile;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import com.getcapacitor.JSObject;
import java.io.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class IncomingImageStoreTest {
    private byte[] png() {
        Bitmap bitmap = Bitmap.createBitmap(4, 4, Bitmap.Config.ARGB_8888);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, output);
        bitmap.recycle();
        return output.toByteArray();
    }

    @Test public void acceptsOnlyOneContentStreamWithASupportedDeclaredType() {
        Intent valid = new Intent(Intent.ACTION_SEND).setType("image/jpeg").putExtra(Intent.EXTRA_STREAM, Uri.parse("content://gallery/photo"));
        assertTrue(IncomingImageActivity.validIntent(valid));
        assertFalse(IncomingImageActivity.validIntent(new Intent(valid).putExtra(Intent.EXTRA_STREAM, Uri.parse("file:///sdcard/private"))));
        assertFalse(IncomingImageActivity.validIntent(new Intent(valid).putExtra(Intent.EXTRA_STREAM, Uri.parse("https://example.com/photo"))));
        assertFalse(IncomingImageActivity.validIntent(new Intent(valid).setAction(Intent.ACTION_SEND_MULTIPLE)));
        assertFalse(IncomingImageActivity.validIntent(new Intent(valid).setType("text/plain")));
    }

    @Test public void validatesActualContentAndKeepsThePendingImageAcrossStoreRecreation() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        IncomingImageStore store = new IncomingImageStore(context);
        assertThrows(IOException.class, () -> store.stage(new ByteArrayInputStream("not an image".getBytes())));
        JSObject first = store.stage(new ByteArrayInputStream(png()));
        store.accept(first, null);
        IncomingImageStore recreated = new IncomingImageStore(context);
        assertEquals(first.getString("id"), recreated.peek().getString("id"));
        assertFalse(recreated.read(first.getString("id")).isEmpty());
        JSObject second = store.stage(new ByteArrayInputStream(png()));
        assertThrows(IOException.class, () -> store.accept(second, null));
        assertEquals(first.getString("id"), store.peek().getString("id"));
        store.accept(second, first.getString("id"));
        assertEquals(second.getString("id"), store.peek().getString("id"));
        store.discard(second.getString("id"));
        assertNull(store.peek());
    }

    @Test public void sizeLimitAndInterruptedCopiesNeverPublishAPartialImage() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        IncomingImageStore store = new IncomingImageStore(context);
        assertThrows(IOException.class, () -> store.stage(new InputStream() {
            long remaining = IncomingImageStore.MAX_BYTES + 1;
            @Override public int read() { return remaining-- > 0 ? 0 : -1; }
            @Override public int read(byte[] bytes) {
                if (remaining <= 0) return -1;
                int count = (int) Math.min(bytes.length, remaining);
                remaining -= count;
                return count;
            }
        }));
        assertThrows(IOException.class, () -> store.stage(new InputStream() {
            @Override public int read() throws IOException { throw new IOException("grant lost"); }
        }));
        assertNull(store.peek());
        File directory = new File(context.getNoBackupFilesDir(), "incoming-photo");
        assertEquals(0, directory.listFiles((dir, name) -> name.endsWith(".image")).length);
    }
}
