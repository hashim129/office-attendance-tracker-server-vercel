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
// jsonb-safe reader: values previously saved as JSON *strings* are parsed back.
function readJson(v, fallback) {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch (_) { return fallback; }
  }
  return v;
}

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
    pin: r.pin || '1234',
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
    deviceChangeHistory: (() => { const v = readJson(r.device_change_history, []); return Array.isArray(v) ? v : []; })(),
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
    pin: e.pin || '1234',
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
    device_change_history: e.deviceChangeHistory || [],
    pending_device_request: pendingWithWfh,
    record_updated_at: e.recordUpdatedAt || new Date().toISOString(),
    last_edited_by_role: e.lastEditedByRole || 'admin',
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
  const breaks = (() => { const v = readJson(r.breaks, []); return Array.isArray(v) ? v : []; })();
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
    adminVerification: readJson(r.admin_verification, undefined) || undefined,
    accountsVerification: readJson(r.accounts_verification, undefined) || undefined,
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
    breaks: a.breaks || [],
    device_id: a.deviceId || a.device_id || null,
    device_name: a.deviceName || a.device_name || null,
    is_device_mismatch: Boolean(a.isDeviceMismatch ?? a.is_device_mismatch),
    is_auto_punched_out: Boolean(a.isAutoPunchedOut ?? a.is_auto_punched_out),
    auto_punch_out_reason: a.autoPunchOutReason || a.auto_punch_out_reason || null,
    disconnected_at: a.disconnectedAt || a.disconnected_at || null,
    monitoring_paused: Boolean(a.monitoringPaused ?? a.monitoring_paused),
    admin_verification: a.adminVerification || readJson(a.admin_verification, null) || null,
    accounts_verification: a.accountsVerification || readJson(a.accounts_verification, null) || null,
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
    workDays: (() => { const v = readJson(r.work_days, null); return Array.isArray(v) ? v : [0, 1, 2, 3, 4, 5, 6]; })(),
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
    work_days: s.workDays || [1, 2, 3, 4, 5],
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
    comment: c.comment || '',
    author_name: c.authorName || '',
    created_at: c.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Loads entire database from Supabase PostgreSQL tables
 */
// PostgREST returns at most ~1000 rows per request; page through everything.
async function fetchAllPages(path, pageSize = 1000, maxPages = 50) {
  const all = [];
  for (let i = 0; i < maxPages; i++) {
    const from = i * pageSize;
    const to = from + pageSize - 1;
    const rows = await supabaseFetch(path, { headers: { Range: `${from}-${to}`, 'Range-Unit': 'items' } });
    if (!Array.isArray(rows)) break;
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}

export async function readSupabaseDb(defaultDb) {
  try {
    const [settingsRows, shiftsRows, empRows, attRows, leavesRows, commentsRows] = await Promise.all([
      supabaseFetch('/settings?id=eq.current&select=*'),
      supabaseFetch('/shifts?select=*&order=id.asc'),
      supabaseFetch('/employees?deleted_at=is.null&select=*&order=employee_code.asc'),
      fetchAllPages('/attendance?select=*&order=date.desc,id.asc'),
      supabaseFetch('/leaves?deleted_at=is.null&select=*&order=applied_at.desc'),
      supabaseFetch('/ceo_comments?select=*&order=created_at.asc'),
    ]);

    const rawSettings = settingsRows?.[0]?.data || {};
    const defaultSettings = defaultDb?.settings || {};
    const settingsData = {
      ...defaultSettings,
      ...rawSettings,
      allowedOfficeIps:
        Array.isArray(rawSettings.allowedOfficeIps) && rawSettings.allowedOfficeIps.length > 0
          ? rawSettings.allowedOfficeIps
          : defaultSettings.allowedOfficeIps || [],
      allowedOfficeIsps:
        Array.isArray(rawSettings.allowedOfficeIsps) && rawSettings.allowedOfficeIsps.length > 0
          ? rawSettings.allowedOfficeIsps
          : defaultSettings.allowedOfficeIsps || [],
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
  const actorRole = incomingRec.lastEditedByRole || options.actorRole || 'employee';
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
    finalTimeOut = incomingRec.timeOut;
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

// Deleted employees are soft-deleted (tombstoned). A stale browser tab, device or queued
// request must never resurrect them, so writes for tombstoned ids are dropped.
async function dropDeletedEmployeeRows(rows) {
  const ids = rows.map((r) => r && r.id).filter(Boolean);
  if (ids.length === 0) return rows;
  const list = ids.map((i) => `"${String(i).replace(/"/g, '')}"`).join(',');
  const dead = await supabaseFetch(`/employees?id=in.(${encodeURIComponent(list)})&deleted_at=not.is.null&select=id`);
  const deadIds = new Set(Array.isArray(dead) ? dead.map((d) => d.id) : []);
  return rows.filter((r) => !deadIds.has(r.id));
}

/**
 * Applies a mutation payload directly to Supabase with ACID UPSERT / Soft-Delete
 */
export async function mutateSupabaseDb(incoming, defaultDb) {
  const scope = incoming.scope || 'legacy_bulk';

  if (scope === 'attendance') {
    const records = incoming.changedRecords || (incoming.changedRecord ? [incoming.changedRecord] : incoming.attendance || []);
    if (records.length > 0) {
      const rowsToUpsert = [];
      for (const rec of records) {
        if (!rec || !rec.id) continue;
        const existingRows = await supabaseFetch(`/attendance?id=eq.${encodeURIComponent(rec.id)}&select=*`);
        const existing = existingRows?.[0] ? mapDbAttendance(existingRows[0]) : null;

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
      const liveRows = await dropDeletedEmployeeRows([row]);
      if (liveRows.length > 0) {
        await supabaseFetch('/employees', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify(liveRows),
        });
      }
    } else if (Array.isArray(incoming.employees) && incoming.employees.length > 0) {
      const rows = await dropDeletedEmployeeRows(incoming.employees.map(mapAppEmployeeToDb));
      await supabaseFetch('/employees', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(rows),
      });
    }
  } else if (scope === 'employee_delete') {
    const targetId = incoming.deletedEmployeeId || incoming.employeeId;
    if (targetId) {
      // Safety: never delete the last active administrator (nobody could log in to manage the system).
      const rows = await supabaseFetch(`/employees?deleted_at=is.null&is_active=eq.true&role=eq.admin&select=id`);
      const otherAdmins = (Array.isArray(rows) ? rows : []).filter((r) => r.id !== targetId);
      const targetRows = await supabaseFetch(`/employees?id=eq.${encodeURIComponent(targetId)}&select=role`);
      if (targetRows?.[0]?.role === 'admin' && otherAdmins.length === 0) {
        const err = new Error('You cannot delete the last active administrator. Create or promote another admin first.');
        err.status = 409;
        throw err;
      }
      await supabaseFetch(`/employees?id=eq.${encodeURIComponent(targetId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ deleted_at: new Date().toISOString(), record_updated_at: new Date().toISOString(), is_active: false }),
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
      const rows = await dropDeletedEmployeeRows(incoming.employees.map(mapAppEmployeeToDb));
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
