import { isSupabaseConfigured, supabaseFetch } from './_supabase.js';
import { getClientIp } from './_cloud.js';
import crypto from 'crypto';
import { issueSession, isSiteDisabled, getSessionEmployee, COMPUTER_SESSION_TTL_MS, SESSION_TTL_MS } from './_session.js';
import { audit, clientIp } from './_audit.js';
import { checkOfficeNetwork } from './_netmatch.js';
import { pushNotificationRows } from './_push.js';
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


const PRIVILEGED = ['admin', 'ceo', 'accounts', 'superadmin'];
const isApp = (req) => /BahaarOfficeApp/.test(String(req.headers?.['user-agent'] || ''));
const ttlFor = (req) => (isApp(req) ? SESSION_TTL_MS : COMPUTER_SESSION_TTL_MS);
const mustChange = (row) => PRIVILEGED.includes(row.role) && (Number(row.pin_len) || 0) < 6;
const deviceLabel = (ua) => {
  const s = String(ua || '');
  const br = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /Chrome\//.test(s) ? 'Chrome' : /Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : 'a browser';
  const os = /Windows/.test(s) ? 'Windows' : /Mac OS X/.test(s) ? 'Mac' : /Android/.test(s) ? 'Android' : /iPhone|iPad/.test(s) ? 'iPhone' : /Linux/.test(s) ? 'Linux' : 'a computer';
  return `${br} on ${os}`;
};
const employeePayload = (row) => ({ id:row.id, employeeCode:row.employee_code, name:row.name, email:row.email||'', role:row.role==='superadmin'?'admin':row.role, isSuperAdmin:row.role==='superadmin', department:row.department||'', designation:row.designation||'', shiftId:row.shift_id||'shift-std', phone:row.phone||'', hourlyRate:Number(row.hourly_rate)||0, isActive:true, joinedDate:row.joined_date||'', pin:'', hasPin:true, featureAccess:row.page_access||{} });

/** After a correct PIN: office-only rule, phone approval for Admin / CEO / Accounts on a computer, then the session. */
async function finishSignIn(req, res, row, { withEmployee = false } = {}) {
  const ip = clientIp(req);
  const settings = (await supabaseFetch('/settings?id=eq.current&select=data'))?.[0]?.data || {};
  let pend = row.pending_device_request;
  if (typeof pend === 'string') { try { pend = JSON.parse(pend); } catch { pend = {}; } }
  if (settings.staffSignInOfficeOnly === true && row.role === 'employee' && !isApp(req) && !pend?.allowWorkFromHome) {
    const net = checkOfficeNetwork({ settings: { ...settings, enforceOfficeIpLock: true }, employee: null, ips: [getClientIp(req), ip] });
    if (!net.allowed) {
      await audit(row, 'sign-in blocked', 'Outside the office network on a computer', ip);
      return res.status(403).json({ error: 'Staff can sign in only from the office network or the Bahaar Office phone app.', code: 'OFFICE_ONLY' });
    }
  }
  if (PRIVILEGED.includes(row.role) && !isApp(req) && settings.phoneApprovalForAdmins !== false) {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const devices = (await supabaseFetch(`/push_devices?employee_id=eq.${encodeURIComponent(row.id)}&or=(fcm_token.not.is.null,last_poll_at.gte.${encodeURIComponent(weekAgo)})&select=device_key`).catch(() => [])) || [];
    if (devices.length) {
      const id = `login-${crypto.randomUUID()}`;
      const at = new Date().toISOString();
      const what = deviceLabel(req.headers?.['user-agent']);
      await supabaseFetch('/crm_company', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify([{ id, data: { employeeId: row.id, status: 'pending', exp: Date.now() + 3 * 60000, what, ip, withEmployee }, updated_at: at }]) });
      const note = { id: `ntf-${id}`, employee_id: row.id, category: 'reminder', ref_id: id, message: `Sign-in request: someone is signing in as you on ${what}${ip ? ` (${ip})` : ''}. Approve only if it is you.`, created_at: at, read_at: null };
      await supabaseFetch('/crm_notifications', { method: 'POST', body: JSON.stringify([note]) });
      await pushNotificationRows([note]);
      return res.status(202).json({ ok: false, pendingApproval: id, message: 'Approve this sign-in on your phone (Bahaar Office app).' });
    }
  }
  if (PRIVILEGED.includes(row.role)) await audit(row, 'signed in', `${isApp(req) ? 'Phone app' : deviceLabel(req.headers?.['user-agent'])}`, ip);
  const out = { ok: true, employeeId: row.id, session: issueSession(row.id, Date.now(), ttlFor(req)), mustChangePin: mustChange(row) };
  if (withEmployee) out.employee = employeePayload(row);
  return res.status(200).json(out);
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
      return finishSignIn(req, res, row);
    }

    // Waiting for the phone to approve an Admin / CEO / Accounts sign-in
    if (action === 'login-status') {
      const id = String(body.id || '');
      if (!/^login-[0-9a-f-]{36}$/.test(id)) return res.status(400).json({ error: 'Bad request.' });
      const r = (await supabaseFetch(`/crm_company?id=eq.${encodeURIComponent(id)}&select=data`))?.[0];
      const d = r?.data || null;
      if (!d) return res.status(410).json({ error: 'This sign-in request has ended. Please sign in again.' });
      if (d.status === 'denied') { await supabaseFetch(`/crm_company?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }); return res.status(403).json({ error: 'The sign-in was declined on your phone.' }); }
      if (d.status !== 'approved') {
        if (Date.now() > d.exp) { await supabaseFetch(`/crm_company?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }); return res.status(410).json({ error: 'No approval came from your phone in time. Please sign in again.' }); }
        return res.status(202).json({ ok: false, pendingApproval: id });
      }
      await supabaseFetch(`/crm_company?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
      const row = await getEmployeeRow(d.employeeId);
      if (!row || row.is_active === false) return res.status(403).json({ error: 'Account not available.' });
      await audit(row, 'signed in', `${d.what || 'Computer'} (approved on phone)`, clientIp(req));
      const out = { ok: true, employeeId: row.id, session: issueSession(row.id, Date.now(), ttlFor(req)), mustChangePin: mustChange(row) };
      if (d.withEmployee) out.employee = employeePayload(row);
      return res.status(200).json(out);
    }

    // Sign in by employee code or e-mail
    if (action === 'lookup') {
      const found = await findByIdentifier(body.identifier);
      if (!found) return res.status(404).json({ error: 'No active employee found with this ID or Email.' });
      const siteDisabled = await isSiteDisabled();
      if (siteDisabled && found.role !== 'superadmin') return res.status(503).json({ error: 'The office portal is temporarily disabled by its Super Admin.' });
      const row = await checkEmployeePin(found.id, String(body.pin ?? '').trim());
      return finishSignIn(req, res, row, { withEmployee: true });
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
      if (PRIVILEGED.includes(row.role) && newPin.length < 6) return res.status(400).json({ error: 'Admin, CEO and Accounts passwords need at least 6 characters.' });
      await audit(row, 'changed own password', '', clientIp(req));
      await supabaseFetch(`/employees?id=eq.${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ pin_hash: hashPin(newPin), pin_len: newPin.length, pin: '', legacy_auto_tokens: [], record_updated_at: new Date().toISOString() }),
      });
      return res.status(200).json({ ok: true, session: issueSession(row.id, Date.now(), ttlFor(req)) });
    }

    // Administrator sets or resets someone's PIN
    if (action === 'set-pin') {
      const newPin = String(body.newPin ?? '').trim();
      if (!isValidNewPin(newPin)) return res.status(400).json({ error: 'PIN must be at least 4 characters.' });
      await checkAdminPin(String(body.adminId || ''), String(body.adminPin ?? '').trim());
      const target = await getEmployeeRow(String(body.employeeId || ''));
      if (!target) return res.status(404).json({ error: 'Employee not found.' });
      if (target.role === 'superadmin' && target.id !== String(body.adminId || '')) return res.status(403).json({ error: 'Only the Super Admin can change this protected account.' });
      if (PRIVILEGED.includes(target.role) && newPin.length < 6) return res.status(400).json({ error: 'Admin, CEO and Accounts passwords need at least 6 characters.' });
      await audit({ id: String(body.adminId || ''), name: (await getEmployeeRow(String(body.adminId || '')))?.name || 'Admin' }, 'reset a password', `For ${target.name}`, clientIp(req));
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
    if (err.status === 401) { try { const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}; if (b.action === 'verify' || b.action === 'lookup') await audit({ id: b.employeeId || null, name: b.identifier || '' }, 'wrong password', b.action === 'lookup' ? `ID ${String(b.identifier || '').slice(0, 60)}` : '', clientIp(req)); } catch { /* ignore */ } }
    return res.status(err.status || 500).json({ error: err.message || 'Auth failed', code: err.code });
  }
}
