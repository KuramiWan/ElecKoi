package com.eleckoi.app;

import android.app.job.*;

/** Runs periodic network checks without starting the local AI Host. */
public final class AppUpdateJobService extends JobService {
    private Runnable detach;
    private boolean active;
    @Override public boolean onStartJob(JobParameters params) {
        active=true;
        detach=((ElecKoiApplication)getApplication()).updates().check(false,success -> { if(active) { active=false; jobFinished(params,!success); } });
        return true;
    }
    @Override public boolean onStopJob(JobParameters params) {
        active=false; if(detach!=null) detach.run(); return true;
    }
}
