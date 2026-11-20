import { format12h, getOfficeDateTimeParts, getShiftEndWindowMs, setNoCacheHeaders } from './_cloud.js';
import { isSupabaseConfigured, supabaseFetch, sweepAutoClose, sweepShiftReminders } from './_supabase.js';
import { evaluateAttendancePresenceAndAutoClose } from './_cloud.js';
import { getEmployeeRow, verifyAutoToken } from './_auth.js';
import { getSessionEmployee } from './_session.js';

/**
 * Receives the silent "I'm online" ping (every ~45 s) from the Windows startup agent (.bat) AND from the
 * signed-in web page (every ~30 s while the tab is open), and stores it,
 * so the portal can show the employee as Online or "No Internet" when pings stop.
 * The web page sends `closing: true` when the tab is shut, so the person shows as offline right away.
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
    const { employeeId, authToken, sessionToken, isUserActive, closing } = body;

    if (!employeeId) {
      return res.status(400).json({ ok: false, code: 'INVALID_REQUEST', message: 'Missing employeeId.' });
    }
    if (!isSupabaseConfigured()) {
      return res.status(200).json({ ok: true, active: true, state: 'active', timestamp: new Date().toISOString() });
    }
    let e;
    if (sessionToken) {
      // Browser page: signed-in session, and it can only ever report for its own person.
      e = await getSessionEmployee(sessionToken);
      if (!e || (employeeId && e.id !== employeeId)) {
        return res.status(401).json({ ok: false, code: 'SESSION_INVALID', message: 'Please sign in again.' });
      }
    } else {
      if (!authToken) {
        return res.status(400).json({ ok: false, code: 'INVALID_REQUEST', message: 'Missing authToken.' });
      }
      e = await getEmployeeRow(employeeId);
      if (!e || e.is_active === false) {
        return res.status(403).json({ ok: false, code: 'EMPLOYEE_INACTIVE', message: 'Employee account not found or deactivated.' });
      }
      if (!verifyAutoToken(e, authToken)) {
        return res.status(401).json({ ok: false, code: 'TOKEN_INVALID', message: 'Auto-start credentials have expired. Please re-download your .bat file from the portal.' });
      }
    }

    // Close anyone whose Shift End + auto-logout window has passed (runs at most once a minute).
    await sweepShiftReminders({ getShiftEndWindowMs, format12h });
    await sweepAutoClose(evaluateAttendancePresenceAndAutoClose);

    const { todayStr } = getOfficeDateTimeParts();
    const rows = await supabaseFetch(
      `/attendance?employee_id=eq.${encodeURIComponent(e.id)}&date=eq.${todayStr}&select=id,time_in,time_out,auto_punch_out_reason`
    );
    const rec = Array.isArray(rows) ? rows[0] : null;
    const nowIso = new Date().toISOString();

    if (!rec || !rec.time_in) {
      return res.status(200).json({ ok: true, active: true, state: 'no_punch', timestamp: nowIso });
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

    // Tab closed / signed out: show as offline right away (the next ping from any device switches it back on).
    const patch = closing === true && sessionToken
      ? { monitoring_paused: true, record_updated_at: nowIso }
      : { last_heartbeat_at: nowIso, record_updated_at: nowIso, monitoring_paused: false, disconnected_at: null };
    if (!patch.monitoring_paused && isUserActive !== false) patch.last_activity_at = nowIso;
    await supabaseFetch(`/attendance?id=eq.${encodeURIComponent(rec.id)}&time_out=is.null`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });

    return res.status(200).json({ ok: true, state: 'active', active: true, timestamp: nowIso });
  } catch (err) {
    return res.status(500).json({ ok: false, code: 'SERVER_ERROR', message: String(err && err.message ? err.message : err) });
  }
}
