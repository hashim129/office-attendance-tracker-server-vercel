import { AttendanceRecord, Employee, LeaveRequest, ShiftSchedule } from '../types';

/**
 * Who was present, who was absent, and the full picture for any day or range of days.
 * An employee counts as ABSENT on a working day when there is no attendance record and no approved leave.
 */
export type DayStatus = 'present' | 'late' | 'half_day' | 'on_leave' | 'absent' | 'not_in_yet';
export interface DailyRow {
  date: string;
  employee: Employee;
  status: DayStatus;
  record?: AttendanceRecord;
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const eachDay = (from: string, to: string, cap = 366): string[] => {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  while (d <= end && out.length < cap) { out.push(ymd(d)); d.setDate(d.getDate() + 1); }
  return out;
};

export function buildDailyRows(o: {
  from: string;
  to: string;
  employees: Employee[];
  records: AttendanceRecord[];
  leaves?: LeaveRequest[];
  shifts: ShiftSchedule[];
  /** today's date (YYYY-MM-DD) and the current clock, so that today's "not in yet" can be told apart from "absent" */
  today: string;
  nowHm: string;
  /** most days one report may span (default one year) */
  maxDays?: number;
}): DailyRow[] {
  const byKey = new Map<string, AttendanceRecord>();
  // an employee can have more than one record in a day (overnight shifts); the one with the earliest punch-in represents the day
  [...o.records].sort((a, b) => String(a.timeIn).localeCompare(String(b.timeIn))).forEach((r) => { const k = `${r.employeeId}|${r.date}`; if (!byKey.has(k)) byKey.set(k, r); });
  const approved = (o.leaves || []).filter((l) => l.status === 'approved');
  const rows: DailyRow[] = [];
  for (const date of eachDay(o.from, o.to, o.maxDays ?? 366)) {
    const dow = new Date(`${date}T12:00:00`).getDay();
    for (const employee of o.employees) {
      if (employee.joinedDate && date < String(employee.joinedDate).slice(0, 10)) continue;
      const record = byKey.get(`${employee.id}|${date}`);
      if (record) {
        const st = record.status === 'absent' || record.status === 'on_leave' || record.status === 'half_day' || record.status === 'late' ? record.status : 'present';
        rows.push({ date, employee, status: st, record });
        continue;
      }
      if (approved.some((l) => l.employeeId === employee.id && l.startDate <= date && l.endDate >= date)) { rows.push({ date, employee, status: 'on_leave' }); continue; }
      const shift = o.shifts.find((s) => s.id === employee.shiftId) || o.shifts[0];
      const isWorkDay = shift ? shift.workDays.includes(dow) : dow >= 1 && dow <= 5;
      if (!isWorkDay || date > o.today) continue; // day off or still in the future: nothing to report
      if (date === o.today && shift && !shift.isNoRestriction && o.nowHm < shift.endTime) { rows.push({ date, employee, status: 'not_in_yet' }); continue; }
      rows.push({ date, employee, status: 'absent' });
    }
  }
  return rows.sort((a, b) => (a.date === b.date ? a.employee.name.localeCompare(b.employee.name) : a.date.localeCompare(b.date)));
}

export type DailyReportKind = 'present' | 'absent' | 'collective';
export const filterDailyRows = (rows: DailyRow[], kind: DailyReportKind): DailyRow[] => {
  if (kind === 'collective') return rows;
  if (kind === 'present') return rows.filter((r) => r.status === 'present' || r.status === 'late' || r.status === 'half_day');
  return rows.filter((r) => r.status === 'absent');
};
