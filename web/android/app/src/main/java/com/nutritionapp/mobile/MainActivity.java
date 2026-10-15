package com.nutritionapp.mobile;

import android.net.Uri;
import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.RenderProcessGoneDetail;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    // Keep this aligned with CapacitorConfig.server.hostname.
    private static final String APP_HOST = "nutrition-diary-app.vercel.app";

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleActionIntent(intent);
    }

    // Shared by onNewIntent (activity already running) and onCreate (cold launch), where the
    // same action arrives only through getIntent() and onNewIntent is never called.
    private void handleActionIntent(Intent intent) {
        if (intent.getBooleanExtra("incoming_photo", false) && getBridge() != null) {
            com.getcapacitor.PluginHandle plugin = getBridge().getPlugin("NutritionDevice");
            if (plugin != null) ((NutritionDevicePlugin) plugin.getInstance()).incomingPhotoReady();
            intent.removeExtra("incoming_photo");
        }
        if (NativeShortcutStore.capture(this, intent) && getBridge() != null) {
            com.getcapacitor.PluginHandle plugin = getBridge().getPlugin("NutritionDevice");
            if (plugin != null) ((NutritionDevicePlugin) plugin.getInstance()).shortcutReady();
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        initialPlugins.add(NutritionBarcodeScannerPlugin.class);
        registerPlugin(NutritionDevicePlugin.class);
        super.onCreate(savedInstanceState);

        Bridge bridge = getBridge();
        if (bridge == null) return;

        handleActionIntent(getIntent());

        bridge.getWebView().setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                ScannerCleanup.stop(bridge);
                return RendererRecovery.handle(MainActivity.this, view);
            }
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                // Let Vercel handle API calls while static paths resolve from the APK bundle.
                if (isRemoteAppEndpoint(request.getUrl())) return null;
                return super.shouldInterceptRequest(view, request);
            }
        });
    }

    private static boolean isRemoteAppEndpoint(Uri uri) {
        if (!"https".equalsIgnoreCase(uri.getScheme()) || !APP_HOST.equalsIgnoreCase(uri.getHost())) return false;
        String path = uri.getPath();
        return path != null && (path.equals("/api") || path.startsWith("/api/") || path.equals("/health"));
    }
}
