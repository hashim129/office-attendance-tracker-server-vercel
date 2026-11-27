package com.bahaarjourneys.office;

import android.app.job.JobParameters;
import android.app.job.JobService;

/** The background check (about every 15 minutes) for new office notifications. */
public class PollJob extends JobService {
    @Override
    public boolean onStartJob(JobParameters params) {
        new Thread(() -> {
            try { Push.checkNow(getApplicationContext()); } catch (Exception ignored) { }
            jobFinished(params, false);
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) { return true; }
}
