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

async function supabaseFetch(endpoint, options = {}) {
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

/**
 * Maps PostgreSQL snake_case columns back to application camelCase objects
 */
function mapDbEmployee(r) {
  if (!r) return null;
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
    registeredDeviceId: r.registered_device_id || undefined,
    registeredDeviceName: r.registered_device_name || undefined,
    registeredAt: r.registered_at || undefined,
    deviceBoundApprovedBy: r.device_bound_approved_by || undefined,
    deviceBoundApprovedAt: r.device_bound_approved_at || undefined,
    deviceChangeHistory: Array.isArray(r.device_change_history) ? r.device_change_history : [],
    pendingDeviceRequest: r.pending_device_request || undefined,
    recordUpdatedAt: r.record_updated_at || undefined,
    lastEditedByRole: r.last_edited_by_role || undefined,
  };
}

function mapAppEmployeeToDb(e) {
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
    device_change_history: JSON.stringify(e.deviceChangeHistory || []),
    pending_device_request: e.pendingDeviceRequest ? JSON.stringify(e.pendingDeviceRequest) : null,
    record_updated_at: e.recordUpdatedAt || new Date().toISOString(),
    last_edited_by_role: e.lastEditedByRole || 'admin',
    deleted_at: null,
  };
}

function mapDbAttendance(r) {
  if (!r) return null;
  const out = {
    id: r.id,
    employeeId: r.employee_id,
    date: r.date,
    timeIn: r.time_in || '',
    status: r.status || 'absent',
    notes: r.notes || '',
    breaks: Array.isArray(r.breaks) ? r.breaks : [],
    deviceId: r.device_id || '',
    deviceName: r.device_name || '',
    isDeviceMismatch: Boolean(r.is_device_mismatch),
    isAutoPunchedOut: Boolean(r.is_auto_punched_out),
    monitoringPaused: Boolean(r.monitoring_paused),
    adminVerification: r.admin_verification || undefined,
    accountsVerification: r.accounts_verification || undefined,
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
    employee_id: a.employeeId,
    date: a.date,
    time_in: a.timeIn || null,
    time_out: a.timeOut || null,
    status: a.status || 'absent',
    notes: a.notes || '',
    breaks: JSON.stringify(a.breaks || []),
    device_id: a.deviceId || null,
    device_name: a.deviceName || null,
    is_device_mismatch: Boolean(a.isDeviceMismatch),
    is_auto_punched_out: Boolean(a.isAutoPunchedOut),
    auto_punch_out_reason: a.autoPunchOutReason || null,
    disconnected_at: a.disconnectedAt || null,
    monitoring_paused: Boolean(a.monitoringPaused),
    admin_verification: a.adminVerification ? JSON.stringify(a.adminVerification) : null,
    accounts_verification: a.accountsVerification ? JSON.stringify(a.accountsVerification) : null,
    last_heartbeat_at: a.lastHeartbeatAt || null,
    last_activity_at: a.lastActivityAt || null,
    record_updated_at: a.recordUpdatedAt || new Date().toISOString(),
    last_edited_by_role: a.lastEditedByRole || 'employee',
    admin_override_at: a.adminOverrideAt || null,
    admin_keep_open: Boolean(a.adminKeepOpen),
  };
}

function mapDbLeave(r) {
  if (!r) return null;
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
    adminNote: r.admin_note || undefined,
    recordUpdatedAt: r.record_updated_at || undefined,
    lastEditedByRole: r.last_edited_by_role || undefined,
  };
}

function mapAppLeaveToDb(l) {
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
    reviewed_at: l.reviewedAt || null,
    admin_note: l.adminNote || null,
    record_updated_at: l.recordUpdatedAt || new Date().toISOString(),
    last_edited_by_role: l.lastEditedByRole || 'employee',
    deleted_at: null,
  };
}

function mapDbShift(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    startTime: r.start_time,
    endTime: r.end_time,
    workDays: Array.isArray(r.work_days) ? r.work_days : [1, 2, 3, 4, 5],
    graceMinutes: Number(r.grace_minutes) || 15,
    expectedHours: Number(r.expected_hours) || 8,
    color: r.color || 'blue',
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

    const settingsData = settingsRows?.[0]?.data || defaultDb.settings;
    const shifts = Array.isArray(shiftsRows) && shiftsRows.length > 0 ? shiftsRows.map(mapDbShift) : defaultDb.shifts;
    const employees = Array.isArray(empRows) ? empRows.map(mapDbEmployee) : defaultDb.employees;
    const attendance = Array.isArray(attRows) ? attRows.map(mapDbAttendance) : [];
    const leaves = Array.isArray(leavesRows) ? leavesRows.map(mapDbLeave) : [];
    const ceoComments = Array.isArray(commentsRows) ? commentsRows.map(mapDbComment) : [];

    return {
      version: '1.0',
      updatedAt: new Date().toISOString(),
      settings: {
        ...settingsData,
        enforceDeviceBinding: false,
      },
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
 * Applies a mutation payload directly to Supabase with ACID UPSERT / Soft-Delete
 */
export async function mutateSupabaseDb(incoming, defaultDb) {
  const scope = incoming.scope || 'legacy_bulk';

  if (scope === 'attendance') {
    const records = incoming.changedRecords || (incoming.changedRecord ? [incoming.changedRecord] : incoming.attendance || []);
    if (records.length > 0) {
      const rows = records.map(mapAppAttendanceToDb);
      await supabaseFetch('/attendance', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(rows),
      });
    }
  } else if (scope === 'employee_upsert') {
    if (incoming.employee) {
      const row = mapAppEmployeeToDb(incoming.employee);
      await supabaseFetch('/employees', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify([row]),
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
    if (leavesList.length > 0) {
      const rows = leavesList.map(mapAppLeaveToDb);
      await supabaseFetch('/leaves', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(rows),
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
