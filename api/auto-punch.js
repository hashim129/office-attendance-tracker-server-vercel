import { isSupabaseConfigured, readSupabaseDb, mutateSupabaseDb } from './_supabase.js';
import {
  doesIpMatchRule,
  format12h,
  getClientIp,
  getCloudToken,
  getOfficeDateTimeParts,
  mutateCloudDb,
  parseMinutes,
  setNoCacheHeaders,
  verifyAutoStartToken,
} from './_cloud.js';

// Runs the decision function against Supabase (preferred) or falls back to the legacy Gist store.
async function runMutation(token, decide, label) {
  if (!isSupabaseConfigured()) return mutateCloudDb(token, decide, label);
  try {
    const db = await readSupabaseDb({ settings: {}, shifts: [], employees: [], attendance: [], leaves: [], ceoComments: [] });
    const out = decide(db);
    if (out.abort) return { ok: false, status: out.status, result: out.result };
    if (out.nextDb) {
      const before = new Set((db.attendance || []).map((r) => r));
      const changed = (out.nextDb.attendance || []).filter((r) => !before.has(r));
      for (const rec of changed) {
        await mutateSupabaseDb({ scope: 'attendance', changedRecord: rec, actorRole: rec.lastEditedByRole || 'employee' }, db);
      }
    }
    return { ok: true, result: out.result };
  } catch (err) {
    return { ok: false, status: 503, error: String(err && err.message ? err.message : err) };
  }
}

export default async function handler(req, res) {
  setNoCacheHeaders(res);

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { employeeId, deviceId, authToken, machineName } = body;

    if (!employeeId || !authToken) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_REQUEST',
        message: 'Missing employeeId or authToken.',
      });
    }

    const token = getCloudToken();
    const clientIp = getClientIp(req);

    const outcome = await runMutation(
      token,
      (db) => {
        const settings = db.settings || {};
        const shifts = Array.isArray(db.shifts) ? db.shifts : [];
        const employees = Array.isArray(db.employees) ? db.employees : [];
        const attendance = Array.isArray(db.attendance) ? db.attendance : [];

        // 1. Global kill switch check
        if (settings.allowAutoStartPunch === false) {
          return {
            abort: true,
            status: 403,
            result: {
              ok: false,
              code: 'AUTO_PUNCH_DISABLED',
              message: 'Automated startup check-in has been disabled by Administrator in Office Settings.',
            },
          };
        }

        // 2. Verify active employee
        const emp = employees.find((e) => e.id === employeeId);
        if (!emp || emp.isActive === false) {
          return {
            abort: true,
            status: 403,
            result: {
              ok: false,
              code: 'EMPLOYEE_INACTIVE',
              message: 'Employee account not found or deactivated.',
            },
          };
        }

        // 3. Verify cryptographic token (automatically invalidates if PIN changes)
        if (!verifyAutoStartToken(emp, authToken)) {
          return {
            abort: true,
            status: 401,
            result: {
              ok: false,
              code: 'TOKEN_INVALID',
              message:
                'Auto-start credentials have expired (PIN changed). Please re-download your .bat file from the portal.',
            },
          };
        }

        // 4. Verify Office Wi-Fi / ISP Public IP on server
        const isWfhBypassIp = Boolean(emp.allowWorkFromHome);
        const isAdminBypassIp = emp.role === 'admin' && (settings.allowAdminBypassIpLock ?? true);
        if (settings.enforceOfficeIpLock && !isAdminBypassIp && !isWfhBypassIp) {
          const allowedList = Array.isArray(settings.allowedOfficeIps) ? settings.allowedOfficeIps : [];
          const ipAllowed = allowedList.some((rule) => doesIpMatchRule(clientIp, rule.ip));
          if (!ipAllowed) {
            return {
              abort: true,
              status: 403,
              result: {
                ok: false,
                code: 'OUTSIDE_OFFICE_WIFI',
                ip: clientIp,
                message: `Outside Office Wi-Fi (IP: ${clientIp || 'Unknown'}). Auto check-in only works on authorized office network.`,
              },
            };
          }
        }

        // 6. Enforce 1-Punch-Per-Day rule
        const { todayStr, nowTime, dayName } = getOfficeDateTimeParts();
        const cleanHost = String(machineName || 'Windows PC').replace(/[^\w.\- ]/g, '').slice(0, 40);
        const nowIso = new Date().toISOString();
        const existingIdx = attendance.findIndex(
          (r) => r.employeeId === emp.id && r.date === todayStr
        );

        if (existingIdx >= 0 && attendance[existingIdx].timeIn) {
          const existingRec = attendance[existingIdx];
          const alreadyResult = {
            ok: true,
            status: 'already_punched',
            employeeName: emp.name,
            employeeCode: emp.employeeCode,
            date: todayStr,
            day: dayName,
            timeIn: existingRec.timeIn,
            timeInFormatted: format12h(existingRec.timeIn),
            timeOut: existingRec.timeOut || null,
            isAutoPunchedOut: Boolean(existingRec.isAutoPunchedOut),
            autoPunchOutReason: existingRec.autoPunchOutReason,
            message: existingRec.timeOut
              ? `Shift already completed today (${format12h(existingRec.timeIn)} - ${format12h(existingRec.timeOut)}).`
              : `Already clocked in today at ${format12h(existingRec.timeIn)}.`,
          };

          const prevHbMs = existingRec.lastHeartbeatAt ? Date.parse(existingRec.lastHeartbeatAt) : 0;
          if (
            existingRec.timeOut ||
            (existingRec.connectionStatus === 'online' &&
              !existingRec.monitoringPaused &&
              existingRec.heartbeatSource === 'windows-agent' &&
              Date.now() - prevHbMs < 120000)
          ) {
            return { skipWrite: true, result: alreadyResult };
          }

          const refreshed = {
            ...existingRec,
            lastHeartbeatAt: nowIso,
            lastActivityAt: nowIso,
            connectionStatus: 'online',
            heartbeatSource: 'windows-agent',
            heartbeatDeviceId: deviceId || emp.registeredDeviceId || cleanHost,
            monitoringPaused: false,
          };
          delete refreshed.disconnectedAt;
          const nextAttendance = [...attendance];
          nextAttendance[existingIdx] = refreshed;

          return {
            nextDb: { ...db, updatedAt: nowIso, attendance: nextAttendance },
            result: alreadyResult,
          };
        }

        // 7. Compute shift lateness
        const shift = shifts.find((s) => s.id === emp.shiftId) || shifts[0];
        const isLate = shift
          ? parseMinutes(nowTime) > parseMinutes(shift.startTime) + (shift.graceMinutes || 0)
          : false;

        const newRecord = {
          ...(existingIdx >= 0 ? attendance[existingIdx] : {}),
          id: existingIdx >= 0 ? attendance[existingIdx].id : `att-${todayStr}-${emp.id}`,
          employeeId: emp.id,
          date: todayStr,
          day: dayName,
          timeIn: nowTime,
          breaks:
            existingIdx >= 0 && Array.isArray(attendance[existingIdx].breaks)
              ? attendance[existingIdx].breaks
              : [],
          totalWorkedMinutes: 0,
          regularMinutes: 0,
          overtimeMinutes: 0,
          status: isLate ? 'late' : 'present',
          notes: `Auto Check-In (Windows Startup · ${cleanHost})`,
          clientIp: clientIp || 'Office LAN',
          deviceId: deviceId || emp.registeredDeviceId || 'windows-autostart',
          deviceName: emp.registeredDeviceName || `${cleanHost} · Startup Agent`,
          isDeviceMismatch: false,
          lastHeartbeatAt: nowIso,
          lastActivityAt: nowIso,
          connectionStatus: 'online',
          heartbeatSource: 'windows-agent',
          heartbeatDeviceId: deviceId || emp.registeredDeviceId || cleanHost,
          monitoringPaused: false,
          recordUpdatedAt: nowIso,
          lastEditedByRole: emp.role,
          actorAction: 'time_in',
        };

        const nextAttendance = [...attendance];
        if (existingIdx >= 0) {
          nextAttendance[existingIdx] = newRecord;
        } else {
          nextAttendance.unshift(newRecord);
        }

        return {
          nextDb: {
            ...db,
            updatedAt: nowIso,
            attendance: nextAttendance,
          },
          result: {
            ok: true,
            status: 'punched_in',
            employeeName: emp.name,
            employeeCode: emp.employeeCode,
            date: todayStr,
            day: dayName,
            timeIn: nowTime,
            timeInFormatted: format12h(nowTime),
            arrivalStatus: isLate ? 'late' : 'present',
            message: `Clocked in automatically at ${format12h(nowTime)} (${isLate ? 'Late' : 'On Time'}).`,
          },
        };
      },
      'Office-Attendance-Tracker-AutoPunch'
    );

    if (!outcome.ok) {
      if (outcome.result) {
        return res.status(outcome.status || 400).json(outcome.result);
      }
      return res.status(outcome.status || 503).json({
        ok: false,
        code: outcome.status === 503 ? 'DB_UNAVAILABLE' : 'DB_WRITE_FAILED',
        message: outcome.error || 'Failed to save automated check-in to cloud database.',
      });
    }

    return res.status(200).json(outcome.result);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      code: 'SERVER_ERROR',
      message: String(err),
    });
  }
}

