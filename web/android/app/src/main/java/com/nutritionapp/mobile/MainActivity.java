package com.nutritionapp.mobile;

import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    // Keep this aligned with CapacitorConfig.server.hostname.
    private static final String APP_HOST = "nutrition-diary-app.vercel.app";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Bridge bridge = getBridge();
        if (bridge == null) return;

        bridge.getWebView().setWebViewClient(new BridgeWebViewClient(bridge) {
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
