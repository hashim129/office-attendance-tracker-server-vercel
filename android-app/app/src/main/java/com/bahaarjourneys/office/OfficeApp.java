package com.bahaarjourneys.office;

import android.app.Application;

/** Starts before anything else, also when Android wakes the app for a push or a background check. */
public class OfficeApp extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        Push.createChannel(this);
        Push.startFirebase(this);
        if (Push.prefs(this).getBoolean("on", false)) Push.scheduleChecks(this);
    }
}
