package org.inheritance.testhost;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.inputmethod.EditorInfo;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import org.json.JSONObject;

/** Debug-only WebView transport. Signing and fixtures belong to the local test server. */
public final class MainActivity extends Activity {
    private static final String DEFAULT_URL = "http://localhost:7777/";
    private WebView webView;
    private EditText address;
    private TextView status;
    private volatile Uri allowedOrigin;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (!BuildConfig.DEBUG) { finish(); return; }
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setFocusableInTouchMode(true);
        layout.setFitsSystemWindows(true);
        layout.setBackgroundColor(Color.rgb(255, 246, 215));
        status = new TextView(this);
        status.setText("TEST HOST · Android · local test funds only");
        status.setPadding(dp(12), dp(6), dp(12), dp(6));
        layout.addView(status);
        LinearLayout toolbar = new LinearLayout(this);
        address = new EditText(this);
        address.setSingleLine(true);
        address.setTextSize(13);
        address.setInputType(android.text.InputType.TYPE_CLASS_TEXT
            | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        address.setImeOptions(EditorInfo.IME_ACTION_GO);
        // Explicit adb launches can use an isolated harness port. openTestUrl still
        // applies the same local-origin allowlist before loading or persisting it.
        String launchUrl = getIntent().getDataString();
        address.setText(launchUrl != null ? launchUrl
            : getPreferences(MODE_PRIVATE).getString("testUrl", DEFAULT_URL));
        toolbar.addView(address, new LinearLayout.LayoutParams(0, dp(48), 1));
        Button open = new Button(this);
        open.setText("Open");
        open.setMinWidth(dp(64));
        open.setOnClickListener(v -> openTestUrl());
        toolbar.addView(open, new LinearLayout.LayoutParams(-2, dp(48)));
        Button reload = new Button(this);
        reload.setText("↻");
        reload.setContentDescription("Reload test page");
        reload.setOnClickListener(v -> webView.reload());
        toolbar.addView(reload, new LinearLayout.LayoutParams(dp(48), dp(48)));
        layout.addView(toolbar);
        webView = new WebView(this);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(false);
        webView.getSettings().setUserAgentString(webView.getSettings().getUserAgentString()
            + " InheritanceTestHost/Android");
        WebView.setWebContentsDebuggingEnabled(true);
        webView.addJavascriptInterface(new NativeBridge(), "Android");
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onJsConfirm(WebView view, String url, String message,
                    android.webkit.JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setTitle("Test host")
                    .setMessage(message).setPositiveButton("OK", (dialog, which) -> result.confirm())
                    .setNegativeButton("Cancel", (dialog, which) -> result.cancel())
                    .setOnCancelListener(dialog -> result.cancel()).show();
                return true;
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                boolean blocked = !sameOrigin(request.getUrl());
                if (blocked) status.setText("TEST HOST · external navigation blocked");
                return blocked;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,
                    WebResourceRequest request) {
                // The harness proxies APIs and RPC on its origin. No external frames/scripts.
                if (sameOrigin(request.getUrl())) return null;
                return new WebResourceResponse("text/plain", "utf-8", 403, "Blocked",
                    java.util.Collections.emptyMap(), new ByteArrayInputStream(
                    "Test host accepts only its configured origin".getBytes(StandardCharsets.UTF_8)));
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request,
                    android.webkit.WebResourceError error) {
                if (request.isForMainFrame()) status.setText("TEST HOST · " + error.getDescription());
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (sameOrigin(Uri.parse(url))) status.setText("TEST HOST · Android · local test funds only");
            }
        });
        layout.addView(webView, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(layout);
        layout.requestFocus();
        address.setOnEditorActionListener((v, action, event) -> {
            if (action == EditorInfo.IME_ACTION_GO) { openTestUrl(); return true; }
            return false;
        });
        openTestUrl();
    }

    private void openTestUrl() {
        Uri uri = Uri.parse(address.getText().toString().trim());
        if (!isLocalTestUrl(uri)) {
            status.setText("Use http(s)://localhost or a private LAN IPv4 address");
            return;
        }
        allowedOrigin = uri;
        getPreferences(MODE_PRIVATE).edit().putString("testUrl", uri.toString()).apply();
        webView.loadUrl(uri.toString());
        address.clearFocus();
        ((android.view.inputmethod.InputMethodManager) getSystemService(INPUT_METHOD_SERVICE))
            .hideSoftInputFromWindow(address.getWindowToken(), 0);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static boolean isLocalTestUrl(Uri uri) {
        if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()))
                || uri.getUserInfo() != null || uri.getHost() == null) return false;
        String host = uri.getHost().toLowerCase(Locale.ROOT);
        if (host.equals("localhost") || host.equals("127.0.0.1") || host.equals("[::1]")
                || host.equals("::1")) return true;
        String[] parts = host.split("\\.");
        if (parts.length != 4) return false;
        int[] octets = new int[4];
        for (int i = 0; i < 4; i++) {
            if (!parts[i].matches("[0-9]{1,3}")) return false;
            octets[i] = Integer.parseInt(parts[i]);
            if (octets[i] > 255) return false;
        }
        return octets[0] == 10 || (octets[0] == 192 && octets[1] == 168)
            || (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31);
    }

    private boolean sameOrigin(Uri uri) {
        Uri origin = allowedOrigin;
        return origin != null && origin.getScheme().equals(uri.getScheme())
            && origin.getHost().equalsIgnoreCase(uri.getHost() == null ? "" : uri.getHost())
            && effectivePort(origin) == effectivePort(uri) && uri.getUserInfo() == null;
    }

    private static int effectivePort(Uri uri) {
        return uri.getPort() != -1 ? uri.getPort() : "https".equals(uri.getScheme()) ? 443 : 80;
    }

    private final class NativeBridge {
        @JavascriptInterface public String getPlatform() { return "android"; }

        @JavascriptInterface public void postMessage(String payload) {
            // JavaScript interfaces run off the UI thread; recheck the active origin on UI.
            runOnUiThread(() -> {
                if (webView.getUrl() == null || !sameOrigin(Uri.parse(webView.getUrl()))) return;
                if (payload == null || payload.length() > 1_000_000) return;
                try {
                    // Parse and re-serialize JSON, never interpolate executable page input.
                    String json = new JSONObject(payload).toString();
                    webView.evaluateJavascript(
                        "void(window.__INHERITANCE_TEST_HOST_RECEIVE__?.(" + json + "))", null);
                } catch (org.json.JSONException error) {
                    status.setText("TEST HOST · invalid bridge JSON");
                }
            });
        }
    }

    @Override public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack(); else super.onBackPressed();
    }

    @Override public void onConfigurationChanged(android.content.res.Configuration configuration) {
        super.onConfigurationChanged(configuration);
        // Preserve the page, draft and pending SDK command when the OS rotates
        // or resizes this shell. The WebView handles its responsive layout.
        if (webView != null) webView.invalidate();
    }

    @Override protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("Android");
            webView.destroy();
        }
        super.onDestroy();
    }
}
