import { AttendanceRecord, Employee, OfficeSettings, ShiftSchedule } from '../types';

export type DerivedWorkingState = 'in' | 'no_internet' | 'break' | 'out' | 'absent';

/**
 * Compute authoritative live working state for an attendance record.
 * Explicit Break ALWAYS takes precedence over disconnectivity or active work.
 */
export function deriveLiveAttendanceState(params: {
  record?: AttendanceRecord;
  settings?: OfficeSettings;
  todayStr?: string;
  nowMs?: number;
  isCurrentUserOffline?: boolean;
  isCurrentUserConnected?: boolean;
}): DerivedWorkingState {
  const {
    record,
    settings,
    todayStr = getTodayDateString(),
    nowMs = Date.now(),
    isCurrentUserOffline = false,
    isCurrentUserConnected = false,
  } = params;

  if (!record || !record.timeIn) return 'absent';
  if (record.timeOut) return 'out';

  // Priority rule: If employee sets on break, it stays Break regardless of network/idle
  const activeBreak = Array.isArray(record.breaks) && record.breaks.some((b) => !b.end);
  if (activeBreak) return 'break';

  if (settings?.enableDisconnectStatusTracking !== false && record.date === todayStr) {
    if (isCurrentUserOffline) return 'no_internet';
    if (isCurrentUserConnected) return 'in';
    if (record.connectionStatus === 'no_internet') return 'no_internet';

    const lastHbMs = record.lastHeartbeatAt ? Date.parse(record.lastHeartbeatAt) : NaN;
    if (!record.lastHeartbeatAt || Number.isNaN(lastHbMs)) {
      return 'no_internet';
    }

    if (record.monitoringPaused && nowMs - lastHbMs > 15000) {
      return 'no_internet';
    }

    const baseDisconnectMs = Math.max(1, settings?.disconnectThresholdMinutes ?? 3) * 60 * 1000;
    const adaptiveFloorMs = record.heartbeatIntervalMs
      ? Number(record.heartbeatIntervalMs) + 90000
      : 0;
    const disconnectMs = Math.max(baseDisconnectMs, adaptiveFloorMs);
    if (nowMs - lastHbMs > disconnectMs) {
      return 'no_internet';
    }
  }

  return 'in';
}

/**
 * Format total minutes into human readable "Xh Ym" or "0m"
 */
export function formatMinutesToHoursMinutes(totalMinutes: number): string {
  if (!totalMinutes || totalMinutes <= 0) return '0h 00m';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
}

/**
 * Format minutes into decimal hours e.g. 8.25
 */
export function formatMinutesToDecimal(totalMinutes: number): string {
  if (!totalMinutes || totalMinutes <= 0) return '0.00';
  return (totalMinutes / 60).toFixed(2);
}

/**
 * Parse "HH:mm" or "HH:mm:ss" string to minutes from midnight
 */
export function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.split(':').map((p) => parseInt(p, 10));
  const hours = parts[0] || 0;
  const minutes = parts[1] || 0;
  return hours * 60 + minutes;
}

/**
 * Get current local date in YYYY-MM-DD format
 */
export function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get weekday name from date string or Date
 */
export function getDayName(dateInput: string | Date): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput + 'T00:00:00') : dateInput;
  return date.toLocaleDateString('en-US', { weekday: 'long' });
}

/**
 * Get current time string in HH:mm:ss format
 */
export function getCurrentTimeString(): string {
  const now = new Date();
  return now.toTimeString().split(' ')[0]; // "09:15:30"
}

/**
 * Calculate total break duration in minutes
 */
export function calculateBreaksDuration(breaks: AttendanceRecord['breaks']): number {
  if (!breaks || breaks.length === 0) return 0;
  return breaks.reduce((total, b) => {
    if (!b.end) return total;
    const startMins = parseTimeToMinutes(b.start);
    const endMins = parseTimeToMinutes(b.end);
    const diff = endMins >= startMins ? endMins - startMins : 24 * 60 - startMins + endMins;
    return total + Math.max(0, diff);
  }, 0);
}

/**
 * Calculate net worked minutes, regular minutes, and overtime minutes
 */
export function calculateWorkedMinutes(
  timeIn: string,
  timeOut: string | undefined,
  breaks: AttendanceRecord['breaks'],
  expectedShiftHours: number = 8
): { totalWorkedMinutes: number; regularMinutes: number; overtimeMinutes: number } {
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

  return {
    totalWorkedMinutes: netWorked,
    regularMinutes: regular,
    overtimeMinutes: overtime,
  };
}

/**
 * Determine if arrival is late compared to shift schedule
 */
export function isLateArrival(timeIn: string, shift: ShiftSchedule): boolean {
  if (!timeIn || !shift) return false;
  // Shifts with no restriction (e.g. I.T / Freelance Shift) are never marked late
  if (shift.isNoRestriction || shift.id === 'shift-freelance' || (shift.startTime === '00:00' && shift.endTime === '23:59')) {
    return false;
  }
  const punchMins = parseTimeToMinutes(timeIn);
  const shiftStartMins = parseTimeToMinutes(shift.startTime);
  const graceLimit = shiftStartMins + (shift.graceMinutes || 0);
  return punchMins > graceLimit;
}

/**
 * Format time to 12-hour AM/PM string
 */
export function formatTime12h(timeStr?: string): string {
  if (!timeStr) return '--:--';
  const parts = timeStr.split(':');
  if (parts.length < 2) return timeStr;
  let hours = parseInt(parts[0], 10);
  const mins = parts[1];
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // 0 is 12
  return `${hours}:${mins} ${ampm}`;
}

/**
 * Web Audio synthetic chime for positive feedback on punch
 */
export function playPunchSound(type: 'in' | 'out' | 'break') {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'in') {
      // Ascending pleasant chord
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.exponentialRampToValueAtTime(659.25, ctx.currentTime + 0.1); // E5
      osc.frequency.exponentialRampToValueAtTime(783.99, ctx.currentTime + 0.2); // G5
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.35);
    } else if (type === 'out') {
      // Descending completion tone
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(783.99, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(523.25, ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.35);
    } else {
      // Soft double chime for break
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.2);
    }
  } catch {
    // Audio autoplay restrictions or headless env
  }
}

function addDaysYmdLocal(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return ymd;
  const dt = new Date(y, m - 1, d + deltaDays, 12, 0, 0);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function buildLocalMs(ymd: string, timeStr: string, fallback = '09:00:00'): number {
  const [y, m, d] = ymd.split('-').map((n) => parseInt(n, 10));
  const parts = String(timeStr || fallback).trim().split(':');
  const hh = parseInt(parts[0] || '0', 10) || 0;
  const mm = parseInt(parts[1] || '0', 10) || 0;
  const ss = parts[2] !== undefined ? parseInt(parts[2] || '0', 10) || 0 : 0;
  if (!y || !m || !d) return NaN;
  return new Date(y, m - 1, d, hh, mm, ss, 0).getTime();
}

export function getShiftEndWindowMs(
  recordDate: string,
  timeIn: string,
  shift?: Partial<ShiftSchedule>,
  graceHours: number = 2
): {
  inMs: number;
  shiftEndMs: number;
  checkAtMs: number;
  isOvernightShift: boolean;
} {
  const startTime = shift?.startTime || '09:00';
  const endTime = shift?.endTime || '17:00';
  const startMins = parseTimeToMinutes(startTime);
  const endMins = parseTimeToMinutes(endTime);
  const inMins = parseTimeToMinutes(timeIn);
  const isOvernightShift = endMins < startMins;

  const inMs = buildLocalMs(recordDate, timeIn);
  const endDateStr =
    isOvernightShift && inMins > endMins ? addDaysYmdLocal(recordDate, 1) : recordDate;
  const shiftEndMs = buildLocalMs(endDateStr, endTime);
  const cleanGrace = Math.max(0, Number(graceHours || 0));
  const checkAtMs = shiftEndMs + cleanGrace * 60 * 60 * 1000;

  return { inMs, shiftEndMs, checkAtMs, isOvernightShift };
}

/**
 * Returns live worked/overtime minutes when an employee is actively working online
 * past Shift End + grace window (2h), or the persisted values otherwise.
 */
export function getLiveWorkedStats(params: {
  record?: AttendanceRecord;
  shift?: Partial<ShiftSchedule>;
  settings?: OfficeSettings;
  liveState?: DerivedWorkingState;
  nowMs?: number;
}): { totalWorkedMinutes: number; regularMinutes: number; overtimeMinutes: number; isLiveOvertime: boolean } {
  const { record, shift, settings, liveState, nowMs = Date.now() } = params;
  if (!record || !record.timeIn) {
    return { totalWorkedMinutes: 0, regularMinutes: 0, overtimeMinutes: 0, isLiveOvertime: false };
  }
  if (record.timeOut) {
    let totalWorked = record.totalWorkedMinutes || 0;
    let regular = record.regularMinutes || 0;
    let overtime = record.overtimeMinutes || 0;
    if (!totalWorked || totalWorked === 0) {
      const calc = calculateWorkedMinutes(
        record.timeIn,
        record.timeOut,
        record.breaks,
        shift?.expectedHours || 8
      );
      totalWorked = calc.totalWorkedMinutes;
      regular = calc.regularMinutes;
      overtime = calc.overtimeMinutes;
    }
    return {
      totalWorkedMinutes: totalWorked,
      regularMinutes: regular,
      overtimeMinutes: overtime,
      isLiveOvertime: false,
    };
  }

  const expectedHours = shift?.expectedHours || 8;
  const todayStr = getTodayDateString();

  // If currently working on today's shift, compute running live worked minutes
  if (liveState === 'in' || liveState === 'break' || record.date === todayStr) {
    const inMins = parseTimeToMinutes(record.timeIn);
    const now = new Date(nowMs);
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const rawElapsed = nowMins >= inMins ? nowMins - inMins : 24 * 60 - inMins + nowMins;
    const breakMins = calculateBreaksDuration(record.breaks || []);
    const netWorked = Math.max(0, rawElapsed - breakMins);
    const threshold = Math.max(1, expectedHours) * 60;
    const regular = Math.min(netWorked, threshold);
    const overtime = Math.max(0, netWorked - threshold);
    return {
      totalWorkedMinutes: Math.max(netWorked, record.totalWorkedMinutes || 0),
      regularMinutes: Math.max(regular, record.regularMinutes || 0),
      overtimeMinutes: Math.max(overtime, record.overtimeMinutes || 0),
      isLiveOvertime: overtime > 0,
    };
  }

  return {
    totalWorkedMinutes: record.totalWorkedMinutes || 0,
    regularMinutes: record.regularMinutes || 0,
    overtimeMinutes: record.overtimeMinutes || 0,
    isLiveOvertime: false,
  };
}

function finalizeAutoClosedRecord(params: {
  record: AttendanceRecord;
  autoOutTime: string;
  autoRemark: string;
  reason: 'midnight' | 'shift_end_2h';
  expectedHours: number;
}): AttendanceRecord {
  const { record, autoOutTime, autoRemark, reason, expectedHours } = params;
  const updatedBreaks = (record.breaks || []).map((b) =>
    !b.end ? { ...b, end: autoOutTime } : b
  );
  const { totalWorkedMinutes, regularMinutes, overtimeMinutes } = calculateWorkedMinutes(
    record.timeIn,
    autoOutTime,
    updatedBreaks,
    expectedHours
  );
  const existingNotes = record.notes ? record.notes.trim() : '';
  const finalNotes = existingNotes
    ? existingNotes.includes(autoRemark)
      ? existingNotes
      : `${existingNotes} · ${autoRemark}`
    : autoRemark;

  return {
    ...record,
    timeOut: autoOutTime,
    breaks: updatedBreaks,
    totalWorkedMinutes,
    regularMinutes,
    overtimeMinutes,
    notes: finalNotes,
    isAutoPunchedOut: true,
    autoPunchOutReason: reason,
    adminKeepOpen: false,
    lastEditedByRole: undefined,
    actorAction: 'auto_close',
    recordUpdatedAt: new Date().toISOString(),
  };
}

/**
 * Evaluates open attendance punches against:
 * 1. Shift-End + 2h (configurable) rule: if user is live through internet & working (!onBreak),
 *    keep open for live overtime; otherwise if disconnected / offline / forgot to logout, auto punch out.
 *    (Device idle timeout during shift has been removed.)
 * 2. End-of-day (23:59:00) safety net for forgotten punches (skipping active overnight shifts and Admin keep-open).
 */
export function autoCloseForgottenPunches(
  records: AttendanceRecord[],
  shifts: ShiftSchedule[],
  settings?: OfficeSettings,
  employees?: Employee[]
): { updatedRecords: AttendanceRecord[]; hasChanges: boolean } {
  const today = getTodayDateString();
  const nowTime = getCurrentTimeString();
  const nowMs = Date.now();
  let hasChanges = false;

  const defaultShift = shifts[0] || {
    startTime: '09:00',
    endTime: '17:00',
    expectedHours: 8,
  };
  const empMap = employees ? new Map(employees.map((e) => [e.id, e])) : null;
  const shiftMap = new Map(shifts.map((s) => [s.id, s]));

  const disconnectMs = Math.max(1, settings?.disconnectThresholdMinutes ?? 3) * 60 * 1000;
  const overtimeHoursRaw =
    settings?.autoPunchOutOnInactiveHours !== undefined
      ? Number(settings.autoPunchOutOnInactiveHours)
      : 2;
  const overtimeGraceMs =
    overtimeHoursRaw > 0 ? overtimeHoursRaw * 60 * 60 * 1000 : 0;

  const updatedRecords = records.map((record) => {
    if (!record.timeIn || record.timeOut) return record;

    const emp = empMap?.get(record.employeeId);
    const shift = (emp && shiftMap.get(emp.shiftId)) || defaultShift;
    const expectedHours = shift.expectedHours || 8;

    const adminOverrideMs = record.adminOverrideAt ? Date.parse(record.adminOverrideAt) : 0;
    const midnightCutoffMs = record.date ? buildLocalMs(record.date, '23:59:00') : 0;
    const adminKeptOpenPastCutoff =
      record.adminKeepOpen === true ||
      (adminOverrideMs > 0 && midnightCutoffMs > 0 && adminOverrideMs > midnightCutoffMs);

    const { inMs, shiftEndMs, checkAtMs, isOvernightShift } = getShiftEndWindowMs(
      record.date,
      record.timeIn,
      shift,
      overtimeHoursRaw
    );

    const onBreak = Array.isArray(record.breaks) && record.breaks.some((b) => !b.end);
    const isKioskSession =
      record.heartbeatSource === 'kiosk' ||
      (!record.heartbeatSource && String(record.notes || '').startsWith('Lobby Kiosk Punch'));

    const lastHbMs = record.lastHeartbeatAt ? Date.parse(record.lastHeartbeatAt) : NaN;
    const adaptiveFloorMs = record.heartbeatIntervalMs ? Number(record.heartbeatIntervalMs) + 90000 : 0;
    const effectiveDisconnectMs = Math.max(disconnectMs, adaptiveFloorMs);
    const isLiveConnected =
      !isKioskSession &&
      !Number.isNaN(lastHbMs) &&
      !record.monitoringPaused &&
      record.connectionStatus !== 'no_internet' &&
      nowMs - lastHbMs <= effectiveDisconnectMs;

    const adminReopenedAfterCheck =
      adminOverrideMs > 0 &&
      !Number.isNaN(checkAtMs) &&
      adminOverrideMs >= checkAtMs &&
      (record.adminKeepOpen === true ||
        nowMs - adminOverrideMs < Math.max(overtimeGraceMs, effectiveDisconnectMs));

    // 1. Shift-End + 2h evaluation: live & working -> overtime; offline / forgot to logout -> auto punch out
    if (
      overtimeGraceMs > 0 &&
      !Number.isNaN(inMs) &&
      !Number.isNaN(checkAtMs) &&
      inMs < checkAtMs &&
      nowMs >= checkAtMs &&
      !adminReopenedAfterCheck
    ) {
      if (!onBreak && isLiveConnected) {
        // Keep clocked in for live overtime (persisted by server/heartbeat)
        return record;
      }

      let candidateOutMs =
        !Number.isNaN(lastHbMs) && lastHbMs > checkAtMs && lastHbMs <= nowMs
          ? lastHbMs
          : checkAtMs;
      if (candidateOutMs > nowMs) candidateOutMs = nowMs;
      if (!isOvernightShift && !Number.isNaN(midnightCutoffMs) && candidateOutMs > midnightCutoffMs) {
        candidateOutMs = midnightCutoffMs;
      }

      if (candidateOutMs >= inMs) {
        hasChanges = true;
        const outDt = new Date(candidateOutMs);
        const outDateStr = `${outDt.getFullYear()}-${String(outDt.getMonth() + 1).padStart(2, '0')}-${String(outDt.getDate()).padStart(2, '0')}`;
        const outTimeStr = outDt.toTimeString().split(' ')[0];
        const effectiveOutTime =
          !isOvernightShift && outDateStr > record.date ? '23:59:00' : outTimeStr;

        return finalizeAutoClosedRecord({
          record,
          autoOutTime: effectiveOutTime,
          autoRemark: `Auto Punched Out (Shift Ended + ${overtimeHoursRaw}h)`,
          reason: 'shift_end_2h',
          expectedHours,
        });
      }
    }

    // 2. End-of-day (23:59:00) safety net
    const isPastDay = record.date < today;
    const isPastMidnightToday = record.date === today && nowTime >= '23:59:00';
    const isActiveOvernightRunning =
      isOvernightShift && !Number.isNaN(shiftEndMs) && nowMs < shiftEndMs;

    if (
      (isPastDay || isPastMidnightToday) &&
      !isActiveOvernightRunning &&
      !adminKeptOpenPastCutoff
    ) {
      hasChanges = true;
      return finalizeAutoClosedRecord({
        record,
        autoOutTime: '23:59:00',
        autoRemark: 'Auto system Punched out',
        reason: 'midnight',
        expectedHours,
      });
    }

    return record;
  });

  return { updatedRecords, hasChanges };
}

/**
 * Computes net worked seconds in real-time up to `nowMs` for an active employee
 * (subtracting both completed breaks and any currently running break).
 */
export function computeLiveElapsedWorkedSeconds(
  record?: AttendanceRecord | null,
  nowMs: number = Date.now()
): number {
  if (!record || !record.timeIn) return 0;

  if (record.timeOut) {
    return Math.max(0, Math.round((record.totalWorkedMinutes || 0) * 60));
  }

  const inMs = buildLocalMs(record.date, record.timeIn);
  if (Number.isNaN(inMs)) {
    return Math.max(0, Math.round((record.totalWorkedMinutes || 0) * 60));
  }

  const totalElapsedSec = Math.max(0, Math.floor((nowMs - inMs) / 1000));
  const breaks = Array.isArray(record.breaks) ? record.breaks : [];
  let breakSec = 0;

  for (const b of breaks) {
    const startMs = Date.parse(b.start);
    if (Number.isNaN(startMs)) continue;
    const endMs = b.end ? Date.parse(b.end) : nowMs;
    if (!Number.isNaN(endMs) && endMs > startMs) {
      breakSec += Math.floor((endMs - startMs) / 1000);
    }
  }

  const fallbackBreakSec =
    breakSec === 0 && breaks.length > 0 ? calculateBreaksDuration(breaks) * 60 : breakSec;

  return Math.max(0, totalElapsedSec - fallbackBreakSec);
}

/** Formats non-negative seconds as HH:MM:SS for live working counters. */
export function formatSecondsToClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}


