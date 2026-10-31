package io.github.rhedak.anaico;

import android.net.Uri;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /** The connect screen: the app's own page, the only one that has the native bridge. */
    static final String CONNECT_PAGE = "https://localhost/";

    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(ComputerPlugin.class);
        super.onCreate(savedInstanceState);
        getBridge().setWebViewClient(new AnaicoWebViewClient(getBridge()));
        WebSettings settings = getBridge().getWebView().getSettings();
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (!goBackInApp()) {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                    setEnabled(true);
                }
            }
        });
    }

    /** Back in the WebView first; from the connected computer's page, back to the connect screen. */
    private boolean goBackInApp() {
        WebView webView = getBridge().getWebView();
        if (webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        if (ComputerPlugin.connected != null && !isConnectPage(webView.getUrl())) {
            webView.loadUrl(CONNECT_PAGE);
            return true;
        }
        return false;
    }

    private static boolean isConnectPage(String url) {
        Uri uri = url == null ? null : Uri.parse(url);
        return uri != null && "https".equals(uri.getScheme()) && "localhost".equals(uri.getHost());
    }
}
