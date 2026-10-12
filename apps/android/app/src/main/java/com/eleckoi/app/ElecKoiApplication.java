package com.eleckoi.app;

import android.app.Application;

/** Owns Android platform services for Activity and scheduled-job lifetimes. */
public final class ElecKoiApplication extends Application {
    private AppUpdates updates;
    @Override public void onCreate() {
        super.onCreate(); updates=new AppUpdates(this); updates.scheduleBackground();
    }
    AppUpdates updates() { return updates; }
}
