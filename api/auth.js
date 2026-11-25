import { isSupabaseConfigured, supabaseFetch } from './_supabase.js';
import { getClientIp } from './_cloud.js';
import { issueSession, isSiteDisabled } from './_session.js';
import {
  autoTokenFor, checkAdminPin, checkEmployeePin, checkLock, clearFailures, getEmployeeRow, hashPin,
  isValidNewPin, migratePlaintextPins, recordFailure, verifyPinHash,
} from './_auth.js';

async function findByIdentifier(identifier) {
  const needle = String(identifier || '').trim().toLowerCase();
  if (!needle) return null;
  const rows = await supabaseFetch('/employees?deleted_at=is.null&is_active=eq.true&select=id,employee_code,email,role');
  return (rows || []).find((r) => String(r.employee_code || '').toLowerCase() === needle || String(r.email || '').toLowerCase() === needle) || null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isSupabaseConfigured()) return res.status(501).json({ error: 'Server-side sign-in is not available here.', code: 'NO_SERVER_AUTH' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { action } = body;
    await migratePlaintextPins();
    const siteDisabled = await isSiteDisabled();
    if (siteDisabled && action !== 'lookup' && action !== 'verify') {
      return res.status(503).json({ error: 'The office portal is temporarily disabled by its Super Admin.' });
    }

    // Sign in / confirm a PIN for a known employee id
    if (action === 'verify') {
      const row = await checkEmployeePin(String(body.employeeId || ''), String(body.pin ?? '').trim());
      if (siteDisabled && row.role !== 'superadmin') return res.status(503).json({ error: 'The office portal is temporarily disabled by its Super Admin.' });
      return res.status(200).json({ ok: true, employeeId: row.id, session: issueSession(row.id) });
    }

    // Sign in by employee code or e-mail
    if (action === 'lookup') {
      const found = await findByIdentifier(body.identifier);
      if (!found) return res.status(404).json({ error: 'No active employee found with this ID or Email.' });
      const siteDisabled = await isSiteDisabled();
      if (siteDisabled && found.role !== 'superadmin') return res.status(503).json({ error: 'The office portal is temporarily disabled by its Super Admin.' });
      const row = await checkEmployeePin(found.id, String(body.pin ?? '').trim());
      return res.status(200).json({ ok: true, employeeId: row.id, session: issueSession(row.id), employee: { id:row.id, employeeCode:row.employee_code, name:row.name, email:row.email||'', role:row.role==='superadmin'?'admin':row.role, isSuperAdmin:row.role==='superadmin', department:row.department||'', designation:row.designation||'', shiftId:row.shift_id||'shift-std', phone:row.phone||'', hourlyRate:Number(row.hourly_rate)||0, isActive:true, joinedDate:row.joined_date||'', pin:'', hasPin:true, featureAccess:row.page_access||{} } });
    }

    // Lobby kiosk: identify the person from the PIN alone
    if (action === 'kiosk') {
      const key = `lock:kiosk:${getClientIp(req) || 'unknown'}`;
      const prev = await checkLock(key);
      const pin = String(body.pin ?? '').trim();
      const rows = await supabaseFetch('/employees?deleted_at=is.null&is_active=eq.true&pin_hash=not.is.null&role=neq.superadmin&select=id,pin_hash');
      const hit = pin.length >= 4 ? (rows || []).find((r) => verifyPinHash(pin, r.pin_hash)) : null;
      if (!hit) {
        await recordFailure(key, prev);
        return res.status(401).json({ error: 'PIN code not recognized.' });
      }
      if (prev) await clearFailures(key);
      return res.status(200).json({ ok: true, employeeId: hit.id, session: issueSession(hit.id) });
    }

    // Any administrator PIN (kiosk exit, kiosk launch)
    if (action === 'admin-verify') {
      const key = `lock:adminpin:${getClientIp(req) || 'unknown'}`;
      const prev = await checkLock(key);
      const pin = String(body.pin ?? '').trim();
      const rows = await supabaseFetch('/employees?deleted_at=is.null&is_active=eq.true&role=in.(admin,superadmin)&pin_hash=not.is.null&select=id,pin_hash');
      const hit = (rows || []).find((r) => verifyPinHash(pin, r.pin_hash));
      if (!hit) {
        await recordFailure(key, prev);
        return res.status(401).json({ error: 'Invalid Admin PIN code.' });
      }
      if (prev) await clearFailures(key);
      return res.status(200).json({ ok: true, adminId: hit.id });
    }

    // Change your own PIN (needs the current one)
    if (action === 'change-pin') {
      const newPin = String(body.newPin ?? '').trim();
      if (!isValidNewPin(newPin)) return res.status(400).json({ error: 'New PIN must be at least 4 characters.' });
      const row = await checkEmployeePin(String(body.employeeId || ''), String(body.currentPin ?? '').trim());
      if (verifyPinHash(newPin, row.pin_hash)) return res.status(400).json({ error: 'New PIN must be different from your current one.' });
      await supabaseFetch(`/employees?id=eq.${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ pin_hash: hashPin(newPin), pin_len: newPin.length, pin: '', legacy_auto_tokens: [], record_updated_at: new Date().toISOString() }),
      });
      return res.status(200).json({ ok: true, session: issueSession(row.id) });
    }

    // Administrator sets or resets someone's PIN
    if (action === 'set-pin') {
      const newPin = String(body.newPin ?? '').trim();
      if (!isValidNewPin(newPin)) return res.status(400).json({ error: 'PIN must be at least 4 characters.' });
      await checkAdminPin(String(body.adminId || ''), String(body.adminPin ?? '').trim());
      const target = await getEmployeeRow(String(body.employeeId || ''));
      if (!target) return res.status(404).json({ error: 'Employee not found.' });
      if (target.role === 'superadmin' && target.id !== String(body.adminId || '')) return res.status(403).json({ error: 'Only the Super Admin can change this protected account.' });
      await supabaseFetch(`/employees?id=eq.${encodeURIComponent(target.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ pin_hash: hashPin(newPin), pin_len: newPin.length, pin: '', legacy_auto_tokens: [], record_updated_at: new Date().toISOString() }),
      });
      return res.status(200).json({ ok: true });
    }

    // Token for the Windows startup script: the employee (own PIN) or an administrator
    if (action === 'auto-token') {
      const actor = await checkEmployeePin(String(body.actorId || ''), String(body.actorPin ?? '').trim());
      const targetId = String(body.employeeId || actor.id);
      if (targetId !== actor.id && actor.role !== 'admin') return res.status(403).json({ error: 'Only an administrator can do this for someone else.' });
      const target = targetId === actor.id ? actor : await getEmployeeRow(targetId);
      if (!target || !target.pin_hash) return res.status(404).json({ error: 'Employee has no PIN set yet.' });
      return res.status(200).json({ ok: true, token: autoTokenFor(target) });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    if (!err.status) console.error('auth api error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Auth failed', code: err.code });
  }
}
