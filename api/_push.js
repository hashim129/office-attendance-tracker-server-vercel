import crypto from 'crypto';
import { supabaseFetch } from './_supabase.js';

/**
 * Phone push notifications for the Bahaar Office Android app.
 *
 * Two ways a notification reaches a phone:
 *  1. Firebase Cloud Messaging (instant, works even when the app is closed). Needs two Vercel settings:
 *       FIREBASE_SERVICE_ACCOUNT  the service-account JSON from Firebase (Project settings → Service accounts)
 *       FIREBASE_ANDROID_CONFIG   {"apiKey","appId","projectId","senderId"} taken from google-services.json
 *  2. Without Firebase (or as a safety net) the app itself checks in the background about every 15 minutes.
 */

const CHANNEL = 'office-alerts-v2';
const LABEL = {
  reminder: 'Reminder', invoice: 'Invoice', receipt: 'Receipt', sale: 'Sales', purchase: 'Purchase',
  followup: 'Follow-up', task: 'Task', meeting: 'Meeting', customer: 'Customer', inventory: 'Inventory', leave: 'Leave', media: 'Media',
};
export const pushTitle = (category) => `Bahaar Office · ${LABEL[category] || 'Update'}`;

const readJson = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v || null; } catch { return null; } };

/** Public values the phone needs to start Firebase (safe to hand to signed-in phones). */
export function androidFirebaseConfig() {
  const c = readJson(process.env.FIREBASE_ANDROID_CONFIG);
  if (!c || !c.apiKey || !c.appId || !c.projectId || !c.senderId) return null;
  return { apiKey: String(c.apiKey), appId: String(c.appId), projectId: String(c.projectId), senderId: String(c.senderId) };
}

function serviceAccount() {
  const sa = readJson(process.env.FIREBASE_SERVICE_ACCOUNT);
  if (!sa || !sa.client_email || !sa.private_key || !sa.project_id) return null;
  return { ...sa, private_key: String(sa.private_key).replace(/\\n/g, '\n') };
}
export const fcmEnabled = () => Boolean(serviceAccount() && androidFirebaseConfig());

let cachedToken = { value: '', exp: 0 };
async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken.value && cachedToken.exp - 60 > now) return cachedToken.value;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Google sign-in for push failed (${r.status})`);
  cachedToken = { value: j.access_token, exp: now + Number(j.expires_in || 3600) };
  return cachedToken.value;
}

/** Sends one notification to one phone. Returns 'ok', 'gone' (token no longer valid) or 'fail'. */
async function sendOne(sa, token, n) {
  const at = await accessToken(sa);
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        // data-only, so the app builds the notification itself (with Punch in / Approve buttons); every app version reads title/body from data
        data: { id: String(n.id || ''), category: String(n.category || ''), refId: String(n.ref_id || ''), title: pushTitle(n.category), body: String(n.message || '').slice(0, 900) },
        android: { priority: 'HIGH', ttl: '86400s' },
      },
    }),
  });
  if (r.ok) return 'ok';
  const body = await r.text().catch(() => '');
  if (r.status === 404 || /UNREGISTERED|INVALID_ARGUMENT.*registration/i.test(body)) return 'gone';
  return 'fail';
}

/**
 * Pushes notification rows ({id, employee_id, category, ref_id, message}) to their people's phones and marks them
 * as pushed. Never throws: a push problem must never break the action that created the notification.
 */
export async function pushNotificationRows(rows) {
  try {
    const list = (rows || []).filter((n) => n && n.id && n.employee_id && !n.read_at);
    if (!list.length) return { sent: 0 };
    const sa = serviceAccount();
    if (!sa || !androidFirebaseConfig()) return { sent: 0, disabled: true };
    const people = [...new Set(list.map((n) => n.employee_id))];
    const devices = (await supabaseFetch(`/push_devices?employee_id=in.(${people.map((p) => `"${p}"`).join(',')})&fcm_token=not.is.null&select=device_key,employee_id,fcm_token`)) || [];
    let sent = 0;
    const gone = new Set();
    for (const n of list) {
      for (const d of devices.filter((x) => x.employee_id === n.employee_id)) {
        const result = await sendOne(sa, d.fcm_token, n).catch(() => 'fail');
        if (result === 'ok') sent += 1;
        if (result === 'gone') gone.add(d.device_key);
      }
    }
    const ids = list.map((n) => `"${n.id}"`).join(',');
    await supabaseFetch(`/crm_notifications?id=in.(${ids})`, { method: 'PATCH', body: JSON.stringify({ pushed_at: new Date().toISOString() }) });
    for (const key of gone) await supabaseFetch(`/push_devices?device_key=eq.${encodeURIComponent(key)}`, { method: 'PATCH', body: JSON.stringify({ fcm_token: null }) });
    return { sent };
  } catch (err) {
    console.error('push failed:', err?.message || err);
    return { sent: 0, error: true };
  }
}

/** Safety net from the 2-minute sweep: anything created recently that was not pushed yet (reminders, portal queries…). */
export async function pushPending() {
  if (!fcmEnabled()) return { sent: 0, disabled: true };
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const rows = (await supabaseFetch(`/crm_notifications?pushed_at=is.null&read_at=is.null&created_at=gte.${since}&select=id,employee_id,category,ref_id,message,read_at&order=created_at.asc&limit=200`)) || [];
  return pushNotificationRows(rows);
}

const cleanKey = (v) => (/^[A-Za-z0-9_-]{16,80}$/.test(String(v || '')) ? String(v) : '');

/** The phone app registers itself for the signed-in person (and its Firebase token once it has one). */
export async function registerDevice(employeeId, body) {
  const key = cleanKey(body.deviceKey);
  if (!key) return { ok: false, error: 'Bad device key.' };
  const token = typeof body.fcmToken === 'string' && body.fcmToken.length > 20 && body.fcmToken.length < 4096 ? body.fcmToken : null;
  const now = new Date().toISOString();
  const row = { device_key: key, employee_id: employeeId, platform: 'android', app_version: String(body.appVersion || '').slice(0, 40), updated_at: now };
  if (token) row.fcm_token = token;
  await supabaseFetch('/push_devices?on_conflict=device_key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify([row]) });
  // one Firebase token belongs to one phone: drop it from any older row
  if (token) await supabaseFetch(`/push_devices?fcm_token=eq.${encodeURIComponent(token)}&device_key=neq.${encodeURIComponent(key)}`, { method: 'PATCH', body: JSON.stringify({ fcm_token: null }) });
  return { ok: true, firebase: androidFirebaseConfig() };
}

export async function unregisterDevice(body) {
  const key = cleanKey(body.deviceKey);
  if (key) await supabaseFetch(`/push_devices?device_key=eq.${encodeURIComponent(key)}`, { method: 'DELETE' });
  return { ok: true };
}

/**
 * Background check by the phone itself (about every 15 minutes, no Firebase needed): unread notifications
 * created since its last check. The device key is the phone's own secret from registration.
 */
export async function pendingForDevice(body) {
  const key = cleanKey(body.deviceKey);
  if (!key) return { ok: false, error: 'Bad device key.' };
  const rows = (await supabaseFetch(`/push_devices?device_key=eq.${encodeURIComponent(key)}&select=employee_id,last_poll_at,fcm_token`)) || [];
  const dev = rows[0];
  if (!dev) return { ok: false, gone: true };
  // office arrive / leave reminder (only sent by phones whose person switched it on)
  if (body.lat !== undefined && body.lng !== undefined) {
    try { const { officeGeofence } = await import('./_smart.js'); await officeGeofence(dev.employee_id, Number(body.lat), Number(body.lng), Number(body.acc) || 0); } catch (e) { console.error('geofence', e?.message); }
  }
  const now = new Date();
  const since = dev.last_poll_at && Date.parse(dev.last_poll_at) > now - 86400000 ? dev.last_poll_at : new Date(now - 30 * 60 * 1000).toISOString();
  // with working Firebase delivery, already-pushed items are skipped so nothing shows twice
  const pushedFilter = dev.fcm_token && fcmEnabled() ? '&pushed_at=is.null' : '';
  const items = (await supabaseFetch(`/crm_notifications?employee_id=eq.${encodeURIComponent(dev.employee_id)}&read_at=is.null&created_at=gt.${encodeURIComponent(since)}${pushedFilter}&select=id,category,message,ref_id&order=created_at.asc&limit=20`)) || [];
  await supabaseFetch(`/push_devices?device_key=eq.${encodeURIComponent(key)}`, { method: 'PATCH', body: JSON.stringify({ last_poll_at: now.toISOString() }) });
  return { ok: true, items: items.map((n) => ({ id: n.id, title: pushTitle(n.category), body: n.message, category: n.category, refId: n.ref_id || '' })) };
}

/** Quick health check (no secrets): is Firebase set up, and does Google accept our key? */
export async function pushStatus() {
  const sa = serviceAccount();
  const cfg = androidFirebaseConfig();
  const out = { firebaseConfigured: Boolean(sa && cfg), projectId: cfg?.projectId || null, googleSignIn: 'not tried' };
  if (!sa) return out;
  try { await accessToken(sa); out.googleSignIn = 'ok'; } catch (e) { out.googleSignIn = String(e?.message || 'failed'); }
  try {
    const devices = (await supabaseFetch('/push_devices?select=device_key,fcm_token')) || [];
    out.phonesRegistered = devices.length;
    out.phonesWithInstantPush = devices.filter((d) => d.fcm_token).length;
  } catch { /* table missing */ }
  return out;
}

