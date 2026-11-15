/**
 * Face-scan punch helpers (server side).
 * - Descriptors (128 numbers per face) are compared on the server, never in the browser.
 * - A successful match returns a short-lived signed "face pass" that the punch must carry.
 */
import crypto from 'crypto';
import { getSupabaseConfig, supabaseFetch } from './_supabase.js';

export const FACE_MATCH_DISTANCE = 0.42; // strict same-person Euclidean distance threshold
export const FACE_AVG_DISTANCE = 0.44;   // max average distance across top enrolled samples
export const FACE_CENTROID_DISTANCE = 0.41; // max distance to the mean enrolled face vector
export const FACE_MIN_COSINE = 0.905;    // min cosine similarity to the mean enrolled face vector
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

export function bestDistance(descriptor, samples) {
  const valid = (samples || []).filter(isValidDescriptor);
  if (valid.length === 0) return Infinity;

  const dists = valid.map((s) => distance(descriptor, s)).sort((a, b) => a - b);
  const minDist = dists[0];
  const topK = dists.slice(0, Math.min(3, dists.length));
  const avgTopDist = topK.reduce((acc, v) => acc + v, 0) / topK.length;

  // Compute centroid (mean descriptor) of all enrolled samples
  const centroid = new Array(DESCRIPTOR_LENGTH).fill(0);
  for (const s of valid) {
    for (let i = 0; i < DESCRIPTOR_LENGTH; i++) centroid[i] += s[i] / valid.length;
  }
  const centroidDist = distance(descriptor, centroid);
  const cosSim = cosineSimilarity(descriptor, centroid);

  // Must satisfy ALL strict identity criteria so another person's face is never accepted
  const matched =
    minDist <= FACE_MATCH_DISTANCE &&
    avgTopDist <= FACE_AVG_DISTANCE &&
    centroidDist <= FACE_CENTROID_DISTANCE &&
    cosSim >= FACE_MIN_COSINE;

  // If any secondary check fails, return a value > FACE_MATCH_DISTANCE so api/face.js rejects it
  if (!matched) {
    return Math.max(minDist, FACE_MATCH_DISTANCE + 0.05);
  }
  return minDist;
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
