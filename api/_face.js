/**
 * Face-scan punch helpers (server side).
 * - Descriptors (128 numbers per face) are compared on the server, never in the browser.
 * - A successful match returns a short-lived signed "face pass" that the punch must carry.
 */
import crypto from 'crypto';
import { getSupabaseConfig, supabaseFetch } from './_supabase.js';

// face-api descriptors: the same person scores about 0.25-0.45 on a webcam, different people almost always
// score 0.6 or more. 0.50 is a safe cut-off for "is this the person they claim to be".
export const FACE_MATCH_DISTANCE = 0.5;
export const FACE_AVG_DISTANCE = 0.56;   // average of the two closest enrolled samples (guards against a one-off lucky sample)
export const FACE_DUPLICATE_DISTANCE = 0.45; // a new enrolment this close to another employee's face is refused
export const FACE_AMBIGUITY_MARGIN = 0.04;  // the claimed person must be clearly closer than any colleague
export const FACE_ENROLL_SPREAD = 0.6;      // enrolment samples must all be the same face
export const FACE_PASS_TTL_MS = 2 * 60 * 1000;
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

export function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

/** Distance to the closest enrolled sample, or a value above the limit when the secondary check fails. */
export function bestDistance(descriptor, samples) {
  const valid = (samples || []).filter(isValidDescriptor);
  if (valid.length === 0) return Infinity;
  const dists = valid.map((s) => distance(descriptor, s)).sort((a, b) => a - b);
  const minDist = dists[0];
  const top = dists.slice(0, Math.min(2, dists.length));
  const avgTop = top.reduce((acc, v) => acc + v, 0) / top.length;
  if (minDist <= FACE_MATCH_DISTANCE && avgTop > FACE_AVG_DISTANCE) {
    return Math.max(minDist, FACE_MATCH_DISTANCE + 0.01);
  }
  return minDist;
}

/** All enrolled templates (without the lock-out rows). */
export async function listTemplates() {
  const rows = await supabaseFetch('/face_templates?select=employee_id,descriptors&employee_id=not.like.lock%3A*');
  return (rows || []).map((r) => ({ employeeId: r.employee_id, descriptors: readJson(r.descriptors, []) }));
}

/** Closest any OTHER employee's enrolled face gets to this descriptor. */
export function closestOther(descriptor, templates, employeeId) {
  let best = { distance: Infinity, employeeId: null };
  for (const t of templates) {
    if (t.employeeId === employeeId) continue;
    const d = Math.min(Infinity, ...t.descriptors.filter(isValidDescriptor).map((x) => distance(descriptor, x)));
    if (d < best.distance) best = { distance: d, employeeId: t.employeeId };
  }
  return best;
}

/** True when every enrolment sample is plausibly the same face (catches two people / a bad capture). */
export function samplesAreConsistent(samples) {
  const n = samples.length;
  const centroid = new Array(DESCRIPTOR_LENGTH).fill(0);
  for (const s of samples) for (let i = 0; i < DESCRIPTOR_LENGTH; i++) centroid[i] += s[i] / n;
  return samples.every((s) => distance(s, centroid) <= FACE_ENROLL_SPREAD / 2);
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
