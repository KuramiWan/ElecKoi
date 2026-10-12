package com.eleckoi.app;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;

/** Bounded, page-local startup errors; successful boot stops collection. */
final class WebClientStartupDiagnostics {
    private static final int MAX_ERRORS = 8, MAX_MESSAGE = 2048;
    private final List<String> errors = new ArrayList<>();
    private String environment = "";
    private boolean collecting;

    void begin(String provider, String userAgent) {
        errors.clear(); collecting = true;
        environment = "WebView: " + provider + "\nUser-Agent: " + userAgent;
    }

    boolean record(String message, String source, int line) {
        if (!collecting || message == null || message.trim().isEmpty() || errors.size() >= MAX_ERRORS) return false;
        String text = message.length() > MAX_MESSAGE ? message.substring(0, MAX_MESSAGE) + "…" : message;
        String location = sourceLocation(source);
        String entry = location.isEmpty() ? text : location + ":" + line + "\n" + text;
        if (errors.contains(entry)) return false;
        errors.add(entry); return true;
    }

    void complete() { collecting = false; }

    String details() {
        if (environment.isEmpty()) return "";
        return environment + (errors.isEmpty() ? "" : "\n\n原始页面错误：\n" + String.join("\n\n", errors));
    }

    String failure(String message) {
        String detail = details();
        return detail.isEmpty() ? message : detail + "\n\n" + message;
    }

    private static String sourceLocation(String source) {
        if (source == null || source.isEmpty()) return "";
        try {
            URI uri = URI.create(source);
            if (uri.getScheme() != null && uri.getHost() != null) {
                return uri.getScheme() + "://" + uri.getHost() + (uri.getPort() < 0 ? "" : ":" + uri.getPort())
                    + (uri.getRawPath() == null ? "" : uri.getRawPath());
            }
        } catch (IllegalArgumentException ignored) { }
        int query = source.indexOf('?'), fragment = source.indexOf('#');
        int end = Math.min(query < 0 ? source.length() : query, fragment < 0 ? source.length() : fragment);
        return source.substring(0, Math.min(end, 512));
    }
}
