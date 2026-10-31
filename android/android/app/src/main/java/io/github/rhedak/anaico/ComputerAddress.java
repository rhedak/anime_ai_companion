package io.github.rhedak.anaico;

import android.net.Uri;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The computer the phone connects to: an http address on the phone's own private network (Wi-Fi or a
 * Tailscale range), or a Bonjour `.local` name. Never this phone, never a public name. Pure Java, so the
 * rules can be tested without Android.
 */
public final class ComputerAddress {

    public static final int DEFAULT_PORT = 3737;
    private static final Pattern IPV4 = Pattern.compile("^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$");

    public final String host;
    public final int port;

    private ComputerAddress(String host, int port) {
        this.host = host;
        this.port = port;
    }

    /**
     * Accepts `192.168.1.9`, `192.168.1.9:3737`, `mac.local:3737`, or a full `http://…` link (the pairing link
     * from `/phone`). Throws IllegalArgumentException with a sentence the user can read when it is not allowed.
     */
    public static ComputerAddress parse(String input) {
        String text = input == null ? "" : input.trim();
        if (text.isEmpty()) throw new IllegalArgumentException("Type the computer's address, for example 192.168.1.9:3737.");
        if (!text.matches("(?i)^[a-z]+://.*")) text = "http://" + text;
        URI uri;
        try {
            uri = new URI(text);
        } catch (URISyntaxException e) {
            throw new IllegalArgumentException("That address does not look right. Type it as 192.168.1.9:3737.");
        }
        if (!"http".equalsIgnoreCase(uri.getScheme())) {
            throw new IllegalArgumentException("Only http addresses on your own network are allowed here.");
        }
        if (uri.getRawUserInfo() != null) {
            throw new IllegalArgumentException("The address must not contain a user name or password.");
        }
        String host = uri.getHost();
        if (host == null) throw new IllegalArgumentException("That address has no computer name or number in it.");
        host = host.toLowerCase(Locale.ROOT);
        if (!isPrivateHost(host)) {
            throw new IllegalArgumentException(
                host + " is not on your own network. Use the computer's address on Wi-Fi (192.168.x.x), a Tailscale address (100.x.x.x) or its name ending in .local.");
        }
        int port = uri.getPort() == -1 ? DEFAULT_PORT : uri.getPort();
        return new ComputerAddress(host, port);
    }

    /** Whether a host is on a private network a phone may reach: 10/8, 172.16/12, 192.168/16, 100.64/10 (Tailscale), or a .local name. */
    public static boolean isPrivateHost(String host) {
        if (host == null || host.isEmpty()) return false;
        Matcher m = IPV4.matcher(host);
        if (m.matches()) {
            int[] o = new int[4];
            for (int i = 0; i < 4; i++) {
                o[i] = Integer.parseInt(m.group(i + 1));
                if (o[i] > 255) return false;
            }
            if (o[0] == 10) return true;
            if (o[0] == 172 && o[1] >= 16 && o[1] <= 31) return true;
            if (o[0] == 192 && o[1] == 168) return true;
            return o[0] == 100 && o[1] >= 64 && o[1] <= 127;
        }
        return host.endsWith(".local") && host.length() > ".local".length();
    }

    /** `host:port`, the form the app saves and shows. */
    public String display() {
        return host + ":" + port;
    }

    /** The computer's own page, with no path. */
    public String origin() {
        return "http://" + host + ":" + port + "/";
    }

    /** Whether a URL the WebView wants to go to is this computer (same host, same port, http). */
    public boolean matches(Uri url) {
        if (url == null || !"http".equalsIgnoreCase(url.getScheme())) return false;
        String h = url.getHost();
        if (h == null || !h.toLowerCase(Locale.ROOT).equals(host)) return false;
        int p = url.getPort() == -1 ? 80 : url.getPort();
        return p == port;
    }

    /** The URL to load for a connection: the link itself when it is this computer (a pairing link), otherwise the computer's page. */
    public static String urlFor(ComputerAddress computer, String link) {
        Uri uri = Uri.parse(link == null ? "" : link.trim());
        if (computer.matches(uri)) return uri.toString();
        return computer.origin();
    }
}
