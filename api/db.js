import {
  evaluateAttendancePresenceAndAutoClose,
  getCloudToken,
  readFromGist,
  setNoCacheHeaders,
  writeToGist,
} from './_cloud.js';

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

function newerIso(a, b) {
  if (!a) return b;
  if (!b) return a;
  const ma = Date.parse(a);
  const mb = Date.parse(b);
  if (Number.isNaN(ma)) return b;
  if (Number.isNaN(mb)) return a;
  return mb > ma ? b : a;
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
    lastHeartbeatAt: shouldClearTimeOut
      ? a.lastHeartbeatAt || new Date().toISOString()
      : newerIso(existing.lastHeartbeatAt, a.lastHeartbeatAt),
    lastActivityAt: shouldClearTimeOut
      ? a.lastActivityAt || new Date().toISOString()
      : newerIso(existing.lastActivityAt, a.lastActivityAt),
    connectionStatus: shouldClearTimeOut
      ? a.connectionStatus || 'online'
      : a.connectionStatus !== undefined
      ? a.connectionStatus
      : existing.connectionStatus,
    heartbeatSource: a.heartbeatSource || existing.heartbeatSource,
    heartbeatDeviceId: a.heartbeatDeviceId || existing.heartbeatDeviceId,
    monitoringPaused:
      shouldClearTimeOut
        ? false
        : a.monitoringPaused !== undefined
        ? a.monitoringPaused
        : existing.monitoringPaused,
  };

  if (shouldClearTimeOut) {
    delete merged.timeOut;
    delete merged.autoPunchOutReason;
    delete merged.disconnectedAt;
  } else {
    merged.timeOut = a.timeOut || existing.timeOut;
    if (a.autoPunchOutReason !== undefined || existing.autoPunchOutReason !== undefined) {
      merged.autoPunchOutReason = a.autoPunchOutReason ?? existing.autoPunchOutReason;
    }
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
  setNoCacheHeaders(res);

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

      // Evaluate 11:59 PM forgotten punches, >2h device inactivity punch-out, and disconnectivity status
      if (Array.isArray(current.attendance)) {
        const { records: evaluatedRecords, changed } = evaluateAttendancePresenceAndAutoClose(
          current.attendance,
          current.settings,
          current.employees,
          current.shifts
        );
        if (changed) {
          current.attendance = evaluatedRecords;
          current.updatedAt = new Date().toISOString();
          await writeToGist(token, current);
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

      const { records: finalAttendance } = evaluateAttendancePresenceAndAutoClose(
        rawAttendance,
        finalSettings,
        finalEmployees,
        finalShifts
      );

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
