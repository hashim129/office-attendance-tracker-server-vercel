import {
  evaluateAttendancePresenceAndAutoClose,
  format12h,
  getCloudToken,
  getOfficeDateTimeParts,
  mutateCloudDb,
  setNoCacheHeaders,
  verifyAutoStartToken,
} from './_cloud.js';

export default async function handler(req, res) {
  setNoCacheHeaders(res);

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const {
      employeeId,
      deviceId,
      authToken,
      source = 'web-client',
      event = 'heartbeat',
      isUserActive = true,
      idleSeconds = 0,
    } = body;

    if (!employeeId) {
      return res.status(400).json({ ok: false, code: 'INVALID_REQUEST', message: 'Missing employeeId.' });
    }

    const token = getCloudToken();

    const outcome = await mutateCloudDb(
      token,
      (db) => {
        const settings = db.settings || {};
        const shifts = Array.isArray(db.shifts) ? db.shifts : [];
        const employees = Array.isArray(db.employees) ? db.employees : [];
        const attendance = Array.isArray(db.attendance) ? db.attendance : [];

        const emp = employees.find((e) => e.id === employeeId);
        if (!emp || emp.isActive === false) {
          return {
            abort: true,
            status: 403,
            result: { ok: false, code: 'EMPLOYEE_INACTIVE' },
          };
        }

        // Cryptographically validate requests coming from Windows background .bat agent
        if (source === 'windows-agent') {
          if (!authToken || !verifyAutoStartToken(emp, authToken)) {
            return {
              abort: true,
              status: 401,
              result: {
                ok: false,
                code: 'TOKEN_INVALID',
                message: 'Auto-start heartbeat token invalid or expired.',
              },
            };
          }
        }

        const { todayStr } = getOfficeDateTimeParts();
        const idx = attendance.findIndex((r) => r.employeeId === employeeId && r.date === todayStr);

        if (idx === -1 || !attendance[idx].timeIn) {
          return {
            skipWrite: true,
            result: {
              ok: true,
              state: 'not_punched_in',
              date: todayStr,
            },
          };
        }

        const existing = attendance[idx];
        if (existing.timeOut) {
          return {
            skipWrite: true,
            result: {
              ok: true,
              state: 'punched_out',
              date: todayStr,
              timeOut: existing.timeOut,
              timeOutFormatted: format12h(existing.timeOut),
              isAutoPunchedOut: Boolean(existing.isAutoPunchedOut),
              autoPunchOutReason: existing.autoPunchOutReason,
            },
          };
        }

        const onBreak = Array.isArray(existing.breaks) && existing.breaks.some((b) => !b.end);
        const nowMs = Date.now();
        const nowIso = new Date(nowMs).toISOString();
        const existingHbMs = existing.lastHeartbeatAt ? Date.parse(existing.lastHeartbeatAt) : 0;
        const existingActMs = existing.lastActivityAt ? Date.parse(existing.lastActivityAt) : 0;

        // Never let a browser tab close interrupt an independently running Windows .bat background agent
        if (event === 'tab_closed') {
          if (existing.heartbeatSource === 'windows-agent' && nowMs - existingHbMs < 180000) {
            return {
              skipWrite: true,
              result: { ok: true, state: onBreak ? 'break' : 'working', keptAgent: true },
            };
          }
          if (existing.heartbeatDeviceId && deviceId && existing.heartbeatDeviceId !== deviceId) {
            return {
              skipWrite: true,
              result: { ok: true, state: onBreak ? 'break' : 'working', keptOtherDevice: true },
            };
          }
          if (existing.monitoringPaused) {
            return {
              skipWrite: true,
              result: { ok: true, state: 'paused' },
            };
          }
          const nextAttendance = [...attendance];
          nextAttendance[idx] = {
            ...existing,
            monitoringPaused: true,
          };
          return {
            nextDb: { ...db, updatedAt: nowIso, attendance: nextAttendance },
            result: { ok: true, state: 'paused' },
          };
        }

        // Do not downgrade an active Windows OS background monitor to web-client source while agent is fresh
        const agentStillFresh =
          existing.heartbeatSource === 'windows-agent' && nowMs - existingHbMs < 180000;
        const effectiveSource =
          source === 'windows-agent' ? 'windows-agent' : agentStillFresh ? 'windows-agent' : 'web-client';
        const effectiveDeviceId =
          source === 'windows-agent'
            ? deviceId || existing.heartbeatDeviceId
            : agentStillFresh
            ? existing.heartbeatDeviceId
            : deviceId || existing.heartbeatDeviceId;

        const cleanIdleSec = Math.max(0, Number(idleSeconds) || 0);
        const activeRightNow = Boolean(isUserActive) && cleanIdleSec < 120;
        const candidateActMs = activeRightNow
          ? Math.max(existingActMs, nowMs - cleanIdleSec * 1000)
          : existingActMs || existingHbMs || nowMs;
        const nextLastActivityAt = new Date(Math.min(nowMs, candidateActMs)).toISOString();

        const updatedRec = {
          ...existing,
          lastHeartbeatAt: nowIso,
          lastActivityAt: nextLastActivityAt,
          connectionStatus: 'online',
          heartbeatSource: effectiveSource,
          heartbeatDeviceId: effectiveDeviceId,
          monitoringPaused: false,
        };
        delete updatedRec.disconnectedAt;

        const candidateAttendance = [...attendance];
        candidateAttendance[idx] = updatedRec;

        // Evaluate whether 2h non-active punch-out or 23:59 close triggered on this or other records
        const { records: finalAttendance, changed: sweepChanged } =
          evaluateAttendancePresenceAndAutoClose(candidateAttendance, settings, employees, shifts);

        const selfAfterSweep = finalAttendance[idx];
        const selfPunchedOutNow = Boolean(selfAfterSweep?.timeOut);

        // Persist on meaningful transitions or at most every 120s during steady-state online work
        const activityMovedSignificantly = Date.parse(nextLastActivityAt) - existingActMs >= 60000;
        const shouldPersist =
          sweepChanged ||
          selfPunchedOutNow ||
          !existing.lastHeartbeatAt ||
          existing.connectionStatus !== 'online' ||
          existing.monitoringPaused === true ||
          existing.heartbeatSource !== effectiveSource ||
          nowMs - existingHbMs >= 120000 ||
          activityMovedSignificantly;

        if (!shouldPersist) {
          return {
            skipWrite: true,
            result: {
              ok: true,
              state: onBreak ? 'break' : 'working',
              onBreak,
              date: todayStr,
              persisted: false,
            },
          };
        }

        const responsePayload = selfAfterSweep?.timeOut
          ? {
              ok: true,
              state: 'punched_out',
              date: todayStr,
              timeOut: selfAfterSweep.timeOut,
              timeOutFormatted: format12h(selfAfterSweep.timeOut),
              isAutoPunchedOut: Boolean(selfAfterSweep.isAutoPunchedOut),
              autoPunchOutReason: selfAfterSweep.autoPunchOutReason,
            }
          : {
              ok: true,
              state: onBreak ? 'break' : 'working',
              onBreak,
              date: todayStr,
              persisted: true,
            };

        return {
          nextDb: {
            ...db,
            updatedAt: nowIso,
            attendance: finalAttendance,
          },
          result: responsePayload,
        };
      },
      'Office-Attendance-Tracker-Heartbeat'
    );

    if (!outcome.ok) {
      if (outcome.result) {
        return res.status(outcome.status || 400).json(outcome.result);
      }
      return res.status(outcome.status || 503).json({
        ok: false,
        code: outcome.status === 503 ? 'DB_UNAVAILABLE' : 'DB_WRITE_FAILED',
      });
    }

    return res.status(200).json(outcome.result);
  } catch (err) {
    return res.status(500).json({ ok: false, code: 'SERVER_ERROR', message: String(err) });
  }
}
