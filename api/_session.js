/**
 * Signed sign-in sessions. The server hands one out after a correct PIN; every admin change must carry it.
 * The person's role is always read from the database, never taken from what the browser claims.
 */
import crypto from 'crypto';
import { getSupabaseConfig } from './_supabase.js';
import { getEmployeeRow } from './_auth.js';

export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function secret() {
  return (
    process.env.SESSION_SECRET ||
    crypto.createHash('sha256').update(`${getSupabaseConfig().key}|session-v1`).digest('hex')
  );
}

export function issueSession(employeeId, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ i: employeeId, x: now + SESSION_TTL_MS })).toString('base64url');
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
    const { i, x } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof x !== 'number' || x <= now || !i) return null;
    const row = await getEmployeeRow(i);
    return row && row.is_active !== false ? row : null;
  } catch {
    return null;
  }
}
