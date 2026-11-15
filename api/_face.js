/**
 * Face-scan punch helpers (server side).
 * - Descriptors (128 numbers per face) are compared on the server, never in the browser.
 * - A successful match returns a short-lived signed "face pass" that the punch must carry.
 */
import crypto from 'crypto';
import { getSupabaseConfig, supabaseFetch } from './_supabase.js';

export const FACE_MATCH_DISTANCE = 0.5; // lower = stricter (face-api typical limit is 0.6)
export const FACE_PASS_TTL_MS = 10 * 60 * 1000;
export const MAX_FAILS = 5;
export const LOCK_MS = 5 * 60 * 1000;
export const DESCRIPTOR_LENGTH = 128;

function secret() {
  return (
    process.env.FACE_PASS_SECRET ||
    crypto.createHash('sha256').update(`${getSupabaseConfig().key}|face-pass-v1`).digest('hex')
  );
}

export function signFacePass(employeeId, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ e: employeeId, x: now + FACE_PASS_TTL_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return { token: `${body}.${sig}`, expiresAt: now + FACE_PASS_TTL_MS };
}

export function verifyFacePass(token, employeeId, now = Date.now()) {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const { e, x } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return e === employeeId && typeof x === 'number' && x > now;
  } catch {
    return false;
  }
}

export function isValidDescriptor(d) {
  return Array.isArray(d) && d.length === DESCRIPTOR_LENGTH && d.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 10);
}

export function distance(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

export function bestDistance(descriptor, samples) {
  let best = Infinity;
  for (const s of samples || []) if (isValidDescriptor(s)) best = Math.min(best, distance(descriptor, s));
  return best;
}

function readJson(v, fb) {
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return fb; } }
  return v ?? fb;
}

export async function getTemplate(employeeId) {
  const rows = await supabaseFetch(`/face_templates?employee_id=eq.${encodeURIComponent(employeeId)}&select=*`);
  const row = rows?.[0];
  return row ? { ...row, descriptors: readJson(row.descriptors, []) } : null;
}

export async function listEnrolledIds() {
  const rows = await supabaseFetch('/face_templates?select=employee_id&employee_id=not.like.lock%3A*');
  return (rows || []).map((r) => r.employee_id);
}

/* ---- simple lock-out so a descriptor cannot be guessed by repeated tries ---- */
export async function checkLock(key) {
  const rows = await supabaseFetch(`/face_templates?employee_id=eq.${encodeURIComponent(key)}&select=fail_count,locked_until`);
  const r = rows?.[0];
  if (r?.locked_until && Date.parse(r.locked_until) > Date.now()) {
    const err = new Error('Too many failed attempts. Try again in a few minutes.');
    err.status = 429;
    err.code = 'FACE_LOCKED';
    throw err;
  }
  return r?.fail_count || 0;
}

export async function recordFailure(key, prev) {
  const n = prev + 1;
  const locked = n >= MAX_FAILS;
  await supabaseFetch('/face_templates', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([{
      employee_id: key,
      descriptors: [],
      fail_count: locked ? 0 : n,
      locked_until: locked ? new Date(Date.now() + LOCK_MS).toISOString() : null,
    }]),
  });
}

export async function clearFailures(key) {
  await supabaseFetch(`/face_templates?employee_id=eq.${encodeURIComponent(key)}`, { method: 'DELETE' });
}
