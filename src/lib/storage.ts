import {
  AttendanceRecord,
  CeoComment,
  Employee,
  LeaveRequest,
  OfficeSettings,
  ShiftSchedule,
} from '../types';
import {
  calculateWorkedMinutes,
  getDayName,
  getTodayDateString,
  isLateArrival,
} from './attendanceCalculations';

const STORAGE_KEY_EMPLOYEES = 'office_attend_employees_v1';
const STORAGE_KEY_ATTENDANCE = 'office_attend_records_v1';
const STORAGE_KEY_SHIFTS = 'office_attend_shifts_v1';
const STORAGE_KEY_LEAVES = 'office_attend_leaves_v1';
const STORAGE_KEY_SETTINGS = 'office_attend_settings_v1';
const STORAGE_KEY_SESSION = 'office_attend_session_v1';
const STORAGE_KEY_MODE = 'office_attend_mode_v1';
const STORAGE_KEY_CEO_COMMENTS = 'office_attend_ceo_comments_v1';

export const INITIAL_SHIFTS: ShiftSchedule[] = [
  {
    id: 'shift-std',
    name: 'General Day Shift (09:00 - 17:00)',
    startTime: '09:00',
    endTime: '17:00',
    workDays: [1, 2, 3, 4, 5],
    graceMinutes: 15,
    expectedHours: 8,
    color: 'blue',
    isActive: true,
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
    isActive: true,
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
    isActive: true,
  },
];

export const INITIAL_SETTINGS: OfficeSettings = {
  companyName: 'Apex Technologies Ltd.',
  companyAddress: 'Suite 400, Innovation Tower, Financial District',
  companyPhone: '+1 (555) 019-8321',
  companyEmail: 'hr@apextech.local',
  workDays: [1, 2, 3, 4, 5],
  defaultShiftId: 'shift-std',
  overtimeThresholdMinutes: 480, // 8 hours
  overtimeRateMultiplier: 1.5,
  kioskPinRequired: true,
  allowSelfClockOut: true,
  serverHostName: 'APEX-SRV-WIN11',
  serverPort: 3000,
  enforceOfficeIpLock: true,
  allowedOfficeIps: [
    {
      ip: '175.107.239.140',
      label: 'Office ISP Provider 1 (Cyber Internet Services) — All Extenders & LAN',
      addedAt: '2026-11-05',
    },
    {
      ip: '175.107.239.*',
      label: 'Office ISP Provider 1 Dynamic Subnet — All Extenders & LAN',
      addedAt: '2026-11-05',
    },
    {
      ip: '127.0.0.1',
      label: 'Local Server Host PC',
      addedAt: '2026-11-05',
    },
  ],
  allowedOfficeIsps: [
    {
      ispName: 'Cyber Internet Services',
      label: 'Office Primary ISP',
      addedAt: '2026-11-05',
    },
  ],
  allowAdminBypassIpLock: true,
  enforceDeviceBinding: true,
  allowAdminBypassDeviceBinding: true,
  allowKioskPunchWithoutDevice: true,
};

export const INITIAL_EMPLOYEES: Employee[] = [
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
    joinedDate: '2026-01-01',
    avatarSeed: 'admin',
  },
];

export const INITIAL_LEAVES: LeaveRequest[] = [];

/**
 * Generate historical attendance records (clean: no fake dummy data)
 */
export function generateInitialAttendanceRecords(): AttendanceRecord[] {
  return [];
}

// Server Sync Helper (for standalone .exe, Express server, and Vercel Gist DB)
let isSyncingFromServer = false;
let pendingPushCount = 0;
let pushQueue: Promise<void> = Promise.resolve();
let cloudSyncListener: (() => void) | null = null;

const STORAGE_KEY_UPDATED_AT = 'office_attend_updated_at_v1';

export function registerCloudSyncListener(listener: (() => void) | null): void {
  cloudSyncListener = listener;
}

export function hasPendingCloudWrites(): boolean {
  return pendingPushCount > 0;
}

export type DbMutationPayload =
  | { scope: 'attendance'; changedRecord?: AttendanceRecord }
  | {
      scope: 'employee_upsert';
      employee: Employee;
      allowClearDevice?: boolean;
      clearPendingRequest?: boolean;
    }
  | { scope: 'employee_delete'; deletedEmployeeId: string }
  | { scope: 'shifts' }
  | { scope: 'leaves'; changedLeave?: LeaveRequest }
  | { scope: 'ceoComments'; changedComment?: CeoComment }
  | { scope: 'settings' }
  | { scope: 'full_restore' };

function applyServerDbToLocal(data: {
  updatedAt?: string;
  settings?: OfficeSettings;
  shifts?: ShiftSchedule[];
  employees?: Employee[];
  attendance?: AttendanceRecord[];
  leaves?: LeaveRequest[];
  ceoComments?: CeoComment[];
}): void {
  isSyncingFromServer = true;
  try {
    if (data.updatedAt) {
      localStorage.setItem(STORAGE_KEY_UPDATED_AT, data.updatedAt);
    }
    if (data.settings) localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(data.settings));
    if (data.shifts) localStorage.setItem(STORAGE_KEY_SHIFTS, JSON.stringify(data.shifts));
    if (data.employees) localStorage.setItem(STORAGE_KEY_EMPLOYEES, JSON.stringify(data.employees));
    if (data.attendance) localStorage.setItem(STORAGE_KEY_ATTENDANCE, JSON.stringify(data.attendance));
    if (data.leaves) localStorage.setItem(STORAGE_KEY_LEAVES, JSON.stringify(data.leaves));
    if (data.ceoComments) localStorage.setItem(STORAGE_KEY_CEO_COMMENTS, JSON.stringify(data.ceoComments));
  } finally {
    isSyncingFromServer = false;
  }
}

export function pushDatabaseToServer(mutation?: DbMutationPayload): Promise<void> {
  if (isSyncingFromServer) return Promise.resolve();

  pendingPushCount += 1;

  const task = pushQueue.then(async () => {
    try {
      const nowIso = new Date().toISOString();
      const scope = mutation?.scope || 'legacy_bulk';

      let payload: Record<string, unknown> = {
        version: '1.0',
        updatedAt: nowIso,
        scope,
      };

      if (mutation?.scope === 'attendance') {
        payload.changedRecord = mutation.changedRecord;
        if (!mutation.changedRecord) {
          payload.attendance =
            JSON.parse(localStorage.getItem(STORAGE_KEY_ATTENDANCE) || 'null') || [];
        }
      } else if (mutation?.scope === 'employee_upsert') {
        payload.employee = mutation.employee;
        payload.allowClearDevice = Boolean(mutation.allowClearDevice);
        payload.clearPendingRequest = Boolean(mutation.clearPendingRequest);
      } else if (mutation?.scope === 'employee_delete') {
        payload.deletedEmployeeId = mutation.deletedEmployeeId;
      } else if (mutation?.scope === 'shifts') {
        payload.shifts =
          JSON.parse(localStorage.getItem(STORAGE_KEY_SHIFTS) || 'null') || INITIAL_SHIFTS;
      } else if (mutation?.scope === 'settings') {
        payload.settings =
          JSON.parse(localStorage.getItem(STORAGE_KEY_SETTINGS) || 'null') || INITIAL_SETTINGS;
      } else if (mutation?.scope === 'leaves') {
        payload.changedLeave = mutation.changedLeave;
        if (!mutation.changedLeave) {
          payload.leaves = JSON.parse(localStorage.getItem(STORAGE_KEY_LEAVES) || 'null') || [];
        }
      } else if (mutation?.scope === 'ceoComments') {
        payload.changedComment = mutation.changedComment;
        if (!mutation.changedComment) {
          payload.ceoComments =
            JSON.parse(localStorage.getItem(STORAGE_KEY_CEO_COMMENTS) || 'null') || [];
        }
      } else {
        // full_restore or legacy_bulk
        payload = {
          ...payload,
          settings:
            JSON.parse(localStorage.getItem(STORAGE_KEY_SETTINGS) || 'null') || INITIAL_SETTINGS,
          shifts:
            JSON.parse(localStorage.getItem(STORAGE_KEY_SHIFTS) || 'null') || INITIAL_SHIFTS,
          employees:
            JSON.parse(localStorage.getItem(STORAGE_KEY_EMPLOYEES) || 'null') || INITIAL_EMPLOYEES,
          attendance: JSON.parse(localStorage.getItem(STORAGE_KEY_ATTENDANCE) || 'null') || [],
          leaves: JSON.parse(localStorage.getItem(STORAGE_KEY_LEAVES) || 'null') || [],
          ceoComments:
            JSON.parse(localStorage.getItem(STORAGE_KEY_CEO_COMMENTS) || 'null') || [],
        };
      }

      const res = await fetch(`/api/db?t=${Date.now()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        // Only apply authoritative server DB once no newer local writes are queued behind this one
        if (pendingPushCount === 1 && data && data.db) {
          applyServerDbToLocal(data.db);
          if (cloudSyncListener) {
            cloudSyncListener();
          }
        } else if (data && data.updatedAt) {
          localStorage.setItem(STORAGE_KEY_UPDATED_AT, data.updatedAt);
        } else {
          localStorage.setItem(STORAGE_KEY_UPDATED_AT, nowIso);
        }
      }
    } catch {
      // Graceful fallback if running offline
    } finally {
      pendingPushCount = Math.max(0, pendingPushCount - 1);
    }
  });

  pushQueue = task;
  return task;
}

export async function syncDatabaseFromServer(forceAccept = false): Promise<boolean> {
  if (pendingPushCount > 0 || isSyncingFromServer) {
    return false;
  }
  try {
    const res = await fetch(`/api/db?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;

    // Abort applying poll result if a local write started while GET was in-flight
    if (pendingPushCount > 0) {
      return false;
    }

    const data = await res.json();
    if (data && Array.isArray(data.employees) && Array.isArray(data.attendance)) {
      const localUpdatedAt = localStorage.getItem(STORAGE_KEY_UPDATED_AT);
      if (!forceAccept && localUpdatedAt && data.updatedAt && data.updatedAt === localUpdatedAt) {
        return false;
      }

      // Final check right before modifying localStorage
      if (pendingPushCount > 0) {
        return false;
      }

      applyServerDbToLocal(data);
      return true;
    }
    return false;
  } catch {
    isSyncingFromServer = false;
    return false;
  }
}

// Local Storage Wrappers — NOTE: load* functions NEVER call pushDatabaseToServer()
// so a newly opened employee laptop never overwrites the server DB with stale data!
export function loadEmployees(): Employee[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_EMPLOYEES);
    if (!raw) {
      return INITIAL_EMPLOYEES;
    }
    return JSON.parse(raw);
  } catch {
    return INITIAL_EMPLOYEES;
  }
}

export function saveEmployees(employees: Employee[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_EMPLOYEES, JSON.stringify(employees));
    void pushDatabaseToServer();
  } catch (err) {
    console.error('Failed to save employees:', err);
  }
}

export function saveEmployeeUpsert(
  employees: Employee[],
  changedEmployee: Employee,
  options?: { allowClearDevice?: boolean; clearPendingRequest?: boolean }
): void {
  try {
    localStorage.setItem(STORAGE_KEY_EMPLOYEES, JSON.stringify(employees));
    void pushDatabaseToServer({
      scope: 'employee_upsert',
      employee: changedEmployee,
      allowClearDevice: options?.allowClearDevice,
      clearPendingRequest: options?.clearPendingRequest,
    });
  } catch (err) {
    console.error('Failed to save employee:', err);
  }
}

export function saveEmployeeDelete(employees: Employee[], deletedEmployeeId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY_EMPLOYEES, JSON.stringify(employees));
    void pushDatabaseToServer({
      scope: 'employee_delete',
      deletedEmployeeId,
    });
  } catch (err) {
    console.error('Failed to delete employee:', err);
  }
}

export function loadAttendanceRecords(): AttendanceRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ATTENDANCE);
    if (!raw) {
      return generateInitialAttendanceRecords();
    }
    return JSON.parse(raw);
  } catch {
    return generateInitialAttendanceRecords();
  }
}

export function saveAttendanceRecords(
  records: AttendanceRecord[],
  changedRecord?: AttendanceRecord
): void {
  try {
    localStorage.setItem(STORAGE_KEY_ATTENDANCE, JSON.stringify(records));
    void pushDatabaseToServer({
      scope: 'attendance',
      changedRecord,
    });
  } catch (err) {
    console.error('Failed to save attendance records:', err);
  }
}

export function loadShifts(): ShiftSchedule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SHIFTS);
    if (!raw) {
      return INITIAL_SHIFTS;
    }
    return JSON.parse(raw);
  } catch {
    return INITIAL_SHIFTS;
  }
}

export function saveShifts(shifts: ShiftSchedule[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_SHIFTS, JSON.stringify(shifts));
    void pushDatabaseToServer({ scope: 'shifts' });
  } catch (err) {
    console.error('Failed to save shifts:', err);
  }
}

export function loadLeaves(): LeaveRequest[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LEAVES);
    if (!raw) {
      return INITIAL_LEAVES;
    }
    return JSON.parse(raw);
  } catch {
    return INITIAL_LEAVES;
  }
}

export function saveLeaves(leaves: LeaveRequest[], changedLeave?: LeaveRequest): void {
  try {
    localStorage.setItem(STORAGE_KEY_LEAVES, JSON.stringify(leaves));
    void pushDatabaseToServer({ scope: 'leaves', changedLeave });
  } catch (err) {
    console.error('Failed to save leaves:', err);
  }
}

export function loadCeoComments(): CeoComment[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CEO_COMMENTS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveCeoComments(comments: CeoComment[], changedComment?: CeoComment): void {
  try {
    localStorage.setItem(STORAGE_KEY_CEO_COMMENTS, JSON.stringify(comments));
    void pushDatabaseToServer({ scope: 'ceoComments', changedComment });
  } catch (err) {
    console.error('Failed to save CEO comments:', err);
  }
}

export function loadSettings(): OfficeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (!raw) {
      return INITIAL_SETTINGS;
    }
    const parsed: OfficeSettings = JSON.parse(raw);
    const upgraded: OfficeSettings = {
      ...INITIAL_SETTINGS,
      ...parsed,
      enforceOfficeIpLock: parsed.enforceOfficeIpLock ?? INITIAL_SETTINGS.enforceOfficeIpLock,
      allowedOfficeIps:
        parsed.allowedOfficeIps && parsed.allowedOfficeIps.length > 0
          ? parsed.allowedOfficeIps
          : INITIAL_SETTINGS.allowedOfficeIps,
      allowedOfficeIsps:
        parsed.allowedOfficeIsps && parsed.allowedOfficeIsps.length > 0
          ? parsed.allowedOfficeIsps
          : INITIAL_SETTINGS.allowedOfficeIsps,
      allowAdminBypassIpLock: parsed.allowAdminBypassIpLock ?? true,
      enforceDeviceBinding: parsed.enforceDeviceBinding ?? true,
      allowAdminBypassDeviceBinding: parsed.allowAdminBypassDeviceBinding ?? true,
      allowKioskPunchWithoutDevice: parsed.allowKioskPunchWithoutDevice ?? true,
    };
    return upgraded;
  } catch {
    return INITIAL_SETTINGS;
  }
}

export function saveSettings(settings: OfficeSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
    void pushDatabaseToServer({ scope: 'settings' });
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}

// Session Management
export interface UserSession {
  userId: string;
  keepLoggedIn: boolean;
  loginTimestamp: number;
}

export function loadSession(): UserSession | null {
  try {
    // Check localStorage (for keepLoggedIn: true)
    const stored = localStorage.getItem(STORAGE_KEY_SESSION);
    if (stored) return JSON.parse(stored);

    // Check sessionStorage (for current window only)
    const sessionOnly = sessionStorage.getItem(STORAGE_KEY_SESSION);
    if (sessionOnly) return JSON.parse(sessionOnly);

    return null;
  } catch {
    return null;
  }
}

export function saveSession(userId: string, keepLoggedIn: boolean): void {
  const session: UserSession = {
    userId,
    keepLoggedIn,
    loginTimestamp: Date.now(),
  };

  if (keepLoggedIn) {
    localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
    sessionStorage.removeItem(STORAGE_KEY_SESSION);
  } else {
    sessionStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
    localStorage.removeItem(STORAGE_KEY_SESSION);
  }
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY_SESSION);
  sessionStorage.removeItem(STORAGE_KEY_SESSION);
}

// App Mode (Desktop vs Lobby Kiosk)
export function loadSavedMode(): 'desktop' | 'kiosk' {
  try {
    const mode = localStorage.getItem(STORAGE_KEY_MODE);
    return mode === 'kiosk' ? 'kiosk' : 'desktop';
  } catch {
    return 'desktop';
  }
}

export function saveMode(mode: 'desktop' | 'kiosk'): void {
  try {
    localStorage.setItem(STORAGE_KEY_MODE, mode);
  } catch {
    // ignore
  }
}

// Full Database Backup Export & Restore
export function exportDatabaseBackup(): string {
  const data = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    settings: loadSettings(),
    shifts: loadShifts(),
    employees: loadEmployees(),
    attendance: loadAttendanceRecords(),
    leaves: loadLeaves(),
  };
  return JSON.stringify(data, null, 2);
}

export function importDatabaseBackup(jsonString: string): boolean {
  try {
    const data = JSON.parse(jsonString);
    if (!data.employees || !data.attendance) {
      throw new Error('Invalid database backup structure');
    }
    if (data.settings) localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(data.settings));
    if (data.shifts) localStorage.setItem(STORAGE_KEY_SHIFTS, JSON.stringify(data.shifts));
    if (data.employees) localStorage.setItem(STORAGE_KEY_EMPLOYEES, JSON.stringify(data.employees));
    if (data.attendance) localStorage.setItem(STORAGE_KEY_ATTENDANCE, JSON.stringify(data.attendance));
    if (data.leaves) localStorage.setItem(STORAGE_KEY_LEAVES, JSON.stringify(data.leaves));
    if (data.ceoComments) localStorage.setItem(STORAGE_KEY_CEO_COMMENTS, JSON.stringify(data.ceoComments));
    void pushDatabaseToServer({ scope: 'full_restore' });
    return true;
  } catch (err) {
    console.error('Failed to import database backup:', err);
    return false;
  }
}

export function resetToFactoryDefaults(): void {
  localStorage.removeItem(STORAGE_KEY_EMPLOYEES);
  localStorage.removeItem(STORAGE_KEY_ATTENDANCE);
  localStorage.removeItem(STORAGE_KEY_SHIFTS);
  localStorage.removeItem(STORAGE_KEY_LEAVES);
  localStorage.removeItem(STORAGE_KEY_SETTINGS);
  localStorage.removeItem(STORAGE_KEY_CEO_COMMENTS);
  localStorage.removeItem(STORAGE_KEY_UPDATED_AT);
  localStorage.removeItem(STORAGE_KEY_SESSION);
  sessionStorage.removeItem(STORAGE_KEY_SESSION);
}
