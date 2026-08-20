package com.gullylegends.arena;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

public class MainActivity extends Activity {
    private static final String APP_DOMAIN = "www.gullylegends.eu";
    private static final String ASSET_PREFIX = "/__arena_assets__/";
    private static final String ASSET_APP_URL = "https://" + APP_DOMAIN + ASSET_PREFIX + "index.html";
    private static final String LEGACY_FILE_URL = "file:///android_asset/index.html?arena_legacy_migration=1";
    private static final String PREFS_NAME = "gully_legends_arena_webview";
    private static final String PREF_MIGRATION_COMPLETE = "asset_origin_migration_complete_v1";
    private static final String PREF_PENDING_LEGACY_DATA = "pending_legacy_local_storage_v1";
    private static final String PREF_LEGACY_DATA_APPLIED = "legacy_local_storage_applied_v1";

    private WebView webView;
    private WebViewAssetLoader assetLoader;
    private SharedPreferences prefs;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        assetLoader = new WebViewAssetLoader.Builder()
            .setDomain(APP_DOMAIN)
            .addPathHandler(ASSET_PREFIX, new WebViewAssetLoader.AssetsPathHandler(this))
            .build();

        webView = new WebView(this);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);

        webView.setBackgroundColor(0xFF0B1220);
        webView.setWebChromeClient(new WebChromeClient());
        webView.addJavascriptInterface(new LegacyStorageBridge(), "AndroidArenaMigration");
        webView.setWebViewClient(new ArenaWebViewClient());
        setContentView(webView);

        if (!prefs.getBoolean(PREF_MIGRATION_COMPLETE, false)) {
            s.setAllowFileAccess(true);
            webView.loadUrl(LEGACY_FILE_URL);
        } else {
            loadAssetApp();
        }
    }

    private void loadAssetApp() {
        WebSettings s = webView.getSettings();
        s.setAllowFileAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        webView.loadUrl(ASSET_APP_URL);
    }

    private boolean isLocalAssetUrl(Uri url) {
        return "https".equals(url.getScheme())
            && APP_DOMAIN.equals(url.getHost())
            && url.getPath() != null
            && url.getPath().startsWith(ASSET_PREFIX);
    }

    private boolean isAppSyncApiUrl(Uri url) {
        return "https".equals(url.getScheme())
            && APP_DOMAIN.equals(url.getHost())
            && url.getPath() != null
            && url.getPath().startsWith("/api/app-sync/");
    }

    private void applyLegacyLocalStorageIfNeeded() {
        if (prefs.getBoolean(PREF_LEGACY_DATA_APPLIED, false)) {
            return;
        }
        String legacyJson = prefs.getString(PREF_PENDING_LEGACY_DATA, null);
        if (legacyJson == null || legacyJson.trim().isEmpty()) {
            prefs.edit().putBoolean(PREF_LEGACY_DATA_APPLIED, true).apply();
            return;
        }
        String quotedJson = JSONObject.quote(legacyJson);
        String script =
            "(function(){"
                + "var data=JSON.parse(" + quotedJson + ");"
                + "var keys=['gla_roster','gla_matches','gla_active','gla_settings'];"
                + "var copied=false;"
                + "keys.forEach(function(k){"
                + "if(localStorage.getItem(k)===null&&Object.prototype.hasOwnProperty.call(data,k)&&data[k]!==null){"
                + "localStorage.setItem(k,data[k]);copied=true;"
                + "}"
                + "});"
                + "localStorage.setItem('gla_asset_origin_migration_complete','1');"
                + "if(copied){localStorage.setItem('gla_skip_auto_sync_once','1');}"
                + "return copied?'copied':'no-op';"
                + "})();";
        webView.evaluateJavascript(script, value -> {
            prefs.edit()
                .remove(PREF_PENDING_LEGACY_DATA)
                .putBoolean(PREF_LEGACY_DATA_APPLIED, true)
                .apply();
            if (value != null && value.contains("copied")) {
                webView.reload();
            }
        });
    }

    private class ArenaWebViewClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (isLocalAssetUrl(url)) {
                return assetLoader.shouldInterceptRequest(url);
            }
            return null;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            String scheme = url.getScheme();
            if (isLocalAssetUrl(url) || isAppSyncApiUrl(url)) {
                return false;
            }
            if ("http".equals(scheme) || "https".equals(scheme)) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (Exception ignored) {
                }
                return true;
            }
            return false;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            if (ASSET_APP_URL.equals(url)) {
                applyLegacyLocalStorageIfNeeded();
            }
        }
    }

    private class LegacyStorageBridge {
        @JavascriptInterface
        public void receive(String json) {
            runOnUiThread(() -> {
                prefs.edit()
                    .putString(PREF_PENDING_LEGACY_DATA, json == null ? "{}" : json)
                    .putBoolean(PREF_MIGRATION_COMPLETE, true)
                    .apply();
                loadAssetApp();
            });
        }
    }

    @Override
    public void onBackPressed() {
        webView.evaluateJavascript("window.appBack ? window.appBack() : 'exit'",
            new ValueCallback<String>() {
                @Override
                public void onReceiveValue(String value) {
                    if (value == null || value.contains("exit")) {
                        finish();
                    }
                }
            });
    }
}
