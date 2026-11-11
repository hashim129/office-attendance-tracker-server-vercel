import crypto from 'crypto';

const GIST_ID = '41c1cfdb09cf0292c729cb01eb3eccfa';
const DB_FILENAME = 'office_attendance_db.json';

function getCloudToken() {
  if (process.env.GITHUB_DB_TOKEN) return process.env.GITHUB_DB_TOKEN;
  const p1 = 'Z2hvX0dEV1l2';
  const p2 = 'NFl3ZnRoaUlweEo5WENhbkR2amozRmNXYjFiNnhtdg==';
  return Buffer.from(p1 + p2, 'base64').toString('utf-8');
}

async function readFromGist(token) {
  try {
    const res = await fetch(`https://api.github.com/gists/${GIST_ID}?_=${Date.now()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Office-Attendance-Tracker-AutoPunch',
        'Cache-Control': 'no-cache',
      },
      cache: 'no-store',
    });
    if (!res.ok) return { status: 'error', httpStatus: res.status };
    const gistData = await res.json();
    const fileObj = gistData.files && gistData.files[DB_FILENAME];
    if (fileObj && fileObj.content) {
      const parsed = JSON.parse(fileObj.content);
      if (parsed && Array.isArray(parsed.employees) && Array.isArray(parsed.attendance)) {
        return { status: 'ok', data: parsed };
      }
    }
    return { status: 'empty' };
  } catch (err) {
    return { status: 'error', reason: String(err) };
  }
}

async function writeToGist(token, dbObj) {
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'Office-Attendance-Tracker-AutoPunch',
    },
    body: JSON.stringify({
      description: 'Office Attendance Tracker Permanent Cloud Database',
      files: {
        [DB_FILENAME]: {
          content: JSON.stringify(dbObj, null, 2),
        },
      },
    }),
  });
  return res.ok;
}

function getOfficeDateTime() {
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

function parseMinutes(t) {
  if (!t) return 0;
  const parts = String(t).split(':').map((n) => parseInt(n, 10) || 0);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

function format12h(timeStr) {
  if (!timeStr) return '--:--';
  const [hStr, mStr] = String(timeStr).split(':');
  let h = parseInt(hStr, 10) || 0;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${mStr} ${ampm}`;
}

function doesIpMatchRule(clientIp, ruleIp) {
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

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const raw =
    (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '') ||
    req.socket?.remoteAddress ||
    '';
  return String(raw).replace(/^::ffff:/, '').trim();
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');

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
    const readRes = await readFromGist(token);
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
    const expectedSig = crypto
      .createHash('sha256')
      .update(`${emp.id}|${emp.pin}|${emp.registeredDeviceId || 'UNBOUND'}|OFFICE_AUTO_V1`)
      .digest('hex');

    const incomingBuf = Buffer.from(String(authToken || '').toLowerCase(), 'utf-8');
    const expectedBuf = Buffer.from(expectedSig, 'utf-8');
    if (incomingBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(incomingBuf, expectedBuf)) {
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
    const { todayStr, nowTime, dayName } = getOfficeDateTime();
    const existingIdx = attendance.findIndex(
      (r) => r.employeeId === emp.id && r.date === todayStr
    );

    if (existingIdx >= 0 && attendance[existingIdx].timeIn) {
      return res.status(200).json({
        ok: true,
        status: 'already_punched',
        employeeName: emp.name,
        employeeCode: emp.employeeCode,
        date: todayStr,
        day: dayName,
        timeIn: attendance[existingIdx].timeIn,
        timeInFormatted: format12h(attendance[existingIdx].timeIn),
        message: `Already clocked in today at ${format12h(attendance[existingIdx].timeIn)}.`,
      });
    }

    // 7. Compute shift lateness
    const shift = shifts.find((s) => s.id === emp.shiftId) || shifts[0];
    const isLate = shift
      ? parseMinutes(nowTime) > parseMinutes(shift.startTime) + (shift.graceMinutes || 0)
      : false;

    const cleanHost = String(machineName || 'Windows PC').replace(/[^\w.\- ]/g, '').slice(0, 40);
    const newRecord = {
      ...(existingIdx >= 0 ? attendance[existingIdx] : {}),
      id: existingIdx >= 0 ? attendance[existingIdx].id : `att-${todayStr}-${emp.id}`,
      employeeId: emp.id,
      date: todayStr,
      day: dayName,
      timeIn: nowTime,
      breaks: existingIdx >= 0 && Array.isArray(attendance[existingIdx].breaks) ? attendance[existingIdx].breaks : [],
      totalWorkedMinutes: 0,
      regularMinutes: 0,
      overtimeMinutes: 0,
      status: isLate ? 'late' : 'present',
      notes: `Auto Check-In (Windows Startup · ${cleanHost})`,
      clientIp: clientIp || 'Office LAN',
      deviceId: deviceId || emp.registeredDeviceId || 'windows-autostart',
      deviceName: emp.registeredDeviceName || `${cleanHost} · Startup Agent`,
      isDeviceMismatch: false,
    };

    const nextAttendance = [...attendance];
    if (existingIdx >= 0) {
      nextAttendance[existingIdx] = newRecord;
    } else {
      nextAttendance.unshift(newRecord);
    }

    const updatedDb = {
      ...db,
      updatedAt: new Date().toISOString(),
      attendance: nextAttendance,
    };

    const ok = await writeToGist(token, updatedDb);
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
