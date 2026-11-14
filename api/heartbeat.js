import {
  format12h,
  getOfficeDateTimeParts,
  setNoCacheHeaders,
  verifyAutoStartToken,
} from './_cloud.js';
import { isSupabaseConfigured, supabaseFetch } from './_supabase.js';

/**
 * Receives the silent "I'm online" ping from the Windows startup agent (.bat) and stores it,
 * so the portal can show the employee as Live (Online) or "No Internet" when pings stop.
 * Only the heartbeat fields of today's attendance row are touched, so a ping can never
 * overwrite a punch, break or admin edit.
 */
export default async function handler(req, res) {
  setNoCacheHeaders(res);

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { employeeId, authToken, isUserActive } = body;

    if (!employeeId || !authToken) {
      return res.status(400).json({ ok: false, code: 'INVALID_REQUEST', message: 'Missing employeeId or authToken.' });
    }
    if (!isSupabaseConfigured()) {
      return res.status(200).json({ ok: true, state: 'active', timestamp: new Date().toISOString() });
    }

    const empRows = await supabaseFetch(
      `/employees?id=eq.${encodeURIComponent(employeeId)}&deleted_at=is.null&select=id,pin,is_active,registered_device_id`
    );
    const e = Array.isArray(empRows) ? empRows[0] : null;
    if (!e || e.is_active === false) {
      return res.status(403).json({ ok: false, code: 'EMPLOYEE_INACTIVE', message: 'Employee account not found or deactivated.' });
    }
    if (!verifyAutoStartToken({ id: e.id, pin: e.pin, registeredDeviceId: e.registered_device_id }, authToken)) {
      return res.status(401).json({ ok: false, code: 'TOKEN_INVALID', message: 'Auto-start credentials have expired. Please re-download your .bat file.' });
    }

    const { todayStr } = getOfficeDateTimeParts();
    const rows = await supabaseFetch(
      `/attendance?employee_id=eq.${encodeURIComponent(e.id)}&date=eq.${todayStr}&select=id,time_in,time_out,auto_punch_out_reason`
    );
    const rec = Array.isArray(rows) ? rows[0] : null;
    const nowIso = new Date().toISOString();

    if (!rec || !rec.time_in) {
      return res.status(200).json({ ok: true, state: 'no_punch', timestamp: nowIso });
    }
    if (rec.time_out) {
      return res.status(200).json({
        ok: true,
        state: 'punched_out',
        timeOut: rec.time_out,
        timeOutFormatted: format12h(rec.time_out),
        autoPunchOutReason: rec.auto_punch_out_reason || undefined,
        timestamp: nowIso,
      });
    }

    const patch = { last_heartbeat_at: nowIso, record_updated_at: nowIso, monitoring_paused: false, disconnected_at: null };
    if (isUserActive !== false) patch.last_activity_at = nowIso;
    await supabaseFetch(`/attendance?id=eq.${encodeURIComponent(rec.id)}&time_out=is.null`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });

    return res.status(200).json({ ok: true, state: 'active', active: true, timestamp: nowIso });
  } catch (err) {
    return res.status(500).json({ ok: false, code: 'SERVER_ERROR', message: String(err && err.message ? err.message : err) });
  }
}
