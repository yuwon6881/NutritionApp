package com.nutritionapp.mobile;

import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginHandle;
import io.capawesome.capacitorjs.plugins.mlkit.barcodescanning.BarcodeScannerPlugin;

/** Invoke the existing adapter's camera/torch cleanup without sending into a dead renderer. */
final class ScannerCleanup {
    static void stop(Bridge bridge) {
        PluginHandle scanner = bridge.getPlugin("BarcodeScanner");
        if (scanner == null || !(scanner.getInstance() instanceof BarcodeScannerPlugin)) return;
        ((BarcodeScannerPlugin) scanner.getInstance()).stopScan(new PluginCall(null, "BarcodeScanner",
                PluginCall.CALLBACK_ID_DANGLING, "stopScan", new JSObject()) {
            @Override public void resolve() { }
            @Override public void reject(String message) { android.util.Log.w("ScannerCleanup", "camera_cleanup_failed"); }
        });
    }
}
