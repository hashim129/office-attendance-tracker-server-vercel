package com.bahaarjourneys.office;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.Toast;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Bahaar Office: the full office app (attendance, CRM, invoices, sales, receipts...) in a phone app.
 * It always opens the live office system, so every feature and every future update is included.
 */
public class MainActivity extends Activity {

    static final String HOME = "https://office-attendance-tracker-server-ve.vercel.app/";
    static final String HOST = "office-attendance-tracker-server-ve.vercel.app";
    // v2: louder alerts with a vibration pattern (Android keeps the first settings of a channel, so it has a new id)
    static final String CHANNEL = "office-alerts-v2";
    static final String RELEASES = "https://api.github.com/repos/hashim129/office-attendance-tracker-server-vercel/releases/latest";
    private static final int REQ_FILE = 41;
    private static final int REQ_PERMS = 42;

    private WebView web;
    private ProgressBar bar;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingWebPermission;
    private GeolocationPermissions.Callback pendingGeo;
    private String pendingGeoOrigin;
    private boolean shimDone = false;
    /** True while the app is on screen (then the page shows alerts itself, so pushes are not doubled). */
    static volatile boolean inFront = false;
    private boolean showingOffline = false;
    private int notifyId = 100;
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        createChannel();

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);
        web = new WebView(this);
        web.setBackgroundColor(Color.WHITE);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        bar.setIndeterminate(false);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3));
        root.addView(bar, lp);
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setSupportMultipleWindows(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setGeolocationEnabled(true);
        s.setTextZoom(100); // the phone's large-font setting must not break the layout
        s.setOffscreenPreRaster(true); // smoother scrolling: the page is drawn ahead of time
        web.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        if (Build.VERSION.SDK_INT >= 26) web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, true);
        s.setUserAgentString(s.getUserAgentString() + " BahaarOfficeApp/" + BuildConfigVersion.NAME);

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);

        web.addJavascriptInterface(new Bridge(), "BahaarApp");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) -> {
            if (url.startsWith("blob:") || url.startsWith("data:")) {
                web.evaluateJavascript("window.__bahaarSave && window.__bahaarSave(" + quote(url) + "," + quote(URLUtil.guessFileName(url, contentDisposition, mimeType)) + ")", null);
                return;
            }
            try {
                DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
                String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
                r.setMimeType(mimeType);
                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null) r.addRequestHeader("Cookie", cookies);
                r.addRequestHeader("User-Agent", userAgent);
                r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(r);
                toast("Downloading " + name + "…");
            } catch (Exception e) {
                openExternal(Uri.parse(url));
            }
        });

        askStartupPermissions();
        if (state != null) web.restoreState(state);
        else web.loadUrl(HOME);
        checkForAppUpdate();
    }

    /** A newer phone app on the download page? Offer it once per version (the office system itself is always live). */
    private void checkForAppUpdate() {
        new Thread(() -> {
            try {
                String mine = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
                HttpURLConnection c = (HttpURLConnection) new URL(RELEASES).openConnection();
                c.setConnectTimeout(8000);
                c.setReadTimeout(8000);
                c.setRequestProperty("Accept", "application/vnd.github+json");
                StringBuilder sb = new StringBuilder();
                try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream()))) {
                    String line;
                    while ((line = r.readLine()) != null) sb.append(line);
                }
                org.json.JSONObject j = new org.json.JSONObject(sb.toString());
                String tag = j.optString("tag_name", "").replace("app-v", "");
                String url = "";
                org.json.JSONArray assets = j.optJSONArray("assets");
                if (assets != null && assets.length() > 0) url = assets.getJSONObject(0).optString("browser_download_url", "");
                if (tag.isEmpty() || url.isEmpty() || !newer(tag, mine)) return;
                android.content.SharedPreferences prefs = getSharedPreferences("app", MODE_PRIVATE);
                if (tag.equals(prefs.getString("offered", ""))) return;
                prefs.edit().putString("offered", tag).apply();
                final String link = url, ver = tag;
                main.post(() -> new android.app.AlertDialog.Builder(this)
                        .setTitle("New app version " + ver)
                        .setMessage("A newer Bahaar Office app is ready (faster, with the latest fixes). Download and install it now?")
                        .setPositiveButton("Update", (d, w) -> openExternal(Uri.parse(link)))
                        .setNegativeButton("Later", null)
                        .show());
            } catch (Exception ignored) { /* offline: try next time */ }
        }).start();
    }

    /** "1.0.12" vs "1.0.9" compared number by number. */
    static boolean newer(String a, String b) {
        String[] x = a.split("\\."), y = (b == null ? "0" : b).split("\\.");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            int p = i < x.length ? parse(x[i]) : 0, q = i < y.length ? parse(y[i]) : 0;
            if (p != q) return p > q;
        }
        return false;
    }

    private static int parse(String v) { try { return Integer.parseInt(v.replaceAll("[^0-9]", "")); } catch (Exception e) { return 0; } }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    private static String quote(String v) {
        return "'" + v.replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ") + "'";
    }

    private void toast(String msg) { main.post(() -> Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()); }

    private boolean online() {
        ConnectivityManager c = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        NetworkInfo n = c == null ? null : c.getActiveNetworkInfo();
        return n != null && n.isConnected();
    }

    private void askStartupPermissions() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_PERMS);
        }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Office alerts", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Punch reminders, follow-ups, invoices and team updates");
            ch.enableVibration(true);
            ch.setVibrationPattern(new long[]{0, 120, 60, 120, 60, 220});
            ch.enableLights(true);
            ch.setLightColor(Color.rgb(37, 99, 235));
            ch.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) {
                nm.deleteNotificationChannel("office-alerts"); // the first, quieter channel
                nm.createNotificationChannel(ch);
            }
        }
    }

    private void openExternal(Uri uri) {
        try {
            Intent i;
            if ("intent".equals(uri.getScheme())) {
                i = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME);
            } else {
                i = new Intent(Intent.ACTION_VIEW, uri);
            }
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            if (uri.toString().contains("whatsapp") || "wa.me".equals(uri.getHost())) toast("WhatsApp is not installed on this phone.");
            else toast("No app found to open this link.");
        } catch (Exception e) {
            toast("Could not open this link.");
        }
    }

    /** Pages that belong to the office app stay inside; everything else (WhatsApp, calendar, maps…) opens outside. */
    private boolean isInternal(Uri uri) {
        String scheme = uri.getScheme();
        if (scheme == null) return true;
        if (scheme.equals("blob") || scheme.equals("data") || scheme.equals("about") || scheme.equals("javascript")) return true;
        if (!scheme.equals("https") && !scheme.equals("http")) return false;
        String host = uri.getHost() == null ? "" : uri.getHost();
        return host.equals(HOST) || host.endsWith(".supabase.co");
    }

    private void showOffline() {
        showingOffline = true;
        web.loadUrl("file:///android_asset/offline.html");
    }

    // Small JS layer: saves PDFs/blobs, shares files to WhatsApp etc., and shows phone notifications.
    private static final String SHIM = "(function(){if(window.__bahaarShim)return;window.__bahaarShim=1;var A=window.BahaarApp;" +
            "function b64(blob){return new Promise(function(ok,no){var r=new FileReader();r.onload=function(){ok(String(r.result).split(',')[1]||'')};r.onerror=no;r.readAsDataURL(blob)})}" +
            "window.__bahaarSave=function(href,name){fetch(href).then(function(r){return r.blob()}).then(function(blob){return b64(blob).then(function(d){A.saveFile(name||'download',blob.type||'application/octet-stream',d)})}).catch(function(){A.toast('Could not save the file.')})};" +
            "var oc=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){var h=this.href||'';if((h.indexOf('blob:')===0||h.indexOf('data:')===0)&&this.hasAttribute('download')){window.__bahaarSave(h,this.getAttribute('download')||'download');return;}return oc.apply(this,arguments)};" +
            "document.addEventListener('click',function(e){var a=e.target&&e.target.closest?e.target.closest('a[download]'):null;if(!a)return;var h=a.href||'';if(h.indexOf('blob:')===0||h.indexOf('data:')===0){e.preventDefault();window.__bahaarSave(h,a.getAttribute('download')||'download');}},true);" +
            "navigator.canShare=function(d){return !!d};" +
            "navigator.share=function(d){d=d||{};var text=[d.title,d.text,d.url].filter(Boolean).join('\\n');if(d.files&&d.files.length){var f=d.files[0];return b64(f).then(function(x){A.shareFile(f.name||'file',f.type||'application/octet-stream',x,text)})}A.shareText(text);return Promise.resolve()};" +
            "function N(t,o){o=o||{};A.showNotification(String(t||'Bahaar Office'),String(o.body||''));this.close=function(){};}" +
            "Object.defineProperty(N,'permission',{get:function(){return A.notifyAllowed()?'granted':'default'}});" +
            "N.requestPermission=function(cb){A.askNotify();var p=Promise.resolve('granted');if(cb)cb('granted');return p};window.Notification=N;" +
            "})();";

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri uri = req.getUrl();
            if (isInternal(uri)) return false;
            openExternal(uri);
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            bar.setVisibility(View.VISIBLE);
            shimDone = false;
            if (!url.startsWith("file:")) showingOffline = false;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            bar.setVisibility(View.GONE);
            if (!url.startsWith("file:")) { view.evaluateJavascript(SHIM, null); shimDone = true; }
            CookieManager.getInstance().flush();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
            if (req.isForMainFrame() && !online()) showOffline();
        }
    }

    private class Chrome extends WebChromeClient {
        @Override
        public void onProgressChanged(WebView view, int p) {
            bar.setProgress(p);
            if (p >= 100) bar.setVisibility(View.GONE);
            else if (p > 10 && !shimDone) { view.evaluateJavascript(SHIM, null); shimDone = true; }
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            main.post(() -> {
                List<String> need = new ArrayList<>();
                for (String r : request.getResources()) {
                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) need.add(Manifest.permission.CAMERA);
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) need.add(Manifest.permission.RECORD_AUDIO);
                }
                if (need.isEmpty()) request.grant(request.getResources());
                else {
                    pendingWebPermission = request;
                    requestPermissions(need.toArray(new String[0]), REQ_PERMS + 1);
                }
            });
        }

        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            if (!origin.contains(HOST)) { callback.invoke(origin, false, false); return; }
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                    || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                callback.invoke(origin, true, false);
                return;
            }
            pendingGeo = callback;
            pendingGeoOrigin = origin;
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_PERMS + 2);
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = cb;
            try {
                Intent i = params.createIntent();
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                startActivityForResult(Intent.createChooser(i, "Choose file"), REQ_FILE);
                return true;
            } catch (Exception e) {
                fileCallback = null;
                toast("No file picker available.");
                return false;
            }
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code != REQ_FILE || fileCallback == null) return;
        Uri[] uris = null;
        if (result == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                uris = new Uri[data.getClipData().getItemCount()];
                for (int i = 0; i < uris.length; i++) uris[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data.getData() != null) {
                uris = new Uri[]{data.getData()};
            }
        }
        fileCallback.onReceiveValue(uris);
        fileCallback = null;
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (code == REQ_PERMS + 1 && pendingWebPermission != null) {
            boolean ok = true;
            for (int r : results) ok &= r == PackageManager.PERMISSION_GRANTED;
            if (ok) pendingWebPermission.grant(pendingWebPermission.getResources());
            else { pendingWebPermission.deny(); toast("Camera permission is needed for face scan."); }
            pendingWebPermission = null;
        }
        if (code == REQ_PERMS + 2 && pendingGeo != null) {
            boolean ok = false;
            for (int r : results) ok |= r == PackageManager.PERMISSION_GRANTED;
            pendingGeo.invoke(pendingGeoOrigin, ok, false);
            if (!ok) toast("Location permission is needed to punch when your office checks location.");
            pendingGeo = null;
            pendingGeoOrigin = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (showingOffline) { super.onBackPressed(); return; }
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        inFront = false;
        // tells the page it is in the background (alerts then go to the phone's notification bar); JavaScript keeps running
        web.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onResume() {
        super.onResume();
        inFront = true;
        web.onResume();
        // back in front: fetch the newest data at once
        web.evaluateJavascript("try{window.dispatchEvent(new Event('focus'))}catch(e){}", null);
    }

    /** Saves a file into the phone's Downloads folder and returns a link that other apps can open. */
    private Uri saveToDownloads(String name, String mime, byte[] bytes) throws Exception {
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Bahaar Office");
            Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (uri == null) throw new Exception("no uri");
            try (OutputStream os = getContentResolver().openOutputStream(uri)) { os.write(bytes); }
            return uri;
        }
        // Older phones: keep a private copy that we can hand to other apps.
        File f = FileShareProvider.fileFor(MainActivity.this, name);
        try (FileOutputStream os = new FileOutputStream(f)) { os.write(bytes); }
        return FileShareProvider.uriFor(name);
    }

    private static String safeName(String name, String mime) {
        String n = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
        if (n.isEmpty()) n = "download";
        if (!n.contains(".")) {
            String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
            if (ext != null) n = n + "." + ext;
        }
        return n;
    }

    private class Bridge {
        @JavascriptInterface
        public void saveFile(String name, String mime, String base64) {
            try {
                String n = safeName(name, mime);
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                Uri uri = saveToDownloads(n, mime, bytes);
                toast("Saved to Downloads: " + n);
                main.post(() -> {
                    try {
                        Intent i = new Intent(Intent.ACTION_VIEW);
                        i.setDataAndType(uri, mime);
                        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(i);
                    } catch (Exception ignored) { /* saved; no viewer installed */ }
                });
            } catch (Exception e) {
                toast("Could not save the file.");
            }
        }

        @JavascriptInterface
        public void shareFile(String name, String mime, String base64, String text) {
            try {
                String n = safeName(name, mime);
                File f = FileShareProvider.fileFor(MainActivity.this, n);
                try (FileOutputStream os = new FileOutputStream(f)) { os.write(Base64.decode(base64, Base64.DEFAULT)); }
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType(mime);
                i.putExtra(Intent.EXTRA_STREAM, FileShareProvider.uriFor(n));
                if (text != null && !text.isEmpty()) i.putExtra(Intent.EXTRA_TEXT, text);
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                main.post(() -> startActivity(Intent.createChooser(i, "Share PDF")));
            } catch (Exception e) {
                toast("Could not share the file.");
            }
        }

        @JavascriptInterface
        public void shareText(String text) {
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType("text/plain");
            i.putExtra(Intent.EXTRA_TEXT, text);
            main.post(() -> startActivity(Intent.createChooser(i, "Share")));
        }

        @JavascriptInterface
        public boolean notifyAllowed() {
            return Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        }

        @JavascriptInterface
        public void askNotify() {
            main.post(MainActivity.this::askStartupPermissions);
        }

        @JavascriptInterface
        public void showNotification(String title, String body) {
            if (!notifyAllowed()) return;
            Intent open = new Intent(MainActivity.this, MainActivity.class);
            open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent pi = PendingIntent.getActivity(MainActivity.this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(MainActivity.this, CHANNEL) : new Notification.Builder(MainActivity.this);
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
            if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL).setVibrate(new long[]{0, 120, 60, 120, 60, 220});
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(notifyId++, b.build());
        }

        @JavascriptInterface
        public void toast(String msg) { MainActivity.this.toast(msg); }

        /** After sign-in: this phone gets the person's notifications even when the app is closed. */
        @JavascriptInterface
        public void registerPush(String sessionToken) { Push.register(MainActivity.this, sessionToken); }

        /** On sign-out: stop notifications for that person on this phone. */
        @JavascriptInterface
        public void unregisterPush() { Push.unregister(MainActivity.this); }

        @JavascriptInterface
        public void retry() {
            main.post(() -> {
                showingOffline = false;
                web.loadUrl(HOME);
            });
        }

        @JavascriptInterface
        public String version() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return BuildConfigVersion.NAME; }
        }
    }
}
