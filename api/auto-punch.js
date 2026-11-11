import {
  doesIpMatchRule,
  format12h,
  getClientIp,
  getCloudToken,
  getOfficeDateTimeParts,
  parseMinutes,
  readFromGist,
  setNoCacheHeaders,
  verifyAutoStartToken,
  writeToGist,
} from './_cloud.js';

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
    const readRes = await readFromGist(token, 'Office-Attendance-Tracker-AutoPunch');
    if (readRes.status !== 'ok') {
      return res.status(503).json({
        ok: false,
        code: 'DB_UNAVAILABLE',
        message: 'Cloud database temporarily unavailable. Please retry.',
      });
    }

    const db = readRes.data;
    const settings = db.settings || {};
    const shifts = Array.isArray(db.shifts) ? db.shifts : [];
    const employees = Array.isArray(db.employees) ? db.employees : [];
    const attendance = Array.isArray(db.attendance) ? db.attendance : [];

    // 1. Global kill switch check
    if (settings.allowAutoStartPunch === false) {
      return res.status(403).json({
        ok: false,
        code: 'AUTO_PUNCH_DISABLED',
        message: 'Automated startup check-in has been disabled by Administrator in Office Settings.',
      });
    }

    // 2. Verify active employee
    const emp = employees.find((e) => e.id === employeeId);
    if (!emp || emp.isActive === false) {
      return res.status(403).json({
        ok: false,
        code: 'EMPLOYEE_INACTIVE',
        message: 'Employee account not found or deactivated.',
      });
    }

    // 3. Verify cryptographic token (automatically invalidates if PIN or device bound changes)
    if (!verifyAutoStartToken(emp, authToken)) {
      return res.status(401).json({
        ok: false,
        code: 'TOKEN_INVALID',
        message:
          'Auto-start credentials have expired (PIN or device binding changed). Please re-download your .bat file from the portal.',
      });
    }

    // 4. Verify Personal Device Binding
    const isAdminBypassDevice =
      emp.role === 'admin' && (settings.allowAdminBypassDeviceBinding ?? true);
    if (settings.enforceDeviceBinding !== false && !isAdminBypassDevice) {
      if (!emp.registeredDeviceId) {
        return res.status(403).json({
          ok: false,
          code: 'DEVICE_NOT_BOUND',
          message: 'No approved device is bound to this account. Submit device approval first.',
        });
      }
      if (!deviceId || emp.registeredDeviceId !== deviceId) {
        return res.status(403).json({
          ok: false,
          code: 'DEVICE_MISMATCH',
          message: 'Device mismatch: Auto-start script does not match your approved PC binding.',
        });
      }
    }

    // 5. Verify Office Wi-Fi / ISP Public IP on server
    const clientIp = getClientIp(req);
    const isAdminBypassIp = emp.role === 'admin' && (settings.allowAdminBypassIpLock ?? true);
    if (settings.enforceOfficeIpLock && !isAdminBypassIp) {
      const allowedList = Array.isArray(settings.allowedOfficeIps) ? settings.allowedOfficeIps : [];
      const ipAllowed = allowedList.some((rule) => doesIpMatchRule(clientIp, rule.ip));
      if (!ipAllowed) {
        return res.status(403).json({
          ok: false,
          code: 'OUTSIDE_OFFICE_WIFI',
          ip: clientIp,
          message: `Outside Office Wi-Fi (IP: ${clientIp || 'Unknown'}). Auto check-in only works on authorized office network.`,
        });
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
      // If still working on a reboot/relauch, refresh Windows-agent heartbeat immediately
      if (!existingRec.timeOut) {
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
        await writeToGist(
          token,
          { ...db, updatedAt: nowIso, attendance: nextAttendance },
          'Office-Attendance-Tracker-AutoPunch'
        );
      }

      return res.status(200).json({
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
      });
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
    };

    const nextAttendance = [...attendance];
    if (existingIdx >= 0) {
      nextAttendance[existingIdx] = newRecord;
    } else {
      nextAttendance.unshift(newRecord);
    }

    const updatedDb = {
      ...db,
      updatedAt: nowIso,
      attendance: nextAttendance,
    };

    const ok = await writeToGist(token, updatedDb, 'Office-Attendance-Tracker-AutoPunch');
    if (!ok) {
      return res.status(500).json({
        ok: false,
        code: 'DB_WRITE_FAILED',
        message: 'Failed to save automated check-in to cloud database.',
      });
    }

    return res.status(200).json({
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
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      code: 'SERVER_ERROR',
      message: String(err),
    });
  }
}

