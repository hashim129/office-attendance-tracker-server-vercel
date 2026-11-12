import {
  AttendanceRecord,
  CeoComment,
  Employee,
  LeaveRequest,
  OfficeSettings,
  Role,
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
  enforceDeviceBinding: false,
  allowAdminBypassDeviceBinding: true,
  allowKioskPunchWithoutDevice: true,
  allowAutoStartPunch: false,
  enableDisconnectStatusTracking: true,
  autoPunchOutOnInactiveHours: 2,
  disconnectThresholdMinutes: 3,
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
export interface CloudSyncState {
  status: 'idle' | 'saving' | 'saved' | 'retrying' | 'error';
  pendingCount: number;
  lastSavedAt?: string;
  lastError?: string;
}

const STORAGE_KEY_UPDATED_AT = 'office_attend_updated_at_v1';
const STORAGE_KEY_OUTBOX = 'office_attend_outbox_v1';

export type DbMutationPayload =
  | {
      scope: 'attendance';
      changedRecord?: AttendanceRecord;
      changedRecords?: AttendanceRecord[];
      actorRole?: Role;
    }
  | {
      scope: 'employee_upsert';
      employee: Employee;
      allowClearDevice?: boolean;
      clearPendingRequest?: boolean;
      actorRole?: Role;
    }
  | { scope: 'employee_delete'; deletedEmployeeId: string; actorRole?: Role }
  | { scope: 'shifts'; actorRole?: Role }
  | { scope: 'leaves'; changedLeave?: LeaveRequest; actorRole?: Role }
  | { scope: 'ceoComments'; changedComment?: CeoComment; actorRole?: Role }
  | { scope: 'settings'; actorRole?: Role }
  | { scope: 'full_restore'; actorRole?: Role }
  | { scope: 'legacy_bulk'; actorRole?: Role };

interface QueuedOutboxItem {
  id: string;
  enqueuedAt: string;
  mutation: DbMutationPayload;
}

let isSyncingFromServer = false;
let isFlushingOutbox = false;
let activeFlushPromise: Promise<boolean> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;
let rateLimitCooldownUntilMs = 0;
let cloudSyncListener: (() => void) | null = null;
const statusListeners = new Set<(state: CloudSyncState) => void>();

let currentSyncState: CloudSyncState = {
  status: 'idle',
  pendingCount: 0,
};

function readOutbox(): QueuedOutboxItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_OUTBOX);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeOutbox(items: QueuedOutboxItem[]): void {
  try {
    if (items.length === 0) {
      localStorage.removeItem(STORAGE_KEY_OUTBOX);
    } else {
      localStorage.setItem(STORAGE_KEY_OUTBOX, JSON.stringify(items));
    }
  } catch {
    // ignore storage quota edge cases
  }
}

function emitSyncState(next: Partial<CloudSyncState>): void {
  currentSyncState = {
    ...currentSyncState,
    ...next,
    pendingCount: readOutbox().length,
  };
  statusListeners.forEach((fn) => {
    try {
      fn(currentSyncState);
    } catch {
      // ignore UI listener error
    }
  });
}

export function getCloudSyncStatus(): CloudSyncState {
  return {
    ...currentSyncState,
    pendingCount: readOutbox().length,
  };
}

export function subscribeCloudSyncStatus(listener: (state: CloudSyncState) => void): () => void {
  statusListeners.add(listener);
  listener(getCloudSyncStatus());
  return () => {
    statusListeners.delete(listener);
  };
}

export function registerCloudSyncListener(listener: (() => void) | null): void {
  cloudSyncListener = listener;
}

export function hasPendingCloudWrites(): boolean {
  return isFlushingOutbox || readOutbox().length > 0;
}

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

function buildServerPayload(mutation?: DbMutationPayload, queuedAgeMs?: number): Record<string, unknown> {
  const nowIso = new Date().toISOString();
  const scope = mutation?.scope || 'legacy_bulk';

  let payload: Record<string, unknown> = {
    version: '1.0',
    updatedAt: nowIso,
    scope,
    actorRole: mutation?.actorRole,
    ...(typeof queuedAgeMs === 'number' && Number.isFinite(queuedAgeMs)
      ? { queuedAgeMs: Math.max(0, Math.round(queuedAgeMs)) }
      : {}),
  };

  if (mutation?.scope === 'attendance') {
    if (mutation.changedRecords && mutation.changedRecords.length > 0) {
      payload.changedRecords = mutation.changedRecords;
    } else if (mutation.changedRecord) {
      payload.changedRecord = mutation.changedRecord;
    } else {
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

  return payload;
}

function scheduleOutboxRetry(explicitDelayMs?: number): void {
  if (retryTimer) return;
  const delayMs =
    explicitDelayMs && explicitDelayMs > 0
      ? explicitDelayMs
      : Math.min(20000, 2000 * Math.pow(2, Math.min(3, retryAttempt)));
  retryAttempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flushPendingCloudWrites({ respectCooldown: false });
  }, delayMs);
}

function computeQueueAgeMs(items: QueuedOutboxItem[]): number {
  let latestMs = 0;
  for (const item of items) {
    const parsed = Date.parse(item.enqueuedAt || '');
    if (!Number.isNaN(parsed) && parsed > latestMs) {
      latestMs = parsed;
    }
  }
  if (latestMs <= 0) return 0;
  return Math.max(0, Math.min(24 * 60 * 60 * 1000, Date.now() - latestMs));
}

function coalesceQueuedBatch(queue: QueuedOutboxItem[]): {
  mutation: DbMutationPayload;
  consumedIds: string[];
  queuedAgeMs: number;
} {
  // Never let an older legacy_bulk item starve critical scoped mutations (attendance punches or settings)
  const firstPriorityIdx = queue.findIndex(
    (q) =>
      q.mutation.scope !== 'legacy_bulk' &&
      q.mutation.scope !== 'full_restore'
  );
  const startIdx =
    queue[0]?.mutation.scope === 'legacy_bulk' && firstPriorityIdx > 0
      ? firstPriorityIdx
      : 0;
  const first = queue[startIdx];
  const consumedItems: QueuedOutboxItem[] = [first];
  const consumedIds: string[] = [first.id];

  if (first.mutation.scope === 'attendance') {
    const byKey = new Map<string, AttendanceRecord>();
    const pushItem = (m: Extract<DbMutationPayload, { scope: 'attendance' }>) => {
      const addRec = (r: AttendanceRecord) => {
        if (!r || !r.id) return;
        const bucket = r.actorAction === 'verify' ? 'verify' : 'mutate';
        byKey.set(`${r.id}::${bucket}`, r);
      };
      if (Array.isArray(m.changedRecords)) {
        for (const r of m.changedRecords) {
          addRec(r);
        }
      } else if (m.changedRecord && m.changedRecord.id) {
        addRec(m.changedRecord);
      }
    };

    const hasExplicitRecords = (m: DbMutationPayload): m is Extract<DbMutationPayload, { scope: 'attendance' }> =>
      m.scope === 'attendance' && (Boolean(m.changedRecord?.id) || Boolean(m.changedRecords?.length));

    if (hasExplicitRecords(first.mutation)) {
      pushItem(first.mutation);
      const baseRole = first.mutation.actorRole;
      for (let i = startIdx + 1; i < queue.length; i++) {
        const nextItem = queue[i];
        if (hasExplicitRecords(nextItem.mutation) && nextItem.mutation.actorRole === baseRole) {
          pushItem(nextItem.mutation);
          consumedItems.push(nextItem);
          consumedIds.push(nextItem.id);
        } else {
          break;
        }
      }
      if (byKey.size > 0) {
        const orderedRecords = Array.from(byKey.values()).sort((a, b) => {
          const aV = a.actorAction === 'verify' ? 1 : 0;
          const bV = b.actorAction === 'verify' ? 1 : 0;
          return aV - bV;
        });
        return {
          mutation: {
            scope: 'attendance',
            changedRecords: orderedRecords,
            actorRole: baseRole,
          },
          consumedIds,
          queuedAgeMs: computeQueueAgeMs(consumedItems),
        };
      }
    }
  } else if (first.mutation.scope === 'settings' || first.mutation.scope === 'shifts') {
    let latest: DbMutationPayload = first.mutation;
    for (let i = startIdx + 1; i < queue.length; i++) {
      if (queue[i].mutation.scope === first.mutation.scope) {
        latest = queue[i].mutation;
        consumedItems.push(queue[i]);
        consumedIds.push(queue[i].id);
      }
    }
    return { mutation: latest, consumedIds, queuedAgeMs: computeQueueAgeMs(consumedItems) };
  } else if (first.mutation.scope === 'employee_upsert') {
    let latest = first.mutation;
    for (let i = startIdx + 1; i < queue.length; i++) {
      const m = queue[i].mutation;
      if (
        m.scope === 'employee_upsert' &&
        m.employee.id === latest.employee.id &&
        Boolean(m.allowClearDevice) === Boolean(latest.allowClearDevice) &&
        Boolean(m.clearPendingRequest) === Boolean(latest.clearPendingRequest) &&
        m.actorRole === latest.actorRole
      ) {
        latest = m;
        consumedItems.push(queue[i]);
        consumedIds.push(queue[i].id);
      }
    }
    return { mutation: latest, consumedIds, queuedAgeMs: computeQueueAgeMs(consumedItems) };
  } else if (first.mutation.scope === 'leaves') {
    let latest = first.mutation;
    for (let i = startIdx + 1; i < queue.length; i++) {
      const m = queue[i].mutation;
      if (
        m.scope === 'leaves' &&
        m.changedLeave?.id &&
        latest.changedLeave?.id &&
        m.changedLeave.id === latest.changedLeave.id &&
        m.actorRole === latest.actorRole
      ) {
        latest = m;
        consumedItems.push(queue[i]);
        consumedIds.push(queue[i].id);
      }
    }
    return { mutation: latest, consumedIds, queuedAgeMs: computeQueueAgeMs(consumedItems) };
  } else if (first.mutation.scope === 'ceoComments') {
    let latest = first.mutation;
    for (let i = startIdx + 1; i < queue.length; i++) {
      const m = queue[i].mutation;
      if (
        m.scope === 'ceoComments' &&
        m.changedComment?.id &&
        latest.changedComment?.id &&
        m.changedComment.id === latest.changedComment.id
      ) {
        latest = m;
        consumedItems.push(queue[i]);
        consumedIds.push(queue[i].id);
      }
    }
    return { mutation: latest, consumedIds, queuedAgeMs: computeQueueAgeMs(consumedItems) };
  }

  return {
    mutation: first.mutation,
    consumedIds,
    queuedAgeMs: computeQueueAgeMs(consumedItems),
  };
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (readOutbox().length > 0) {
      rateLimitCooldownUntilMs = 0;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      void flushPendingCloudWrites({ respectCooldown: false });
    }
  });
}

export function flushPendingCloudWrites(options?: { respectCooldown?: boolean }): Promise<boolean> {
  if (activeFlushPromise) {
    return activeFlushPromise;
  }

  if (options?.respectCooldown && (retryTimer || Date.now() < rateLimitCooldownUntilMs)) {
    return Promise.resolve(false);
  }

  const run = (async (): Promise<boolean> => {
    if (readOutbox().length === 0) return true;

    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }

    isFlushingOutbox = true;
    emitSyncState({ status: 'saving', lastError: undefined });

    let lastServerDb: Record<string, unknown> | null = null;
    let lastUpdatedAt: string | undefined;

    try {
      while (true) {
        const queue = readOutbox();
        if (queue.length === 0) break;

        const { mutation, consumedIds, queuedAgeMs } = coalesceQueuedBatch(queue);
        const payload = buildServerPayload(mutation, queuedAgeMs);
        const bodyStr = JSON.stringify(payload);

        const res = await fetch(`/api/db?t=${Date.now()}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          keepalive: bodyStr.length < 60000,
          body: bodyStr,
        });

        if (!res.ok) {
          let errMsg = `HTTP ${res.status}`;
          let explicitWaitMs: number | undefined;
          try {
            const errJson = await res.json();
            if (errJson?.error) errMsg = String(errJson.error);
            if (res.status === 429 && errJson?.retryAfterSeconds) {
              explicitWaitMs = Math.min(300000, Math.max(5000, Number(errJson.retryAfterSeconds) * 1000));
              rateLimitCooldownUntilMs = Date.now() + explicitWaitMs;
            }
          } catch {
            // ignore non-json error
          }
          emitSyncState({ status: 'retrying', lastError: errMsg });
          scheduleOutboxRetry(explicitWaitMs);
          return false;
        }

        const data = await res.json();
        retryAttempt = 0;
        rateLimitCooldownUntilMs = 0;

        // Pop all coalesced items in this committed batch while preserving any new items appended mid-flight
        const consumedSet = new Set(consumedIds);
        const latestQueue = readOutbox();
        const remaining = latestQueue.filter((q) => !consumedSet.has(q.id));
        writeOutbox(remaining);

        if (data?.updatedAt) {
          lastUpdatedAt = String(data.updatedAt);
          localStorage.setItem(STORAGE_KEY_UPDATED_AT, lastUpdatedAt);
        }
        if (data?.db) {
          lastServerDb = data.db;
        }

        if (remaining.length === 0 && readOutbox().length === 0 && lastServerDb) {
          applyServerDbToLocal(lastServerDb as Parameters<typeof applyServerDbToLocal>[0]);
          if (cloudSyncListener) {
            cloudSyncListener();
          }
        }
      }

      emitSyncState({
        status: 'saved',
        lastSavedAt: lastUpdatedAt || new Date().toISOString(),
        lastError: undefined,
      });
      return true;
    } catch (err) {
      emitSyncState({
        status: 'retrying',
        lastError: err instanceof Error ? err.message : 'Network unavailable',
      });
      scheduleOutboxRetry();
      return false;
    } finally {
      isFlushingOutbox = false;
      activeFlushPromise = null;
      // If another item arrived right before finally cleared activeFlushPromise, flush it promptly
      if (readOutbox().length > 0 && !retryTimer && currentSyncState.status !== 'retrying') {
        void flushPendingCloudWrites({ respectCooldown: true });
      }
    }
  })();

  activeFlushPromise = run;
  return run;
}

export function retryCloudOutboxNow(): Promise<boolean> {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  retryAttempt = 0;
  rateLimitCooldownUntilMs = 0;
  return flushPendingCloudWrites({ respectCooldown: false });
}

function isSupersedingOutboxItem(existing: QueuedOutboxItem, nextMut: DbMutationPayload): boolean {
  const m = existing.mutation;
  if (m.scope !== nextMut.scope) return false;
  if (nextMut.scope === 'settings' || nextMut.scope === 'shifts') return true;
  if (
    nextMut.scope === 'employee_upsert' &&
    m.scope === 'employee_upsert' &&
    m.employee.id === nextMut.employee.id &&
    Boolean(m.allowClearDevice) === Boolean(nextMut.allowClearDevice) &&
    Boolean(m.clearPendingRequest) === Boolean(nextMut.clearPendingRequest) &&
    m.actorRole === nextMut.actorRole
  ) {
    return true;
  }
  if (
    nextMut.scope === 'attendance' &&
    m.scope === 'attendance' &&
    nextMut.changedRecord?.id &&
    m.changedRecord?.id === nextMut.changedRecord.id &&
    (m.changedRecord?.actorAction === 'verify' ? 'verify' : 'mutate') ===
      (nextMut.changedRecord.actorAction === 'verify' ? 'verify' : 'mutate') &&
    m.actorRole === nextMut.actorRole
  ) {
    return true;
  }
  if (
    nextMut.scope === 'leaves' &&
    m.scope === 'leaves' &&
    nextMut.changedLeave?.id &&
    m.changedLeave?.id === nextMut.changedLeave.id &&
    m.actorRole === nextMut.actorRole
  ) {
    return true;
  }
  if (
    nextMut.scope === 'ceoComments' &&
    m.scope === 'ceoComments' &&
    nextMut.changedComment?.id &&
    m.changedComment?.id === nextMut.changedComment.id
  ) {
    return true;
  }
  return false;
}

export function pushDatabaseToServer(mutation?: DbMutationPayload): Promise<boolean> {
  const resolvedMutation = mutation || { scope: 'legacy_bulk' as const };
  const item: QueuedOutboxItem = {
    id: `mut-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    enqueuedAt: new Date().toISOString(),
    mutation: resolvedMutation,
  };

  // Deduplicate redundant retries while skipping item 0 if an active flush is currently transmitting it
  const current = readOutbox();
  const protectedHeadId = isFlushingOutbox && current.length > 0 ? current[0].id : null;
  const filtered = current.filter(
    (q) => q.id === protectedHeadId || !isSupersedingOutboxItem(q, resolvedMutation)
  );
  writeOutbox([...filtered, item]);
  emitSyncState({ status: 'saving', lastError: undefined });

  return flushPendingCloudWrites({ respectCooldown: false });
}

export async function syncDatabaseFromServer(forceAccept = false): Promise<boolean> {
  if (hasPendingCloudWrites() || isSyncingFromServer) {
    return false;
  }
  try {
    const res = await fetch(`/api/db?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;

    // Abort applying poll result if any local write entered the outbox while GET was in-flight
    if (hasPendingCloudWrites()) {
      return false;
    }

    const data = await res.json();
    if (data && Array.isArray(data.employees) && Array.isArray(data.attendance)) {
      const localUpdatedAt = localStorage.getItem(STORAGE_KEY_UPDATED_AT);
      if (!forceAccept && localUpdatedAt && data.updatedAt && data.updatedAt === localUpdatedAt) {
        return false;
      }

      if (hasPendingCloudWrites()) {
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
    void pushDatabaseToServer({ scope: 'legacy_bulk' });
  } catch (err) {
    console.error('Failed to save employees:', err);
  }
}

export function saveEmployeeUpsert(
  employees: Employee[],
  changedEmployee: Employee,
  options?: { allowClearDevice?: boolean; clearPendingRequest?: boolean; actorRole?: Role }
): Promise<boolean> {
  try {
    localStorage.setItem(STORAGE_KEY_EMPLOYEES, JSON.stringify(employees));
    return pushDatabaseToServer({
      scope: 'employee_upsert',
      employee: changedEmployee,
      allowClearDevice: options?.allowClearDevice,
      clearPendingRequest: options?.clearPendingRequest,
      actorRole: options?.actorRole,
    });
  } catch (err) {
    console.error('Failed to save employee:', err);
    return Promise.resolve(false);
  }
}

export function saveEmployeeDelete(
  employees: Employee[],
  deletedEmployeeId: string,
  actorRole?: Role
): Promise<boolean> {
  try {
    localStorage.setItem(STORAGE_KEY_EMPLOYEES, JSON.stringify(employees));
    return pushDatabaseToServer({
      scope: 'employee_delete',
      deletedEmployeeId,
      actorRole,
    });
  } catch (err) {
    console.error('Failed to delete employee:', err);
    return Promise.resolve(false);
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

export function updateAttendanceRecordsLocalCacheOnly(records: AttendanceRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_ATTENDANCE, JSON.stringify(records));
  } catch (err) {
    console.error('Failed to update local attendance cache:', err);
  }
}

export function saveAttendanceRecords(
  records: AttendanceRecord[],
  changedOrBatch?: AttendanceRecord | AttendanceRecord[],
  actorRole?: Role
): Promise<boolean> {
  try {
    localStorage.setItem(STORAGE_KEY_ATTENDANCE, JSON.stringify(records));
    if (Array.isArray(changedOrBatch)) {
      if (changedOrBatch.length === 0) return Promise.resolve(true);
      return pushDatabaseToServer({
        scope: 'attendance',
        changedRecords: changedOrBatch,
        actorRole,
      });
    } else {
      return pushDatabaseToServer({
        scope: 'attendance',
        changedRecord: changedOrBatch,
        actorRole,
      });
    }
  } catch (err) {
    console.error('Failed to save attendance records:', err);
    return Promise.resolve(false);
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

export function saveShifts(shifts: ShiftSchedule[], actorRole?: Role): Promise<boolean> {
  try {
    localStorage.setItem(STORAGE_KEY_SHIFTS, JSON.stringify(shifts));
    return pushDatabaseToServer({ scope: 'shifts', actorRole });
  } catch (err) {
    console.error('Failed to save shifts:', err);
    return Promise.resolve(false);
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

export function saveLeaves(
  leaves: LeaveRequest[],
  changedLeave?: LeaveRequest,
  actorRole?: Role
): Promise<boolean> {
  try {
    localStorage.setItem(STORAGE_KEY_LEAVES, JSON.stringify(leaves));
    return pushDatabaseToServer({ scope: 'leaves', changedLeave, actorRole });
  } catch (err) {
    console.error('Failed to save leaves:', err);
    return Promise.resolve(false);
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

export function saveCeoComments(
  comments: CeoComment[],
  changedComment?: CeoComment,
  actorRole?: Role
): Promise<boolean> {
  try {
    localStorage.setItem(STORAGE_KEY_CEO_COMMENTS, JSON.stringify(comments));
    return pushDatabaseToServer({ scope: 'ceoComments', changedComment, actorRole });
  } catch (err) {
    console.error('Failed to save CEO comments:', err);
    return Promise.resolve(false);
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
      enforceDeviceBinding: false,
      allowAdminBypassDeviceBinding: parsed.allowAdminBypassDeviceBinding ?? true,
      allowKioskPunchWithoutDevice: parsed.allowKioskPunchWithoutDevice ?? true,
      allowAutoStartPunch: parsed.allowAutoStartPunch ?? false,
      enableDisconnectStatusTracking: parsed.enableDisconnectStatusTracking ?? true,
      autoPunchOutOnInactiveHours:
        parsed.autoPunchOutOnInactiveHours !== undefined
          ? Number(parsed.autoPunchOutOnInactiveHours)
          : 2,
      disconnectThresholdMinutes:
        parsed.disconnectThresholdMinutes !== undefined
          ? Number(parsed.disconnectThresholdMinutes)
          : 3,
    };
    return upgraded;
  } catch {
    return INITIAL_SETTINGS;
  }
}

export function saveSettings(settings: OfficeSettings, actorRole?: Role): void {
  try {
    const stamped: OfficeSettings = {
      ...settings,
      settingsUpdatedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(stamped));
    void pushDatabaseToServer({ scope: 'settings', actorRole });
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
    void pushDatabaseToServer({ scope: 'full_restore', actorRole: 'admin' });
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
  localStorage.removeItem(STORAGE_KEY_OUTBOX);
  localStorage.removeItem(STORAGE_KEY_SESSION);
  sessionStorage.removeItem(STORAGE_KEY_SESSION);
}
