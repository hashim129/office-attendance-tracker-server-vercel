import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Printer, Download, X, Calendar } from 'lucide-react';
import { AttendanceRecord, Employee, OfficeSettings, ShiftSchedule } from '../../types';
import {
  calculateBreaksDuration,
  formatMinutesToDecimal,
  formatMinutesToHoursMinutes,
  formatTime12h,
  getTodayDateString,
  getLiveWorkedStats,
  deriveLiveAttendanceState,
} from '../../lib/attendanceCalculations';
import { downloadOfficialTimesheetPdf } from '../../lib/pdfTimesheet';

interface PrintableTimesheetModalProps {
  isOpen: boolean;
  onClose: () => void;
  employee: Employee | null; // null if whole team
  allEmployees: Employee[];
  records: AttendanceRecord[];
  shifts?: ShiftSchedule[];
  settings: OfficeSettings;
  currentUser?: Employee | null;
}

export const PrintableTimesheetModal: React.FC<PrintableTimesheetModalProps> = ({
  isOpen,
  onClose,
  employee,
  allEmployees,
  records,
  shifts = [],
  settings,
  currentUser,
}) => {
  const [periodMode, setPeriodMode] = useState<'all' | 'this_month' | 'last_month' | 'custom'>('all');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const empMap = useMemo(() => new Map(allEmployees.map((e) => [e.id, e])), [allEmployees]);
  const shiftMap = useMemo(() => new Map(shifts.map((s) => [s.id, s])), [shifts]);

  const sortedRecords = useMemo(() => {
    const todayStr = getTodayDateString();
    const [curYearStr, curMonthStr] = todayStr.split('-');
    const currentMonthPrefix = `${curYearStr}-${curMonthStr}`;
    const y = Number(curYearStr);
    const m = Number(curMonthStr);
    const lastMonthDate = new Date(y, m - 2, 1);
    const lastMonthPrefix = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;

    const scoped = records.filter((r) => {
      if (periodMode === 'this_month' && !r.date.startsWith(currentMonthPrefix)) return false;
      if (periodMode === 'last_month' && !r.date.startsWith(lastMonthPrefix)) return false;
      if (periodMode === 'custom') {
        if (customStart && r.date < customStart) return false;
        if (customEnd && r.date > customEnd) return false;
      }
      return true;
    });

    return scoped.sort((a, b) => a.date.localeCompare(b.date));
  }, [records, periodMode, customStart, customEnd]);

  if (!isOpen) return null;

  // Compute totals (including live hours for open active shifts)
  let totalWorkedMins = 0;
  let totalRegularMins = 0;
  let totalOvertimeMins = 0;
  let totalBreakMins = 0;
  let lateDays = 0;

  const rowStats = sortedRecords.map((r) => {
    const emp = empMap.get(r.employeeId) || employee || undefined;
    const shift = (emp ? shiftMap.get(emp.shiftId) : undefined) || shifts[0];
    const breakMins = calculateBreaksDuration(r.breaks);
    const liveState = deriveLiveAttendanceState({ record: r, settings });
    const stats =
      !r.timeOut && r.timeIn && shift
        ? getLiveWorkedStats({ record: r, shift, settings, liveState })
        : {
            totalWorkedMinutes: r.totalWorkedMinutes || 0,
            regularMinutes: r.regularMinutes || 0,
            overtimeMinutes: r.overtimeMinutes || 0,
          };

    totalWorkedMins += stats.totalWorkedMinutes;
    totalRegularMins += stats.regularMinutes;
    totalOvertimeMins += stats.overtimeMinutes;
    totalBreakMins += breakMins;
    if (r.status === 'late') lateDays++;
    return { record: r, emp, breakMins, stats };
  });

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPdf = () => {
    downloadOfficialTimesheetPdf({
      employee,
      allEmployees,
      records: sortedRecords,
      shifts,
      settings,
      generatedBy: currentUser || null,
    });
  };

  const startDate = sortedRecords[0]?.date || 'N/A';
  const endDate = sortedRecords[sortedRecords.length - 1]?.date || 'N/A';

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-2 sm:p-4 bg-slate-900/80 backdrop-blur-xs overflow-auto"
      onClick={onClose}
    >
      {/* Floating Global Exit / Close Button (Always in view on all devices) */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Exit and return to Attendance Panel"
        title="Exit to Main Menu / Attendance Panel (Esc)"
        className="fixed top-3 right-3 sm:top-5 sm:right-6 z-[60] flex items-center gap-1.5 px-3 py-2 rounded-full bg-rose-600 hover:bg-rose-700 text-white shadow-xl text-xs font-bold transition-all cursor-pointer border-2 border-white dark:border-slate-800"
      >
        <X className="w-4 h-4" />
        <span className="hidden sm:inline">Close / Back to Panel</span>
      </button>

      <div
        className="w-full max-w-6xl bg-white text-slate-900 rounded-xl shadow-2xl overflow-hidden my-2 sm:my-4 border border-slate-200 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Control Bar (Sticky & Hidden during print) */}
        <div className="no-print sticky top-0 z-20 bg-slate-100/95 backdrop-blur-xs px-4 sm:px-6 py-3 border-b border-slate-200 flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white hover:bg-slate-200 text-slate-800 border border-slate-300 shadow-2xs cursor-pointer transition-colors"
                title="Go back to Attendance / Main Panel"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back to Panel</span>
              </button>
              <span className="text-xs font-semibold text-slate-700 hidden sm:inline">
                Official Timesheet Preview &amp; PDF Export (A4 Format)
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDownloadPdf}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Official PDF</span>
              </button>

              <button
                type="button"
                onClick={handlePrint}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs cursor-pointer transition-colors"
              >
                <Printer className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Print</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                aria-label="Close Preview"
                title="Close and go back (Esc)"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
                <span>Close</span>
              </button>
            </div>
          </div>

          {/* Period Quick Switcher */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] pt-1 border-t border-slate-200/80">
            <div className="flex flex-wrap items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-slate-500 mr-1" />
              {(
                [
                  { id: 'all', label: 'All Loaded' },
                  { id: 'this_month', label: 'This Month' },
                  { id: 'last_month', label: 'Last Month' },
                  { id: 'custom', label: 'Custom Range' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setPeriodMode(opt.id)}
                  className={`px-2.5 py-1 rounded-md font-semibold cursor-pointer transition-colors ${
                    periodMode === opt.id
                      ? 'bg-slate-900 text-white'
                      : 'bg-white text-slate-600 hover:bg-slate-200/70 border border-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {periodMode === 'custom' && (
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="px-2 py-0.5 bg-white border border-slate-300 rounded text-[11px]"
                />
                <span className="text-slate-400">to</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="px-2 py-0.5 bg-white border border-slate-300 rounded text-[11px]"
                />
              </div>
            )}
          </div>
        </div>

        {/* Printable Document Container */}
        <div className="print-container p-8 sm:p-12 space-y-6 bg-white font-sans text-xs">
          {/* Company Letterhead Header */}
          <div className="border-b-2 border-slate-900 pb-4 flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 uppercase">
                {settings.companyName}
              </h1>
              <p className="text-slate-600 mt-1">{settings.companyAddress}</p>
              <p className="text-slate-500 text-[11px]">
                Phone: {settings.companyPhone} · Email: {settings.companyEmail}
              </p>
            </div>

            <div className="text-right">
              <span className="inline-block px-3 py-1 bg-slate-900 text-white font-mono font-bold text-xs uppercase tracking-wider rounded">
                Official Timesheet
              </span>
              <p className="text-slate-500 text-[11px] mt-1.5 font-mono">
                Generated: {new Date().toLocaleDateString()}
              </p>
            </div>
          </div>

          {/* Employee & Period Details */}
          <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded border border-slate-200">
            <div>
              <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                {employee ? 'Employee Information' : 'Department Timesheet Scope'}
              </p>
              {employee ? (
                <div className="mt-1 space-y-0.5">
                  <p className="text-sm font-bold text-slate-900">{employee.name}</p>
                  <p className="text-slate-600">
                    ID: <strong className="font-mono">{employee.employeeCode}</strong> · {employee.designation}
                  </p>
                  <p className="text-slate-600">Department: {employee.department}</p>
                </div>
              ) : (
                <div className="mt-1 space-y-0.5">
                  <p className="text-sm font-bold text-slate-900">All Office Personnel</p>
                  <p className="text-slate-600">Scope: Company-wide verified logs</p>
                </div>
              )}
            </div>

            <div className="text-right">
              <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                Timesheet Pay Period
              </p>
              <p className="text-sm font-bold text-slate-900 font-mono mt-1">
                {startDate} to {endDate}
              </p>
              <p className="text-slate-500 text-[11px]">
                Total Days Logged: {sortedRecords.length} days
              </p>
            </div>
          </div>

          {/* Aggregate Hours Summary Box */}
          <div className="grid grid-cols-4 gap-3 border border-slate-300 rounded p-3 text-center bg-white">
            <div>
              <span className="text-[10px] text-slate-500 uppercase font-semibold">
                Total Regular Hours
              </span>
              <p className="text-base font-bold font-mono text-slate-900 mt-0.5">
                {formatMinutesToHoursMinutes(totalRegularMins)}
              </p>
            </div>

            <div>
              <span className="text-[10px] text-slate-500 uppercase font-semibold">
                Total Overtime
              </span>
              <p className="text-base font-bold font-mono text-slate-900 mt-0.5">
                {formatMinutesToHoursMinutes(totalOvertimeMins)}
              </p>
            </div>

            <div>
              <span className="text-[10px] text-slate-500 uppercase font-semibold">
                Total Net Hours
              </span>
              <p className="text-base font-bold font-mono text-blue-900 mt-0.5">
                {formatMinutesToHoursMinutes(totalWorkedMins)}
              </p>
            </div>

            <div>
              <span className="text-[10px] text-slate-500 uppercase font-semibold">
                Punctuality / Late
              </span>
              <p className="text-base font-bold font-mono text-slate-900 mt-0.5">
                {lateDays} Late Days
              </p>
            </div>
          </div>

          {/* Records Table */}
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full min-w-[740px] text-left border-collapse text-xs">
              <thead>
                <tr className="border-b-2 border-slate-900 bg-slate-100 text-[11px] font-bold text-slate-800">
                  <th className="py-2 px-2">Date</th>
                  <th className="py-2 px-2">Day</th>
                  {!employee && <th className="py-2 px-2">Staff Name</th>}
                  <th className="py-2 px-2">Time In</th>
                  <th className="py-2 px-2">Time Out</th>
                  <th className="py-2 px-2 text-right">Break</th>
                  <th className="py-2 px-2 text-right">Regular</th>
                  <th className="py-2 px-2 text-right">Overtime</th>
                  <th className="py-2 px-2 text-right">Total</th>
                  <th className="py-2 px-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rowStats.length === 0 ? (
                  <tr>
                    <td colSpan={employee ? 9 : 10} className="py-6 text-center text-slate-400">
                      No attendance records found for this date range.
                    </td>
                  </tr>
                ) : (
                  rowStats.map(({ record: r, emp, breakMins, stats }) => (
                    <tr key={r.id}>
                      <td className="py-1.5 px-2 font-mono whitespace-nowrap">{r.date}</td>
                      <td className="py-1.5 px-2 whitespace-nowrap">{r.day.slice(0, 3)}</td>
                      {!employee && <td className="py-1.5 px-2 font-medium whitespace-nowrap">{emp?.name}</td>}
                      <td className="py-1.5 px-2 font-mono whitespace-nowrap">{r.timeIn ? formatTime12h(r.timeIn) : '—'}</td>
                      <td className="py-1.5 px-2 font-mono whitespace-nowrap">{r.timeOut ? formatTime12h(r.timeOut) : '—'}</td>
                      <td className="py-1.5 px-2 font-mono text-right">{breakMins > 0 ? `${breakMins}m` : '0m'}</td>
                      <td className="py-1.5 px-2 font-mono text-right">{formatMinutesToDecimal(stats.regularMinutes)}</td>
                      <td className="py-1.5 px-2 font-mono text-right">{formatMinutesToDecimal(stats.overtimeMinutes)}</td>
                      <td className="py-1.5 px-2 font-mono text-right font-bold whitespace-nowrap">{formatMinutesToHoursMinutes(stats.totalWorkedMinutes)}</td>
                      <td className="py-1.5 px-2 text-center text-[10px] font-semibold uppercase">{r.status}</td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-900 font-bold bg-slate-50">
                  <td colSpan={employee ? 5 : 6} className="py-2 px-2 text-right uppercase text-[11px]">
                    Totals:
                  </td>
                  <td className="py-2 px-2 font-mono text-right">{formatMinutesToDecimal(totalRegularMins)}h</td>
                  <td className="py-2 px-2 font-mono text-right">{formatMinutesToDecimal(totalOvertimeMins)}h</td>
                  <td className="py-2 px-2 font-mono text-right font-bold text-slate-950 whitespace-nowrap">
                    {formatMinutesToHoursMinutes(totalWorkedMins)}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Signatures Section for Official Payroll Timesheets */}
          <div className="pt-12 grid grid-cols-2 gap-12 text-slate-700">
            <div className="border-t border-slate-400 pt-2 text-center">
              <p className="font-semibold text-slate-900">
                {employee ? employee.name : 'Employee Signature'}
              </p>
              <p className="text-[11px] text-slate-500">Employee Signature & Date</p>
            </div>

            <div className="border-t border-slate-400 pt-2 text-center">
              <p className="font-semibold text-slate-900">Office Administrator / HR Approver</p>
              <p className="text-[11px] text-slate-500">Authorized Signature & Date</p>
            </div>
          </div>
        </div>

        {/* Bottom Close / Return Bar (Hidden during print) */}
        <div className="no-print px-4 sm:px-6 py-3 bg-slate-100 border-t border-slate-200 flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-500">Tip: Press Esc or click Back to return to attendance.</span>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white cursor-pointer transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Main Panel</span>
          </button>
        </div>
      </div>
    </div>
  );
};
