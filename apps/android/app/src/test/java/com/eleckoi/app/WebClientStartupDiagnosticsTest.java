package com.eleckoi.app;

import org.junit.Test;
import static org.junit.Assert.*;

public final class WebClientStartupDiagnosticsTest {
    @Test public void includesOriginalExceptionAndLocationAlongsideTheBootSummary() {
        WebClientStartupDiagnostics diagnostics = new WebClientStartupDiagnostics();
        diagnostics.begin("synthetic.webview 99.0", "Synthetic WebView");
        assertTrue(diagnostics.record("TypeError: syntheticMethod is not a function\n    at apply (synthetic.js:10)",
            "http://127.0.0.1:12345/plugins/synthetic.js?token=synthetic-secret", 10));
        String report = diagnostics.failure("web boot: 32 entries did not activate");
        assertTrue(report.endsWith("web boot: 32 entries did not activate"));
        assertTrue(report.contains("WebView: synthetic.webview 99.0"));
        assertTrue(report.contains("User-Agent: Synthetic WebView"));
        assertTrue(report.contains("TypeError: syntheticMethod is not a function"));
        assertTrue(report.contains("http://127.0.0.1:12345/plugins/synthetic.js:10"));
        assertFalse(report.contains("synthetic-secret"));
    }

    @Test public void boundsAndDeduplicatesErrorsAndStopsAfterReadiness() {
        WebClientStartupDiagnostics diagnostics = new WebClientStartupDiagnostics();
        diagnostics.begin("synthetic.webview", "Synthetic WebView");
        assertTrue(diagnostics.record("synthetic first failure", "synthetic.js", 1));
        assertFalse(diagnostics.record("synthetic first failure", "synthetic.js", 1));
        for (int index = 0; index < 20; index++) diagnostics.record("synthetic failure " + index, "synthetic.js", index);
        assertFalse(diagnostics.details().contains("synthetic failure 19"));
        diagnostics.complete();
        assertFalse(diagnostics.record("after readiness", "synthetic.js", 1));
        diagnostics.begin("synthetic.next 114", "Next WebView");
        assertFalse(diagnostics.details().contains("synthetic first failure"));
        assertTrue(diagnostics.record(new String(new char[10000]).replace('\0', 'x'), "synthetic.js", 1));
        assertTrue(diagnostics.details().length() < 3000);
    }
}
