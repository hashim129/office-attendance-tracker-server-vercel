import { checkOfficeNetwork } from './_netmatch.js';
import { verifyFacePass } from './_face.js';
/**
 * Supabase (PostgreSQL) REST Adapter
 * Provides zero-dependency, atomic cloud database persistence via Supabase PostgREST API.
 * Eliminates GitHub Gist rate limits, write mutex contention, and ephemeral file wiping.
 */

export function getSupabaseConfig() {
  let url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    process.env.SUPABASE_PROJECT_URL ||
    process.env.SUPABASE_API_URL ||
    '';

  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
  if (!url && dbUrl) {
    const match1 = dbUrl.match(/@db\.([a-z0-9_-]+)\.supabase\.co/i);
    const match2 = dbUrl.match(/postgres\.([a-z0-9_-]+):/i);
    const match3 = dbUrl.match(/https?:\/\/([a-z0-9_-]+)\.supabase\.co/i);
    const ref = match1?.[1] || match2?.[1] || match3?.[1];
    if (ref) {
      url = `https://${ref}.supabase.co`;
    }
  }

  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_API_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    '';

  return {
    url: url.replace(/\/+$/, ''),
    key,
    isConfigured: Boolean(url && key),
  };
}

export function isSupabaseConfigured() {
  return getSupabaseConfig().isConfigured;
}

export async function supabaseFetch(endpoint, options = {}) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    throw new Error('Supabase credentials not configured in environment variables.');
  }

  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const fullUrl = `${url}/rest/v1${cleanEndpoint}`;

  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const res = await fetch(fullUrl, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let errText = '';
    try {
      const errJson = await res.json();
      errText = errJson.message || errJson.error || JSON.stringify(errJson);
    } catch {
      errText = await res.text();
    }
    const err = new Error(`Supabase error (${res.status}): ${errText}`);
    err.status = res.status;
    throw err;
  }

  // Handle empty bodies (204 No Content, 201 Created with 0 bytes, etc.)
  const text = await res.text();
  if (!text || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getDayNameFromDate(dateStr) {
  if (!dateStr) return 'Monday';
  const d = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return 'Monday';
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}

/**
 * Maps PostgreSQL snake_case columns back to application camelCase objects
 */
function mapDbEmployee(r) {
  if (!r) return null;
  let pendingObj = null;
  if (r.pending_device_request) {
    try {
      pendingObj =
        typeof r.pending_device_request === 'string'
          ? JSON.parse(r.pending_device_request)
          : r.pending_device_request;
    } catch {
      pendingObj = null;
    }
  }

  const allowWorkFromHome = Boolean(
    r.allow_work_from_home ?? pendingObj?.allowWorkFromHome ?? false
  );

  return {
    id: r.id,
    employeeCode: r.employee_code,
    name: r.name,
    email: r.email || '',
    role: r.role || 'employee',
    // The PIN is never sent to browsers. It is checked on the server (api/auth.js).
    pin: '',
    hasPin: Boolean(r.pin_hash || r.pin),
    pinLength: Number(r.pin_len) || undefined,
    department: r.department || '',
    designation: r.designation || '',
    shiftId: r.shift_id || 'shift-std',
    phone: r.phone || '',
    hourlyRate: Number(r.hourly_rate) || 0,
    isActive: Boolean(r.is_active),
    joinedDate: r.joined_date || '',
    avatarSeed: r.avatar_seed || '',
    allowWorkFromHome,
    registeredDeviceId: r.registered_device_id || undefined,
    registeredDeviceName: r.registered_device_name || undefined,
    registeredAt: r.registered_at || undefined,
    deviceBoundApprovedBy: r.device_bound_approved_by || undefined,
    deviceBoundApprovedAt: r.device_bound_approved_at || undefined,
    deviceChangeHistory: Array.isArray(r.device_change_history) ? r.device_change_history : [],
    pendingDeviceRequest: pendingObj || undefined,
    recordUpdatedAt: r.record_updated_at || undefined,
    lastEditedByRole: r.last_edited_by_role || undefined,
  };
}

function mapAppEmployeeToDb(e) {
  const existingPending =
    e.pendingDeviceRequest && typeof e.pendingDeviceRequest === 'object'
      ? e.pendingDeviceRequest
      : {};
  const pendingWithWfh = {
    ...existingPending,
    allowWorkFromHome: Boolean(e.allowWorkFromHome),
  };

  return {
    id: e.id,
    employee_code: e.employeeCode || e.id,
    name: e.name,
    email: e.email || '',
    role: e.role || 'employee',
    department: e.department || '',
    designation: e.designation || '',
    shift_id: e.shiftId || 'shift-std',
    phone: e.phone || '',
    hourly_rate: Number(e.hourlyRate) || 0,
    is_active: e.isActive !== false,
    joined_date: e.joinedDate || null,
    avatar_seed: e.avatarSeed || '',
    registered_device_id: e.registeredDeviceId || null,
    registered_device_name: e.registeredDeviceName || null,
    registered_at: e.registeredAt || null,
    device_bound_approved_by: e.deviceBoundApprovedBy || null,
    device_bound_approved_at: e.deviceBoundApprovedAt || null,
    device_change_history: JSON.stringify(e.deviceChangeHistory || []),
    pending_device_request: JSON.stringify(pendingWithWfh),
    record_updated_at: e.recordUpdatedAt || new Date().toISOString(),
    last_edited_by_role: e.lastEditedByRole || 'admin',
    deleted_at: null,
  };
}

function parseTimeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const parts = timeStr.split(':').map((p) => parseInt(p, 10));
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

function calculateBreaksDuration(breaks) {
  if (!breaks || !Array.isArray(breaks) || breaks.length === 0) return 0;
  return breaks.reduce((total, b) => {
    if (!b || !b.end || !b.start) return total;
    const startMins = parseTimeToMinutes(b.start);
    const endMins = parseTimeToMinutes(b.end);
    const diff = endMins >= startMins ? endMins - startMins : 24 * 60 - startMins + endMins;
    return total + Math.max(0, diff);
  }, 0);
}

function calculateWorkedMinutes(timeIn, timeOut, breaks, expectedShiftHours = 8) {
  if (!timeIn || !timeOut) {
    return { totalWorkedMinutes: 0, regularMinutes: 0, overtimeMinutes: 0 };
  }
  const inMins = parseTimeToMinutes(timeIn);
  const outMins = parseTimeToMinutes(timeOut);
  const rawDiff = outMins >= inMins ? outMins - inMins : 24 * 60 - inMins + outMins;
  const breakMins = calculateBreaksDuration(breaks);
  const netWorked = Math.max(0, rawDiff - breakMins);
  const regularThreshold = expectedShiftHours * 60;
  const regular = Math.min(netWorked, regularThreshold);
  const overtime = Math.max(0, netWorked - regularThreshold);
  return { totalWorkedMinutes: netWorked, regularMinutes: regular, overtimeMinutes: overtime };
}

function mapDbAttendance(r) {
  if (!r) return null;
  const breaks = Array.isArray(r.breaks) ? r.breaks : (typeof r.breaks === 'string' ? JSON.parse(r.breaks || '[]') : []);
  let totalWorked = Number(r.total_worked_minutes) || 0;
  let regular = Number(r.regular_minutes) || 0;
  let overtime = Number(r.overtime_minutes) || 0;
  if (r.time_in && r.time_out && (!totalWorked || totalWorked === 0)) {
    const calc = calculateWorkedMinutes(r.time_in, r.time_out, breaks);
    totalWorked = calc.totalWorkedMinutes;
    regular = calc.regularMinutes;
    overtime = calc.overtimeMinutes;
  }

  const out = {
    id: r.id,
    employeeId: r.employee_id,
    date: r.date,
    day: getDayNameFromDate(r.date),
    timeIn: r.time_in || '',
    status: r.status || 'absent',
    notes: r.notes || '',
    breaks,
    totalWorkedMinutes: totalWorked,
    regularMinutes: regular,
    overtimeMinutes: overtime,
    deviceId: r.device_id || '',
    deviceName: r.device_name || '',
    isDeviceMismatch: Boolean(r.is_device_mismatch),
    isAutoPunchedOut: Boolean(r.is_auto_punched_out),
    monitoringPaused: Boolean(r.monitoring_paused),
    adminVerification: readJson(r.admin_verification, undefined),
    accountsVerification: readJson(r.accounts_verification, undefined),
    lastHeartbeatAt: r.last_heartbeat_at || undefined,
    lastActivityAt: r.last_activity_at || undefined,
    recordUpdatedAt: r.record_updated_at || undefined,
    lastEditedByRole: r.last_edited_by_role || undefined,
    adminOverrideAt: r.admin_override_at || undefined,
    adminKeepOpen: Boolean(r.admin_keep_open),
  };
  if (r.time_out) out.timeOut = r.time_out;
  if (r.auto_punch_out_reason) out.autoPunchOutReason = r.auto_punch_out_reason;
  if (r.disconnected_at) out.disconnectedAt = r.disconnected_at;
  return out;
}

function mapAppAttendanceToDb(a) {
  return {
    id: a.id,
    employee_id: a.employeeId || a.employee_id,
    date: a.date,
    time_in: a.timeIn || a.time_in || null,
    time_out: a.timeOut || a.time_out || null,
    status: a.status || 'absent',
    notes: a.notes || '',
    breaks: readJson(a.breaks, []),
    device_id: a.deviceId || a.device_id || null,
    device_name: a.deviceName || a.device_name || null,
    is_device_mismatch: Boolean(a.isDeviceMismatch ?? a.is_device_mismatch),
    is_auto_punched_out: Boolean(a.isAutoPunchedOut ?? a.is_auto_punched_out),
    auto_punch_out_reason: a.autoPunchOutReason || a.auto_punch_out_reason || null,
    disconnected_at: a.disconnectedAt || a.disconnected_at || null,
    monitoring_paused: Boolean(a.monitoringPaused ?? a.monitoring_paused),
    admin_verification: readJson(a.adminVerification ?? a.admin_verification, null),
    accounts_verification: readJson(a.accountsVerification ?? a.accounts_verification, null),
    last_heartbeat_at: a.lastHeartbeatAt || a.last_heartbeat_at || null,
    last_activity_at: a.lastActivityAt || a.last_activity_at || null,
    record_updated_at: a.recordUpdatedAt || a.record_updated_at || new Date().toISOString(),
    last_edited_by_role: a.lastEditedByRole || a.last_edited_by_role || 'employee',
    admin_override_at: a.adminOverrideAt || a.admin_override_at || null,
    admin_keep_open: Boolean(a.adminKeepOpen ?? a.admin_keep_open),
  };
}

function mapDbLeave(r) {
  if (!r) return null;
  const note = r.admin_note || undefined;
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeName: r.employee_name || '',
    leaveType: r.leave_type,
    startDate: r.start_date,
    endDate: r.end_date,
    reason: r.reason || '',
    status: r.status || 'pending',
    appliedAt: r.applied_at || undefined,
    reviewedBy: r.reviewed_by || undefined,
    reviewedAt: r.reviewed_at || undefined,
    adminNote: note,
    reviewNote: note,
    recordUpdatedAt: r.record_updated_at || undefined,
    lastEditedByRole: r.last_edited_by_role || undefined,
  };
}

function mapAppLeaveToDb(l) {
  const note = l.adminNote || l.reviewNote || null;
  return {
    id: l.id,
    employee_id: l.employeeId,
    employee_name: l.employeeName || '',
    leave_type: l.leaveType,
    start_date: l.startDate,
    end_date: l.endDate,
    reason: l.reason || '',
    status: l.status || 'pending',
    applied_at: l.appliedAt || new Date().toISOString(),
    reviewed_by: l.reviewedBy || null,
    reviewed_at: l.reviewedAt || (l.status !== 'pending' ? l.recordUpdatedAt || new Date().toISOString() : null),
    admin_note: note,
    record_updated_at: l.recordUpdatedAt || new Date().toISOString(),
    last_edited_by_role: l.lastEditedByRole || 'employee',
    deleted_at: null,
  };
}

function mapDbShift(r) {
  if (!r) return null;
  const isNoRestriction =
    r.id === 'shift-freelance' ||
    (r.start_time === '00:00' && r.end_time === '23:59');
  return {
    id: r.id,
    name: r.name,
    startTime: r.start_time,
    endTime: r.end_time,
    workDays: Array.isArray(r.work_days) ? r.work_days : [0, 1, 2, 3, 4, 5, 6],
    graceMinutes: Number(r.grace_minutes) || 15,
    expectedHours: Number(r.expected_hours) || 8,
    color: r.color || 'blue',
    isActive: true,
    isNoRestriction,
  };
}

function mapAppShiftToDb(s) {
  return {
    id: s.id,
    name: s.name,
    start_time: s.startTime,
    end_time: s.endTime,
    work_days: JSON.stringify(s.workDays || [1, 2, 3, 4, 5]),
    grace_minutes: Number(s.graceMinutes) || 15,
    expected_hours: Number(s.expectedHours) || 8,
    color: s.color || 'blue',
    updated_at: new Date().toISOString(),
  };
}

function mapDbComment(r) {
  if (!r) return null;
  return {
    id: r.id,
    recordId: r.record_id || '',
    employeeId: r.employee_id || '',
    date: r.date || '',
    comment: r.comment || '',
    authorName: r.author_name || '',
    createdAt: r.created_at || undefined,
    updatedAt: r.updated_at || undefined,
  };
}

function mapAppCommentToDb(c) {
  return {
    id: c.id,
    record_id: c.recordId || '',
    employee_id: c.employeeId || '',
    date: c.date || '',
    comment: c.comment,
    author_name: c.authorName || '',
    created_at: c.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Loads entire database from Supabase PostgreSQL tables
 */
export async function readSupabaseDb(defaultDb) {
  try {
    const [settingsRows, shiftsRows, empRows, attRows, leavesRows, commentsRows] = await Promise.all([
      supabaseFetch('/settings?id=eq.current&select=*'),
      supabaseFetch('/shifts?select=*&order=id.asc'),
      supabaseFetch('/employees?deleted_at=is.null&select=*&order=employee_code.asc'),
      supabaseFetch('/attendance?select=*&order=date.desc'),
      supabaseFetch('/leaves?deleted_at=is.null&select=*&order=applied_at.desc'),
      supabaseFetch('/ceo_comments?select=*&order=created_at.asc'),
    ]);

    const rawSettings = settingsRows?.[0]?.data || {};
    const defaultSettings = defaultDb?.settings || {};
    const settingsData = {
      ...defaultSettings,
      ...rawSettings,
      // An empty list is a deliberate choice by the admin; never refill it from defaults.
      allowedOfficeIps: Array.isArray(rawSettings.allowedOfficeIps)
        ? rawSettings.allowedOfficeIps
        : defaultSettings.allowedOfficeIps || [],
      // An ISP name never grants access.
      allowedOfficeIsps: [],
      enforceOfficeIpLock: rawSettings.enforceOfficeIpLock ?? true,
      enforceDeviceBinding: false,
    };
    let shifts = Array.isArray(shiftsRows) && shiftsRows.length > 0 ? shiftsRows.map(mapDbShift) : defaultDb.shifts;
    if (!shifts.some((s) => s.id === 'shift-freelance')) {
      shifts.push({
        id: 'shift-freelance',
        name: 'I.T & Freelance Shift (No Restriction / 24/7)',
        startTime: '00:00',
        endTime: '23:59',
        workDays: [0, 1, 2, 3, 4, 5, 6],
        graceMinutes: 1440,
        expectedHours: 8,
        color: 'purple',
        isActive: true,
        isNoRestriction: true,
      });
    }
    const employees = Array.isArray(empRows) ? empRows.map(mapDbEmployee) : defaultDb.employees;
    const attendance = Array.isArray(attRows) ? attRows.map(mapDbAttendance) : [];
    const leaves = Array.isArray(leavesRows) ? leavesRows.map(mapDbLeave) : [];
    const ceoComments = Array.isArray(commentsRows) ? commentsRows.map(mapDbComment) : [];

    let maxUpdatedMs = 0;
    const checkMax = (iso) => {
      if (!iso) return;
      const ms = Date.parse(iso);
      if (!Number.isNaN(ms) && ms > maxUpdatedMs) maxUpdatedMs = ms;
    };
    checkMax(rawSettings?.settingsUpdatedAt || settingsRows?.[0]?.updated_at);
    if (Array.isArray(empRows)) empRows.forEach(r => checkMax(r.record_updated_at || r.created_at));
    if (Array.isArray(attRows)) attRows.forEach(r => checkMax(r.record_updated_at || r.created_at || r.admin_override_at));
    if (Array.isArray(leavesRows)) leavesRows.forEach(r => checkMax(r.record_updated_at || r.applied_at || r.reviewed_at));
    if (Array.isArray(commentsRows)) commentsRows.forEach(r => checkMax(r.updated_at || r.created_at));

    const latestDbUpdatedAt = maxUpdatedMs > 0 ? new Date(maxUpdatedMs).toISOString() : new Date().toISOString();

    return {
      version: '1.0',
      updatedAt: latestDbUpdatedAt,
      settings: settingsData,
      shifts,
      employees,
      attendance,
      leaves,
      ceoComments,
    };
  } catch (err) {
    console.error('Failed to read from Supabase:', err);
    throw err;
  }
}

/**
 * Intelligent, atomic merge for an individual attendance record against existing Supabase record
 */
export function mergeSupabaseAttendanceRecord(existing, incomingRec, options = {}) {
  const actorRole = options.actorRole || incomingRec.lastEditedByRole || 'employee';
  const isAdmin = actorRole === 'admin';
  const nowIso = new Date().toISOString();

  if (!existing) {
    const fresh = { ...incomingRec };
    if (fresh.clearTimeOut) {
      delete fresh.timeOut;
      delete fresh.clearTimeOut;
    }
    fresh.recordUpdatedAt = nowIso;
    fresh.lastEditedByRole = actorRole;
    return fresh;
  }

  const existingHasAdminOverride = Boolean(existing.adminOverrideAt);
  const isTimeOutAction = incomingRec.actorAction === 'time_out' || (incomingRec.timeOut !== undefined && incomingRec.timeOut !== null && incomingRec.timeOut !== '');
  const isBreakAction = incomingRec.actorAction === 'start_break' || incomingRec.actorAction === 'end_break';
  const isNoteAction = incomingRec.actorAction === 'update_note';
  const isFreshPunchIn = incomingRec.actorAction === 'time_in' && !existing.timeIn && Boolean(incomingRec.timeIn);

  // If Admin edited the record, only allow fresh employee actions (punch out, breaks, notes)
  // Do NOT let non-admin stale writes overwrite Admin punch times
  if (existingHasAdminOverride && !isAdmin) {
    if (!isTimeOutAction && !isBreakAction && !isNoteAction && !isFreshPunchIn) {
      return {
        ...existing,
        lastHeartbeatAt: incomingRec.lastHeartbeatAt || existing.lastHeartbeatAt,
        lastActivityAt: incomingRec.lastActivityAt || existing.lastActivityAt,
        connectionStatus: incomingRec.connectionStatus || existing.connectionStatus,
      };
    }
  }

  const shouldClearTimeOut = Boolean(
    incomingRec.clearTimeOut ||
    incomingRec.adminKeepOpen ||
    (isAdmin && (incomingRec.timeOut === null || incomingRec.timeOut === ''))
  );
  const shouldClearTimeIn = Boolean(isAdmin && incomingRec.timeIn === '');

  // Determine final timeIn
  let finalTimeIn = existing.timeIn;
  if (shouldClearTimeIn) {
    finalTimeIn = null;
  } else if (incomingRec.timeIn) {
    if (isAdmin || (!existing.timeIn && incomingRec.actorAction === 'time_in') || (!existingHasAdminOverride && incomingRec.actorAction === 'time_in')) {
      finalTimeIn = incomingRec.timeIn;
    }
  }

  // Determine final timeOut
  let finalTimeOut = existing.timeOut;
  if (shouldClearTimeOut) {
    finalTimeOut = null;
  } else if (incomingRec.timeOut !== undefined && incomingRec.timeOut !== null && incomingRec.timeOut !== '') {
    // Non-admins can punch out, but cannot rewrite an existing punch-out time.
    const mayChangeTimeOut = isAdmin || !existing.timeOut || incomingRec.actorAction === 'time_out' || incomingRec.actorAction === 'auto_close';
    if (mayChangeTimeOut) finalTimeOut = incomingRec.timeOut;
  }

  // Determine breaks
  let finalBreaks = existing.breaks || [];
  if (Array.isArray(incomingRec.breaks)) {
    if (isAdmin || incomingRec.breaks.length > 0 || isBreakAction) {
      finalBreaks = incomingRec.breaks;
    }
  }

  // Determine status
  let finalStatus = existing.status || 'absent';
  if (shouldClearTimeIn) {
    finalStatus = 'absent';
  } else if (incomingRec.status && incomingRec.status !== 'absent') {
    finalStatus = incomingRec.status;
  } else if (finalTimeIn && finalStatus === 'absent') {
    finalStatus = 'present';
  }

  const merged = {
    ...existing,
    ...incomingRec,
    timeIn: finalTimeIn,
    timeOut: finalTimeOut,
    breaks: finalBreaks,
    status: finalStatus,
    notes: incomingRec.notes !== undefined ? incomingRec.notes : existing.notes,
    deviceId: incomingRec.deviceId || existing.deviceId,
    deviceName: incomingRec.deviceName || existing.deviceName,
    isDeviceMismatch: incomingRec.isDeviceMismatch !== undefined ? Boolean(incomingRec.isDeviceMismatch) : Boolean(existing.isDeviceMismatch),
    isAutoPunchedOut: shouldClearTimeOut ? false : (incomingRec.isAutoPunchedOut !== undefined ? Boolean(incomingRec.isAutoPunchedOut) : Boolean(existing.isAutoPunchedOut)),
    adminVerification: incomingRec.adminVerification !== undefined ? incomingRec.adminVerification : existing.adminVerification,
    accountsVerification: incomingRec.accountsVerification !== undefined ? incomingRec.accountsVerification : existing.accountsVerification,
    adminOverrideAt: isAdmin ? (incomingRec.adminOverrideAt || nowIso) : existing.adminOverrideAt,
    adminKeepOpen: shouldClearTimeOut
      ? Boolean(!shouldClearTimeIn && finalTimeIn)
      : (incomingRec.adminKeepOpen !== undefined ? Boolean(incomingRec.adminKeepOpen) : Boolean(existing.adminKeepOpen)),
    lastEditedByRole: actorRole,
    recordUpdatedAt: nowIso,
  };

  delete merged.clearTimeOut;
  return merged;
}

// ---------------------------------------------------------------------------
// Office network lock, enforced on the SERVER (the browser check alone can be skipped).
// A write counts as a "punch" when it adds or changes a punch-in time, punch-out time or breaks.
// Heartbeats, verification stamps and admin notes never trigger the check.
// ---------------------------------------------------------------------------
function readJson(v, fallback) {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch (_) { return fallback; }
  }
  return v;
}

function punchFieldsChanged(existing, rec) {
  if (!existing) return Boolean(rec.timeIn || rec.timeOut);
  const brk = (r) => JSON.stringify(r.breaks || []);
  return (
    (rec.timeIn || '') !== (existing.timeIn || '') && Boolean(rec.timeIn) ||
    (rec.timeOut || '') !== (existing.timeOut || '') && Boolean(rec.timeOut) ||
    (Array.isArray(rec.breaks) && brk(rec) !== brk(existing))
  );
}

async function enforceOfficeNetworkForPunch(existing, rec, actorRole, clientIps) {
  if (!Array.isArray(clientIps)) return; // internal callers (auto-punch checks its own IP)
  if (!punchFieldsChanged(existing, rec)) return;

  const setRows = await supabaseFetch('/settings?id=eq.current&select=data');
  const settings = readJson(setRows?.[0]?.data, {}) || {};
  if (!settings.enforceOfficeIpLock) return;
  if (actorRole === 'admin' && (settings.allowAdminBypassIpLock ?? true)) return;

  const empRows = await supabaseFetch(
    `/employees?id=eq.${encodeURIComponent(rec.employeeId || existing?.employeeId || '')}&select=role,pending_device_request`
  );
  const wfh = Boolean(readJson(empRows?.[0]?.pending_device_request, null)?.allowWorkFromHome);
  const verdict = checkOfficeNetwork({ settings, employee: { allowWorkFromHome: wfh }, ips: clientIps });
  if (!verdict.allowed) {
    const err = new Error(verdict.reason || 'You are not on the office network.');
    err.status = 403;
    err.code = verdict.code || 'OUTSIDE_OFFICE_NETWORK';
    throw err;
  }
}

/**
 * High-security face scan: when the admin turned it on, a punch for an employee with an
 * enrolled face must carry a valid, unexpired "face pass" issued by /api/face for that employee.
 */
async function enforceFacePassForPunch(existing, rec, actorRole, ctx) {
  if (!Array.isArray(ctx.clientIps)) return; // internal callers
  if (!punchFieldsChanged(existing, rec)) return;
  const setRows = await supabaseFetch('/settings?id=eq.current&select=data');
  const settings = readJson(setRows?.[0]?.data, {}) || {};
  if (!settings.faceScanPunchEnabled) return;
  const isDirectPunchAction = ['time_in', 'time_out', 'start_break', 'end_break'].includes(rec.actorAction);
  if (actorRole === 'admin' && !isDirectPunchAction) return; // admin timesheet corrections on roster bypass face scan

  const employeeId = rec.employeeId || existing?.employeeId || '';
  const tplRows = await supabaseFetch(
    `/face_templates?employee_id=eq.${encodeURIComponent(employeeId)}&select=employee_id`
  );
  const enrolled = Boolean(tplRows?.[0]);
  if (!enrolled) {
    if (settings.faceScanAllowUnenrolled ?? true) return;
    const err = new Error('Face scan is required but your face is not enrolled yet. Ask the administrator to enroll you.');
    err.status = 403;
    err.code = 'FACE_NOT_ENROLLED';
    throw err;
  }
  const token = ctx.facePasses && typeof ctx.facePasses === 'object' ? ctx.facePasses[employeeId] : undefined;
  if (!verifyFacePass(token, employeeId)) {
    const err = new Error('Face scan required (or it expired). Please scan your face and try again.');
    err.status = 403;
    err.code = 'FACE_REQUIRED';
    throw err;
  }
}

/**
 * Applies a mutation payload directly to Supabase with ACID UPSERT / Soft-Delete
 */
const ADMIN_ONLY_SCOPES = new Set([
  'employee_delete', 'employees', 'shifts', 'settings', 'attendance_delete', 'leave_delete',
  'legacy_bulk', 'full_restore',
]);

function denied(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

/**
 * Who is really calling? The browser's claim ("I am admin") is checked against the signed-in
 * session when present, while allowing attendance verifications and punches to preserve their role.
 */
function authorizeExternalMutation(incoming, ctx) {
  const scope = incoming.scope || 'legacy_bulk';
  const actor = ctx.actor || null;
  const isAdmin = actor?.role === 'admin';
  const needSignIn = () => denied(403, 'SESSION_REQUIRED', 'Please sign in again to make this change.');
  const forbidden = () => denied(403, 'FORBIDDEN', 'Only an administrator can make this change.');

  if (ADMIN_ONLY_SCOPES.has(scope) && !isAdmin) throw actor ? forbidden() : needSignIn();

  if (scope === 'employee_upsert' && !isAdmin) {
    if (!actor) throw needSignIn();
    const emp = incoming.employee || incoming.changedEmployee;
    if (!emp || emp.id !== actor.id) throw forbidden();
    // Staff may only file their own device-change request (never role, pay, PIN or status).
    const safe = {};
    if (emp.pendingDeviceRequest) safe.pendingDeviceRequest = emp.pendingDeviceRequest;
    incoming.employee = { id: actor.id, ...safe };
    delete incoming.changedEmployee;
    incoming.selfServiceOnly = true;
  }

  if ((scope === 'leaves') && !isAdmin) {
    if (!actor) throw needSignIn();
    const list = incoming.changedLeave ? [incoming.changedLeave] : incoming.leaves || [];
    if (!incoming.changedLeave || list.some((l) => l?.employeeId !== actor.id)) throw forbidden();
    incoming.leaveRequestOnly = true;
  }

  if (scope === 'ceoComments' && !isAdmin && actor?.role !== 'ceo') {
    if (!actor) throw needSignIn();
    const c = incoming.changedComment;
    if (!c || c.employeeId !== actor.id) throw forbidden();
    incoming.changedComment = undefined;
    incoming.ceoComments = [];
  }

  // The role always comes from the server's own record of the signed-in person, never from the browser's claim.
  incoming.actorRole = actor?.role || 'employee';

  if (scope === 'attendance') {
    // Every attendance record is stamped with the server-known role (the browser's "lastEditedByRole" is ignored),
    // and only administrators, accounts and CEO accounts can write verification marks or lock a record.
    const role = incoming.actorRole;
    const isVerifier = role === 'admin' || role === 'accounts' || role === 'ceo';
    const list = incoming.changedRecords || (incoming.changedRecord ? [incoming.changedRecord] : incoming.attendance || []);
    for (const rec of list) {
      if (!rec || typeof rec !== 'object') continue;
      rec.lastEditedByRole = role;
      if (!isVerifier) {
        delete rec.adminVerification;
        delete rec.accountsVerification;
      }
      if (role !== 'admin') delete rec.adminOverrideAt;
    }
  }
}

export async function mutateSupabaseDb(incoming, defaultDb, ctx = {}) {
  if (Array.isArray(ctx.clientIps)) authorizeExternalMutation(incoming, ctx);
  const scope = incoming.scope || 'legacy_bulk';

  if (scope === 'attendance') {
    const records = incoming.changedRecords || (incoming.changedRecord ? [incoming.changedRecord] : incoming.attendance || []);
    if (records.length > 0) {
      const rowsToUpsert = [];
      for (const rec of records) {
        if (!rec || !rec.id) continue;
        const existingRows = await supabaseFetch(`/attendance?id=eq.${encodeURIComponent(rec.id)}&select=*`);
        const existing = existingRows?.[0] ? mapDbAttendance(existingRows[0]) : null;

        await enforceOfficeNetworkForPunch(existing, rec, incoming.actorRole, ctx.clientIps);
        await enforceFacePassForPunch(existing, rec, incoming.actorRole, ctx);
        const mergedRec = mergeSupabaseAttendanceRecord(existing, rec, { actorRole: incoming.actorRole });
        rowsToUpsert.push(mapAppAttendanceToDb(mergedRec));
      }

      if (rowsToUpsert.length > 0) {
        await supabaseFetch('/attendance', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify(rowsToUpsert),
        });
      }
    }
  } else if (scope === 'attendance_delete') {
    const targetId = incoming.attendanceId || incoming.id;
    if (targetId) {
      await supabaseFetch(`/attendance?id=eq.${encodeURIComponent(targetId)}`, {
        method: 'DELETE',
      });
    }
  } else if (scope === 'employee_upsert' || scope === 'employees') {
    const emp = incoming.employee || incoming.changedEmployee;
    if (emp) {
      const targetId = emp.id;
      const existingRows = await supabaseFetch(`/employees?id=eq.${encodeURIComponent(targetId)}&select=*`);
      const existing = existingRows?.[0] ? mapDbEmployee(existingRows[0]) : null;

      if (incoming.selfServiceOnly && !existing) throw denied(403, 'FORBIDDEN', 'Employee not found.');
      let mergedEmp = emp;
      if (existing) {
        mergedEmp = {
          ...existing,
          ...emp,
        };
        if (incoming.allowClearDevice) {
          mergedEmp.registeredDeviceId = undefined;
          mergedEmp.registeredDeviceName = undefined;
          mergedEmp.registeredAt = undefined;
          mergedEmp.deviceBoundApprovedBy = undefined;
          mergedEmp.deviceBoundApprovedAt = undefined;
        }
        if (incoming.clearPendingRequest) {
          mergedEmp.pendingDeviceRequest = undefined;
        }
      }
      mergedEmp.recordUpdatedAt = new Date().toISOString();
      if (incoming.actorRole) {
        mergedEmp.lastEditedByRole = incoming.actorRole;
      }
      const row = mapAppEmployeeToDb(mergedEmp);
      await supabaseFetch('/employees', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify([row]),
      });
    } else if (Array.isArray(incoming.employees) && incoming.employees.length > 0) {
      const rows = incoming.employees.map(mapAppEmployeeToDb);
      await supabaseFetch('/employees', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(rows),
      });
    }
  } else if (scope === 'employee_delete') {
    const targetId = incoming.deletedEmployeeId || incoming.employeeId;
    if (targetId && targetId !== 'emp-101') {
      await supabaseFetch(`/employees?id=eq.${encodeURIComponent(targetId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ deleted_at: new Date().toISOString(), is_active: false }),
      });
    }
  } else if (scope === 'leaves') {
    const leavesList = incoming.changedLeave ? [incoming.changedLeave] : incoming.leaves || [];
    const rowsToUpsert = [];
    for (const l of leavesList) {
      if (!l || !l.id) continue;
      const existingRows = await supabaseFetch(`/leaves?id=eq.${encodeURIComponent(l.id)}&select=*`);
      const existing = existingRows?.[0] ? mapDbLeave(existingRows[0]) : null;

      if (existing) {
        const existingHasAdminDecision =
          existing.lastEditedByRole === 'admin' ||
          Boolean(existing.reviewedBy) ||
          existing.status === 'approved' ||
          existing.status === 'rejected';

        // An employee device CAN NEVER revert or overwrite an admin's decision!
        if (existingHasAdminDecision && incoming.actorRole !== 'admin') {
          console.warn(`[Supabase Leaves] Protected leave ${l.id} against employee overwrite.`);
          continue;
        }

        const incMs = Date.parse(l.recordUpdatedAt || '') || Date.now();
        const existingMs = Date.parse(existing.recordUpdatedAt || '') || 0;
        if (incoming.actorRole !== 'admin' && existingMs > 0 && incMs < existingMs) {
          console.warn(`[Supabase Leaves] Ignored older revision for leave ${l.id}.`);
          continue;
        }
      }

      const mergedLeave = {
        ...(existing || {}),
        ...l,
        recordUpdatedAt: new Date().toISOString(),
      };
      if (incoming.leaveRequestOnly && !existing) {
        // A staff member can only ask: approval is an administrator's decision.
        mergedLeave.status = 'pending';
        mergedLeave.reviewedBy = undefined;
        mergedLeave.reviewedAt = undefined;
      }
      if (incoming.actorRole) {
        mergedLeave.lastEditedByRole = incoming.actorRole;
      }
      rowsToUpsert.push(mapAppLeaveToDb(mergedLeave));
    }

    if (rowsToUpsert.length > 0) {
      await supabaseFetch('/leaves', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(rowsToUpsert),
      });
    }
  } else if (scope === 'leave_delete') {
    const targetId = incoming.leaveId || incoming.id;
    if (targetId) {
      await supabaseFetch(`/leaves?id=eq.${encodeURIComponent(targetId)}`, {
        method: 'DELETE',
      });
    }
  } else if (scope === 'shifts') {
    if (Array.isArray(incoming.shifts) && incoming.shifts.length > 0) {
      const rows = incoming.shifts.map(mapAppShiftToDb);
      await supabaseFetch('/shifts', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(rows),
      });
    }
  } else if (scope === 'settings') {
    if (incoming.settings) {
      await supabaseFetch('/settings', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify([
          {
            id: 'current',
            data: { ...incoming.settings, enforceDeviceBinding: false },
            updated_at: new Date().toISOString(),
          },
        ]),
      });
    }
  } else if (scope === 'ceoComments') {
    const comments = incoming.changedComment ? [incoming.changedComment] : incoming.ceoComments || [];
    if (comments.length > 0) {
      const rows = comments.map(mapAppCommentToDb);
      await supabaseFetch('/ceo_comments', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(rows),
      });
    }
  } else if (scope === 'legacy_bulk' || scope === 'full_restore') {
    if (Array.isArray(incoming.employees) && incoming.employees.length > 0) {
      const rows = incoming.employees.map(mapAppEmployeeToDb);
      await supabaseFetch('/employees', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(rows),
      });
    }
    if (Array.isArray(incoming.attendance) && incoming.attendance.length > 0) {
      const rows = incoming.attendance.map(mapAppAttendanceToDb);
      await supabaseFetch('/attendance', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(rows),
      });
    }
    if (Array.isArray(incoming.leaves) && incoming.leaves.length > 0) {
      const rows = incoming.leaves.map(mapAppLeaveToDb);
      await supabaseFetch('/leaves', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(rows),
      });
    }
    if (Array.isArray(incoming.shifts) && incoming.shifts.length > 0) {
      const rows = incoming.shifts.map(mapAppShiftToDb);
      await supabaseFetch('/shifts', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(rows),
      });
    }
    if (incoming.settings) {
      await supabaseFetch('/settings', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify([
          {
            id: 'current',
            data: { ...incoming.settings, enforceDeviceBinding: false },
            updated_at: new Date().toISOString(),
          },
        ]),
      });
    }
  }

  // Return the fresh database state
  const updatedDb = await readSupabaseDb(defaultDb);
  return {
    ok: true,
    status: 200,
    db: updatedDb,
  };
}
