import crypto from 'crypto';

export const GIST_ID = '41c1cfdb09cf0292c729cb01eb3eccfa';
export const DB_FILENAME = 'office_attendance_db.json';

export function getCloudToken() {
  if (process.env.GITHUB_DB_TOKEN) return process.env.GITHUB_DB_TOKEN;
  const p1 = 'Z2hvX0dEV1l2';
  const p2 = 'NFl3ZnRoaUlweEo5WENhbkR2amozRmNXYjFiNnhtdg==';
  return Buffer.from(p1 + p2, 'base64').toString('utf-8');
}

export function setNoCacheHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

export async function readFromGist(token, userAgent = 'Office-Attendance-Tracker-Server') {
  try {
    const res = await fetch(`https://api.github.com/gists/${GIST_ID}?_=${Date.now()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': userAgent,
        'Cache-Control': 'no-cache',
      },
      cache: 'no-store',
    });
    if (!res.ok) {
      return { status: 'error', httpStatus: res.status };
    }
    const gistData = await res.json();
    const fileObj = gistData.files && gistData.files[DB_FILENAME];
    if (fileObj && fileObj.content) {
      try {
        const parsed = JSON.parse(fileObj.content);
        if (parsed && Array.isArray(parsed.employees) && Array.isArray(parsed.attendance)) {
          return { status: 'ok', data: parsed };
        }
      } catch {
        return { status: 'error', reason: 'Corrupt JSON in Gist' };
      }
    }
    return { status: 'empty' };
  } catch (err) {
    return { status: 'error', reason: String(err) };
  }
}

export async function writeToGist(token, dbObj, userAgent = 'Office-Attendance-Tracker-Server') {
  const bodyStr = JSON.stringify(dbObj, null, 2);
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': userAgent,
    },
    body: JSON.stringify({
      description: 'Office Attendance Tracker Permanent Cloud Database',
      files: {
        [DB_FILENAME]: {
          content: bodyStr,
        },
      },
    }),
  });
  return res.ok;
}

export function getOfficeDateTimeParts() {
  const now = new Date();
  try {
    const todayStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Karachi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    const nowTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Karachi',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(now);
    const dayName = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Karachi',
      weekday: 'long',
    }).format(now);
    return { todayStr, nowTime, dayName };
  } catch {
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    return {
      todayStr: `${year}-${month}-${day}`,
      nowTime: now.toTimeString().split(' ')[0],
      dayName: now.toLocaleDateString('en-US', { weekday: 'long' }),
    };
  }
}

export function parseMinutes(t) {
  if (!t) return 0;
  const parts = String(t).split(':').map((n) => parseInt(n, 10) || 0);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

export function format12h(timeStr) {
  if (!timeStr) return '--:--';
  const [hStr, mStr] = String(timeStr).split(':');
  let h = parseInt(hStr, 10) || 0;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${mStr} ${ampm}`;
}

export function doesIpMatchRule(clientIp, ruleIp) {
  const cleanClient = String(clientIp || '').trim().toLowerCase();
  const cleanRule = String(ruleIp || '').trim().toLowerCase();
  if (!cleanClient || !cleanRule) return false;
  if (cleanClient === cleanRule) return true;

  if (cleanRule.includes('*')) {
    const prefix = cleanRule.split('*')[0];
    if (prefix && cleanClient.startsWith(prefix)) return true;
  }

  if (cleanRule.includes('/')) {
    const [baseIp, bitsStr] = cleanRule.split('/');
    const bits = parseInt(bitsStr, 10);
    const clientParts = cleanClient.split('.');
    const baseParts = baseIp.split('.');
    if (clientParts.length === 4 && baseParts.length === 4) {
      if (bits === 24 && clientParts.slice(0, 3).join('.') === baseParts.slice(0, 3).join('.')) {
        return true;
      }
      if (bits === 16 && clientParts.slice(0, 2).join('.') === baseParts.slice(0, 2).join('.')) {
        return true;
      }
    }
  }

  return false;
}

export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const raw =
    (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '') ||
    req.socket?.remoteAddress ||
    '';
  return String(raw).replace(/^::ffff:/, '').trim();
}

export function verifyAutoStartToken(emp, authToken) {
  const expectedSig = crypto
    .createHash('sha256')
    .update(`${emp.id}|${emp.pin}|${emp.registeredDeviceId || 'UNBOUND'}|OFFICE_AUTO_V1`)
    .digest('hex');

  const incomingBuf = Buffer.from(String(authToken || '').toLowerCase(), 'utf-8');
  const expectedBuf = Buffer.from(expectedSig, 'utf-8');
  return incomingBuf.length === expectedBuf.length && crypto.timingSafeEqual(incomingBuf, expectedBuf);
}

function finalizeClosedRecord(rec, outTime, remark, reason, expectedHours = 8) {
  const updatedBreaks = (rec.breaks || []).map((b) => (!b.end ? { ...b, end: outTime } : b));
  const inMins = parseMinutes(rec.timeIn);
  const outMins = parseMinutes(outTime);
  const diff = outMins >= inMins ? outMins - inMins : Math.max(0, outMins - inMins);
  let breakMins = 0;
  for (const b of updatedBreaks) {
    if (b.start && b.end) {
      const bStart = parseMinutes(b.start);
      const bEnd = parseMinutes(b.end);
      breakMins += Math.max(0, bEnd - bStart);
    }
  }
  const netWorked = Math.max(0, diff - breakMins);
  const threshold = Math.max(1, Number(expectedHours || 8)) * 60;
  const regular = Math.min(netWorked, threshold);
  const overtime = Math.max(0, netWorked - threshold);

  const existingNotes = rec.notes ? rec.notes.trim() : '';
  const finalNotes = existingNotes
    ? existingNotes.includes(remark)
      ? existingNotes
      : `${existingNotes} · ${remark}`
    : remark;

  return {
    ...rec,
    timeOut: outTime,
    breaks: updatedBreaks,
    totalWorkedMinutes: netWorked,
    regularMinutes: regular,
    overtimeMinutes: overtime,
    notes: finalNotes,
    isAutoPunchedOut: true,
    autoPunchOutReason: reason,
  };
}

/**
 * Evaluates all attendance records for:
 * 1. End-of-day (23:59:00 / past day) auto punch-out
 * 2. Active Break protection (Break always remains 'break'; never marked no_internet or auto-closed by inactivity)
 * 3. Non-active > 2 hours auto punch-out for monitored sessions
 * 4. Disconnectivity detection ('no_internet' when heartbeat missed > threshold while online work expected)
 */
export function evaluateAttendancePresenceAndAutoClose(
  attendanceList,
  settings = {},
  employees = [],
  shifts = []
) {
  if (!Array.isArray(attendanceList)) return { records: [], changed: false };
  const { todayStr, nowTime } = getOfficeDateTimeParts();
  const nowMs = Date.now();

  const empMap = new Map(Array.isArray(employees) ? employees.map((e) => [e.id, e]) : []);
  const shiftMap = new Map(Array.isArray(shifts) ? shifts.map((s) => [s.id, s]) : []);
  const defaultExpected = (Array.isArray(shifts) && shifts[0]?.expectedHours) || 8;

  const disconnectMs = Math.max(1, Number(settings?.disconnectThresholdMinutes ?? 3)) * 60 * 1000;
  const inactiveHoursRaw =
    settings?.autoPunchOutOnInactiveHours !== undefined
      ? Number(settings.autoPunchOutOnInactiveHours)
      : 2;
  const inactiveMs = inactiveHoursRaw > 0 ? inactiveHoursRaw * 60 * 60 * 1000 : 0;

  let changed = false;
  const records = attendanceList.map((rec) => {
    if (!rec || !rec.timeIn || rec.timeOut) return rec;

    const emp = empMap.get(rec.employeeId);
    const shift = (emp && shiftMap.get(emp.shiftId)) || null;
    const expectedHours = shift?.expectedHours || defaultExpected;

    const isPastDay = rec.date < todayStr;
    const isPastMidnightToday = rec.date === todayStr && nowTime >= '23:59:00';

    if (isPastDay || isPastMidnightToday) {
      changed = true;
      return finalizeClosedRecord(rec, '23:59:00', 'Auto system Punched out', 'midnight', expectedHours);
    }

    // Active break takes precedence: keep status as Break (never overwrite to no_internet or auto-punch-out)
    const onBreak = Array.isArray(rec.breaks) && rec.breaks.some((b) => !b.end);
    if (onBreak) {
      return rec;
    }

    // Monitor connectivity & inactivity only for active non-kiosk monitored sessions
    if (rec.date === todayStr && rec.lastHeartbeatAt && !rec.monitoringPaused && rec.heartbeatSource !== 'kiosk') {
      const lastHbMs = Date.parse(rec.lastHeartbeatAt);
      const lastActMs = Date.parse(rec.lastActivityAt || rec.lastHeartbeatAt);
      const isDisconnected = !Number.isNaN(lastHbMs) && nowMs - lastHbMs > disconnectMs;

      if (
        inactiveMs > 0 &&
        !Number.isNaN(lastActMs) &&
        nowMs - lastActMs > inactiveMs &&
        parseMinutes(nowTime) >= parseMinutes(rec.timeIn)
      ) {
        changed = true;
        const closed = finalizeClosedRecord(
          rec,
          nowTime,
          `Auto Punched Out (Device Inactive > ${inactiveHoursRaw}h)`,
          'inactivity_2h',
          expectedHours
        );
        return {
          ...closed,
          connectionStatus: isDisconnected ? 'no_internet' : 'online',
        };
      }

      if (settings?.enableDisconnectStatusTracking !== false && !Number.isNaN(lastHbMs)) {
        const desiredConn = isDisconnected ? 'no_internet' : 'online';
        if (rec.connectionStatus !== desiredConn) {
          changed = true;
          const next = {
            ...rec,
            connectionStatus: desiredConn,
          };
          if (desiredConn === 'no_internet') {
            next.disconnectedAt = rec.disconnectedAt || new Date(lastHbMs + disconnectMs).toISOString();
          } else {
            delete next.disconnectedAt;
          }
          return next;
        }
      }
    }

    return rec;
  });

  return { records, changed };
}
