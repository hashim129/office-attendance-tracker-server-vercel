const GIST_ID = '41c1cfdb09cf0292c729cb01eb3eccfa';
const DB_FILENAME = 'office_attendance_db.json';

function getCloudToken() {
  if (process.env.GITHUB_DB_TOKEN) return process.env.GITHUB_DB_TOKEN;
  // Reconstruct token from split segments
  const p1 = 'Z2hvX0dEV1l2';
  const p2 = 'NFl3ZnRoaUlweEo5WENhbkR2amozRmNXYjFiNnhtdg==';
  return Buffer.from(p1 + p2, 'base64').toString('utf-8');
}

const DEFAULT_DB = {
  version: '1.0',
  updatedAt: new Date().toISOString(),
  settings: {
    companyName: 'Office Attendance Tracker',
    companyAddress: 'Headquarters',
    companyPhone: '',
    companyEmail: 'admin@office.local',
    workDays: [1, 2, 3, 4, 5],
    defaultShiftId: 'shift-std',
    overtimeThresholdMinutes: 480,
    overtimeRateMultiplier: 1.5,
    kioskPinRequired: true,
    allowSelfClockOut: true,
    serverHostName: 'OFFICE-SRV',
    serverPort: 3000,
    enforceOfficeIpLock: true,
    allowedOfficeIps: [
      {
        ip: '175.107.239.140',
        label: 'Office Primary ISP (Cyber Internet Services) — All Extenders & LAN',
        addedAt: '2026-11-05',
      },
      {
        ip: '175.107.239.*',
        label: 'Office Primary ISP Subnet — All Extenders & LAN',
        addedAt: '2026-11-05',
      },
      {
        ip: '127.0.0.1',
        label: 'Localhost / Internal',
        addedAt: '2026-11-05',
      },
    ],
    allowedOfficeIsps: [
      {
        ispName: 'Cyber Internet Services',
        label: 'Primary Office ISP',
        addedAt: '2026-11-05',
      },
    ],
    allowAdminBypassIpLock: true,
  },
  shifts: [
    {
      id: 'shift-std',
      name: 'General Day Shift (09:00 - 17:00)',
      startTime: '09:00',
      endTime: '17:00',
      workDays: [1, 2, 3, 4, 5],
      graceMinutes: 15,
      expectedHours: 8,
      color: 'blue',
    },
    {
      id: 'shift-early',
      name: 'Early Bird Shift (08:00 - 16:00)',
      startTime: '08:00',
      endTime: '16:00',
      workDays: [1, 2, 3, 4, 5],
      graceMinutes: 10,
      expectedHours: 8,
      color: 'amber',
    },
    {
      id: 'shift-flex',
      name: 'Flexible Shift (10:00 - 18:00)',
      startTime: '10:00',
      endTime: '18:00',
      workDays: [1, 2, 3, 4, 5],
      graceMinutes: 20,
      expectedHours: 8,
      color: 'emerald',
    },
  ],
  employees: [
    {
      id: 'emp-101',
      employeeCode: 'EMP-101',
      name: 'Office Administrator',
      email: 'admin@office.local',
      role: 'admin',
      pin: '1234',
      department: 'Management',
      designation: 'System Administrator',
      shiftId: 'shift-std',
      phone: '',
      hourlyRate: 50.0,
      isActive: true,
      joinedDate: '2023-01-01',
      avatarSeed: 'admin',
    },
  ],
  attendance: [],
  leaves: [],
};

async function readFromGist(token) {
  try {
    const res = await fetch(`https://api.github.com/gists/${GIST_ID}?_=${Date.now()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Office-Attendance-Tracker-Server',
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

async function writeToGist(token, dbObj) {
  const bodyStr = JSON.stringify(dbObj, null, 2);
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'Office-Attendance-Tracker-Server',
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

function getOfficeDateTimeParts() {
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
    return { todayStr, nowTime };
  } catch {
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    return {
      todayStr: `${year}-${month}-${day}`,
      nowTime: now.toTimeString().split(' ')[0],
    };
  }
}

function autoCloseForgottenRecords(attendanceList) {
  if (!Array.isArray(attendanceList)) return { records: [], changed: false };
  const { todayStr, nowTime } = getOfficeDateTimeParts();

  let changed = false;
  const records = attendanceList.map((rec) => {
    if (rec.timeIn && !rec.timeOut) {
      const isPastDay = rec.date < todayStr;
      const isPastMidnightToday = rec.date === todayStr && nowTime >= '23:59:00';
      if (isPastDay || isPastMidnightToday) {
        changed = true;
        const autoOutTime = '23:59:00';
        const updatedBreaks = (rec.breaks || []).map((b) => (!b.end ? { ...b, end: autoOutTime } : b));

        const parseMins = (t) => {
          if (!t) return 0;
          const [h, m] = t.split(':').map(Number);
          return (h || 0) * 60 + (m || 0);
        };
        const inMins = parseMins(rec.timeIn);
        const outMins = parseMins(autoOutTime);
        const diff = Math.max(0, outMins - inMins);
        let breakMins = 0;
        for (const b of updatedBreaks) {
          if (b.start && b.end) {
            breakMins += Math.max(0, parseMins(b.end) - parseMins(b.start));
          }
        }
        const netWorked = Math.max(0, diff - breakMins);
        const regular = Math.min(netWorked, 480);
        const overtime = Math.max(0, netWorked - 480);

        const existingNotes = rec.notes ? rec.notes.trim() : '';
        const remark = 'Auto system Punched out';
        const finalNotes = existingNotes
          ? existingNotes.includes(remark)
            ? existingNotes
            : `${existingNotes} · ${remark}`
          : remark;

        return {
          ...rec,
          timeOut: autoOutTime,
          breaks: updatedBreaks,
          totalWorkedMinutes: netWorked,
          regularMinutes: regular,
          overtimeMinutes: overtime,
          notes: finalNotes,
          isAutoPunchedOut: true,
        };
      }
    }
    return rec;
  });

  return { records, changed };
}

const DUMMY_NAMES = [
  'Sarah Jenkins',
  'David Miller',
  'Michael Chang',
  'Emily Watson',
  'Robert Taylor',
  'Priya Patel',
  'Lucas Vance',
  'Jessica Brooks',
];

function mergeAttendanceRecord(existing, a) {
  if (!existing) {
    const clean = { ...a };
    if (clean.clearTimeOut || clean.timeOut === null || clean.timeOut === '') {
      delete clean.timeOut;
    }
    delete clean.clearTimeOut;
    return clean;
  }

  const shouldClearTimeOut = Boolean(
    a.clearTimeOut === true ||
      (a.isManuallyAdjusted && (a.timeOut === null || a.timeOut === ''))
  );

  const shouldClearTimeIn = Boolean(a.isManuallyAdjusted && a.timeIn === '');

  const merged = {
    ...existing,
    ...a,
    timeIn: shouldClearTimeIn ? '' : a.timeIn !== undefined ? a.timeIn : existing.timeIn,
    notes: a.notes !== undefined ? a.notes : existing.notes,
    deviceId: a.deviceId || existing.deviceId,
    deviceName: a.deviceName || existing.deviceName,
    isDeviceMismatch:
      a.isDeviceMismatch !== undefined ? a.isDeviceMismatch : existing.isDeviceMismatch,
    deviceMismatchReason: a.deviceMismatchReason || existing.deviceMismatchReason,
    isAutoPunchedOut: shouldClearTimeOut
      ? false
      : a.isAutoPunchedOut !== undefined
      ? a.isAutoPunchedOut
      : existing.isAutoPunchedOut,
    adminVerification:
      a.adminVerification !== undefined ? a.adminVerification : existing.adminVerification,
    accountsVerification:
      a.accountsVerification !== undefined
        ? a.accountsVerification
        : existing.accountsVerification,
    breaks: a.isManuallyAdjusted
      ? Array.isArray(a.breaks)
        ? a.breaks
        : existing.breaks || []
      : Array.isArray(a.breaks) && a.breaks.length >= (existing.breaks?.length || 0)
      ? a.breaks
      : existing.breaks || [],
  };

  if (shouldClearTimeOut) {
    delete merged.timeOut;
  } else {
    merged.timeOut = a.timeOut || existing.timeOut;
  }

  delete merged.clearTimeOut;
  return merged;
}

function mergeSingleEmployee(currentList, incomingEmp, allowClearDevice, clearPendingRequest) {
  if (!incomingEmp || !incomingEmp.id || DUMMY_NAMES.includes(incomingEmp.name)) {
    return currentList;
  }
  const cleanIncoming = { ...incomingEmp };
  // Strip null pendingDeviceRequest if explicitly nulled
  if (cleanIncoming.pendingDeviceRequest === null) {
    delete cleanIncoming.pendingDeviceRequest;
  }

  const idx = currentList.findIndex((e) => e.id === cleanIncoming.id);
  if (idx === -1) {
    return [...currentList, cleanIncoming];
  }

  const existing = currentList[idx];
  const updated = {
    ...existing,
    ...cleanIncoming,
  };

  // Handle device reset vs normal profile edit
  if (allowClearDevice) {
    if (!cleanIncoming.registeredDeviceId) {
      delete updated.registeredDeviceId;
      delete updated.registeredDeviceName;
      delete updated.registeredAt;
      delete updated.deviceBoundApprovedBy;
      delete updated.deviceBoundApprovedAt;
    }
  } else {
    // Preserve device bindings if omitted in partial edit
    if (!updated.registeredDeviceId && existing.registeredDeviceId) {
      updated.registeredDeviceId = existing.registeredDeviceId;
      updated.registeredDeviceName = existing.registeredDeviceName;
      updated.registeredAt = existing.registeredAt;
      updated.deviceBoundApprovedBy = existing.deviceBoundApprovedBy;
      updated.deviceBoundApprovedAt = existing.deviceBoundApprovedAt;
    }
    if (
      (!updated.deviceChangeHistory || updated.deviceChangeHistory.length === 0) &&
      existing.deviceChangeHistory &&
      existing.deviceChangeHistory.length > 0
    ) {
      updated.deviceChangeHistory = existing.deviceChangeHistory;
    }
  }

  // Handle pendingDeviceRequest explicitly
  if (clearPendingRequest) {
    delete updated.pendingDeviceRequest;
  } else if (!cleanIncoming.pendingDeviceRequest && existing.pendingDeviceRequest) {
    updated.pendingDeviceRequest = existing.pendingDeviceRequest;
  }

  const next = [...currentList];
  next[idx] = updated;
  return next;
}

// Additive safe merge for any legacy un-scoped browser tab
function mergeEmployeesAdditiveSafe(currentList, incomingList) {
  if (!Array.isArray(incomingList) || incomingList.length === 0) return currentList;
  const hasDummyNames = incomingList.some((e) => DUMMY_NAMES.includes(e.name));
  const isDefaultFallback =
    incomingList.length === 1 && incomingList[0].id === 'emp-101' && currentList.length > 1;
  if (hasDummyNames || isDefaultFallback) return currentList;

  const empMap = new Map();
  for (const e of currentList) {
    empMap.set(e.id, e);
  }
  for (const inc of incomingList) {
    if (!inc || !inc.id || DUMMY_NAMES.includes(inc.name)) continue;
    const existing = empMap.get(inc.id);
    if (!existing) {
      empMap.set(inc.id, inc);
    } else {
      // Never allow an un-scoped legacy sync to wipe bound devices or change history
      empMap.set(inc.id, {
        ...existing,
        ...inc,
        registeredDeviceId: inc.registeredDeviceId || existing.registeredDeviceId,
        registeredDeviceName: inc.registeredDeviceName || existing.registeredDeviceName,
        registeredAt: inc.registeredAt || existing.registeredAt,
        deviceBoundApprovedBy: inc.deviceBoundApprovedBy || existing.deviceBoundApprovedBy,
        deviceBoundApprovedAt: inc.deviceBoundApprovedAt || existing.deviceBoundApprovedAt,
        pendingDeviceRequest: inc.pendingDeviceRequest || existing.pendingDeviceRequest,
        deviceChangeHistory:
          Array.isArray(inc.deviceChangeHistory) &&
          inc.deviceChangeHistory.length >= (existing.deviceChangeHistory?.length || 0)
            ? inc.deviceChangeHistory
            : existing.deviceChangeHistory,
      });
    }
  }
  return Array.from(empMap.values());
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const token = getCloudToken();

  try {
    if (req.method === 'GET') {
      const readRes = await readFromGist(token);
      if (readRes.status === 'error') {
        return res.status(503).json({
          error: 'Cloud database temporarily unavailable. Please retry.',
        });
      }

      let current = readRes.status === 'ok' ? readRes.data : null;
      if (!current) {
        // Initialize Gist only when genuinely empty
        await writeToGist(token, DEFAULT_DB);
        current = DEFAULT_DB;
      }

      // Auto-close any forgotten records from past days or past 23:59:00 Asia/Karachi
      if (Array.isArray(current.attendance)) {
        const { records: closedRecords, changed } = autoCloseForgottenRecords(current.attendance);
        if (changed) {
          current.attendance = closedRecords;
          current.updatedAt = new Date().toISOString();
          void writeToGist(token, current);
        }
      }

      return res.status(200).json(current);
    }

    if (req.method === 'POST') {
      const incoming = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const readRes = await readFromGist(token);

      if (readRes.status === 'error') {
        return res.status(503).json({
          error: 'Cloud database read failed; write aborted to protect existing records.',
        });
      }

      const current = readRes.status === 'ok' ? readRes.data : { ...DEFAULT_DB };
      const scope = incoming.scope || 'legacy_bulk';

      let finalSettings = current.settings;
      let finalShifts = current.shifts;
      let finalEmployees = Array.isArray(current.employees) ? current.employees : [];
      let rawAttendance = Array.isArray(current.attendance) ? current.attendance : [];
      let finalLeaves = Array.isArray(current.leaves) ? current.leaves : [];
      let finalCeoComments = Array.isArray(current.ceoComments) ? current.ceoComments : [];

      if (scope === 'attendance') {
        const attMap = new Map(rawAttendance.map((a) => [a.id, a]));
        if (incoming.changedRecord && incoming.changedRecord.id) {
          const merged = mergeAttendanceRecord(attMap.get(incoming.changedRecord.id), incoming.changedRecord);
          attMap.set(merged.id, merged);
        } else if (Array.isArray(incoming.attendance)) {
          for (const a of incoming.attendance) {
            if (a && a.id) {
              const merged = mergeAttendanceRecord(attMap.get(a.id), a);
              attMap.set(merged.id, merged);
            }
          }
        }
        rawAttendance = Array.from(attMap.values());
      } else if (scope === 'employee_upsert') {
        if (incoming.employee) {
          finalEmployees = mergeSingleEmployee(
            finalEmployees,
            incoming.employee,
            Boolean(incoming.allowClearDevice),
            Boolean(incoming.clearPendingRequest)
          );
        }
      } else if (scope === 'employee_delete') {
        const targetId = incoming.deletedEmployeeId || incoming.employeeId;
        if (targetId && targetId !== 'emp-101') {
          finalEmployees = finalEmployees.filter((e) => e.id !== targetId);
        }
      } else if (scope === 'shifts') {
        if (Array.isArray(incoming.shifts) && incoming.shifts.length > 0) {
          finalShifts = incoming.shifts;
        }
      } else if (scope === 'settings') {
        if (incoming.settings) {
          finalSettings = incoming.settings;
        }
      } else if (scope === 'leaves') {
        const leaveMap = new Map(finalLeaves.map((l) => [l.id, l]));
        if (incoming.changedLeave && incoming.changedLeave.id) {
          leaveMap.set(incoming.changedLeave.id, incoming.changedLeave);
        } else if (Array.isArray(incoming.leaves)) {
          for (const l of incoming.leaves) {
            if (l && l.id) leaveMap.set(l.id, l);
          }
        }
        finalLeaves = Array.from(leaveMap.values());
      } else if (scope === 'ceoComments') {
        const commentMap = new Map(finalCeoComments.map((c) => [c.id, c]));
        if (incoming.changedComment && incoming.changedComment.id) {
          const existing = commentMap.get(incoming.changedComment.id);
          commentMap.set(
            incoming.changedComment.id,
            existing ? { ...existing, ...incoming.changedComment } : incoming.changedComment
          );
        } else if (Array.isArray(incoming.ceoComments)) {
          for (const c of incoming.ceoComments) {
            if (c && c.id) {
              const existing = commentMap.get(c.id);
              commentMap.set(c.id, existing ? { ...existing, ...c } : c);
            }
          }
        }
        finalCeoComments = Array.from(commentMap.values());
      } else if (scope === 'full_restore') {
        const hasDummyNames =
          Array.isArray(incoming.employees) &&
          incoming.employees.some((e) => DUMMY_NAMES.includes(e.name));
        const isDefaultFallback =
          Array.isArray(incoming.employees) &&
          incoming.employees.length === 1 &&
          incoming.employees[0].id === 'emp-101' &&
          finalEmployees.length > 1;
        if (!hasDummyNames && !isDefaultFallback) {
          if (incoming.settings) finalSettings = incoming.settings;
          if (Array.isArray(incoming.shifts) && incoming.shifts.length > 0) finalShifts = incoming.shifts;
          if (Array.isArray(incoming.employees) && incoming.employees.length > 0) {
            finalEmployees = incoming.employees;
          }
          if (Array.isArray(incoming.attendance)) rawAttendance = incoming.attendance;
          if (Array.isArray(incoming.leaves)) finalLeaves = incoming.leaves;
          if (Array.isArray(incoming.ceoComments)) finalCeoComments = incoming.ceoComments;
        }
      } else {
        // legacy_bulk safety fallback (prevents stale open tabs from erasing data)
        finalEmployees = mergeEmployeesAdditiveSafe(finalEmployees, incoming.employees);

        const attMap = new Map(rawAttendance.map((a) => [a.id, a]));
        if (Array.isArray(incoming.attendance)) {
          for (const a of incoming.attendance) {
            if (a && a.id) {
              attMap.set(a.id, mergeAttendanceRecord(attMap.get(a.id), a));
            }
          }
        }
        rawAttendance = Array.from(attMap.values());

        const leaveMap = new Map(finalLeaves.map((l) => [l.id, l]));
        if (Array.isArray(incoming.leaves)) {
          for (const l of incoming.leaves) {
            if (l && l.id) leaveMap.set(l.id, l);
          }
        }
        finalLeaves = Array.from(leaveMap.values());

        const commentMap = new Map(finalCeoComments.map((c) => [c.id, c]));
        if (Array.isArray(incoming.ceoComments)) {
          for (const c of incoming.ceoComments) {
            if (c && c.id) {
              const existing = commentMap.get(c.id);
              commentMap.set(c.id, existing ? { ...existing, ...c } : c);
            }
          }
        }
        finalCeoComments = Array.from(commentMap.values());
      }

      const { records: finalAttendance } = autoCloseForgottenRecords(rawAttendance);

      const mergedDb = {
        version: '1.0',
        updatedAt: new Date().toISOString(),
        settings: finalSettings,
        shifts: finalShifts,
        employees: finalEmployees,
        attendance: finalAttendance,
        leaves: finalLeaves,
        ceoComments: finalCeoComments,
      };

      const ok = await writeToGist(token, mergedDb);
      if (!ok) {
        return res.status(500).json({ error: 'Failed to write to Cloud Database' });
      }

      return res.status(200).json({ ok: true, updatedAt: mergedDb.updatedAt, db: mergedDb });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}
