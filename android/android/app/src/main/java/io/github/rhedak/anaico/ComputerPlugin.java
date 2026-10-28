package io.github.rhedak.anaico;

import android.content.SharedPreferences;
import android.webkit.CookieManager;
import android.webkit.WebView;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKeys;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The connect screen's only way to the native side: the saved computer, opening it, and forgetting it.
 * Capacitor gives its bridge only to the app's own origin, so the computer's page cannot call this.
 */
@CapacitorPlugin(name = "Computer")
public class ComputerPlugin extends Plugin {

    private static final String PREFS = "computer";
    private static final String KEY = "address";

    /** The computer the WebView is connected to; null while the connect screen is shown. */
    static volatile ComputerAddress connected;

    private SharedPreferences prefs() throws Exception {
        return EncryptedSharedPreferences.create(
            PREFS,
            MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC),
            getContext(),
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        );
    }

    @PluginMethod
    public void saved(PluginCall call) {
        try {
            JSObject result = new JSObject();
            result.put("address", prefs().getString(KEY, null));
            call.resolve(result);
        } catch (Exception e) {
            call.reject("The saved computer could not be read. Forget it and type the address again.");
        }
    }

    @PluginMethod
    public void open(PluginCall call) {
        String link = call.getString("url", "");
        ComputerAddress computer;
        try {
            computer = ComputerAddress.parse(link);
            prefs().edit().putString(KEY, computer.display()).apply();
        } catch (IllegalArgumentException e) {
            call.reject(e.getMessage());
            return;
        } catch (Exception e) {
            call.reject("The computer could not be remembered, so it was not opened.");
            return;
        }
        String url = ComputerAddress.urlFor(computer, link);
        connected = computer;
        getActivity().runOnUiThread(() -> {
            WebView webView = getBridge().getWebView();
            webView.loadUrl(url);
            call.resolve();
        });
    }

    @PluginMethod
    public void forget(PluginCall call) {
        connected = null;
        try {
            prefs().edit().remove(KEY).apply();
        } catch (Exception e) {
            call.reject("The saved computer could not be removed.");
            return;
        }
        getActivity().runOnUiThread(() -> CookieManager.getInstance().removeAllCookies(ignored -> call.resolve()));
    }
}
