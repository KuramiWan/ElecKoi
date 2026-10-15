package com.eleckoi.app;

import android.app.Application;

/** Owns Android platform services for Activity and scheduled-job lifetimes. */
public final class ElecKoiApplication extends Application {
    private AppUpdates updates;
    private AndroidDiagnostics diagnostics;
    @Override public void onCreate() {
        super.onCreate(); diagnostics=new AndroidDiagnostics(this); updates=new AppUpdates(this); updates.scheduleBackground();
    }
    AppUpdates updates() { return updates; }
    AndroidDiagnostics diagnostics() { return diagnostics; }
}
