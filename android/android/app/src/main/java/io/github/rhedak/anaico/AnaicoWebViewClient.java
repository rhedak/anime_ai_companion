package io.github.rhedak.anaico;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/**
 * Keeps the WebView on the connected computer. Capacitor sends every other link to the phone's browser;
 * a link to the connected computer stays in the WebView.
 */
public class AnaicoWebViewClient extends BridgeWebViewClient {

    public AnaicoWebViewClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        ComputerAddress computer = ComputerPlugin.connected;
        Uri url = request.getUrl();
        if (computer != null && computer.matches(url)) return false;
        return super.shouldOverrideUrlLoading(view, request);
    }
}
