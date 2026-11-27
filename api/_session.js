/**
 * Signed sign-in sessions. The server hands one out after a correct PIN; every admin change must carry it.
 * The person's role is always read from the database, never taken from what the browser claims.
 */
import crypto from 'crypto';
import { getSupabaseConfig } from './_supabase.js';
import { getEmployeeRow } from './_auth.js';
import { supabaseFetch } from './_supabase.js';

export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
let lockdownCache = { expiresAt: 0, enabled: false };

export async function isSiteDisabled(now = Date.now()) {
  if (lockdownCache.expiresAt > now) return lockdownCache.enabled;
  try {
    const rows = await supabaseFetch('/settings?id=eq.current&select=data');
    const data = rows?.[0]?.data || {};
    lockdownCache = { expiresAt: now + 3000, enabled: data.siteDisabled === true };
  } catch {
    return lockdownCache.enabled;
  }
  return lockdownCache.enabled;
}
export function refreshSiteDisabledCache(enabled) {
  lockdownCache = { expiresAt: Date.now() + 3000, enabled: enabled === true };
}

function secret() {
  return (
    process.env.SESSION_SECRET ||
    crypto.createHash('sha256').update(`${getSupabaseConfig().key}|session-v1`).digest('hex')
  );
}

export const COMPUTER_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Phone app sign-ins last 14 days (the app has its own fingerprint lock); computers 7 days. */
export function issueSession(employeeId, now = Date.now(), ttl = SESSION_TTL_MS) {
  const body = Buffer.from(JSON.stringify({ i: employeeId, x: now + Math.min(ttl, SESSION_TTL_MS), t: now })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** Returns the signed-in employee row (fresh role from the database) or null. */
export async function getSessionEmployee(token, now = Date.now()) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { i, x, t } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof x !== 'number' || x <= now || !i) return null;
    const row = await getEmployeeRow(i);
    if (!row || row.is_active === false || (await isSiteDisabled(now) && row.role !== 'superadmin')) return null;
    // Admin pressed "Sign out of all devices": sessions issued before that moment stop working.
    let pend = row.pending_device_request;
    if (typeof pend === 'string') { try { pend = JSON.parse(pend); } catch { pend = null; } }
    const cutoff = Number(pend?.signOutBefore) || 0;
    const issuedAt = typeof t === 'number' ? t : x - SESSION_TTL_MS;
    if (cutoff && issuedAt < cutoff) return null;
    return row.role === 'superadmin' ? { ...row, role: 'admin', isSuperAdmin: true, featureAccess: row.page_access || {} } : { ...row, featureAccess: row.page_access || {} };
  } catch {
    return null;
  }
}
