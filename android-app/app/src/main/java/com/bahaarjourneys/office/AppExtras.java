package com.bahaarjourneys.office;

import android.Manifest;
import android.app.Activity;
import android.app.KeyguardManager;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.location.Location;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * Extra phone-app features kept out of MainActivity: fingerprint / face lock, actions from notification buttons,
 * home-screen shortcuts and the widget, files shared into the app, screenshot block and office location reminders.
 */
final class AppExtras {
    private AppExtras() { }

    static final String ACTION_EXTRA = "appAction";
    private static String pendingAction = "";
    private static String pendingShare = "";
    private static long pausedAt = 0;
    private static FrameLayout lockView;

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("extras", Context.MODE_PRIVATE); }

    // ------------------------------------------------------------------ launch actions & shared files
    /** Reads what the app was opened with. Returns true when there is a new action for the page. */
    static boolean handleIntent(Activity a, Intent i) {
        if (i == null) return false;
        boolean got = false;
        String act = i.getStringExtra(ACTION_EXTRA);
        if (act != null && !act.isEmpty()) { pendingAction = act; got = true; i.removeExtra(ACTION_EXTRA); }
        Uri data = i.getData();
        if (data != null && "bahaaroffice".equals(data.getScheme())) {
            String p = data.getPath() == null ? "" : data.getPath().replaceFirst("^/", "");
            if (!p.isEmpty()) { pendingAction = p; got = true; }
            i.setData(null);
        }
        if (Intent.ACTION_SEND.equals(i.getAction())) {
            Uri u = Build.VERSION.SDK_INT >= 33 ? i.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class) : (Uri) i.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) {
                try { pendingShare = readShared(a, u, i.getType()); got = true; } catch (Exception ignored) { }
            }
            i.setAction(Intent.ACTION_MAIN);
        }
        return got;
    }

    private static String readShared(Context c, Uri u, String type) throws Exception {
        String name = "shared";
        try (android.database.Cursor cur = c.getContentResolver().query(u, null, null, null, null)) {
            if (cur != null && cur.moveToFirst()) {
                int idx = cur.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) name = cur.getString(idx);
            }
        } catch (Exception ignored) { }
        String mime = c.getContentResolver().getType(u);
        if (mime == null) mime = type == null ? "application/octet-stream" : type;
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (InputStream in = c.getContentResolver().openInputStream(u)) {
            if (in == null) throw new Exception("no stream");
            byte[] buf = new byte[16384];
            int n; long total = 0;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > 8L * 1024 * 1024) throw new Exception("too big");
                out.write(buf, 0, n);
            }
        }
        return new JSONObject().put("name", name).put("type", mime).put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)).toString();
    }

    static String takeAction() { String a = pendingAction; pendingAction = ""; return a; }
    static String takeShare() { String s = pendingShare; pendingShare = ""; return s; }

    // ------------------------------------------------------------------ screenshot block
    static void setSecure(Activity a, boolean on) {
        new Handler(Looper.getMainLooper()).post(() -> {
            if (on) a.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            else a.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        });
    }

    // ------------------------------------------------------------------ fingerprint / face lock
    static boolean biometricAvailable(Context c) {
        if (Build.VERSION.SDK_INT < 29) return false;
        KeyguardManager km = (KeyguardManager) c.getSystemService(Context.KEYGUARD_SERVICE);
        return km != null && km.isDeviceSecure();
    }
    static boolean biometricEnabled(Context c) { return biometricAvailable(c) && prefs(c).getBoolean("bio", false); }

    /** Turning it on asks once, so the person knows it works on this phone. */
    static void setBiometric(Activity a, boolean on) {
        if (!on) { prefs(a).edit().putBoolean("bio", false).apply(); return; }
        if (!biometricAvailable(a)) return;
        new Handler(Looper.getMainLooper()).post(() -> prompt(a, () -> prefs(a).edit().putBoolean("bio", true).apply(), () -> { }));
    }

    static void onPause() { pausedAt = System.currentTimeMillis(); }

    /** Locks on start and after more than a minute in the background, if the person is signed in and switched it on. */
    static void maybeLock(Activity a, boolean coldStart) {
        if (!biometricEnabled(a) || !Push.prefs(a).getBoolean("on", false)) return;
        if (!coldStart && (pausedAt == 0 || System.currentTimeMillis() - pausedAt < 60_000)) return;
        showLock(a);
    }

    private static void showLock(Activity a) {
        ViewGroup content = a.findViewById(android.R.id.content);
        if (content == null) return;
        if (lockView != null && lockView.getParent() != null) return;
        FrameLayout v = new FrameLayout(a);
        GradientDrawable bg = new GradientDrawable(GradientDrawable.Orientation.TL_BR, new int[]{Color.parseColor("#0B2A6F"), Color.parseColor("#1A43B8"), Color.parseColor("#1D4ED8")});
        v.setBackground(bg);
        v.setClickable(true);
        LinearLayout col = new LinearLayout(a);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);
        ImageView logo = new ImageView(a);
        logo.setImageResource(R.drawable.loading_logo);
        logo.setAdjustViewBounds(true);
        int w = Math.min(dp(a, 240), Math.round(a.getResources().getDisplayMetrics().widthPixels * 0.62f));
        col.addView(logo, new LinearLayout.LayoutParams(w, ViewGroup.LayoutParams.WRAP_CONTENT));
        TextView t = new TextView(a);
        t.setText("Locked");
        t.setTextColor(Color.WHITE);
        t.setTextSize(20);
        t.setGravity(Gravity.CENTER);
        t.setPadding(0, dp(a, 28), 0, dp(a, 6));
        col.addView(t);
        TextView sub = new TextView(a);
        sub.setText("Use your fingerprint, face or screen lock");
        sub.setTextColor(Color.parseColor("#D6E6FF"));
        sub.setTextSize(14);
        sub.setGravity(Gravity.CENTER);
        col.addView(sub);
        Button b = new Button(a);
        b.setText("Unlock");
        b.setAllCaps(false);
        b.setTextColor(Color.parseColor("#0B1B4D"));
        GradientDrawable bb = new GradientDrawable();
        bb.setColor(Color.WHITE);
        bb.setCornerRadius(dp(a, 14));
        b.setBackground(bb);
        LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(dp(a, 200), dp(a, 52));
        blp.topMargin = dp(a, 28);
        col.addView(b, blp);
        v.addView(col, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        content.addView(v, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        lockView = v;
        Runnable unlock = () -> { if (lockView != null && lockView.getParent() != null) ((ViewGroup) lockView.getParent()).removeView(lockView); lockView = null; };
        b.setOnClickListener((x) -> prompt(a, unlock, () -> { }));
        v.postDelayed(() -> prompt(a, unlock, () -> { }), 250);
    }

    private static void prompt(Activity a, Runnable ok, Runnable fail) {
        if (Build.VERSION.SDK_INT < 29) { ok.run(); return; }
        try {
            android.hardware.biometrics.BiometricPrompt.Builder b = new android.hardware.biometrics.BiometricPrompt.Builder(a)
                    .setTitle("Unlock Bahaar Office")
                    .setSubtitle("Use your fingerprint, face or screen lock");
            if (Build.VERSION.SDK_INT >= 30) {
                b.setAllowedAuthenticators(android.hardware.biometrics.BiometricManager.Authenticators.BIOMETRIC_WEAK
                        | android.hardware.biometrics.BiometricManager.Authenticators.DEVICE_CREDENTIAL);
            } else {
                b.setDeviceCredentialAllowed(true);
            }
            b.build().authenticate(new CancellationSignal(), a.getMainExecutor(), new android.hardware.biometrics.BiometricPrompt.AuthenticationCallback() {
                @Override public void onAuthenticationSucceeded(android.hardware.biometrics.BiometricPrompt.AuthenticationResult result) { ok.run(); }
                @Override public void onAuthenticationError(int code, CharSequence msg) { fail.run(); }
            });
        } catch (Exception e) {
            ok.run(); // never lock someone out because the phone cannot show the prompt
        }
    }

    // ------------------------------------------------------------------ office arrive / leave reminders
    static boolean officeRemindersEnabled(Context c) { return prefs(c).getBoolean("geo", false) && hasBackgroundLocation(c); }

    static boolean hasBackgroundLocation(Context c) {
        boolean fine = c.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || c.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        if (!fine) return false;
        return Build.VERSION.SDK_INT < 29 || c.checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    static final int REQ_GEO = 4711;
    static void setOfficeReminders(Activity a, boolean on) {
        prefs(a).edit().putBoolean("geo", on).apply();
        if (!on) return;
        new Handler(Looper.getMainLooper()).post(() -> {
            boolean fine = a.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
            if (!fine) { a.requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_GEO); return; }
            askBackground(a);
        });
    }
    /** Called again after the normal location permission is granted. */
    static void askBackground(Activity a) {
        if (Build.VERSION.SDK_INT >= 29 && a.checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            a.requestPermissions(new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION}, REQ_GEO + 1);
        }
    }

    /** The newest location the phone already knows (no GPS start-up, so it costs no battery). */
    @android.annotation.SuppressLint("MissingPermission")
    static Location lastLocation(Context c) {
        if (!officeRemindersEnabled(c)) return null;
        LocationManager lm = (LocationManager) c.getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) return null;
        Location best = null;
        for (String p : new String[]{LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER}) {
            try {
                Location l = lm.getLastKnownLocation(p);
                if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
            } catch (SecurityException | IllegalArgumentException ignored) { }
        }
        if (best == null || System.currentTimeMillis() - best.getTime() > 30 * 60 * 1000L) return null;
        return best;
    }

    // ------------------------------------------------------------------ home-screen widget
    static void updateWidget(Context c, String json) {
        prefs(c).edit().putString("widget", json == null ? "" : json).apply();
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(new ComponentName(c, StatusWidget.class));
        if (ids.length > 0) StatusWidget.render(c, m, ids);
    }

    static int dp(Context c, int v) { return Math.round(v * c.getResources().getDisplayMetrics().density); }
}
