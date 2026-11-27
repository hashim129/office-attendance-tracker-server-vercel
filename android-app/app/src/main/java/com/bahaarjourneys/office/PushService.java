package com.bahaarjourneys.office;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/** Firebase delivery. With the app closed Android shows the notification itself; with it open we show it here. */
public class PushService extends FirebaseMessagingService {
    @Override
    public void onNewToken(String token) {
        Push.onNewToken(getApplicationContext(), token);
    }

    @Override
    public void onMessageReceived(RemoteMessage msg) {
        if (MainActivity.inFront) return; // the open app shows it as a pop-up itself
        RemoteMessage.Notification n = msg.getNotification();
        String title = n != null && n.getTitle() != null ? n.getTitle() : msg.getData().getOrDefault("title", "Bahaar Office");
        String body = n != null && n.getBody() != null ? n.getBody() : msg.getData().getOrDefault("body", "");
        String id = msg.getData().getOrDefault("id", String.valueOf(System.currentTimeMillis()));
        Push.show(getApplicationContext(), id.hashCode(), title, body);
    }
}
