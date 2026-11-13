import {
  evaluateAttendancePresenceAndAutoClose,
  getCloudToken,
  mutateCloudDb,
  readFromGist,
  setNoCacheHeaders,
  writeToGist,
} from './_cloud.js';
import {
  isSupabaseConfigured,
  getSupabaseConfig,
  readSupabaseDb,
  mutateSupabaseDb,
} from './_supabase.js';

export const DEFAULT_DB = {
  version: '1.0',
  updatedAt: new Date().toISOString(),
  deletedEmployeeIds: [],
  deletedLeaveIds: [],
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

export function parseIsoMs(iso) {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

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

function cleanRecordForSave(rec) {
  const out = { ...rec };
  if (out.clearTimeOut || out.timeOut === null || out.timeOut === '') {
    delete out.timeOut;
  }
  delete out.clearTimeOut;
  return out;
}

export function mergeAttendanceRecord(existing, a, options = {}) {
  const {
    isLegacyBulk = false,
    actorRoleFallback,
    authoritativeIso,
    authoritativeMs,
    onReject,
  } = options;

  const nowMs = Date.now();
  const serverAuthoritativeMs =
    typeof authoritativeMs === 'number' && Number.isFinite(authoritativeMs) && authoritativeMs > 0
      ? authoritativeMs
      : nowMs;
  const serverAuthoritativeIso = authoritativeIso || new Date(serverAuthoritativeMs).toISOString();

  const useAuthoritativeStamp = !isLegacyBulk && a?.actorAction !== 'auto_close';
  const effectiveRecordIso = useAuthoritativeStamp
    ? serverAuthoritativeIso
    : a?.recordUpdatedAt || serverAuthoritativeIso;

  if (!existing) {
    return cleanRecordForSave(
      useAuthoritativeStamp ? { ...a, recordUpdatedAt: effectiveRecordIso } : a
    );
  }

  const incomingRole = a.lastEditedByRole || actorRoleFallback;
  const incomingIsAdmin = incomingRole === 'admin';

  // Verification-only action: update ONLY the verification object for that role without touching punch times!
  if (a.actorAction === 'verify') {
    const mergedVerify = {
      ...existing,
      recordUpdatedAt: newerIso(existing.recordUpdatedAt, effectiveRecordIso),
    };
    if (a.adminVerification !== undefined && (incomingIsAdmin || !existing.adminVerification?.verified)) {
      mergedVerify.adminVerification = a.adminVerification;
    }
    if (
      a.accountsVerification !== undefined &&
      (incomingRole === 'accounts' || incomingIsAdmin || !existing.accountsVerification?.verified)
    ) {
      mergedVerify.accountsVerification = a.accountsVerification;
    }
    return mergedVerify;
  }

  const existingAdminMs = parseIsoMs(existing.adminOverrideAt);
  const effectiveAdminIso = useAuthoritativeStamp
    ? authoritativeIso
    : a.adminOverrideAt || a.recordUpdatedAt || new Date().toISOString();
  const incomingAdminMs = incomingIsAdmin
    ? parseIsoMs(effectiveAdminIso) || Date.now()
    : parseIsoMs(a.adminOverrideAt);

  const existingUpdatedMs = Math.max(parseIsoMs(existing.recordUpdatedAt), existingAdminMs);
  const incomingUpdatedMs = Math.max(parseIsoMs(effectiveRecordIso), incomingAdminMs);

  // Protect against stale legacy bulk pushes from old open browser tabs
  if (isLegacyBulk) {
    if (existingAdminMs > 0 && (!incomingIsAdmin || incomingAdminMs <= existingAdminMs)) {
      return existing;
    }
    if (existingUpdatedMs > 0 && (incomingUpdatedMs === 0 || incomingUpdatedMs <= existingUpdatedMs)) {
      return existing;
    }
  }

  const shouldClearTimeOut = Boolean(
    a.clearTimeOut === true ||
      a.adminKeepOpen === true ||
      (a.isManuallyAdjusted && (a.timeOut === null || a.timeOut === ''))
  );
  const shouldClearTimeIn = Boolean(a.isManuallyAdjusted && a.timeIn === '');

  // Case A: Explicit Admin edit -> Admin privileges overwrite prior employee or auto-close state
  if (incomingIsAdmin) {
    if (existingAdminMs > 0 && incomingAdminMs > 0 && incomingAdminMs < existingAdminMs) {
      // Stale older Admin tab write: preserve newer Admin state, only keep non-conflicting verification if missing
      return existing;
    }

    const adminStamp = effectiveAdminIso;
    const mergedAdmin = {
      ...existing,
      ...a,
      status: shouldClearTimeIn ? a.status || 'absent' : a.status || existing.status,
      timeIn: shouldClearTimeIn ? '' : a.timeIn !== undefined ? a.timeIn : existing.timeIn,
      notes: a.notes !== undefined ? a.notes : existing.notes,
      deviceId: a.deviceId || existing.deviceId,
      deviceName: a.deviceName || existing.deviceName,
      isDeviceMismatch: false,
      deviceMismatchReason: undefined,
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
      breaks: Array.isArray(a.breaks) ? a.breaks : existing.breaks || [],
      lastHeartbeatAt: newerIso(existing.lastHeartbeatAt, a.lastHeartbeatAt),
      lastActivityAt: newerIso(existing.lastActivityAt, a.lastActivityAt),
      connectionStatus: shouldClearTimeOut
        ? a.connectionStatus || existing.connectionStatus
        : a.connectionStatus !== undefined
        ? a.connectionStatus
        : existing.connectionStatus,
      heartbeatSource: a.heartbeatSource || existing.heartbeatSource,
      heartbeatDeviceId: a.heartbeatDeviceId || existing.heartbeatDeviceId,
      monitoringPaused:
        shouldClearTimeOut
          ? Boolean(a.monitoringPaused)
          : a.monitoringPaused !== undefined
          ? a.monitoringPaused
          : existing.monitoringPaused,
      recordUpdatedAt: newerIso(existing.recordUpdatedAt, effectiveRecordIso || adminStamp),
      lastEditedByRole: 'admin',
      adminOverrideAt: adminStamp,
      adminKeepOpen: Boolean(shouldClearTimeOut && !shouldClearTimeIn && (a.timeIn || existing.timeIn)),
    };

    if (shouldClearTimeOut || shouldClearTimeIn) {
      delete mergedAdmin.timeOut;
      delete mergedAdmin.autoPunchOutReason;
      delete mergedAdmin.disconnectedAt;
      mergedAdmin.isAutoPunchedOut = false;
    } else if (a.timeOut) {
      mergedAdmin.timeOut = a.timeOut;
      mergedAdmin.adminKeepOpen = false;
      if (a.autoPunchOutReason !== undefined) {
        if (a.autoPunchOutReason) {
          mergedAdmin.autoPunchOutReason = a.autoPunchOutReason;
        } else {
          delete mergedAdmin.autoPunchOutReason;
        }
      }
    } else if (existing.timeOut) {
      mergedAdmin.timeOut = existing.timeOut;
      mergedAdmin.adminKeepOpen = false;
    }

    delete mergedAdmin.clearTimeOut;
    return mergedAdmin;
  }

  // Case B: Non-admin write when record already has an Admin override
  if (existingAdminMs > 0) {
    // Allow Accounts Officer to verify independently without overwriting punch times
    if (incomingRole === 'accounts' && a.accountsVerification !== undefined) {
      return {
        ...existing,
        accountsVerification: a.accountsVerification,
        recordUpdatedAt: newerIso(existing.recordUpdatedAt, effectiveRecordIso),
      };
    }

    // Only allow genuine fresh employee self-service actions strictly AFTER Admin's override
    // (Include 'time_in' when the Admin-edited record has no punch-in yet, e.g. cleared or pre-marked)
    const isFreshEmployeePunchIn =
      a.actorAction === 'time_in' &&
      !existing.timeIn &&
      Boolean(a.timeIn) &&
      (incomingUpdatedMs > existingAdminMs || existing.status !== 'absent');
    const validPostAdminEmployeeAction =
      isFreshEmployeePunchIn ||
      (incomingUpdatedMs > existingAdminMs &&
        ['time_out', 'start_break', 'end_break', 'update_note'].includes(a.actorAction || ''));

    if (!validPostAdminEmployeeAction) {
      if (typeof onReject === 'function') {
        onReject('Attendance record has been locked/modified by Administrator and cannot be overwritten.');
      }
      // Do NOT let older/un-timestamped non-admin tabs overwrite Admin edits!
      // Only fold in fresher heartbeats if any.
      const fresherHb = newerIso(existing.lastHeartbeatAt, a.lastHeartbeatAt);
      const fresherAct = newerIso(existing.lastActivityAt, a.lastActivityAt);
      if (fresherHb !== existing.lastHeartbeatAt || fresherAct !== existing.lastActivityAt) {
        return {
          ...existing,
          lastHeartbeatAt: fresherHb,
          lastActivityAt: fresherAct,
        };
      }
      return existing;
    }
  }

  // Case C: Non-admin write vs prior non-admin record
  // Genuine new state transitions (punch-in, punch-out, breaks, notes) are always permitted
  const isNewPunchTransition =
    (a.actorAction === 'time_in' && !existing.timeIn && Boolean(a.timeIn)) ||
    (a.actorAction === 'time_out' && !existing.timeOut && Boolean(a.timeOut)) ||
    a.actorAction === 'start_break' ||
    a.actorAction === 'end_break' ||
    a.actorAction === 'update_note';

  if (
    existingUpdatedMs > 0 &&
    incomingUpdatedMs > 0 &&
    incomingUpdatedMs < existingUpdatedMs &&
    !isNewPunchTransition
  ) {
    if (typeof onReject === 'function') {
      onReject('Attendance update rejected: Newer revision already exists on server.');
    }
    return existing;
  }

  // Never let a stale payload without explicit timeOut wipe an existing timeOut, or vice versa, unless newer
  const incomingIsNewer = incomingUpdatedMs >= existingUpdatedMs;
  const effectiveClearTimeOut =
    shouldClearTimeOut && (incomingUpdatedMs > existingAdminMs || existingAdminMs === 0);

  const merged = {
    ...existing,
    ...a,
    timeIn: shouldClearTimeIn
      ? ''
      : a.timeIn
      ? a.timeIn
      : existing.timeIn || '',
    status: shouldClearTimeIn
      ? 'absent'
      : (a.timeIn || existing.timeIn)
      ? (a.status && a.status !== 'absent' ? a.status : existing.status && existing.status !== 'absent' ? existing.status : 'present')
      : a.status || existing.status || 'absent',
    notes: a.notes !== undefined ? a.notes : existing.notes,
    deviceId: a.deviceId || existing.deviceId,
    deviceName: a.deviceName || existing.deviceName,
    isDeviceMismatch: false,
    deviceMismatchReason: undefined,
    isAutoPunchedOut: effectiveClearTimeOut
      ? false
      : a.isAutoPunchedOut !== undefined
      ? a.isAutoPunchedOut
      : existing.isAutoPunchedOut,
    adminVerification: existing.adminVerification ?? a.adminVerification,
    accountsVerification:
      a.accountsVerification !== undefined
        ? a.accountsVerification
        : existing.accountsVerification,
    breaks:
      a.actorAction === 'start_break' || a.actorAction === 'end_break'
        ? Array.isArray(a.breaks)
          ? a.breaks
          : existing.breaks || []
        : Array.isArray(a.breaks) && a.breaks.length >= (existing.breaks?.length || 0)
        ? a.breaks
        : existing.breaks || [],
    lastHeartbeatAt: newerIso(existing.lastHeartbeatAt, a.lastHeartbeatAt),
    lastActivityAt: newerIso(existing.lastActivityAt, a.lastActivityAt),
    connectionStatus:
      a.connectionStatus !== undefined ? a.connectionStatus : existing.connectionStatus,
    heartbeatSource: a.heartbeatSource || existing.heartbeatSource,
    heartbeatDeviceId: a.heartbeatDeviceId || existing.heartbeatDeviceId,
    monitoringPaused:
      a.monitoringPaused !== undefined ? a.monitoringPaused : existing.monitoringPaused,
    recordUpdatedAt: newerIso(existing.recordUpdatedAt, effectiveRecordIso),
    lastEditedByRole: incomingRole || existing.lastEditedByRole,
    adminOverrideAt: existing.adminOverrideAt,
    adminKeepOpen:
      a.actorAction === 'time_out' || (!effectiveClearTimeOut && a.timeOut)
        ? false
        : existing.adminKeepOpen,
  };

  if (effectiveClearTimeOut) {
    delete merged.timeOut;
    delete merged.autoPunchOutReason;
    delete merged.disconnectedAt;
  } else {
    merged.timeOut = incomingIsNewer ? a.timeOut || existing.timeOut : existing.timeOut || a.timeOut;
    if (a.autoPunchOutReason !== undefined || existing.autoPunchOutReason !== undefined) {
      merged.autoPunchOutReason = a.autoPunchOutReason ?? existing.autoPunchOutReason;
    }
  }

  delete merged.clearTimeOut;
  return merged;
}

export function mergeSingleEmployee(
  currentList,
  incomingEmp,
  allowClearDevice,
  clearPendingRequest,
  actorRole
) {
  if (!incomingEmp || !incomingEmp.id || DUMMY_NAMES.includes(incomingEmp.name)) {
    return currentList;
  }
  const cleanIncoming = { ...incomingEmp };
  if (cleanIncoming.pendingDeviceRequest === null) {
    delete cleanIncoming.pendingDeviceRequest;
  }

  const idx = currentList.findIndex((e) => e.id === cleanIncoming.id);
  if (idx === -1) {
    return [...currentList, cleanIncoming];
  }

  const existing = currentList[idx];
  const isAdminActor = !actorRole || actorRole === 'admin';

  // Non-admin self-service (e.g., Change Password or Device Change Request):
  // NEVER let a stale employee profile overwrite Admin-edited role, shift, salary, or device binding!
  if (!isAdminActor) {
    const next = [...currentList];
    const safeUpdated = { ...existing };
    if (cleanIncoming.pin && cleanIncoming.pin !== existing.pin) {
      safeUpdated.pin = cleanIncoming.pin;
    }
    if (cleanIncoming.pendingDeviceRequest) {
      safeUpdated.pendingDeviceRequest = cleanIncoming.pendingDeviceRequest;
    }
    if (cleanIncoming.recordUpdatedAt) {
      safeUpdated.recordUpdatedAt = newerIso(existing.recordUpdatedAt, cleanIncoming.recordUpdatedAt);
    }
    next[idx] = safeUpdated;
    return next;
  }

  const updated = {
    ...existing,
    ...cleanIncoming,
    lastEditedByRole: 'admin',
    recordUpdatedAt: newerIso(existing.recordUpdatedAt, cleanIncoming.recordUpdatedAt || new Date().toISOString()),
  };

  if (allowClearDevice) {
    if (!cleanIncoming.registeredDeviceId) {
      delete updated.registeredDeviceId;
      delete updated.registeredDeviceName;
      delete updated.registeredAt;
      delete updated.deviceBoundApprovedBy;
      delete updated.deviceBoundApprovedAt;
    }
  } else {
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
export function mergeEmployeesAdditiveSafe(currentList, incomingList, deletedEmployeeIds = []) {
  if (!Array.isArray(incomingList) || incomingList.length === 0) return currentList;
  const hasDummyNames = incomingList.some((e) => DUMMY_NAMES.includes(e.name));
  const isDefaultFallback =
    incomingList.length === 1 && incomingList[0].id === 'emp-101' && currentList.length > 1;
  if (hasDummyNames || isDefaultFallback) return currentList;

  const deletedSet = new Set(Array.isArray(deletedEmployeeIds) ? deletedEmployeeIds : []);
  const empMap = new Map();
  for (const e of currentList) {
    empMap.set(e.id, e);
  }
  for (const inc of incomingList) {
    if (!inc || !inc.id || DUMMY_NAMES.includes(inc.name)) continue;
    if (deletedSet.has(inc.id)) continue;
    const existing = empMap.get(inc.id);
    if (!existing) {
      empMap.set(inc.id, inc);
    } else if (parseIsoMs(inc.recordUpdatedAt) > parseIsoMs(existing.recordUpdatedAt)) {
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

  // 1. If Supabase PostgreSQL is configured, route all operations to Supabase directly
  if (isSupabaseConfigured()) {
    try {
      if (req.method === 'GET') {
        let currentSupaDb = await readSupabaseDb(DEFAULT_DB);

        // If Supabase was just initialized (only 1 default admin employee), auto-migrate all 17 employees and attendance from Gist
        if (Array.isArray(currentSupaDb.employees) && currentSupaDb.employees.length <= 1) {
          const token = getCloudToken();
          if (token) {
            try {
              const gistRes = await readFromGist(token, 'Office-Attendance-Tracker-Server', { useEtagCache: false });
              if (gistRes.status === 'ok' && gistRes.data && Array.isArray(gistRes.data.employees) && gistRes.data.employees.length > 1) {
                console.log(`Auto-migrating ${gistRes.data.employees.length} employees and ${gistRes.data.attendance?.length || 0} attendance records from Gist to Supabase...`);
                const mutRes = await mutateSupabaseDb({
                  scope: 'full_restore',
                  employees: gistRes.data.employees,
                  attendance: gistRes.data.attendance || [],
                  leaves: gistRes.data.leaves || [],
                  shifts: gistRes.data.shifts || [],
                  settings: gistRes.data.settings || DEFAULT_DB.settings,
                }, DEFAULT_DB);
                currentSupaDb = mutRes.db;
              }
            } catch (migErr) {
              console.warn('Gist auto-migration to Supabase skipped:', migErr);
            }
          }
        }

        if (Array.isArray(currentSupaDb.attendance)) {
          const { records: displayRecs } = evaluateAttendancePresenceAndAutoClose(
            currentSupaDb.attendance,
            currentSupaDb.settings,
            currentSupaDb.employees,
            currentSupaDb.shifts
          );
          return res.status(200).json({
            ...currentSupaDb,
            attendance: displayRecs,
          });
        }
        return res.status(200).json(currentSupaDb);
      }

      if (req.method === 'POST') {
        const incoming = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const result = await mutateSupabaseDb(incoming, DEFAULT_DB);
        return res.status(200).json({
          ok: true,
          updatedAt: result.db.updatedAt,
          db: result.db,
        });
      }

      return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
      console.error('Supabase operation error:', err);
      return res.status(err.status || 500).json({ error: err.message || 'Supabase operation failed.' });
    }
  }

  // 2. Fallback to hardened GitHub Gist storage
  const token = getCloudToken();

  try {
    if (req.method === 'GET') {
      const readRes = await readFromGist(token, 'Office-Attendance-Tracker-Server', {
        useEtagCache: false,
      });
      if (readRes.status === 'error') {
        const supa = getSupabaseConfig();
        return res.status(503).json({
          error: 'Cloud database temporarily unavailable. Please retry.',
          diagnostics: {
            hasSupabaseUrl: Boolean(supa.url),
            hasSupabaseKey: Boolean(supa.key),
            hasGithubToken: Boolean(token),
          },
          help: !token && !supa.isConfigured
            ? 'Missing database credentials in Vercel. Set SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY (or GITHUB_DB_TOKEN) in Vercel Settings -> Environment Variables, and Redeploy.'
            : readRes.error,
        });
      }

      if (readRes.status === 'empty' || !readRes.data) {
        const initOutcome = await mutateCloudDb(
          token,
          (db) => ({
            nextDb: db || { ...DEFAULT_DB, updatedAt: new Date().toISOString() },
            skipWrite: Boolean(db),
          }),
          'Office-Attendance-Tracker-Server',
          { allowEmptyInit: true, defaultDb: DEFAULT_DB }
        );
        if (!initOutcome.ok) {
          return res.status(initOutcome.status || 503).json({ error: initOutcome.error });
        }
        return res.status(200).json(initOutcome.db);
      }

      const rawCurrent = readRes.data;
      const current = {
        ...rawCurrent,
        settings: {
          ...(rawCurrent.settings || DEFAULT_DB.settings),
          enforceDeviceBinding: false,
        },
      };

      // Evaluate 11:59 PM rollover and worked minutes for display (pure read-only without burning write quota)
      if (Array.isArray(current.attendance)) {
        const { records: displayRecs } = evaluateAttendancePresenceAndAutoClose(
          current.attendance,
          current.settings,
          current.employees,
          current.shifts
        );
        return res.status(200).json({
          ...current,
          settings: {
            ...(current.settings || DEFAULT_DB.settings),
            enforceDeviceBinding: false,
          },
          attendance: displayRecs,
        });
      }

      return res.status(200).json({
        ...current,
        settings: {
          ...(current.settings || DEFAULT_DB.settings),
          enforceDeviceBinding: false,
        },
      });
    }

    if (req.method === 'POST') {
      const incoming = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const scope = incoming.scope || 'legacy_bulk';
      const hasQueuedAge =
        incoming.queuedAgeMs !== undefined && Number.isFinite(Number(incoming.queuedAgeMs));
      const clampedQueuedAgeMs = hasQueuedAge
        ? Math.max(0, Math.min(24 * 60 * 60 * 1000, Number(incoming.queuedAgeMs)))
        : 0;

      const mutationResult = await mutateCloudDb(
        token,
        (current) => {
          let rejectionReason = null;
          const onReject = (reason) => {
            if (!rejectionReason) rejectionReason = reason;
          };

          const authoritativeMs = hasQueuedAge ? Date.now() - clampedQueuedAgeMs : Date.now();
          const authoritativeIso = new Date(authoritativeMs).toISOString();
          const mergeOpts = {
            actorRoleFallback: incoming.actorRole,
            authoritativeMs,
            authoritativeIso,
            onReject,
          };

          let finalSettings = current.settings || DEFAULT_DB.settings;
          let finalShifts = Array.isArray(current.shifts) && current.shifts.length > 0 ? current.shifts : DEFAULT_DB.shifts;
          let finalEmployees = Array.isArray(current.employees) ? current.employees : [];
          let rawAttendance = Array.isArray(current.attendance) ? current.attendance : [];
          let finalLeaves = Array.isArray(current.leaves) ? current.leaves : [];
          let finalCeoComments = Array.isArray(current.ceoComments) ? current.ceoComments : [];
          let finalDeletedEmployeeIds = Array.isArray(current.deletedEmployeeIds) ? current.deletedEmployeeIds : [];
          let finalDeletedLeaveIds = Array.isArray(current.deletedLeaveIds) ? current.deletedLeaveIds : [];

          if (scope === 'attendance') {
            const attMap = new Map(rawAttendance.map((a) => [a.id, a]));
            if (Array.isArray(incoming.changedRecords) && incoming.changedRecords.length > 0) {
              for (const rec of incoming.changedRecords) {
                if (rec && rec.id) {
                  const merged = mergeAttendanceRecord(attMap.get(rec.id), rec, mergeOpts);
                  attMap.set(merged.id, merged);
                }
              }
            } else if (incoming.changedRecord && incoming.changedRecord.id) {
              const merged = mergeAttendanceRecord(
                attMap.get(incoming.changedRecord.id),
                incoming.changedRecord,
                mergeOpts
              );
              attMap.set(merged.id, merged);
            } else if (Array.isArray(incoming.attendance)) {
              for (const a of incoming.attendance) {
                if (a && a.id) {
                  const merged = mergeAttendanceRecord(attMap.get(a.id), a, mergeOpts);
                  attMap.set(merged.id, merged);
                }
              }
            }
            rawAttendance = Array.from(attMap.values());
          } else if (scope === 'employee_upsert') {
            if (incoming.employee) {
              if (incoming.actorRole === 'admin') {
                finalDeletedEmployeeIds = finalDeletedEmployeeIds.filter((id) => id !== incoming.employee.id);
              }
              finalEmployees = mergeSingleEmployee(
                finalEmployees,
                incoming.employee,
                Boolean(incoming.allowClearDevice),
                Boolean(incoming.clearPendingRequest),
                incoming.actorRole
              );
            }
          } else if (scope === 'employee_delete') {
            const targetId = incoming.deletedEmployeeId || incoming.employeeId;
            if (targetId && targetId !== 'emp-101') {
              finalEmployees = finalEmployees.filter((e) => e.id !== targetId);
              finalDeletedEmployeeIds = Array.from(new Set([...finalDeletedEmployeeIds, targetId]));
            } else if (targetId === 'emp-101') {
              rejectionReason = 'Primary Administrator account (emp-101) cannot be deleted.';
            }
          } else if (scope === 'shifts') {
            if (Array.isArray(incoming.shifts) && incoming.shifts.length > 0) {
              finalShifts = incoming.shifts;
            }
          } else if (scope === 'settings') {
            if (incoming.settings) {
              const curSetMs = parseIsoMs(finalSettings?.settingsUpdatedAt);
              const incSetMs = hasQueuedAge
                ? authoritativeMs
                : parseIsoMs(incoming.settings?.settingsUpdatedAt);
              if (curSetMs === 0 || incSetMs === 0 || incSetMs >= curSetMs) {
                finalSettings = {
                  ...finalSettings,
                  ...incoming.settings,
                  enforceDeviceBinding: false,
                  settingsUpdatedAt:
                    authoritativeIso || incoming.settings.settingsUpdatedAt || new Date().toISOString(),
                };
              }
            }
          } else if (scope === 'leaves') {
            const leaveMap = new Map(finalLeaves.map((l) => [l.id, l]));
            if (incoming.changedLeave && incoming.changedLeave.id) {
              const existingLeave = leaveMap.get(incoming.changedLeave.id);
              const incLeaveMs = hasQueuedAge
                ? authoritativeMs
                : parseIsoMs(incoming.changedLeave.recordUpdatedAt);
              const existingMs = parseIsoMs(existingLeave?.recordUpdatedAt);
              const existingHasAdminDecision =
                existingLeave &&
                (existingLeave.lastEditedByRole === 'admin' ||
                  existingLeave.reviewedBy ||
                  existingLeave.status === 'approved' ||
                  existingLeave.status === 'rejected');

              // Rule: Admin decision is AUTHORITATIVE. An employee tab/device can NEVER revert an admin-approved/rejected leave!
              const isAllowed =
                !existingLeave ||
                incoming.actorRole === 'admin' ||
                (!existingHasAdminDecision && (incLeaveMs >= existingMs || existingMs === 0));

              if (isAllowed) {
                leaveMap.set(incoming.changedLeave.id, {
                  ...(existingLeave || {}),
                  ...incoming.changedLeave,
                  recordUpdatedAt:
                    authoritativeIso || incoming.changedLeave.recordUpdatedAt || new Date().toISOString(),
                });
              } else {
                rejectionReason = existingHasAdminDecision
                  ? 'Leave request has already been reviewed by Administrator and cannot be modified.'
                  : 'Leave update rejected: Newer revision already exists on server.';
              }
            } else if (Array.isArray(incoming.leaves)) {
              for (const l of incoming.leaves) {
                if (l && l.id) {
                  const existingLeave = leaveMap.get(l.id);
                  const existingHasAdminDecision =
                    existingLeave &&
                    (existingLeave.lastEditedByRole === 'admin' ||
                      existingLeave.reviewedBy ||
                      existingLeave.status === 'approved' ||
                      existingLeave.status === 'rejected');

                  if (!existingLeave) {
                    leaveMap.set(l.id, l);
                  } else if (incoming.actorRole === 'admin') {
                    leaveMap.set(l.id, { ...existingLeave, ...l });
                  } else if (
                    !existingHasAdminDecision &&
                    parseIsoMs(l.recordUpdatedAt) >= parseIsoMs(existingLeave.recordUpdatedAt)
                  ) {
                    leaveMap.set(l.id, { ...existingLeave, ...l });
                  }
                }
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
              if (incoming.settings) {
                finalSettings = { ...incoming.settings, enforceDeviceBinding: false };
              }
              if (Array.isArray(incoming.shifts) && incoming.shifts.length > 0) finalShifts = incoming.shifts;
              if (Array.isArray(incoming.employees) && incoming.employees.length > 0) {
                finalEmployees = incoming.employees;
              }
              if (Array.isArray(incoming.attendance)) rawAttendance = incoming.attendance;
              if (Array.isArray(incoming.leaves)) finalLeaves = incoming.leaves;
              if (Array.isArray(incoming.ceoComments)) finalCeoComments = incoming.ceoComments;
            }
          } else {
            // legacy_bulk safety fallback (prevents stale open tabs from erasing or reverting newer data)
            finalEmployees = mergeEmployeesAdditiveSafe(
              finalEmployees,
              incoming.employees,
              finalDeletedEmployeeIds
            );

            const attMap = new Map(rawAttendance.map((a) => [a.id, a]));
            if (Array.isArray(incoming.attendance)) {
              for (const a of incoming.attendance) {
                if (a && a.id) {
                  attMap.set(a.id, mergeAttendanceRecord(attMap.get(a.id), a, { isLegacyBulk: true }));
                }
              }
            }
            rawAttendance = Array.from(attMap.values());

            const leaveMap = new Map(finalLeaves.map((l) => [l.id, l]));
            if (Array.isArray(incoming.leaves)) {
              for (const l of incoming.leaves) {
                if (l && l.id && !leaveMap.has(l.id) && !finalDeletedLeaveIds.includes(l.id)) {
                  leaveMap.set(l.id, l);
                }
              }
            }
            finalLeaves = Array.from(leaveMap.values());

            const commentMap = new Map(finalCeoComments.map((c) => [c.id, c]));
            if (Array.isArray(incoming.ceoComments)) {
              for (const c of incoming.ceoComments) {
                if (c && c.id && !commentMap.has(c.id)) {
                  commentMap.set(c.id, c);
                }
              }
            }
            finalCeoComments = Array.from(commentMap.values());
          }

          const { records: evaluatedAttendance } = evaluateAttendancePresenceAndAutoClose(
            rawAttendance,
            finalSettings,
            finalEmployees,
            finalShifts
          );
          const finalAttendance = rawAttendance.map((orig, i) => {
            const ev = evaluatedAttendance[i];
            return ev && ev.timeOut && !orig?.timeOut ? ev : orig;
          });

          if (rejectionReason) {
            return {
              abort: true,
              status: 409,
              error: rejectionReason,
            };
          }

          const unchanged =
            JSON.stringify(current.settings || null) === JSON.stringify(finalSettings || null) &&
            JSON.stringify(current.shifts || []) === JSON.stringify(finalShifts || []) &&
            JSON.stringify(current.employees || []) === JSON.stringify(finalEmployees || []) &&
            JSON.stringify(current.attendance || []) === JSON.stringify(finalAttendance || []) &&
            JSON.stringify(current.leaves || []) === JSON.stringify(finalLeaves || []) &&
            JSON.stringify(current.ceoComments || []) === JSON.stringify(finalCeoComments || []);

          if (unchanged) {
            return { skipWrite: true };
          }

          const mergedDb = {
            version: '1.0',
            updatedAt: new Date().toISOString(),
            deletedEmployeeIds: finalDeletedEmployeeIds,
            deletedLeaveIds: finalDeletedLeaveIds,
            settings: finalSettings,
            shifts: finalShifts,
            employees: finalEmployees,
            attendance: finalAttendance,
            leaves: finalLeaves,
            ceoComments: finalCeoComments,
          };

          return { nextDb: mergedDb };
        },
        'Office-Attendance-Tracker-Server',
        { allowEmptyInit: true, defaultDb: DEFAULT_DB, priority: 'critical' }
      );

      if (!mutationResult.ok) {
        return res.status(mutationResult.status || 500).json({
          error: mutationResult.error,
          ...(mutationResult.retryAfterSeconds ? { retryAfterSeconds: mutationResult.retryAfterSeconds } : {}),
          ...(mutationResult.resetAtIso ? { resetAtIso: mutationResult.resetAtIso } : {}),
        });
      }

      return res.status(200).json({
        ok: true,
        updatedAt: mutationResult.db.updatedAt,
        db: {
          ...mutationResult.db,
          settings: {
            ...(mutationResult.db.settings || DEFAULT_DB.settings),
            enforceDeviceBinding: false,
          },
        },
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}
