/**
 * PIN security (server side).
 * - PINs are stored only as salted scrypt hashes (employees.pin_hash). The plain PIN is never returned by the API.
 * - Wrong guesses are rate limited so a 4-digit PIN cannot be brute-forced through the API.
 */
import crypto from 'crypto';
import { supabaseFetch } from './_supabase.js';
import { checkLock, recordFailure, clearFailures } from './_face.js';

const SCRYPT = { N: 8192, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 32, SCRYPT).toString('hex');
  return `s1$${salt}$${hash}`;
}

export function verifyPinHash(pin, stored) {
  if (typeof stored !== 'string') return false;
  const [v, salt, hash] = stored.split('$');
  if (v !== 's1' || !salt || !hash) return false;
  const got = crypto.scryptSync(String(pin), salt, 32, SCRYPT);
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export function isValidNewPin(pin) {
  return typeof pin === 'string' && pin.trim().length >= 4 && pin.trim().length <= 32;
}

export async function getEmployeeRow(id) {
  const rows = await supabaseFetch(`/employees?id=eq.${encodeURIComponent(id)}&deleted_at=is.null&select=*`);
  return rows?.[0] || null;
}

/**
 * One-time (automatic) conversion of old plain-text PINs. The old .bat check-in tokens are kept
 * in a server-only column so already-installed startup scripts keep working.
 */
export async function migratePlaintextPins() {
  const rows = await supabaseFetch('/employees?pin_hash=is.null&select=id,pin,registered_device_id');
  for (const r of rows || []) {
    const pin = String(r.pin || '');
    if (!pin) continue;
    const legacy = [
      `${r.id}|${pin}|OFFICE_AUTO_V1`,
      `${r.id}|${pin}|${r.registered_device_id || 'UNBOUND'}|OFFICE_AUTO_V1`,
    ].map((p) => crypto.createHash('sha256').update(p).digest('hex'));
    await supabaseFetch(`/employees?id=eq.${encodeURIComponent(r.id)}&pin_hash=is.null`, {
      method: 'PATCH',
      body: JSON.stringify({ pin_hash: hashPin(pin), pin_len: pin.length, legacy_auto_tokens: legacy, pin: '' }),
    });
  }
  return (rows || []).length;
}

/** Checks one employee's PIN with rate limiting. Returns the row, or throws a 401/429 error. */
export async function checkEmployeePin(employeeId, pin) {
  const key = `lock:login:${employeeId}`;
  const prev = await checkLock(key);
  const row = employeeId ? await getEmployeeRow(employeeId) : null;
  if (!row || row.is_active === false || !row.pin_hash || !verifyPinHash(pin, row.pin_hash)) {
    await recordFailure(key, prev);
    const err = new Error('Incorrect PIN or password. Please try again.');
    err.status = 401;
    throw err;
  }
  if (prev) await clearFailures(key);
  return row;
}

export async function checkAdminPin(adminId, pin) {
  const row = await checkEmployeePin(adminId, pin);
  if (row.role !== 'admin') {
    const err = new Error('Administrator PIN required.');
    err.status = 403;
    throw err;
  }
  return row;
}

/** Token the Windows startup script sends. Derived from the stored hash, so only the server can create it. */
export function autoTokenFor(row) {
  return crypto
    .createHash('sha256')
    .update(`${row.id}|${row.pin_hash}|${row.registered_device_id || 'UNBOUND'}|OFFICE_AUTO_V2`)
    .digest('hex');
}

export function verifyAutoToken(row, token) {
  const incoming = Buffer.from(String(token || '').toLowerCase());
  const candidates = [autoTokenFor(row), ...(Array.isArray(row.legacy_auto_tokens) ? row.legacy_auto_tokens : [])];
  return candidates.some((c) => {
    const b = Buffer.from(String(c));
    return b.length === incoming.length && crypto.timingSafeEqual(b, incoming);
  });
}

export { checkLock, recordFailure, clearFailures };
