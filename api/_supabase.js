import { checkOfficeNetwork } from './_netmatch.js';
import { verifyFacePass } from './_face.js';
import { CHARACTER_IDS } from '../src/lib/universeCharacters.js';
/**
 * Supabase (PostgreSQL) REST Adapter
 * Provides zero-dependency, atomic cloud database persistence via Supabase PostgREST API.
 * Eliminates GitHub Gist rate limits, write mutex contention, and ephemeral file wiping.
 */

import { pushNotificationRows } from './_push.js';

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
  const crmCustomerAccess = Boolean(pendingObj?.crmCustomerAccess);
  const salesAccess = Boolean(pendingObj?.salesAccess);
  const customerPortalAccess = Boolean(pendingObj?.customerPortalAccess);
  const liveDashboardAccess = Boolean(pendingObj?.liveDashboardAccess);
  const leaderboardAccess = Boolean(pendingObj?.leaderboardAccess);
  const payablesAccess = Boolean(pendingObj?.payablesAccess);
  const mediaTeam = Boolean(pendingObj?.mediaTeam);
  const salesTeam = ['B2C', 'B2B'].includes(pendingObj?.salesTeam) ? pendingObj.salesTeam : '';
  const salesTeamHead = Boolean(salesTeam && pendingObj?.salesTeamHead);
  const birthday = /^\d{4}-\d{2}-\d{2}$/.test(String(pendingObj?.birthday || '')) ? String(pendingObj.birthday) : '';
  const faceEnrollRequired = Boolean(pendingObj?.faceEnrollRequired);
  const locationCheck = Boolean(pendingObj?.locationCheck);

  return {
    id: r.id,
    employeeCode: r.employee_code,
    name: r.name,
    email: r.email || '',
    role: r.role === 'superadmin' ? 'admin' : (r.role || 'employee'),
    isSuperAdmin: r.role === 'superadmin',
    featureAccess: r.page_access && typeof r.page_access === 'object' ? r.page_access : undefined,
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
    crmCustomerAccess,
    salesAccess,
    customerPortalAccess,
    liveDashboardAccess,
    leaderboardAccess,
    payablesAccess,
    mediaTeam,
    salesTeam,
    salesTeamHead,
    birthday,
    faceEnrollRequired,
    locationCheck,
    avatarAppearance: r.avatar_appearance || undefined,
    gameCharacterId: CHARACTER_IDS.has(r.game_character_id || pendingObj?.gameCharacterId) ? (r.game_character_id || pendingObj?.gameCharacterId) : undefined,
    gamePetId: ['cat','dog','rabbit','owl','hamster','parrot','turtle'].includes(r.game_pet_id || pendingObj?.gamePetId) ? (r.game_pet_id || pendingObj?.gamePetId) : undefined,
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
    ...(e.__keepSignOutBefore ? { signOutBefore: e.__keepSignOutBefore } : {}),
    allowWorkFromHome: Boolean(e.allowWorkFromHome),
    crmCustomerAccess: Boolean(e.crmCustomerAccess),
    salesAccess: Boolean(e.salesAccess),
    customerPortalAccess: Boolean(e.customerPortalAccess),
    liveDashboardAccess: Boolean(e.liveDashboardAccess),
    leaderboardAccess: Boolean(e.leaderboardAccess),
    payablesAccess: Boolean(e.payablesAccess),
    mediaTeam: Boolean(e.mediaTeam),
    salesTeam: ['B2C', 'B2B'].includes(e.salesTeam) ? e.salesTeam : '',
    salesTeamHead: Boolean(['B2C', 'B2B'].includes(e.salesTeam) && e.salesTeamHead),
    birthday: /^\d{4}-\d{2}-\d{2}$/.test(String(e.birthday || '')) ? String(e.birthday) : '',
    faceEnrollRequired: Boolean(e.faceEnrollRequired),
    locationCheck: Boolean(e.locationCheck),
    gameCharacterId: e.gameCharacterId || existingPending.gameCharacterId || null,
    gamePetId: e.gamePetId || existingPending.gamePetId || 'none',
  };

  return {
    id: e.id,
    employee_code: e.employeeCode || e.id,
    name: e.name,
    email: e.email || '',
    role: e.isSuperAdmin ? 'superadmin' : (e.role || 'employee'),
    department: e.department || '',
    designation: e.designation || '',
    shift_id: e.shiftId || 'shift-std',
    phone: e.phone || '',
    hourly_rate: Number(e.hourlyRate) || 0,
    is_active: e.isActive !== false,
    joined_date: e.joinedDate || null,
    avatar_seed: e.avatarSeed || '',
    game_character_id: e.gameCharacterId || null,
    game_pet_id: e.gamePetId || null,
    page_access: e.featureAccess || {},
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
    notesLog: Array.isArray(r.notes_log) ? r.notes_log : [],
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
    workMode: r.work_mode === 'wfh' ? 'wfh' : 'office',
    wfhReason: r.wfh_reason || '',
    unverifiedMinutes: Number(r.unverified_minutes) || 0,
  };
  const locs = readJson(r.punch_locations, null);
  if (locs && typeof locs === 'object') out.punchLocations = locs;
  if (r.work_confirmed_at) out.workConfirmedAt = r.work_confirmed_at;
  if (r.auto_out_at) out.autoOutAt = r.auto_out_at;
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
    notes_log: readJson(a.notesLog, []),
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
    work_mode: (a.workMode ?? a.work_mode) === 'wfh' ? 'wfh' : 'office',
    wfh_reason: (a.workMode ?? a.work_mode) === 'wfh' ? String(a.wfhReason ?? a.wfh_reason ?? '').slice(0, 300) : '',
    work_confirmed_at: a.workConfirmedAt || a.work_confirmed_at || null,
    auto_out_at: a.autoOutAt || a.auto_out_at || null,
    unverified_minutes: Math.max(0, Math.round(Number(a.unverifiedMinutes ?? a.unverified_minutes) || 0)),
    punch_locations: cleanPunchLocations(a.punchLocations ?? a.punch_locations),
  };
}

/** Phone punch locations: { in: {lat,lng,acc,dist,at}, out: {...} }. Anything malformed is dropped. */
function cleanPunchLocations(v) {
  const src = readJson(v, null);
  if (!src || typeof src !== 'object') return null;
  const out = {};
  for (const k of ['in', 'out']) {
    const p = src[k];
    if (!p || typeof p !== 'object') continue;
    const lat = Number(p.lat), lng = Number(p.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const item = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
    if (Number.isFinite(Number(p.acc))) item.acc = Math.round(Number(p.acc));
    if (Number.isFinite(Number(p.dist))) item.dist = Math.round(Number(p.dist));
    if (typeof p.at === 'string') item.at = p.at.slice(0, 40);
    if (p.outside === true) item.outside = true;
    out[k] = item;
  }
  return Object.keys(out).length ? out : null;
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
  // Older saves stored the JSON array as a JSON string inside jsonb. Parse both
  // representations so a weekday-only schedule never silently becomes 7 days.
  let parsedWorkDays = r.work_days;
  if (typeof parsedWorkDays === 'string') {
    try { parsedWorkDays = JSON.parse(parsedWorkDays); } catch { parsedWorkDays = null; }
  }
  const workDays = Array.isArray(parsedWorkDays)
    ? [...new Set(parsedWorkDays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    : [];
  return {
    id: r.id,
    name: r.name,
    startTime: r.start_time,
    endTime: r.end_time,
    workDays: isNoRestriction ? [0, 1, 2, 3, 4, 5, 6] : (workDays.length ? workDays : [1, 2, 3, 4, 5]),
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
    work_days: Array.isArray(s.workDays) ? [...new Set(s.workDays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))] : [1, 2, 3, 4, 5],
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
    employeeName: r.employee_name || '',
    fromName: r.author_name || '',
    fromRole: r.from_role || 'ceo',
    message: r.comment || '',
    date: r.date || '',
    isRead: Boolean(r.is_read),
    createdAt: r.created_at || undefined,
    updatedAt: r.updated_at || undefined,
  };
}

function mapAppCommentToDb(c) {
  return {
    id: c.id,
    record_id: c.recordId || '',
    employee_id: c.employeeId || '',
    employee_name: c.employeeName || '',
    date: (c.date || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
    comment: String(c.message ?? c.comment ?? ''),
    author_name: c.fromName || c.authorName || '',
    from_role: c.fromRole || 'ceo',
    is_read: Boolean(c.isRead),
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

    const parsedSettings = readJson(settingsRows?.[0]?.data, {});
    const rawSettings =
      parsedSettings && typeof parsedSettings === 'object' && !Array.isArray(parsedSettings)
        ? parsedSettings
        : {};
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
      customerPortalBetaEnabled: rawSettings.customerPortalBetaEnabled !== false,
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

let lastAutoCloseSweepAt = 0;

/**
 * Closes every punch that has passed "Shift End + auto-logout window", even if nobody has the portal open.
 * Called (at most once a minute per server instance) from the 45-second agent heartbeat and from portal requests.
 * `evaluate` is evaluateAttendancePresenceAndAutoClose (passed in to avoid a circular import).
 */
export async function sweepAutoClose(evaluate) {
  const nowMs = Date.now();
  if (nowMs - lastAutoCloseSweepAt < 60000) return 0;
  lastAutoCloseSweepAt = nowMs;
  try {
    const since = new Date(nowMs - 3 * 86400000).toISOString().slice(0, 10);
    const openRows = await supabaseFetch(`/attendance?time_out=is.null&time_in=not.is.null&date=gte.${since}&select=*`);
    if (!Array.isArray(openRows) || openRows.length === 0) return 0;
    const [settingsRows, shiftsRows, empRows] = await Promise.all([
      supabaseFetch('/settings?id=eq.current&select=*'),
      supabaseFetch('/shifts?select=*&order=id.asc'),
      supabaseFetch('/employees?deleted_at=is.null&select=*'),
    ]);
    const settings = { ...(settingsRows?.[0]?.data || {}) };
    const shifts = Array.isArray(shiftsRows) ? shiftsRows.map(mapDbShift) : [];
    const employees = Array.isArray(empRows) ? empRows.map(mapDbEmployee) : [];
    const original = openRows.map(mapDbAttendance);
    const { records } = evaluate(original, settings, employees, shifts);
    return await persistAutoClosures(original, records);
  } catch (e) {
    console.error('Auto-logout sweep failed:', e);
    return 0;
  }
}

/**
 * "Yes, I'm working": extends EVERY punch the employee still has open (an overnight session can sit on
 * yesterday's record while a new one exists for today), so the reminder that was asked about is the one extended.
 * Returns the updated rows.
 */
export async function confirmOpenWork(employeeId, at) {
  const since = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  const updated = await supabaseFetch(
    `/attendance?employee_id=eq.${encodeURIComponent(employeeId)}&time_out=is.null&time_in=not.is.null&date=gte.${since}&select=id,work_confirmed_at`,
    { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ work_confirmed_at: at, record_updated_at: at }) }
  );
  return Array.isArray(updated) ? updated : [];
}


/** Leave request alerts in the notification list. Never blocks saving the leave. */
async function sendLeaveAlerts(alerts) {
  if (!alerts.length) return;
  try {
    const people = (await supabaseFetch('/employees?deleted_at=is.null&select=id,name,role,is_active')) || [];
    const at = new Date().toISOString();
    const rows = [];
    const days = (l) => `${l.totalDays || ''} day${Number(l.totalDays) === 1 ? '' : 's'}`.trim();
    const typeName = (l) => String(l.leaveType || 'leave').replace('_', ' ');
    for (const { kind, leave } of alerts) {
      const who = people.find((p) => p.id === leave.employeeId)?.name || 'An employee';
      const rand = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      if (kind === 'asked') {
        for (const p of people.filter((x) => x.is_active !== false && x.role === 'admin' && x.id !== leave.employeeId)) {
          rows.push({ id: `ntf-lv-${rand()}`, employee_id: p.id, category: 'reminder', ref_id: leave.id, message: `${who} asked for ${typeName(leave)} (${days(leave)}, ${leave.startDate} to ${leave.endDate}). Open Leave Requests to approve or reject.`, created_at: at, read_at: null });
        }
      } else {
        rows.push({ id: `ntf-lv-${rand()}`, employee_id: leave.employeeId, category: 'reminder', ref_id: leave.id, message: `Your ${typeName(leave)} request (${leave.startDate} to ${leave.endDate}) was ${kind === 'approved' ? 'approved' : 'rejected'}${leave.reviewNote ? `: ${leave.reviewNote}` : '.'}`, created_at: at, read_at: null });
      }
    }
    if (rows.length) {
      await supabaseFetch('/crm_notifications', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(rows) });
      await pushNotificationRows(rows);
    }
  } catch (e) {
    console.warn('[Leaves] Could not send alerts:', e?.message || e);
  }
}

let lastReminderSweepAt = 0;
const ASK_WINDOW_MS = 30 * 60 * 1000;

/**
 * Punch-out reminders. For everybody who is still punched in, it adds (once each, per shift) a notification:
 *   15 minutes before shift end, when the shift ends, and 15 minutes before the automatic logout.
 * The portal turns these into a pop-up + sound and keeps them in the Notifications history.
 * Runs from the heartbeat, the portal's own polling and every save, throttled to once a minute.
 */
export async function sweepShiftReminders({ getShiftEndWindowMs, format12h }) {
  const nowMs = Date.now();
  if (nowMs - lastReminderSweepAt < 60000) return 0;
  lastReminderSweepAt = nowMs;
  try {
    const karachi = (ms, opts) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', ...opts }).format(new Date(ms));
    const today = karachi(nowMs, { year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('-');
    const clock = (ms) => karachi(ms, { hour: '2-digit', minute: '2-digit', hour12: false });
    const nowHm = clock(nowMs);
    const toMin = (hm) => { const [h, m] = String(hm || '').split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : NaN; };

    // Old reminders never pop up again: anything from a punch that is already closed, or older than 12 hours, is marked read.
    const unread = (await supabaseFetch(`/crm_notifications?category=eq.reminder&read_at=is.null&select=id,ref_id,created_at&limit=500`)) || [];
    if (unread.length) {
      const recIds = [...new Set(unread.map((n) => n.ref_id).filter((x) => x && !String(x).startsWith('pin-')))];
      const closed = new Set();
      for (let i = 0; i < recIds.length; i += 80) {
        const part = recIds.slice(i, i + 80).map((x) => `"${x}"`).join(',');
        const rows = (await supabaseFetch(`/attendance?id=in.(${part})&select=id,time_out`)) || [];
        rows.filter((r) => r.time_out).forEach((r) => closed.add(r.id));
      }
      // a punch-in reminder is done once that person has punched in today
      const pinPeople = [...new Set(unread.map((n) => String(n.ref_id || '')).filter((r) => r.startsWith('pin-')).map((r) => r.slice(4, -11)))];
      const punchedIn = new Set();
      if (pinPeople.length) {
        const rows = (await supabaseFetch(`/attendance?date=eq.${today}&employee_id=in.(${pinPeople.map((x) => `"${x}"`).join(',')})&select=employee_id`)) || [];
        rows.forEach((r) => punchedIn.add(r.employee_id));
      }
      const stale = unread.filter((n) => (closed.has(n.ref_id) && !String(n.id).endsWith('-closed')) ||
        (String(n.ref_id || '').startsWith('pin-') && punchedIn.has(String(n.ref_id).slice(4, -11))) || nowMs - Date.parse(n.created_at) > 12 * 3600000 || (String(n.ref_id).startsWith('pin-') && !String(n.ref_id).endsWith(today)));
      for (let i = 0; i < stale.length; i += 80) {
        const ids = stale.slice(i, i + 80).map((n) => `"${n.id}"`).join(',');
        await supabaseFetch(`/crm_notifications?id=in.(${ids})`, { method: 'PATCH', body: JSON.stringify({ read_at: new Date(nowMs).toISOString() }) });
      }
    }

    const [settingsRows, shiftsRows, empRows, openRows, todayRows, leaveRows] = await Promise.all([
      supabaseFetch('/settings?id=eq.current&select=*'),
      supabaseFetch('/shifts?select=*&order=id.asc'),
      supabaseFetch('/employees?deleted_at=is.null&select=*'),
      // today's open punches (and yesterday's only for night shifts that run past midnight)
      supabaseFetch(`/attendance?time_out=is.null&time_in=not.is.null&date=gte.${new Date(Date.parse(`${today}T12:00:00Z`) - 86400000).toISOString().slice(0, 10)}&select=*`),
      supabaseFetch(`/attendance?date=eq.${today}&select=employee_id`),
      supabaseFetch(`/leaves?deleted_at=is.null&status=eq.approved&start_date=lte.${today}&end_date=gte.${today}&select=*`),
    ]);
    const settings = settingsRows?.[0]?.data || {};
    const graceHours = Math.max(0, Number(settings.autoPunchOutOnInactiveHours ?? 2) || 0);
    const shifts = Array.isArray(shiftsRows) ? shiftsRows.map(mapDbShift) : [];
    const employees = Array.isArray(empRows) ? empRows.map(mapDbEmployee) : [];
    const out = [];

    // 1) Shift start: remind to punch in (once a day, within the first hour of the shift, workdays only, not on leave).
    const punchedToday = new Set((todayRows || []).map((r) => r.employee_id));
    const onLeave = new Set((leaveRows || []).map(mapDbLeave).filter((l) => l && l.leaveType !== 'remote_work').map((l) => l.employeeId));
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
    for (const emp of employees) {
      if (!emp || emp.isActive === false || emp.id === 'emp-101' || punchedToday.has(emp.id) || onLeave.has(emp.id)) continue;
      const shift = shifts.find((x) => x.id === emp.shiftId);
      if (!shift || !Array.isArray(shift.workDays) || !shift.workDays.includes(dow)) continue;
      const start = toMin(shift.startTime);
      const n = toMin(nowHm);
      if (!Number.isFinite(start) || n < start || n > start + 60) continue;
      const startLabel = format12h ? format12h(shift.startTime) : shift.startTime;
      out.push({ id: `rem-in-${emp.id}-${today}`, employee_id: emp.id, category: 'reminder', ref_id: `pin-${emp.id}-${today}`, message: `⏰ Your shift starts at ${startLabel}. Please punch in.`, created_at: new Date(nowMs).toISOString(), read_at: null });
    }

    // 2) Shift end: remind to punch out (once). 3) Shift end + grace hours: ask once to confirm extra work.
    for (const raw of Array.isArray(openRows) ? openRows : []) {
      const rec = mapDbAttendance(raw);
      const emp = employees.find((e) => e.id === rec.employeeId);
      if (!emp || emp.isActive === false || !rec.timeIn) continue;
      const shift = shifts.find((x) => x.id === emp.shiftId) || shifts[0];
      if (!shift) continue;
      const confirmedMs = rec.workConfirmedAt ? Date.parse(rec.workConfirmedAt) : NaN;
      const win = getShiftEndWindowMs(rec.date, rec.timeIn, shift, graceHours, confirmedMs);
      const shiftEndMs = win.shiftEndMs;
      const checkAtMs = win.checkAtMs;
      if (!Number.isFinite(shiftEndMs)) continue;
      if (rec.date !== today && !win.isOvernightShift) continue;
      const askFromMs = checkAtMs - 15 * 60 * 1000; // the one "are you still working?" question, 15 minutes before auto punch-out
      const endLabel = format12h ? format12h(shift.endTime) : shift.endTime;
      const logoutLabel = format12h ? format12h(clock(checkAtMs)) : clock(checkAtMs);
      if (graceHours > 0 && nowMs >= askFromMs && nowMs < checkAtMs) {
        out.push({ id: `rem-${rec.id}-ask-${Math.round(checkAtMs / 60000)}-1`, employee_id: rec.employeeId, category: 'reminder', ref_id: rec.id, created_at: new Date(nowMs).toISOString(), read_at: null,
          message: `❓ You are still punched in ${graceHours}h after your shift. Are you working extra hours? Tap “Yes, I'm working” to stay punched in, otherwise you will be punched out automatically at ${logoutLabel} (extra time is recorded separately).` });
      } else if (nowMs >= shiftEndMs && (graceHours === 0 || nowMs < askFromMs)) {
        out.push({ id: `rem-${rec.id}-end`, employee_id: rec.employeeId, category: 'reminder', ref_id: rec.id, created_at: new Date(nowMs).toISOString(), read_at: null,
          message: graceHours > 0
            ? `🔔 Your shift ended at ${endLabel}. Please punch out. Working extra hours? Tap “Yes, I'm working”.`
            : `🔔 Your shift ended at ${endLabel}. Please punch out.` });
      }
    }
    if (out.length) {
      // only rows that are really new come back, so each reminder is shown / pushed once
      const added = await supabaseFetch('/crm_notifications?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify(out) });
      await pushNotificationRows(Array.isArray(added) ? added : []);
    }
    return out.length;
  } catch (e) {
    console.error('Shift reminder sweep failed:', e);
    return 0;
  }
}

/**
 * Intelligent, atomic merge for an individual attendance record against existing Supabase record
 */
/**
 * Saves punches that the auto-logout / end-of-day rules have just closed, so the closure is permanent
 * (not only shown on screen). Only rows that are still open in the database are touched.
 */
export async function persistAutoClosures(originalRecords, evaluatedRecords) {
  if (!Array.isArray(originalRecords) || !Array.isArray(evaluatedRecords)) return 0;
  let saved = 0;
  for (let i = 0; i < originalRecords.length; i++) {
    const orig = originalRecords[i];
    const ev = evaluatedRecords[i];
    if (!orig || !ev || orig.timeOut || !ev.timeOut || !orig.id) continue;
    try {
      await supabaseFetch(`/attendance?id=eq.${encodeURIComponent(orig.id)}&time_out=is.null`, {
        method: 'PATCH',
        body: JSON.stringify({
          time_out: ev.timeOut,
          breaks: ev.breaks || [],
          notes: ev.notes || '',
          is_auto_punched_out: true,
          auto_punch_out_reason: ev.autoPunchOutReason || null,
          admin_keep_open: false,
          auto_out_at: ev.autoOutAt || null,
          unverified_minutes: Math.max(0, Math.round(Number(ev.unverifiedMinutes) || 0)),
          record_updated_at: new Date().toISOString(),
        }),
      });
      if (orig.employeeId) {
        const outLabel = (t) => { const [h, m] = String(t || '').split(':').map((x) => parseInt(x, 10)); return Number.isFinite(h) ? `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}` : ''; };
        const otMins = Number(ev.overtimeMinutes) || 0;
        const otDesc = otMins > 0 ? ` (Overtime counted separately in remarks: ${Math.floor(otMins / 60)}h ${otMins % 60}m)` : '';
        const msg = `🔒 You were punched out automatically at ${outLabel(ev.timeOut)} after the post-shift verification window${otDesc}.`;
        try {
          const added = await supabaseFetch('/crm_notifications?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify([{ id: `rem-${orig.id}-closed`, employee_id: orig.employeeId, category: 'reminder', ref_id: orig.id, message: msg, created_at: new Date().toISOString(), read_at: null }]) });
          await pushNotificationRows(Array.isArray(added) ? added : []);
        } catch (_) {}
      }
      saved++;
    } catch (e) {
      console.error('Could not save auto-closed punch', orig.id, e);
    }
  }
  return saved;
}

/**
 * Every punch-in / punch-out / extra remark is kept forever: when a new remark text arrives it is added to the
 * record's notes_log (the single `notes` field only shows the latest one and used to overwrite the earlier remark).
 */
export function withNotesLog(existing, incomingRec, merged, actorRole) {
  const prior = Array.isArray(existing?.notesLog) ? [...existing.notesLog] : [];
  if (!prior.length && String(existing?.notes || '').trim()) prior.push({ id: 'legacy', at: existing.recordUpdatedAt || '', kind: 'note', by: existing.employeeId || '', text: existing.notes });
  let log = prior;
  const text = String(incomingRec?.notes ?? '').trim();
  const before = String(existing?.notes ?? '').trim();
  const act = incomingRec.actorAction;
  const explicit = ['time_in', 'time_out', 'update_note'].includes(act);
  const entryId = `nl-${incomingRec.recordUpdatedAt || new Date().toISOString()}-${act || 'note'}`;
  if (text && (explicit || (actorRole === 'admin' && text !== before)) && !prior.some((e) => e && e.id === entryId)) {
    const kind = actorRole === 'admin' && act !== 'time_in' && act !== 'time_out' ? 'admin_note'
      : act === 'time_in' ? 'punch_in' : act === 'time_out' ? 'punch_out' : 'note';
    log = [...prior, { id: entryId, at: new Date().toISOString(), kind, by: merged.employeeId || incomingRec.employeeId || '', text }];
  }
  return { ...merged, notesLog: log };
}

export function mergeSupabaseAttendanceRecord(existing, incomingRec, options = {}) {
  const merged = mergeSupabaseAttendanceRecordCore(existing, incomingRec, options);
  return withNotesLog(existing, incomingRec, merged, options.actorRole || incomingRec.lastEditedByRole || 'employee');
}

function mergeSupabaseAttendanceRecordCore(existing, incomingRec, options = {}) {
  const actorRole = options.actorRole || incomingRec.lastEditedByRole || 'employee';
  const isAdmin = actorRole === 'admin';
  const nowIso = new Date().toISOString();
  if (existing && incomingRec.actorAction === 'update_note') return { ...existing, notes: String(incomingRec.notes || '').trim() || existing.notes, recordUpdatedAt: nowIso };

  if (!existing) {
    const fresh = { ...incomingRec };
    delete fresh.workConfirmedAt; delete fresh.autoOutAt; fresh.unverifiedMinutes = 0;
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
    // An admin/CEO saving their OWN punch is not an "admin override"; otherwise their own auto punch-out kept being postponed.
    adminOverrideAt: isAdmin && !(options.actorId && options.actorId === (existing.employeeId || incomingRec.employeeId)) ? (incomingRec.adminOverrideAt || nowIso) : existing.adminOverrideAt,
    adminKeepOpen: shouldClearTimeOut
      ? Boolean(!shouldClearTimeIn && finalTimeIn)
      : (incomingRec.adminKeepOpen !== undefined ? Boolean(incomingRec.adminKeepOpen) : Boolean(existing.adminKeepOpen)),
    workMode: (isAdmin || isFreshPunchIn) && (incomingRec.workMode === 'wfh' || incomingRec.workMode === 'office') ? incomingRec.workMode : (existing.workMode || 'office'),
    wfhReason: (isAdmin || isFreshPunchIn) && incomingRec.workMode ? (incomingRec.workMode === 'wfh' ? String(incomingRec.wfhReason || '') : '') : (existing.wfhReason || ''),
    // Confirmation / auto punch-out details are written only by the server (never trusted from the browser)
    workConfirmedAt: existing.workConfirmedAt,
    autoOutAt: shouldClearTimeOut ? undefined : (incomingRec.actorAction === 'auto_close' ? incomingRec.autoOutAt : existing.autoOutAt),
    unverifiedMinutes: shouldClearTimeOut ? 0 : (incomingRec.actorAction === 'auto_close' ? Number(incomingRec.unverifiedMinutes) || 0 : Number(existing.unverifiedMinutes) || 0),
    lastEditedByRole: actorRole,
    recordUpdatedAt: nowIso,
    punchLocations: shouldClearTimeIn ? undefined : (() => {
      const a = existing.punchLocations && typeof existing.punchLocations === 'object' ? existing.punchLocations : {};
      const b = incomingRec.punchLocations && typeof incomingRec.punchLocations === 'object' ? incomingRec.punchLocations : {};
      const m = { ...a, ...b };
      if (shouldClearTimeOut) delete m.out;
      return Object.keys(m).length ? m : undefined;
    })(),
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
  if (!Array.isArray(clientIps)) return null; // internal callers (auto-punch checks its own IP)
  if (!punchFieldsChanged(existing, rec)) return null;

  const setRows = await supabaseFetch('/settings?id=eq.current&select=data');
  const settings = readJson(setRows?.[0]?.data, {}) || {};
  if (!settings.enforceOfficeIpLock) return null;
  if (actorRole === 'admin' && (settings.allowAdminBypassIpLock ?? true)) return null;

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
  return { remote: Boolean(verdict.remote) };
}

/**
 * Work-from-home marking. A punch-in made by a work-from-home employee OFF the office network is a
 * "wfh" shift: it must carry a written reason (the punch Note), and is stored and counted separately.
 * Clients can never choose the mode themselves; only the server (or an admin correcting a record) does.
 */
function stampWorkMode(existing, rec, net, actorRole, external) {
  const isFreshPunchIn = rec.actorAction === 'time_in' && Boolean(rec.timeIn) && !(existing && existing.timeIn);
  const adminChoice = actorRole === 'admin' && (rec.workMode === 'wfh' || rec.workMode === 'office') ? rec.workMode : null;
  const reasonSent = String(rec.wfhReason || '').trim() || String(rec.notes || '').trim();
  if (external && actorRole !== 'admin') { delete rec.workMode; delete rec.wfhReason; }
  if (adminChoice) { rec.workMode = adminChoice; rec.wfhReason = adminChoice === 'wfh' ? reasonSent.slice(0, 300) : ''; return; }
  if (!isFreshPunchIn) return;
  if (net && net.remote) {
    if (reasonSent.length < 3) {
      const err = new Error('Work from home: please write the reason in the Note before you punch in.');
      err.status = 400;
      err.code = 'WFH_REASON_REQUIRED';
      throw err;
    }
    rec.workMode = 'wfh';
    rec.wfhReason = reasonSent.slice(0, 300);
  } else {
    rec.workMode = rec.workMode === 'wfh' && !external ? 'wfh' : 'office';
    rec.wfhReason = rec.workMode === 'wfh' ? reasonSent.slice(0, 300) : '';
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
  const employeeIdForFace = rec.employeeId || existing?.employeeId || '';
  let personRequired = false;
  if (!settings.faceEnrollRequired) {
    const er = await supabaseFetch(`/employees?id=eq.${encodeURIComponent(employeeIdForFace)}&select=pending_device_request`);
    personRequired = Boolean(readJson(er?.[0]?.pending_device_request, null)?.faceEnrollRequired);
  }
  const enrollRequired = Boolean(settings.faceEnrollRequired || personRequired);
  if (!settings.faceScanPunchEnabled && !enrollRequired) return;
  const isDirectPunchAction = ['time_in', 'time_out', 'start_break', 'end_break'].includes(rec.actorAction);
  if (actorRole === 'admin' && !isDirectPunchAction) return; // admin timesheet corrections on roster bypass face scan

  const employeeId = rec.employeeId || existing?.employeeId || '';
  const tplRows = await supabaseFetch(
    `/face_templates?employee_id=eq.${encodeURIComponent(employeeId)}&select=employee_id`
  );
  const enrolled = Boolean(tplRows?.[0]);
  if (!enrolled) {
    // The administrator requires this person (or everyone) to enroll their face through their own login before punching.
    if (enrollRequired) {
      const err = new Error('Your administrator requires a face scan. Please sign in to your own account and set up your face first.');
      err.status = 403;
      err.code = 'FACE_ENROLL_REQUIRED';
      throw err;
    }
    if (settings.faceScanAllowUnenrolled ?? true) return;
    const err = new Error('Face scan is required but your face is not enrolled yet. Ask the administrator to enroll you.');
    err.status = 403;
    err.code = 'FACE_NOT_ENROLLED';
    throw err;
  }
  if (!settings.faceScanPunchEnabled) return; // enrolled; per-punch scanning is not switched on
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
    // An employee can only mark their own note as read; nothing else about it can be changed.
    incoming.markReadId = c.id;
    incoming.markReadEmployeeId = actor.id;
    incoming.changedComment = undefined;
    incoming.ceoComments = [];
  }

  // The role always comes from the server's own record of the signed-in person, never from the browser's claim.
  incoming.actorRole = actor?.role || 'employee';

  if (scope === 'attendance') {
    // Attendance writes always require a verified server session (or the separately
    // verified Windows auto-punch token). Never trust a role supplied by the browser.
    if (!actor) throw needSignIn();
    const role = actor.role;
    const isVerifier = role === 'admin' || role === 'accounts' || role === 'ceo';
    const list = incoming.changedRecords || (incoming.changedRecord ? [incoming.changedRecord] : incoming.attendance || []);
    const employeeActions = new Set(['time_in', 'time_out', 'start_break', 'end_break', 'update_note', 'heartbeat']);

    for (const rec of list) {
      if (!rec || typeof rec !== 'object') continue;

      if (role !== 'admin') {
        if (rec.actorAction === 'verify') {
          if (!isVerifier) throw forbidden();
        } else {
          if (rec.employeeId !== actor.id) {
            throw denied(403, 'OWN_ATTENDANCE_ONLY', 'You can only update your own attendance record.');
          }
          if (!employeeActions.has(rec.actorAction)) throw forbidden();
        }
      }

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
  const scope = incoming.scope || 'legacy_bulk';
  const pageByScope = { attendance: 'clock', employee_upsert: 'employees', employees: 'employees', employee_delete: 'employees', shifts: 'shifts', leaves: 'leaves', settings: 'settings' };
  const protectedPage = pageByScope[scope];
  if (protectedPage && ctx.actor && !ctx.actor.isSuperAdmin && ctx.actor.featureAccess?.[protectedPage] === false) {
    throw denied(403, 'PAGE_ACCESS_REVOKED', 'Your Super Admin has disabled access to this page.');
  }
  // The one-time Gist migration is an internal server operation, not a browser mutation.
  if (!(ctx.internalMigration === true && scope === 'full_restore')) {
    authorizeExternalMutation(incoming, ctx);
  }

  if (scope === 'attendance') {
    const records = incoming.changedRecords || (incoming.changedRecord ? [incoming.changedRecord] : incoming.attendance || []);
    if (records.length > 0) {
      const rowsToUpsert = [];
      for (const rec of records) {
        if (!rec || !rec.id) continue;
        const existingRows = await supabaseFetch(`/attendance?id=eq.${encodeURIComponent(rec.id)}&select=*`);
        const existing = existingRows?.[0] ? mapDbAttendance(existingRows[0]) : null;

        if (rec.actorAction === 'update_note' && !existing) throw denied(400, 'ATTENDANCE_REQUIRED', 'Punch in before saving an additional remark.');

        const net = await enforceOfficeNetworkForPunch(existing, rec, incoming.actorRole, ctx.clientIps);
        stampWorkMode(existing, rec, net, incoming.actorRole, Array.isArray(ctx.clientIps));
        await enforceFacePassForPunch(existing, rec, incoming.actorRole, ctx);
        const mergedRec = mergeSupabaseAttendanceRecord(existing, rec, { actorRole: incoming.actorRole, actorId: ctx.actor?.id });
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
        if (existing.isSuperAdmin && !ctx.actor?.isSuperAdmin) {
          throw denied(403, 'SUPER_ADMIN_PROTECTED', 'Only the Super Admin can change this protected account.');
        }
        mergedEmp = {
          ...existing,
          ...emp,
          ...(existing.isSuperAdmin ? { isSuperAdmin: true, role: 'admin' } : {}),
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
      if (existing && existing.isActive !== false && mergedEmp.isActive === false) {
        // Disabling a profile: never your own, and never the last active administrator.
        if (existing.id === ctx.actor?.id) throw denied(400, 'CANNOT_DISABLE_SELF', 'You cannot disable your own profile while you are signed in.');
        if (existing.role === 'admin') {
          const admins = await supabaseFetch('/employees?role=eq.admin&deleted_at=is.null&is_active=eq.true&select=id');
          if (!(Array.isArray(admins) ? admins : []).some((x) => x.id !== existing.id)) {
            throw denied(400, 'LAST_ADMIN', 'At least one active administrator must remain.');
          }
        }
      }
      mergedEmp.recordUpdatedAt = new Date().toISOString();
      if (incoming.actorRole) {
        mergedEmp.lastEditedByRole = incoming.actorRole;
      }
      try {
        const keys = ['role', 'isActive', 'featureAccess', 'salesAccess', 'crmCustomerAccess', 'liveDashboardAccess', 'leaderboardAccess', 'payablesAccess', 'mediaTeam', 'teamPresenceAccess', 'allowWorkFromHome', 'faceEnrollRequired', 'locationCheck', 'customerPortalAccess'];
        const changed = existing ? keys.filter((k) => JSON.stringify(existing[k] ?? null) !== JSON.stringify(mergedEmp[k] ?? null)) : ['new employee'];
        if (changed.length) { const { audit } = await import('./_audit.js'); await audit(ctx?.actor, existing ? 'changed an employee' : 'added an employee', `${mergedEmp.name}: ${changed.join(', ')}`); }
      } catch { /* the log never blocks saving */ }
      const keepCut = Math.max(Number(existing?.pendingDeviceRequest?.signOutBefore) || 0, Number(mergedEmp.pendingDeviceRequest?.signOutBefore) || 0);
      if (keepCut) mergedEmp.__keepSignOutBefore = keepCut;
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
    if (targetId && targetId === ctx.actor?.id) {
      const e = new Error('You cannot delete your own account while you are signed in.');
      e.status = 400; e.code = 'CANNOT_DELETE_SELF';
      throw e;
    }
    if (targetId) {
      const targetRows = await supabaseFetch(`/employees?id=eq.${encodeURIComponent(targetId)}&select=id,role`);
      if (targetRows?.[0]?.role === 'superadmin' && !ctx.actor?.isSuperAdmin) {
        throw denied(403, 'SUPER_ADMIN_PROTECTED', 'Only the Super Admin can change this protected account.');
      }
      // An administrator may remove another administrator, but never the last active one.
      const admins = await supabaseFetch('/employees?role=eq.admin&deleted_at=is.null&is_active=eq.true&select=id');
      const others = (Array.isArray(admins) ? admins : []).filter((a) => a.id !== targetId);
      const targetIsAdmin = (Array.isArray(admins) ? admins : []).some((a) => a.id === targetId);
      if (targetIsAdmin && others.length === 0) {
        const e = new Error('At least one active administrator must remain.');
        e.status = 400; e.code = 'LAST_ADMIN';
        throw e;
      }
      await supabaseFetch(`/employees?id=eq.${encodeURIComponent(targetId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ deleted_at: new Date().toISOString(), is_active: false }),
      });
    }
  } else if (scope === 'leaves') {
    const leavesList = incoming.changedLeave ? [incoming.changedLeave] : incoming.leaves || [];
    const rowsToUpsert = [];
    const leaveAlerts = [];
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
      // Who should hear about this: admins when a request arrives, the employee when it is decided
      if (!existing && mergedLeave.status === 'pending') leaveAlerts.push({ kind: 'asked', leave: mergedLeave });
      else if (existing && existing.status === 'pending' && ['approved', 'rejected'].includes(mergedLeave.status)) leaveAlerts.push({ kind: mergedLeave.status, leave: mergedLeave });
    }

    if (rowsToUpsert.length > 0) {
      await supabaseFetch('/leaves', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(rowsToUpsert),
      });
      await sendLeaveAlerts(leaveAlerts);
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
      try {
        const prev = (await supabaseFetch('/settings?id=eq.current&select=data'))?.[0]?.data || {};
        const changed = Object.keys({ ...prev, ...incoming.settings }).filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(incoming.settings[k]) && !['updatedAt', 'recordUpdatedAt'].includes(k));
        if (changed.length) { const { audit } = await import('./_audit.js'); await audit(ctx?.actor, 'changed office settings', changed.slice(0, 12).join(', ')); }
      } catch { /* the log never blocks saving */ }
      await supabaseFetch('/settings', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify([
          {
            id: 'current',
            data: {
              ...incoming.settings,
              enforceDeviceBinding: false,
              customerPortalBetaEnabled: incoming.settings.customerPortalBetaEnabled !== false,
            },
            updated_at: new Date().toISOString(),
          },
        ]),
      });
    }
  } else if (scope === 'ceoComments') {
    if (incoming.markReadId && incoming.markReadEmployeeId) {
      await supabaseFetch(`/ceo_comments?id=eq.${encodeURIComponent(incoming.markReadId)}&employee_id=eq.${encodeURIComponent(incoming.markReadEmployeeId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_read: true, updated_at: new Date().toISOString() }),
      });
    }
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
            data: {
              ...incoming.settings,
              enforceDeviceBinding: false,
              customerPortalBetaEnabled: incoming.settings.customerPortalBetaEnabled !== false,
            },
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
