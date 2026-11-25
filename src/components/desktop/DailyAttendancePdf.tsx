import React, { useMemo, useState } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';
import { AttendanceRecord, Employee, LeaveRequest, ShiftSchedule } from '../../types';
import { formatMinutesToHoursMinutes, formatTime12h, getTodayDateString } from '../../lib/attendanceCalculations';
import { DailyReportKind, DayStatus, buildDailyRows, filterDailyRows } from '../../lib/attendanceDaily';
import { downloadReportPdf, fmtDayText, safeFileName } from '../../lib/reportPdf';

/**
 * Attendance PDFs for any day or range: everyone who is present, everyone who is absent, or the collective report.
 * "Selected data" = chosen dates (and people); "All collective data" = every day on record, everybody.
 */
interface Props {
  employees: Employee[];
  records: AttendanceRecord[];
  leaves?: LeaveRequest[];
  shifts: ShiftSchedule[];
  currentUser?: Employee;
}

const LABEL: Record<DayStatus, string> = { present: 'Present', late: 'Present (late)', half_day: 'Half day', on_leave: 'On leave', absent: 'Absent', not_in_yet: 'Not in yet' };
const KIND_TEXT: Record<DailyReportKind, string> = { present: 'All present', absent: 'All absent', collective: 'Collective report (everyone)' };
const field = 'w-full px-2.5 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100';

export const DailyAttendancePdf: React.FC<Props> = ({ employees, records, leaves, shifts, currentUser }) => {
  const today = getTodayDateString();
  const [mode, setMode] = useState<'selected' | 'all'>('selected');
  const [kind, setKind] = useState<DailyReportKind>('present');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [who, setWho] = useState('all');
  const [dept, setDept] = useState('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const people = useMemo(() => employees.filter((e) => e.isActive !== false), [employees]);
  const depts = useMemo(() => [...new Set(people.map((e) => e.department).filter(Boolean))].sort(), [people]);
  const firstRecord = useMemo(() => records.reduce((m, r) => (!m || r.date < m ? r.date : m), ''), [records]);

  const range = mode === 'all' ? { from: firstRecord || today, to: today } : { from: from || today, to: to || today };
  const rows = useMemo(() => {
    const pool = mode === 'all' ? people : people.filter((e) => (who === 'all' || e.id === who) && (dept === 'all' || e.department === dept));
    const now = new Date();
    const all = buildDailyRows({ from: range.from, to: range.to, employees: pool, records, leaves, shifts, today, maxDays: mode === 'all' ? 3700 : 366, nowHm: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` });
    return filterDailyRows(all, kind);
  }, [mode, people, who, dept, range.from, range.to, records, leaves, shifts, today, kind]);

  const count = (s: DayStatus[]) => rows.filter((r) => s.includes(r.status)).length;
  const tooLong = mode === 'selected' && from && to && (new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 86400000 > 365;

  const download = async () => {
    setBusy(true);
    setError('');
    try {
      const single = range.from === range.to;
      const scope = mode === 'all' ? 'All collective data' : `${single ? fmtDayText(range.from) : `${fmtDayText(range.from)} to ${fmtDayText(range.to)}`}${who !== 'all' ? `, ${people.find((e) => e.id === who)?.name || ''}` : ''}${dept !== 'all' ? `, ${dept} department` : ''}`;
      await downloadReportPdf({
        title: `Attendance - ${KIND_TEXT[kind]}`,
        subtitle: `${scope}. Absent = a working day with no attendance record and no approved leave.`,
        generatedBy: currentUser?.name,
        columns: [
          { key: 'date', label: 'Date', width: 1.1 },
          { key: 'name', label: 'Employee', width: 1.8 },
          { key: 'code', label: 'Code', width: 0.8 },
          { key: 'dept', label: 'Department', width: 1.3 },
          { key: 'status', label: 'Status', width: 1.1 },
          { key: 'in', label: 'Time in', width: 0.9 },
          { key: 'out', label: 'Time out', width: 0.9 },
          { key: 'worked', label: 'Worked', width: 0.9, align: 'right' },
          { key: 'notes', label: 'Remarks', width: 2.2 },
        ],
        rows: rows.map((r) => ({
          date: fmtDayText(r.date), name: r.employee.name, code: r.employee.employeeCode || '-', dept: r.employee.department || '-', status: LABEL[r.status],
          in: r.record ? formatTime12h(r.record.timeIn) : '-', out: r.record?.timeOut ? formatTime12h(r.record.timeOut) : '-', worked: r.record ? formatMinutesToHoursMinutes(r.record.totalWorkedMinutes) : '-',
          notes: r.record?.notes || '',
        })),
        summary: [['Rows', String(rows.length)], ['Present', String(count(['present', 'late', 'half_day']))], ['Late', String(count(['late']))], ['Absent', String(count(['absent']))], ['On leave', String(count(['on_leave']))]],
        landscape: true,
      }, `attendance-${kind}_${mode === 'all' ? 'all' : single ? range.from : `${range.from}_to_${range.to}`}${who !== 'all' ? `_${safeFileName(people.find((e) => e.id === who)?.name || '')}` : ''}.pdf`);
    } catch (e: any) {
      setError(e?.message || 'The PDF could not be made.');
    } finally {
      setBusy(false);
    }
  };

  const seg = (active: boolean) => `py-1.5 rounded-lg text-xs font-bold cursor-pointer ${active ? 'bg-white dark:bg-slate-900 shadow-xs text-blue-700 dark:text-blue-300' : 'text-slate-500'}`;

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3" data-daily-attendance-pdf>
      <div>
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2"><FileText className="w-4 h-4 text-blue-600" /> Attendance PDF: present, absent or collective</h3>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">Download any day, any range of days, or everything on record in one PDF.</p>
      </div>
      <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 max-w-sm" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'selected'} data-att-mode="selected" onClick={() => setMode('selected')} className={seg(mode === 'selected')}>Selected data</button>
        <button type="button" role="tab" aria-selected={mode === 'all'} data-att-mode="all" onClick={() => setMode('all')} className={seg(mode === 'all')}>All collective data</button>
      </div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Report type">
        {(['present', 'absent', 'collective'] as DailyReportKind[]).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} data-att-kind={k} onClick={() => setKind(k)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border cursor-pointer ${kind === k ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>{KIND_TEXT[k]}</button>
        ))}
      </div>
      {mode === 'selected' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">From<input type="date" className={`${field} mt-0.5`} value={from} max={today} onChange={(e) => setFrom(e.target.value)} data-att-from /></label>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">To<input type="date" className={`${field} mt-0.5`} value={to} max={today} onChange={(e) => setTo(e.target.value)} data-att-to /></label>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Employee
            <select className={`${field} mt-0.5 normal-case font-normal`} value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="all">Everyone</option>
              {people.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Department
            <select className={`${field} mt-0.5 normal-case font-normal`} value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="all">All departments</option>
              {depts.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
        </div>
      ) : (
        <p className="text-xs text-slate-600 dark:text-slate-300 rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3">Every employee, from the first day on record ({fmtDayText(range.from)}) to today.</p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300" data-att-count>{rows.length} row{rows.length === 1 ? '' : 's'}: {count(['present', 'late', 'half_day'])} present, {count(['absent'])} absent, {count(['on_leave'])} on leave.</p>
        <button type="button" disabled={busy || !rows.length || Boolean(tooLong)} onClick={() => void download()} data-att-go className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Download PDF
        </button>
      </div>
      {tooLong && <p className="text-xs text-amber-600">Please choose at most one year at a time (or use All collective data).</p>}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </section>
  );
};
