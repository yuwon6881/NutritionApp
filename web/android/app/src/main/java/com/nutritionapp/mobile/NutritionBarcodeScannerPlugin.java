package com.nutritionapp.mobile;

import android.Manifest;
import android.graphics.Point;
import android.view.View;
import android.view.ViewGroup;
import androidx.camera.view.PreviewView;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.google.mlkit.vision.barcode.common.Barcode;
import io.capawesome.capacitorjs.plugins.mlkit.barcodescanning.BarcodeScannerHelper;
import io.capawesome.capacitorjs.plugins.mlkit.barcodescanning.BarcodeScannerPlugin;

/** Keep the existing ML Kit scanner, exposing its raw corners and actual native preview geometry. */
@CapacitorPlugin(name = "BarcodeScanner", permissions = {
        @Permission(strings = {Manifest.permission.CAMERA}, alias = BarcodeScannerPlugin.CAMERA)
})
public class NutritionBarcodeScannerPlugin extends BarcodeScannerPlugin {
    @PluginMethod public void getScanCoordinateContract(PluginCall call) {
        JSObject result = new JSObject();
        result.put("version", 1);
        call.resolve(result);
    }

    @Override public void notifyBarcodesScannedListener(Barcode[] barcodes, Point imageSize) {
        View webview = getBridge().getWebView();
        ViewGroup parent = (ViewGroup) webview.getParent();
        PreviewView preview = null;
        for (int i = 0; i < parent.getChildCount(); i++) {
            if (parent.getChildAt(i) instanceof PreviewView) preview = (PreviewView) parent.getChildAt(i);
        }
        if (preview == null || imageSize == null) return;
        JSArray detections = new JSArray();
        for (Barcode barcode : barcodes)
            detections.put(BarcodeScannerHelper.createBarcodeResultForBarcode(barcode, imageSize, null));
        JSObject geometry = new JSObject();
        geometry.put("imageWidth", imageSize.x);
        geometry.put("imageHeight", imageSize.y);
        geometry.put("preview", bounds(preview));
        geometry.put("webview", bounds(webview));
        JSObject result = new JSObject();
        result.put("barcodes", detections);
        result.put("geometry", geometry);
        notifyListeners(BARCODES_SCANNED_EVENT, result);
    }

    private static JSObject bounds(View view) {
        int[] location = new int[2];
        view.getLocationOnScreen(location);
        JSObject result = new JSObject();
        result.put("left", location[0]);
        result.put("top", location[1]);
        result.put("width", view.getWidth());
        result.put("height", view.getHeight());
        return result;
    }

    @Override protected void handleOnPause() {
        ScannerCleanup.stop(getBridge());
        super.handleOnPause();
    }

    @Override protected void handleOnDestroy() {
        ScannerCleanup.stop(getBridge());
        super.handleOnDestroy();
    }
}
