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

import java.io.File;
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
    static final String CHANNEL = "office-alerts";
    private static final int REQ_FILE = 41;
    private static final int REQ_PERMS = 42;

    private WebView web;
    private ProgressBar bar;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingWebPermission;
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
    }

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
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
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
            if (!url.startsWith("file:")) showingOffline = false;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            bar.setVisibility(View.GONE);
            if (!url.startsWith("file:")) view.evaluateJavascript(SHIM, null);
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
            else if (p > 10) view.evaluateJavascript(SHIM, null);
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
        CookieManager.getInstance().flush();
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
                    .setContentTitle(title)
                    .setContentText(body)
                    .setStyle(new Notification.BigTextStyle().bigText(body))
                    .setAutoCancel(true)
                    .setContentIntent(pi);
            if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(notifyId++, b.build());
        }

        @JavascriptInterface
        public void toast(String msg) { MainActivity.this.toast(msg); }

        @JavascriptInterface
        public void retry() {
            main.post(() -> {
                showingOffline = false;
                web.loadUrl(HOME);
            });
        }

        @JavascriptInterface
        public String version() { return BuildConfigVersion.NAME; }
    }
}
