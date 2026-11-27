import type { AttendanceRecord, Employee, ShiftSchedule } from '../types';
import { calculateWorkedMinutes, isLateArrival, formatTime12h } from './attendanceCalculations';
import { downloadReportPdf } from './reportPdf';

/** Monthly attendance & pay summary PDF for one employee (days, in/out, hours, late days, overtime, estimated pay). */
export async function downloadMonthlySummary(emp: Employee, records: AttendanceRecord[], shifts: ShiftSchedule[], month: string, companyName: string): Promise<void> {
  const shift = shifts.find((s) => s.id === emp.shiftId);
  const expected = Number((shift as any)?.expectedHours) || 8;
  const mine = records.filter((r) => r.employeeId === emp.id && r.date.slice(0, 7) === month && r.timeIn).sort((a, b) => a.date.localeCompare(b.date));
  let total = 0; let over = 0; let late = 0; let wfh = 0;
  const rows = mine.map((r) => {
    const m = calculateWorkedMinutes(r.timeIn, r.timeOut || undefined, r.breaks, expected);
    total += m.totalWorkedMinutes; over += r.isAutoPunchedOut ? 0 : m.overtimeMinutes;
    const isLate = shift ? isLateArrival(r.timeIn, shift) : false;
    if (isLate) late++;
    if ((r as any).workMode === 'wfh') wfh++;
    const h = (x: number) => `${Math.floor(x / 60)}h ${String(x % 60).padStart(2, '0')}m`;
    return { date: new Date(`${r.date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }), in: formatTime12h(r.timeIn), out: r.timeOut ? formatTime12h(r.timeOut) : '—', hours: h(m.totalWorkedMinutes), note: [isLate ? 'Late' : '', (r as any).workMode === 'wfh' ? 'WFH' : '', r.isAutoPunchedOut ? 'Auto punch-out' : ''].filter(Boolean).join(' · ') };
  });
  const hrs = (x: number) => `${Math.floor(x / 60)}h ${String(x % 60).padStart(2, '0')}m`;
  const rate = Number(emp.hourlyRate) || 0;
  const summary: [string, string][] = [['Days worked', String(mine.length)], ['Late days', String(late)], ['Work from home', String(wfh)], ['Total hours', hrs(total)], ['Overtime', hrs(over)]];
  if (rate > 0) summary.push(['Estimated pay (hours × rate)', `PKR ${Math.round((total / 60) * rate).toLocaleString()}`]);
  const label = new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  await downloadReportPdf({
    title: `Attendance summary · ${label}`, subtitle: `${emp.name} (${emp.employeeCode})${shift ? ` · ${shift.name}` : ''}`, companyName, generatedBy: emp.name, summary,
    columns: [{ key: 'date', label: 'Day', width: 2 }, { key: 'in', label: 'In', width: 1.4 }, { key: 'out', label: 'Out', width: 1.4 }, { key: 'hours', label: 'Hours', width: 1.4, align: 'right' }, { key: 'note', label: 'Note', width: 2.4 }],
    rows,
  }, `attendance-${emp.name.replace(/\s+/g, '-')}-${month}`);
}
