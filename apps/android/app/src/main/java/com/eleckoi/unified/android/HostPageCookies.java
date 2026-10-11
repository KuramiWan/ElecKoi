package com.eleckoi.unified.android;

import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import java.util.regex.Pattern;

/** One active authority in the app-owned WebView jar; product and plugin cookies remain untouched. */
final class HostPageCookies {
    // Locked client-connection browser-auth contract: SHA-256 authority, base64url without padding.
    private static final Pattern SESSION_NAME = Pattern.compile("dsh-auth-[A-Za-z0-9_-]{43}");
    interface Completion { void complete(boolean success); }
    interface Store {
        String get(String url);
        void set(String url, String header, Completion completion);
    }
    private HostPageCookies() {}

    static String sessionName(String header) {
        if (header == null) return null;
        int equals = header.indexOf('=');
        if (equals <= 0) return null;
        String name = header.substring(0, equals).trim();
        return SESSION_NAME.matcher(name).matches() ? name : null;
    }
    static List<String> mutations(String stored, String issued) throws IOException {
        String active = sessionName(issued);
        if (active == null || issued.substring(issued.indexOf('=') + 1).split(";", 2)[0].trim().isEmpty())
            throw new IOException("Host did not issue a supported browser session cookie");
        Set<String> obsolete = new LinkedHashSet<>();
        if (stored != null) for (String pair : stored.split(";")) {
            String name = sessionName(pair);
            if (name != null && !name.equals(active)) obsolete.add(name);
        }
        List<String> headers = new ArrayList<>();
        for (String name : obsolete) headers.add(name + "=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict");
        headers.add(issued);
        return headers;
    }
    static void install(Store store, String url, String issued, BooleanSupplier current,
                        Runnable admitted, Consumer<String> failed) {
        if (!current.getAsBoolean()) return;
        final List<String> headers;
        try { headers = mutations(store.get(url), issued); }
        catch (IOException error) { failed.accept(error.getMessage()); return; }
        apply(store, url, headers, 0, current, admitted, failed);
    }
    private static void apply(Store store, String url, List<String> headers, int index,
                              BooleanSupplier current, Runnable admitted, Consumer<String> failed) {
        if (!current.getAsBoolean()) return;
        if (index == headers.size()) { admitted.run(); return; }
        store.set(url, headers.get(index), success -> {
            if (!current.getAsBoolean()) return;
            if (!success) { failed.accept("Host browser session cookie update failed"); return; }
            apply(store, url, headers, index + 1, current, admitted, failed);
        });
    }
}
