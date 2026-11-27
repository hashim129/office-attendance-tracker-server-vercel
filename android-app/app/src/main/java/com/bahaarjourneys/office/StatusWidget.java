package com.bahaarjourneys.office;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** Home-screen widget: today's status and a Punch in / Punch out button (the punch itself happens in the app, with its usual checks). */
public class StatusWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) { render(c, m, ids); }

    static void render(Context c, AppWidgetManager m, int[] ids) {
        String title = "Bahaar Office";
        String line = "Open the app to sign in";
        boolean punchedIn = false, canPunch = false;
        try {
            String raw = AppExtras.prefs(c).getString("widget", "");
            if (raw != null && !raw.isEmpty() && Push.prefs(c).getBoolean("on", false)) {
                JSONObject o = new JSONObject(raw);
                title = o.optString("title", title);
                line = o.optString("line", line);
                punchedIn = o.optBoolean("punchedIn", false);
                canPunch = o.optBoolean("canPunch", false);
            }
        } catch (Exception ignored) { }
        for (int id : ids) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_status);
            v.setTextViewText(R.id.w_title, title);
            v.setTextViewText(R.id.w_line, line);
            v.setOnClickPendingIntent(R.id.w_root, open(c, "clock", 900));
            if (canPunch) {
                v.setViewVisibility(R.id.w_button, View.VISIBLE);
                v.setTextViewText(R.id.w_button, punchedIn ? "Punch out" : "Punch in");
                v.setOnClickPendingIntent(R.id.w_button, open(c, punchedIn ? "punch-out" : "punch-in", 901));
            } else {
                v.setViewVisibility(R.id.w_button, View.GONE);
            }
            m.updateAppWidget(id, v);
        }
    }

    static PendingIntent open(Context c, String action, int code) {
        Intent i = new Intent(c, MainActivity.class);
        i.putExtra(AppExtras.ACTION_EXTRA, action);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
}
