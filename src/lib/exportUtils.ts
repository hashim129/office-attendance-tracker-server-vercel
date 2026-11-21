import { AttendanceRecord, Employee, OfficeSettings, ShiftSchedule } from '../types';
import { getPunchNotes, punchNoteLabel, punchNotesText } from './punchNotes';
import {
  calculateBreaksDuration,
  formatMinutesToDecimal,
  formatMinutesToHoursMinutes,
  formatTime12h,
} from './attendanceCalculations';

/**
 * Clean CSV cell to avoid delimiter injection and handle quotes/commas
 */
function escapeCsvCell(val: string | number | undefined | null): string {
  if (val === undefined || val === null) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

/**
 * Download a generated CSV file to user's device
 */
export function downloadCsvFile(content: string, filename: string): void {
  // UTF-8 BOM so Microsoft Excel on Windows renders UTF-8 correctly
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Generate CSV for Employee or Admin attendance records
 */
export function exportAttendanceToCsv({
  records,
  employees,
  shifts,
  settings,
  employeeFilter,
  startDate,
  endDate,
}: {
  records: AttendanceRecord[];
  employees: Employee[];
  shifts: ShiftSchedule[];
  settings: OfficeSettings;
  employeeFilter?: Employee;
  startDate?: string;
  endDate?: string;
}): void {
  const empMap = new Map(employees.map((e) => [e.id, e]));
  const shiftMap = new Map(shifts.map((s) => [s.id, s]));

  // Filter records
  let filtered = [...records];
  if (employeeFilter) {
    filtered = filtered.filter((r) => r.employeeId === employeeFilter.id);
  }
  if (startDate) {
    filtered = filtered.filter((r) => r.date >= startDate);
  }
  if (endDate) {
    filtered = filtered.filter((r) => r.date <= endDate);
  }

  // Sort by date descending, then employee code
  filtered.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    const empA = empMap.get(a.employeeId)?.employeeCode || '';
    const empB = empMap.get(b.employeeId)?.employeeCode || '';
    return empA.localeCompare(empB);
  });

  const headers = [
    'Date',
    'Day',
    'Employee Code',
    'Employee Name',
    'Department',
    'Designation',
    'Shift Name',
    'Time In',
    'Time Out',
    'Break Duration (mins)',
    'Total Worked (hh:mm)',
    'Total Worked (Hours)',
    'Regular Hours',
    'Overtime Hours',
    'Arrival Status',
    'Live Status',
    'Admin Verification',
    'Accounts Verification',
    'Auto Closed',
    'Not Counted - Auto Punch-Out (hrs)',
    'Work Mode',
    'Work From Home Reason',
    'Notes / Remarks',
  ];

  const rows = filtered.map((rec) => {
    const emp = empMap.get(rec.employeeId);
    const shift = emp ? shiftMap.get(emp.shiftId) : undefined;
    const breakMins = calculateBreaksDuration(rec.breaks);
    const onBreak = Array.isArray(rec.breaks) && rec.breaks.some((b) => !b.end);
    const liveStatus = rec.timeOut
      ? rec.isAutoPunchedOut
        ? rec.autoPunchOutReason === 'shift_end_2h'
          ? 'Auto Punched Out (Shift End +2h)'
          : 'Auto Punched Out'
        : 'Punched Out'
      : onBreak
      ? 'On Break'
      : rec.connectionStatus === 'no_internet' || rec.monitoringPaused || !rec.lastHeartbeatAt
      ? 'Offline / No Internet (In)'
      : 'Working (Online)';

    const adminVer = rec.adminVerification?.verified
      ? `Verified (${rec.adminVerification.verifiedByName || 'Admin'})`
      : 'Unverified';
    const accountsVer = rec.accountsVerification?.verified
      ? `Verified (${rec.accountsVerification.verifiedByName || 'Accounts'})`
      : 'Unverified';
    const autoOut = rec.isAutoPunchedOut ? 'Yes' : 'No';

    return [
      escapeCsvCell(rec.date),
      escapeCsvCell(rec.day),
      escapeCsvCell(emp?.employeeCode || 'N/A'),
      escapeCsvCell(emp?.name || 'Unknown'),
      escapeCsvCell(emp?.department || 'General'),
      escapeCsvCell(emp?.designation || ''),
      escapeCsvCell(shift?.name || 'Standard'),
      escapeCsvCell(formatTime12h(rec.timeIn)),
      escapeCsvCell(rec.timeOut ? formatTime12h(rec.timeOut) : '—'),
      escapeCsvCell(breakMins),
      escapeCsvCell(formatMinutesToHoursMinutes(rec.totalWorkedMinutes)),
      escapeCsvCell(formatMinutesToDecimal(rec.totalWorkedMinutes)),
      escapeCsvCell(formatMinutesToDecimal(rec.regularMinutes)),
      escapeCsvCell(formatMinutesToDecimal(rec.overtimeMinutes)),
      escapeCsvCell(rec.status.toUpperCase()),
      escapeCsvCell(liveStatus),
      escapeCsvCell(adminVer),
      escapeCsvCell(accountsVer),
      escapeCsvCell(autoOut),
      escapeCsvCell(formatMinutesToDecimal(rec.unverifiedMinutes || 0)),
      escapeCsvCell(rec.workMode === 'wfh' ? 'Work From Home' : 'Office'),
      escapeCsvCell(rec.workMode === 'wfh' ? rec.wfhReason || '' : ''),
      escapeCsvCell(punchNotesText(rec) || (rec.isManuallyAdjusted ? `Adjusted: ${rec.adjustmentNote}` : '')),
    ].join(',');
  });

  const titleRow = escapeCsvCell(`${settings.companyName} - Attendance Report`);
  const generatedRow = escapeCsvCell(`Generated on: ${new Date().toLocaleString()}`);
  const scopeRow = escapeCsvCell(
    employeeFilter
      ? `Employee: ${employeeFilter.name} (${employeeFilter.employeeCode})`
      : 'Scope: All Office Employees'
  );

  const csvContent = [
    titleRow,
    generatedRow,
    scopeRow,
    '',
    headers.join(','),
    ...rows,
  ].join('\r\n');

  const filePrefix = employeeFilter
    ? `attendance_${employeeFilter.employeeCode}_${employeeFilter.name.toLowerCase().replace(/\s+/g, '_')}`
    : 'office_attendance_report';
  const timestamp = new Date().toISOString().split('T')[0];

  downloadCsvFile(csvContent, `${filePrefix}_${timestamp}.csv`);
}

/** One row per remark: date, employee, punch times, type, time written and the remark itself. */
export function exportRemarksToCsv(rows: { date: string; code: string; name: string; department: string; timeIn: string; timeOut: string; type: string; written: string; text: string }[], filename: string): void {
  const header = ['Date', 'Employee ID', 'Employee', 'Department', 'Punch In', 'Punch Out', 'Remark Type', 'Written At (PKT)', 'Remark'];
  const lines = rows.map((r) => [r.date, r.code, r.name, r.department, r.timeIn, r.timeOut, r.type, r.written, r.text].map(escapeCsvCell).join(','));
  downloadCsvFile([header.map(escapeCsvCell).join(','), ...lines].join('\r\n'), filename);
}

export { getPunchNotes, punchNoteLabel };
