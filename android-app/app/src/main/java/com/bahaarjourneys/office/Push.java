package com.bahaarjourneys.office;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;

import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * Phone notifications for Bahaar Office.
 *  - Firebase (instant, also when the app is closed) once the office has set it up on the server.
 *  - A background check about every 15 minutes, which works with or without Firebase.
 */
final class Push {
    static final String CHANNEL = "office-alerts-v2";
    static final String API = MainActivity.HOME + "api/system?task=";
    private static final int JOB_ID = 7301;

    private Push() {}

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("push", Context.MODE_PRIVATE); }

    /** This phone's own random key (its secret for background checks). */
    static String deviceKey(Context c) {
        SharedPreferences p = prefs(c);
        String k = p.getString("key", "");
        if (k.isEmpty()) {
            k = UUID.randomUUID().toString().replace("-", "") + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
            p.edit().putString("key", k).apply();
        }
        return k;
    }

    static void createChannel(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Office alerts", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Punch reminders, follow-ups, invoices and team updates");
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[]{0, 120, 60, 120, 60, 220});
        ch.enableLights(true);
        ch.setLightColor(Color.rgb(37, 99, 235));
        ch.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm != null) {
            nm.deleteNotificationChannel("office-alerts");
            nm.createNotificationChannel(ch);
        }
    }

    static void show(Context c, int id, String title, String body) { show(c, id, title, body, "", "", ""); }

    /** Shows one notification, with action buttons where they help (Punch in / Punch out / Still working / Approve / Decline). */
    static void show(Context c, int id, String title, String body, String category, String refId, String notifId) {
        if (Build.VERSION.SDK_INT >= 33 && c.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) return;
        String cat = category == null ? "" : category;
        String ref = refId == null ? "" : refId;
        String nid = notifId == null ? "" : notifId;
        PendingIntent pi = action(c, id * 4, "open:" + cat + ":" + ref);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, CHANNEL) : new Notification.Builder(c);
        b.setSmallIcon(R.drawable.ic_notify)
                .setColor(Color.rgb(37, 99, 235))
                .setCategory(Notification.CATEGORY_MESSAGE)
                .setWhen(System.currentTimeMillis())
                .setShowWhen(true)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setContentIntent(pi);
        String text = body == null ? "" : body.toLowerCase();
        if (ref.startsWith("pin-")) {
            b.addAction(button(c, "Punch in", action(c, id * 4 + 1, "punch-in")));
        } else if (nid.endsWith("-end") || ref.startsWith("geo-out-")) {
            b.addAction(button(c, "Punch out", action(c, id * 4 + 1, "punch-out")));
        } else if (nid.contains("-ask-")) {
            b.addAction(button(c, "I'm still working", action(c, id * 4 + 1, "work-confirm")));
            b.addAction(button(c, "Punch out", action(c, id * 4 + 2, "punch-out")));
        } else if (ref.startsWith("leave-") && text.contains("asked for")) {
            b.addAction(button(c, "Approve", action(c, id * 4 + 1, "leave-approve:" + ref)));
            b.addAction(button(c, "Decline", action(c, id * 4 + 2, "leave-decline:" + ref)));
        }
        if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(id, b.build());
    }

    private static PendingIntent action(Context c, int code, String appAction) {
        Intent open = new Intent(c, MainActivity.class);
        open.putExtra(AppExtras.ACTION_EXTRA, appAction);
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(c, code, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    @SuppressWarnings("deprecation")
    private static Notification.Action button(Context c, String label, PendingIntent pi) {
        return new Notification.Action.Builder((android.graphics.drawable.Icon) null, label, pi).build();
    }

    static JSONObject post(String task, JSONObject body) throws Exception {
        HttpURLConnection con = (HttpURLConnection) new URL(API + task).openConnection();
        con.setConnectTimeout(10000);
        con.setReadTimeout(15000);
        con.setRequestMethod("POST");
        con.setDoOutput(true);
        con.setRequestProperty("Content-Type", "application/json");
        try (OutputStream os = con.getOutputStream()) { os.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
        StringBuilder sb = new StringBuilder();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(con.getResponseCode() < 400 ? con.getInputStream() : con.getErrorStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
        }
        return new JSONObject(sb.length() == 0 ? "{}" : sb.toString());
    }

    static String appVersion(Context c) {
        try { return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName; } catch (Exception e) { return ""; }
    }

    /** Called by the web page after sign-in. Runs off the main thread. */
    static void register(Context c, String sessionToken) {
        final Context app = c.getApplicationContext();
        new Thread(() -> {
            try {
                if (sessionToken != null && !sessionToken.isEmpty()) prefs(app).edit().putString("session", sessionToken).putBoolean("on", true).apply();
                String session = prefs(app).getString("session", "");
                if (session.isEmpty()) return;
                JSONObject b = new JSONObject()
                        .put("sessionToken", session)
                        .put("deviceKey", deviceKey(app))
                        .put("appVersion", appVersion(app));
                String token = prefs(app).getString("fcm", "");
                if (!token.isEmpty()) b.put("fcmToken", token);
                JSONObject r = post("push-register", b);
                if (!r.optBoolean("ok")) return;
                JSONObject fb = r.optJSONObject("firebase");
                if (fb != null) {
                    prefs(app).edit().putString("firebase", fb.toString()).apply();
                    if (startFirebase(app) && token.isEmpty()) fetchToken(app);
                }
                scheduleChecks(app);
            } catch (Exception ignored) { /* offline: tried again at the next sign-in / app start */ }
        }).start();
    }

    static void unregister(Context c) {
        final Context app = c.getApplicationContext();
        prefs(app).edit().remove("session").putBoolean("on", false).apply();
        JobScheduler js = (JobScheduler) app.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js != null) js.cancel(JOB_ID);
        new Thread(() -> {
            try { post("push-unregister", new JSONObject().put("deviceKey", deviceKey(app))); } catch (Exception ignored) { }
        }).start();
    }

    /** Starts Firebase from the settings the server gave us (cached for when the app is opened by a push). */
    static boolean startFirebase(Context c) {
        try {
            if (!FirebaseApp.getApps(c).isEmpty()) return true;
            String raw = prefs(c).getString("firebase", "");
            if (raw.isEmpty()) return false;
            JSONObject j = new JSONObject(raw);
            FirebaseOptions o = new FirebaseOptions.Builder()
                    .setApiKey(j.getString("apiKey"))
                    .setApplicationId(j.getString("appId"))
                    .setProjectId(j.getString("projectId"))
                    .setGcmSenderId(j.getString("senderId"))
                    .build();
            FirebaseApp.initializeApp(c, o);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    static void fetchToken(Context c) {
        try {
            FirebaseMessaging.getInstance().getToken().addOnSuccessListener(t -> {
                if (t == null || t.isEmpty()) return;
                prefs(c).edit().putString("fcm", t).apply();
                register(c, null);
            });
        } catch (Exception ignored) { }
    }

    static void onNewToken(Context c, String token) {
        prefs(c).edit().putString("fcm", token).apply();
        if (prefs(c).getBoolean("on", false)) register(c, null);
    }

    /** About every 15 minutes (Android decides the exact moment), also after a phone restart. */
    static void scheduleChecks(Context c) {
        JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js == null) return;
        for (JobInfo j : js.getAllPendingJobs()) if (j.getId() == JOB_ID) return;
        JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(c, PollJob.class))
                .setPeriodic(15 * 60 * 1000L)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .build();
        js.schedule(job);
    }

    /** One background check: shows anything new for this phone's person. */
    static void checkNow(Context c) throws Exception {
        if (!prefs(c).getBoolean("on", false) || MainActivity.inFront) return;
        JSONObject req = new JSONObject().put("deviceKey", deviceKey(c));
        android.location.Location loc = AppExtras.lastLocation(c);
        if (loc != null) req.put("lat", loc.getLatitude()).put("lng", loc.getLongitude()).put("acc", loc.getAccuracy());
        JSONObject r = post("push-pending", req);
        if (r.optBoolean("gone")) { prefs(c).edit().putBoolean("on", false).apply(); return; }
        org.json.JSONArray items = r.optJSONArray("items");
        if (items == null) return;
        for (int i = 0; i < items.length(); i++) {
            JSONObject n = items.getJSONObject(i);
            show(c, n.optString("id").hashCode(), n.optString("title", "Bahaar Office"), n.optString("body"), n.optString("category"), n.optString("refId"), n.optString("id"));
        }
    }
}
