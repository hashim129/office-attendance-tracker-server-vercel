import React, { useEffect, useMemo, useState } from 'react';
import { HoursBarChart, PunchTimeline } from '../charts/ChartKit';
import {
  BarChart3,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Crown,
  Download,
  FileText,
  Flame,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  User,
  Users,
  WifiOff,
  CheckCircle2,
  AlertTriangle,
  X,
} from 'lucide-react';
import {
  AttendanceRecord,
  Employee,
  LeaveRequest,
  OfficeSettings,
  ShiftSchedule,
} from '../../types';
import {
  calculateBreaksDuration,
  calculateWorkedMinutes,
  deriveLiveAttendanceState,
  formatMinutesToHoursMinutes,
  formatTime12h,
  getLiveWorkedStats,
  getTodayDateString,
} from '../../lib/attendanceCalculations';
import { downloadOfficialTimesheetPdf } from '../../lib/pdfTimesheet';
import { parseSmartAttendanceQuery } from '../../lib/smartSearchParser';

interface SmartInsightsTabProps {
  currentUser: Employee;
  employees: Employee[];
  records: AttendanceRecord[];
  shifts: ShiftSchedule[];
  leaves?: LeaveRequest[];
  settings: OfficeSettings;
  onOpenPrintModal?: (employee: Employee | null, filteredRecords: AttendanceRecord[]) => void;
  isNetworkOnline?: boolean;
}

type InsightsRangeKey = '7d' | '14d' | 'this_month' | '30d' | 'last_month' | 'custom';
type CompareMetricKey = 'hours' | 'attendance' | 'punctuality' | 'overtime';

function addDaysUtc(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}

function buildDateSeries(startIso: string, endIso: string): string[] {
  if (!startIso || !endIso || startIso > endIso) return [];
  const dates: string[] = [];
  let cursor = startIso;
  // Cap safety at 92 days so custom ranges stay fluid
  let guard = 0;
  while (cursor <= endIso && guard < 92) {
    dates.push(cursor);
    cursor = addDaysUtc(cursor, 1);
    guard++;
  }
  return dates;
}

function getWeekdayNumber(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function parseTimeToMinutesOfDay(hhmm?: string): number | null {
  if (!hhmm) return null;
  const parts = hhmm.split(':').map(Number);
  if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return null;
  return parts[0] * 60 + parts[1];
}

function formatMinutesOfDay12h(minsOfDay: number): string {
  const clamped = ((Math.round(minsOfDay) % 1440) + 1440) % 1440;
  const hh = Math.floor(clamped / 60);
  const mm = clamped % 60;
  const suffix = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 || 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${suffix}`;
}

export const SmartInsightsTab: React.FC<SmartInsightsTabProps> = ({
  currentUser,
  employees,
  records,
  shifts,
  leaves = [],
  settings,
  onOpenPrintModal,
  isNetworkOnline = true,
}) => {
  const isAuthorized =
    currentUser.role === 'admin' ||
    currentUser.role === 'ceo' ||
    currentUser.role === 'accounts';

  const activeEmployees = useMemo(
    () =>
      employees
        .filter((e) => e.isActive)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [employees]
  );

  const [viewMode, setViewMode] = useState<'individual' | 'team'>('individual');
  const [selectedEmpId, setSelectedEmpId] = useState<string>(
    () => activeEmployees[0]?.id || ''
  );
  const [empSearch, setEmpSearch] = useState<string>('');
  const [smartQuery, setSmartQuery] = useState<string>('');
  const [smartDateOverride, setSmartDateOverride] = useState<string | null>(null);
  const [rangeKey, setRangeKey] = useState<InsightsRangeKey>('14d');
  const [customStart, setCustomStart] = useState<string>(() => addDaysUtc(getTodayDateString(), -13));
  const [customEnd, setCustomEnd] = useState<string>(() => getTodayDateString());
  const [compareMetric, setCompareMetric] = useState<CompareMetricKey>('hours');
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const [pinnedDate, setPinnedDate] = useState<string | null>(null);

  const todayStr = getTodayDateString();
  const shiftMap = useMemo(() => new Map(shifts.map((s) => [s.id, s])), [shifts]);

  const parsedSmartQuery = useMemo(() => {
    if (!smartQuery.trim()) return null;
    return parseSmartAttendanceQuery(smartQuery, activeEmployees, todayStr);
  }, [smartQuery, activeEmployees, todayStr]);

  useEffect(() => {
    setSmartDateOverride(null);
  }, [smartQuery]);

  useEffect(() => {
    if (!parsedSmartQuery) return;
    if (parsedSmartQuery.matchedEmployee) {
      setSelectedEmpId(parsedSmartQuery.matchedEmployee.id);
      setViewMode('individual');
    }
    const resolvedDate = smartDateOverride || parsedSmartQuery.targetDate;
    if (resolvedDate) {
      setPinnedDate(resolvedDate);
      setHoveredDate(null);
      if (parsedSmartQuery.suggestedRangeKey === 'custom' && parsedSmartQuery.rangeStart && parsedSmartQuery.rangeEnd && !smartDateOverride) {
        setRangeKey('custom');
        setCustomStart(parsedSmartQuery.rangeStart);
        setCustomEnd(parsedSmartQuery.rangeEnd);
      } else if (resolvedDate >= addDaysUtc(todayStr, -13) && resolvedDate <= todayStr) {
        setRangeKey('14d');
      } else {
        const winStart = addDaysUtc(resolvedDate, -6);
        const candidateEnd = addDaysUtc(resolvedDate, 6);
        const winEnd = candidateEnd > todayStr ? (resolvedDate > todayStr ? resolvedDate : todayStr) : candidateEnd;
        setRangeKey('custom');
        setCustomStart(winStart);
        setCustomEnd(winEnd);
      }
    } else if (parsedSmartQuery.suggestedRangeKey) {
      if (parsedSmartQuery.suggestedRangeKey === 'custom' && parsedSmartQuery.rangeStart && parsedSmartQuery.rangeEnd) {
        setRangeKey('custom');
        setCustomStart(parsedSmartQuery.rangeStart);
        setCustomEnd(parsedSmartQuery.rangeEnd);
      } else {
        setRangeKey(parsedSmartQuery.suggestedRangeKey);
      }
    }
  }, [parsedSmartQuery, smartDateOverride, todayStr]);

  const effectiveEmp = useMemo(() => {
    return (
      activeEmployees.find((e) => e.id === selectedEmpId) ||
      activeEmployees[0] ||
      null
    );
  }, [activeEmployees, selectedEmpId]);

  const filteredEmployeeOptions = useMemo(() => {
    const q = empSearch.trim().toLowerCase();
    if (!q) return activeEmployees;
    return activeEmployees.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.employeeCode.toLowerCase().includes(q) ||
        e.department.toLowerCase().includes(q)
    );
  }, [activeEmployees, empSearch]);

  const { rangeStart, rangeEnd, rangeLabel } = useMemo(() => {
    const [cy, cm] = todayStr.split('-').map(Number);
    if (rangeKey === '7d') {
      const start = addDaysUtc(todayStr, -6);
      return { rangeStart: start, rangeEnd: todayStr, rangeLabel: 'Last 7 Days' };
    }
    if (rangeKey === '14d') {
      const start = addDaysUtc(todayStr, -13);
      return { rangeStart: start, rangeEnd: todayStr, rangeLabel: 'Last 14 Days' };
    }
    if (rangeKey === '30d') {
      const start = addDaysUtc(todayStr, -29);
      return { rangeStart: start, rangeEnd: todayStr, rangeLabel: 'Last 30 Days' };
    }
    if (rangeKey === 'this_month') {
      const start = `${cy}-${String(cm).padStart(2, '0')}-01`;
      return { rangeStart: start, rangeEnd: todayStr, rangeLabel: 'This Month' };
    }
    if (rangeKey === 'last_month') {
      const lastStartDt = new Date(Date.UTC(cy, cm - 2, 1));
      const lastEndDt = new Date(Date.UTC(cy, cm - 1, 0));
      return {
        rangeStart: lastStartDt.toISOString().slice(0, 10),
        rangeEnd: lastEndDt.toISOString().slice(0, 10),
        rangeLabel: 'Last Month',
      };
    }
    const start = customStart && customStart <= (customEnd || todayStr) ? customStart : addDaysUtc(todayStr, -13);
    const end = customEnd || todayStr;
    return { rangeStart: start, rangeEnd: end, rangeLabel: `${start} to ${end}` };
  }, [rangeKey, customStart, customEnd, todayStr]);

  const dateSeries = useMemo(
    () => buildDateSeries(rangeStart, rangeEnd),
    [rangeStart, rangeEnd]
  );

  // Per-employee summary across all active employees (powers both Individual Mode & Team Comparison)
  const employeeAnalyticsMap = useMemo(() => {
    const approvedLeavesByEmp = new Map<string, LeaveRequest[]>();
    leaves
      .filter((l) => l.status === 'approved')
      .forEach((l) => {
        const arr = approvedLeavesByEmp.get(l.employeeId) || [];
        arr.push(l);
        approvedLeavesByEmp.set(l.employeeId, arr);
      });

    const recordsByEmpDate = new Map<string, Map<string, AttendanceRecord>>();
    records.forEach((r) => {
      if (r.date < rangeStart || r.date > rangeEnd) return;
      if (!recordsByEmpDate.has(r.employeeId)) {
        recordsByEmpDate.set(r.employeeId, new Map());
      }
      recordsByEmpDate.get(r.employeeId)!.set(r.date, r);
    });

    const todayRecMap = new Map<string, AttendanceRecord>();
    records.forEach((r) => {
      if (r.date === todayStr) todayRecMap.set(r.employeeId, r);
    });

    const map = new Map<
      string,
      {
        employee: Employee;
        shift: ShiftSchedule;
        todayState: ReturnType<typeof deriveLiveAttendanceState>;
        totalWorkedMinutes: number;
        totalRegularMinutes: number;
        totalOvertimeMinutes: number;
        totalBreakMinutes: number;
        presentDays: number;
        onTimeDays: number;
        lateDays: number;
        absentDays: number;
        leaveDays: number;
        scheduledWorkdays: number;
        overtimeDays: number;
        autoClosedDays: number;
        noInternetEvents: number;
        adminVerifiedDays: number;
        accountsVerifiedDays: number;
        attendanceRate: number;
        punctualityRate: number;
        avgDailyMinutes: number;
        avgArrivalMinutesOfDay: number | null;
        periodRecords: AttendanceRecord[];
        dailySeries: {
          date: string;
          weekday: number;
          isWorkday: boolean;
          isLeave: boolean;
          record?: AttendanceRecord;
          regularMinutes: number;
          overtimeMinutes: number;
          totalWorkedMinutes: number;
          breakMinutes: number;
          liveState: ReturnType<typeof deriveLiveAttendanceState>;
          dayStatus: 'on_time' | 'late' | 'absent' | 'leave' | 'off_day';
        }[];
      }
    >();

    activeEmployees.forEach((emp) => {
      const shift = shiftMap.get(emp.shiftId) || shifts[0];
      const workDays = shift?.workDays?.length ? shift.workDays : settings.workDays || [1, 2, 3, 4, 5];
      const empRecMap = recordsByEmpDate.get(emp.id) || new Map<string, AttendanceRecord>();
      const empLeaves = approvedLeavesByEmp.get(emp.id) || [];

      const todayRec = todayRecMap.get(emp.id);
      const todayState = deriveLiveAttendanceState({
        record: todayRec,
        settings,
        todayStr,
        isCurrentUserOffline: !isNetworkOnline && emp.id === currentUser.id,
        isCurrentUserConnected: isNetworkOnline && emp.id === currentUser.id,
      });

      let totalWorkedMinutes = 0;
      let totalRegularMinutes = 0;
      let totalOvertimeMinutes = 0;
      let totalBreakMinutes = 0;
      let presentDays = 0;
      let onTimeDays = 0;
      let lateDays = 0;
      let absentDays = 0;
      let leaveDays = 0;
      let scheduledWorkdays = 0;
      let overtimeDays = 0;
      let autoClosedDays = 0;
      let noInternetEvents = 0;
      let adminVerifiedDays = 0;
      let accountsVerifiedDays = 0;
      let arrivalSum = 0;
      let arrivalCount = 0;
      const periodRecords: AttendanceRecord[] = [];

      const dailySeries = dateSeries.map((date) => {
        const weekday = getWeekdayNumber(date);
        const isWorkday = workDays.includes(weekday);
        const isLeave = empLeaves.some((l) => date >= l.startDate && date <= l.endDate);
        const rec = empRecMap.get(date);
        const liveState = deriveLiveAttendanceState({
          record: rec,
          settings,
          todayStr,
          isCurrentUserOffline: !isNetworkOnline && emp.id === currentUser.id,
          isCurrentUserConnected: isNetworkOnline && emp.id === currentUser.id,
        });

        let regularMinutes = 0;
        let overtimeMinutes = 0;
        let dayWorked = 0;
        let breakMins = 0;
        let dayStatus: 'on_time' | 'late' | 'absent' | 'leave' | 'off_day' = 'off_day';

        if (rec?.timeIn) {
          periodRecords.push(rec);
          let stats = {
            totalWorkedMinutes: rec.totalWorkedMinutes || 0,
            regularMinutes: rec.regularMinutes || 0,
            overtimeMinutes: rec.overtimeMinutes || 0,
          };
          if (!rec.timeOut && shift) {
            stats = getLiveWorkedStats({ record: rec, shift, settings, liveState });
          } else if (rec.timeIn && rec.timeOut && (!stats.totalWorkedMinutes || stats.totalWorkedMinutes === 0)) {
            stats = calculateWorkedMinutes(rec.timeIn, rec.timeOut, rec.breaks, shift?.expectedHours || 8);
          }
          dayWorked = stats.totalWorkedMinutes;
          regularMinutes = stats.regularMinutes;
          overtimeMinutes = stats.overtimeMinutes;
          breakMins = calculateBreaksDuration(rec.breaks);

          totalWorkedMinutes += dayWorked;
          totalRegularMinutes += regularMinutes;
          totalOvertimeMinutes += overtimeMinutes;
          totalBreakMinutes += breakMins;
          presentDays++;

          if (rec.status === 'late') {
            lateDays++;
            dayStatus = 'late';
          } else {
            onTimeDays++;
            dayStatus = 'on_time';
          }
          if (overtimeMinutes > 0) overtimeDays++;
          if (rec.isAutoPunchedOut) autoClosedDays++;
          if (liveState === 'no_internet' || rec.connectionStatus === 'no_internet') noInternetEvents++;
          if (rec.adminVerification?.verified) adminVerifiedDays++;
          if (rec.accountsVerification?.verified) accountsVerifiedDays++;

          const arrivalM = parseTimeToMinutesOfDay(rec.timeIn);
          if (arrivalM !== null) {
            arrivalSum += arrivalM;
            arrivalCount++;
          }
          if (isWorkday) scheduledWorkdays++;
        } else if (isLeave) {
          leaveDays++;
          dayStatus = 'leave';
        } else if (isWorkday && date < todayStr) {
          scheduledWorkdays++;
          absentDays++;
          dayStatus = 'absent';
        }

        return {
          date,
          weekday,
          isWorkday,
          isLeave,
          record: rec,
          regularMinutes,
          overtimeMinutes,
          totalWorkedMinutes: dayWorked,
          breakMinutes: breakMins,
          liveState,
          dayStatus,
        };
      });

      const denomWorkdays = Math.max(scheduledWorkdays, presentDays);
      const attendanceRate = denomWorkdays > 0 ? Math.min(100, Math.round((presentDays / denomWorkdays) * 100)) : 100;
      const punctualityRate = presentDays > 0 ? Math.round((onTimeDays / presentDays) * 100) : 100;
      const avgDailyMinutes = presentDays > 0 ? Math.round(totalWorkedMinutes / presentDays) : 0;
      const avgArrivalMinutesOfDay = arrivalCount > 0 ? arrivalSum / arrivalCount : null;

      map.set(emp.id, {
        employee: emp,
        shift,
        todayState,
        totalWorkedMinutes,
        totalRegularMinutes,
        totalOvertimeMinutes,
        totalBreakMinutes,
        presentDays,
        onTimeDays,
        lateDays,
        absentDays,
        leaveDays,
        scheduledWorkdays,
        overtimeDays,
        autoClosedDays,
        noInternetEvents,
        adminVerifiedDays,
        accountsVerifiedDays,
        attendanceRate,
        punctualityRate,
        avgDailyMinutes,
        avgArrivalMinutesOfDay,
        periodRecords,
        dailySeries,
      });
    });

    return map;
  }, [
    activeEmployees,
    records,
    leaves,
    shifts,
    shiftMap,
    settings,
    dateSeries,
    rangeStart,
    rangeEnd,
    todayStr,
    isNetworkOnline,
    currentUser.id,
  ]);

  const selectedAnalytics = effectiveEmp ? employeeAnalyticsMap.get(effectiveEmp.id) || null : null;

  // Team aggregate daily bar series & ranked comparison list
  const teamDailySeries = useMemo(() => {
    const allEmpAnalytics = Array.from(employeeAnalyticsMap.values());
    return dateSeries.map((date, idx) => {
      let totalMinutes = 0;
      let totalOtMinutes = 0;
      let presentCount = 0;
      let lateCount = 0;
      let absentCount = 0;

      allEmpAnalytics.forEach((item) => {
        const dayItem = item.dailySeries[idx];
        if (!dayItem) return;
        totalMinutes += dayItem.totalWorkedMinutes;
        totalOtMinutes += dayItem.overtimeMinutes;
        if (dayItem.record?.timeIn) {
          presentCount++;
          if (dayItem.dayStatus === 'late') lateCount++;
        } else if (dayItem.dayStatus === 'absent') {
          absentCount++;
        }
      });

      return {
        date,
        totalMinutes,
        totalOtMinutes,
        presentCount,
        lateCount,
        absentCount,
      };
    });
  }, [employeeAnalyticsMap, dateSeries]);

  const teamComparisonRows = useMemo(() => {
    const rows = Array.from(employeeAnalyticsMap.values());
    return rows.sort((a, b) => {
      if (compareMetric === 'hours') return b.totalWorkedMinutes - a.totalWorkedMinutes;
      if (compareMetric === 'attendance') return b.attendanceRate - a.attendanceRate || b.totalWorkedMinutes - a.totalWorkedMinutes;
      if (compareMetric === 'punctuality') return b.punctualityRate - a.punctualityRate || b.presentDays - a.presentDays;
      return b.totalOvertimeMinutes - a.totalOvertimeMinutes || b.totalWorkedMinutes - a.totalWorkedMinutes;
    });
  }, [employeeAnalyticsMap, compareMetric]);

  const maxComparisonVal = useMemo(() => {
    if (teamComparisonRows.length === 0) return 1;
    if (compareMetric === 'hours') {
      return Math.max(60, ...teamComparisonRows.map((r) => r.totalWorkedMinutes));
    }
    if (compareMetric === 'overtime') {
      return Math.max(60, ...teamComparisonRows.map((r) => r.totalOvertimeMinutes));
    }
    return 100;
  }, [teamComparisonRows, compareMetric]);

  const inspectedDay = useMemo(() => {
    if (!selectedAnalytics) return null;
    const targetDate = hoveredDate || pinnedDate || selectedAnalytics.dailySeries[selectedAnalytics.dailySeries.length - 1]?.date;
    return selectedAnalytics.dailySeries.find((d) => d.date === targetDate) || null;
  }, [selectedAnalytics, hoveredDate, pinnedDate]);

  if (!isAuthorized) return null;

  const expectedShiftMins = (selectedAnalytics?.shift?.expectedHours || 8) * 60;
  const maxDailyChartMinutes = Math.max(
    expectedShiftMins + 120,
    ...(selectedAnalytics?.dailySeries.map((d) => d.totalWorkedMinutes) || [480])
  );

  const stepEmployee = (dir: -1 | 1) => {
    if (activeEmployees.length === 0) return;
    const idx = activeEmployees.findIndex((e) => e.id === effectiveEmp?.id);
    const nextIdx = (Math.max(0, idx) + dir + activeEmployees.length) % activeEmployees.length;
    setSelectedEmpId(activeEmployees[nextIdx].id);
    setHoveredDate(null);
    setPinnedDate(null);
  };

  const handleDownloadCurrentPdf = () => {
    if (viewMode === 'individual' && effectiveEmp && selectedAnalytics) {
      downloadOfficialTimesheetPdf({
        employee: effectiveEmp,
        allEmployees: employees,
        records: selectedAnalytics.periodRecords,
        shifts,
        settings,
        periodLabel: `${rangeStart} to ${rangeEnd} (${rangeLabel})`,
        generatedBy: currentUser,
      });
    } else {
      const allPeriodRecords = records.filter((r) => r.date >= rangeStart && r.date <= rangeEnd);
      downloadOfficialTimesheetPdf({
        employee: null,
        allEmployees: employees,
        records: allPeriodRecords,
        shifts,
        settings,
        periodLabel: `${rangeStart} to ${rangeEnd} (${rangeLabel})`,
        generatedBy: currentUser,
      });
    }
  };

  const handlePreviewCurrentPdf = () => {
    if (!onOpenPrintModal) {
      handleDownloadCurrentPdf();
      return;
    }
    if (viewMode === 'individual' && effectiveEmp && selectedAnalytics) {
      onOpenPrintModal(effectiveEmp, selectedAnalytics.periodRecords);
    } else {
      const allPeriodRecords = records.filter((r) => r.date >= rangeStart && r.date <= rangeEnd);
      onOpenPrintModal(null, allPeriodRecords);
    }
  };

  const smartTakeaways = useMemo(() => {
    if (!selectedAnalytics || !effectiveEmp) return [];
    const notes: { tone: 'emerald' | 'amber' | 'indigo'; text: string }[] = [];
    notes.push({
      tone: selectedAnalytics.attendanceRate >= 85 ? 'emerald' : 'amber',
      text: `${effectiveEmp.name} maintained a ${selectedAnalytics.attendanceRate}% attendance consistency score (${selectedAnalytics.presentDays} present, ${selectedAnalytics.absentDays} absent, ${selectedAnalytics.leaveDays} leave) across ${rangeLabel}.`,
    });

    if (selectedAnalytics.avgArrivalMinutesOfDay !== null) {
      const shiftStartMins = parseTimeToMinutesOfDay(selectedAnalytics.shift?.startTime || '09:00') ?? 540;
      const diffMins = Math.round(selectedAnalytics.avgArrivalMinutesOfDay - shiftStartMins);
      const avgTime = formatMinutesOfDay12h(selectedAnalytics.avgArrivalMinutesOfDay);
      const diffText =
        diffMins <= 0
          ? `${Math.abs(diffMins)}m earlier than shift start`
          : `${diffMins}m after shift start`;
      notes.push({
        tone: selectedAnalytics.punctualityRate >= 85 ? 'emerald' : 'amber',
        text: `Average punch-in is ${avgTime} (${diffText}), achieving ${selectedAnalytics.punctualityRate}% on-time punctuality with ${selectedAnalytics.lateDays} late arrival${selectedAnalytics.lateDays === 1 ? '' : 's'}.`,
      });
    }

    const pendingAdmin = Math.max(0, selectedAnalytics.presentDays - selectedAnalytics.adminVerifiedDays);
    const pendingAccounts = Math.max(0, selectedAnalytics.presentDays - selectedAnalytics.accountsVerifiedDays);
    notes.push({
      tone: 'indigo',
      text: `Logged ${formatMinutesToHoursMinutes(selectedAnalytics.totalWorkedMinutes)} net (${formatMinutesToHoursMinutes(selectedAnalytics.totalOvertimeMinutes)} overtime across ${selectedAnalytics.overtimeDays} day${selectedAnalytics.overtimeDays === 1 ? '' : 's'}). Audit pending: ${pendingAdmin} Admin / ${pendingAccounts} Accounts.`,
    });

    return notes;
  }, [selectedAnalytics, effectiveEmp, rangeLabel]);

  return (
    <div className="space-y-6 bg-sky-50/85 dark:bg-slate-950/60 p-3 sm:p-5 rounded-2xl border border-sky-200/80 dark:border-slate-800">
      {/* SMART Executive Command Hero Header (Light Blue Surface) */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-sky-100 via-blue-50 to-white dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 text-slate-900 dark:text-slate-100 p-5 sm:p-6 border border-sky-200 dark:border-slate-700 shadow-sm">
        <div className="absolute -right-12 -top-12 w-56 h-56 rounded-full bg-sky-300/25 blur-3xl pointer-events-none" />
        <div className="absolute -left-12 -bottom-12 w-48 h-48 rounded-full bg-blue-300/20 blur-3xl pointer-events-none" />

        <div className="relative flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-600 text-white shadow-2xs">
                <Sparkles className="w-3 h-3 text-amber-200" />
                <span>Smart Attendance Insights</span>
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-white/90 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-sky-200 dark:border-slate-700">
                {currentUser.role === 'ceo' ? (
                  <>
                    <Crown className="w-3 h-3 text-amber-500" />
                    <span>CEO Executive View</span>
                  </>
                ) : currentUser.role === 'accounts' ? (
                  <>
                    <ShieldCheck className="w-3 h-3 text-emerald-600" />
                    <span>Accounts Audit View</span>
                  </>
                ) : (
                  <>
                    <BarChart3 className="w-3 h-3 text-blue-600" />
                    <span>Admin Control View</span>
                  </>
                )}
              </span>
            </div>

            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              {viewMode === 'individual' && effectiveEmp
                ? `${effectiveEmp.name} — Performance & Bar Analytics`
                : 'Company-Wide Attendance Graphical Insights'}
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-300 max-w-2xl">
              Ask in natural language (e.g. "Search Attendance of Kashif for last wednesday") or browse interactive daily bar graphs, punctuality intelligence, overtime, and official A4 PDF timesheets.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Mode Toggle */}
            <div className="inline-flex p-1 rounded-xl bg-white/90 dark:bg-slate-800 border border-sky-200 dark:border-slate-700 shadow-2xs">
              <button
                type="button"
                onClick={() => setViewMode('individual')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  viewMode === 'individual'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-slate-700'
                }`}
              >
                <User className="w-3.5 h-3.5" />
                <span>Per Employee</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('team')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  viewMode === 'team'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-slate-700'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Team Comparison</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleDownloadCurrentPdf}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-all cursor-pointer"
              title="Download official A4 PDF timesheet right now"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Official PDF</span>
            </button>

            <button
              type="button"
              onClick={handlePreviewCurrentPdf}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white dark:bg-slate-800 hover:bg-sky-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 border border-sky-200 dark:border-slate-700 transition-all cursor-pointer"
              title="Open print preview modal"
            >
              <FileText className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Preview</span>
            </button>
          </div>
        </div>

        {/* Smart Natural-Language Search Bar */}
        <div className="relative mt-4 p-3 rounded-xl bg-white/90 dark:bg-slate-900/90 border border-sky-200 dark:border-slate-700 shadow-2xs space-y-2">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="relative flex-1">
              <Sparkles className="w-4 h-4 text-blue-600 dark:text-sky-400 absolute left-3 top-2.5 pointer-events-none" />
              <input
                type="text"
                value={smartQuery}
                onChange={(e) => setSmartQuery(e.target.value)}
                placeholder='Smart Search: e.g. "Search Attendance of Kashif for last wednesday", "Zonehra yesterday", "Hashim last 7 days"...'
                className="w-full pl-9 pr-9 py-2 rounded-lg bg-sky-50/70 dark:bg-slate-800 border border-sky-200 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
              />
              {smartQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSmartQuery('');
                    setSmartDateOverride(null);
                  }}
                  title="Clear Smart Search"
                  className="absolute right-2.5 top-2 p-0.5 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/70 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
              <span className="font-semibold text-slate-500 dark:text-slate-400">Try:</span>
              {[
                activeEmployees[0] ? `Attendance of ${activeEmployees[0].name.split(' ')[0]} last wednesday` : 'Last wednesday',
                activeEmployees[1] ? `${activeEmployees[1].name.split(' ')[0]} yesterday` : 'Yesterday',
                'Last 7 days',
              ].map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setSmartQuery(example)}
                  className="px-2 py-1 rounded-md bg-sky-100/80 dark:bg-slate-800 hover:bg-sky-200/80 text-sky-900 dark:text-sky-300 border border-sky-200 dark:border-slate-700 font-semibold transition-colors cursor-pointer"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>

          {parsedSmartQuery && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-sky-100 dark:border-slate-800 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-blue-700 dark:text-sky-300">
                  Interpreted:
                </span>
                <span className="px-2 py-0.5 rounded bg-sky-100 dark:bg-sky-950/60 text-sky-900 dark:text-sky-200 font-semibold">
                  Employee:{' '}
                  {parsedSmartQuery.matchedEmployee
                    ? `${parsedSmartQuery.matchedEmployee.name} (${parsedSmartQuery.matchedEmployee.employeeCode})`
                    : effectiveEmp?.name || 'All'}
                </span>
                <span className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-950/60 text-blue-900 dark:text-blue-200 font-semibold">
                  Period: {parsedSmartQuery.dateLabel || rangeLabel}
                  {(smartDateOverride || parsedSmartQuery.targetDate)
                    ? ` (${smartDateOverride || parsedSmartQuery.targetDate})`
                    : ''}
                </span>
                {parsedSmartQuery.alternativeDate && (
                  <button
                    type="button"
                    onClick={() =>
                      setSmartDateOverride((prev) =>
                        prev === parsedSmartQuery.alternativeDate ? null : parsedSmartQuery.alternativeDate
                      )
                    }
                    className="px-2 py-0.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-900 font-semibold border border-amber-300 cursor-pointer"
                  >
                    {smartDateOverride === parsedSmartQuery.alternativeDate
                      ? `Back to ${parsedSmartQuery.targetDate}`
                      : `Did you mean ${parsedSmartQuery.alternativeDate} (week earlier)?`}
                  </button>
                )}
              </div>
              {parsedSmartQuery.confidence === 'none' && (
                <span className="text-amber-700 dark:text-amber-300 font-medium">
                  No exact staff name detected — showing {effectiveEmp?.name || 'team'} for the resolved date.
                </span>
              )}
            </div>
          )}
        </div>

        {/* Period & Employee Selector Strip inside Hero */}
        <div className="relative mt-4 pt-4 border-t border-sky-200/80 dark:border-slate-700 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Date Range Pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-blue-600 dark:text-sky-400 mr-1" />
            {(
              [
                { id: '7d', label: '7 Days' },
                { id: '14d', label: '14 Days' },
                { id: 'this_month', label: 'This Month' },
                { id: '30d', label: '30 Days' },
                { id: 'last_month', label: 'Last Month' },
                { id: 'custom', label: 'Custom' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setRangeKey(opt.id)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                  rangeKey === opt.id
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-white/90 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-sky-200 dark:border-slate-700 hover:bg-sky-100 dark:hover:bg-slate-700'
                }`}
              >
                {opt.label}
              </button>
            ))}

            {rangeKey === 'custom' && (
              <div className="flex items-center gap-1.5 ml-1">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="px-2 py-1 rounded-lg bg-white dark:bg-slate-800 border border-sky-200 dark:border-slate-700 text-[11px] text-slate-900 dark:text-slate-100"
                />
                <span className="text-slate-500 text-xs">→</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="px-2 py-1 rounded-lg bg-white dark:bg-slate-800 border border-sky-200 dark:border-slate-700 text-[11px] text-slate-900 dark:text-slate-100"
                />
              </div>
            )}
          </div>

          {/* Individual Employee Selector Control */}
          {viewMode === 'individual' && activeEmployees.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                <input
                  type="text"
                  value={empSearch}
                  onChange={(e) => setEmpSearch(e.target.value)}
                  placeholder="Quick find staff..."
                  className="w-36 sm:w-44 pl-8 pr-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-sky-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => stepEmployee(-1)}
                  className="p-1.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-sky-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-sky-200 dark:border-slate-700 cursor-pointer"
                  title="Previous Employee"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <select
                  value={effectiveEmp?.id || ''}
                  onChange={(e) => {
                    setSelectedEmpId(e.target.value);
                    setHoveredDate(null);
                    setPinnedDate(null);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-sky-300 dark:border-slate-600 text-xs font-semibold text-slate-900 dark:text-slate-100 max-w-[220px]"
                >
                  {(filteredEmployeeOptions.length > 0 ? filteredEmployeeOptions : activeEmployees).map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} ({e.employeeCode}) — {e.department}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => stepEmployee(1)}
                  className="p-1.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-sky-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-sky-200 dark:border-slate-700 cursor-pointer"
                  title="Next Employee"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Clickable Employee Avatar Pills Strip for 1-click hopping across every staff member */}
        {viewMode === 'individual' && activeEmployees.length > 0 && (
          <div className="relative mt-3 flex items-center gap-2 overflow-x-auto pb-1">
            {activeEmployees.map((emp) => {
              const empStats = employeeAnalyticsMap.get(emp.id);
              const isSelected = emp.id === effectiveEmp?.id;
              const statusDot =
                empStats?.todayState === 'in'
                  ? 'bg-emerald-500'
                  : empStats?.todayState === 'no_internet' || empStats?.todayState === 'break'
                  ? 'bg-amber-500'
                  : empStats?.todayState === 'out'
                  ? 'bg-slate-400'
                  : 'bg-rose-500';

              return (
                <button
                  key={emp.id}
                  type="button"
                  onClick={() => {
                    setSelectedEmpId(emp.id);
                    setHoveredDate(null);
                    setPinnedDate(null);
                  }}
                  className={`shrink-0 inline-flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : 'bg-white/90 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-sky-200 dark:border-slate-700 hover:bg-sky-100 dark:hover:bg-slate-700'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${statusDot}`} />
                  <span>{emp.name}</span>
                  <span className={`text-[10px] font-mono ${isSelected ? 'text-sky-100' : 'text-slate-400'}`}>
                    {emp.employeeCode}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Smart Query Instant Answer Card (when natural-language query pins a day) */}
      {parsedSmartQuery && viewMode === 'individual' && effectiveEmp && selectedAnalytics && (smartDateOverride || parsedSmartQuery.targetDate) && (() => {
        const queryDate = smartDateOverride || parsedSmartQuery.targetDate!;
        const matchedDay = selectedAnalytics.dailySeries.find((d) => d.date === queryDate);
        const rec = matchedDay?.record || records.find((r) => r.employeeId === effectiveEmp.id && r.date === queryDate);
        const shift = selectedAnalytics.shift;
        const shiftStartMins = parseTimeToMinutesOfDay(shift?.startTime || '09:00') ?? 540;
        const inMins = parseTimeToMinutesOfDay(rec?.timeIn);
        const deltaMins = inMins !== null ? Math.round(inMins - shiftStartMins) : null;
        const workedMins = matchedDay?.totalWorkedMinutes ?? (rec?.totalWorkedMinutes || 0);
        const breakMins = rec ? calculateBreaksDuration(rec.breaks) : 0;
        const overtimeMins = matchedDay?.overtimeMinutes ?? (rec?.overtimeMinutes || 0);

        return (
          <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border-2 border-sky-300 dark:border-sky-700 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-1 rounded-lg bg-sky-100 dark:bg-sky-900/50 text-sky-900 dark:text-sky-200 text-xs font-bold">
                  Smart Query Result
                </span>
                <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100">
                  {effectiveEmp.name} · {queryDate} ({parsedSmartQuery.dateLabel})
                </h2>
              </div>
              <button
                type="button"
                onClick={handleDownloadCurrentPdf}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download PDF</span>
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
              <div className="p-2.5 rounded-xl bg-sky-50/80 dark:bg-slate-800 border border-sky-200/70 dark:border-slate-700">
                <p className="text-[10px] font-bold uppercase text-slate-500">Status</p>
                <p className="font-bold mt-0.5 text-slate-900 dark:text-slate-100 uppercase">
                  {rec?.timeIn ? (rec.status === 'late' ? 'Present (Late)' : 'Present (On Time)') : matchedDay?.dayStatus || 'Absent'}
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-sky-50/80 dark:bg-slate-800 border border-sky-200/70 dark:border-slate-700">
                <p className="text-[10px] font-bold uppercase text-slate-500">Time In</p>
                <p className="font-mono font-bold mt-0.5 text-emerald-700 dark:text-emerald-300">
                  {rec?.timeIn ? formatTime12h(rec.timeIn) : '—'}
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-sky-50/80 dark:bg-slate-800 border border-sky-200/70 dark:border-slate-700">
                <p className="text-[10px] font-bold uppercase text-slate-500">Time Out</p>
                <p className="font-mono font-bold mt-0.5 text-slate-800 dark:text-slate-200">
                  {rec?.timeOut ? formatTime12h(rec.timeOut) : rec?.timeIn ? 'Active / Open' : '—'}
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-sky-50/80 dark:bg-slate-800 border border-sky-200/70 dark:border-slate-700">
                <p className="text-[10px] font-bold uppercase text-slate-500">Net Worked / OT</p>
                <p className="font-mono font-bold mt-0.5 text-blue-700 dark:text-sky-300">
                  {formatMinutesToHoursMinutes(workedMins)}
                  {overtimeMins > 0 ? ` (+${formatMinutesToHoursMinutes(overtimeMins)} OT)` : ''}
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-sky-50/80 dark:bg-slate-800 border border-sky-200/70 dark:border-slate-700">
                <p className="text-[10px] font-bold uppercase text-slate-500">Break</p>
                <p className="font-mono font-bold mt-0.5 text-amber-700 dark:text-amber-300">
                  {breakMins}m
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-sky-50/80 dark:bg-slate-800 border border-sky-200/70 dark:border-slate-700">
                <p className="text-[10px] font-bold uppercase text-slate-500">Punctuality vs Shift</p>
                <p className="font-bold mt-0.5 text-slate-800 dark:text-slate-200">
                  {deltaMins === null
                    ? '—'
                    : deltaMins <= 0
                    ? `${Math.abs(deltaMins)}m early`
                    : `${deltaMins}m after shift start`}
                </p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* INDIVIDUAL EMPLOYEE SMART ANALYTICS VIEW */}
      {viewMode === 'individual' && selectedAnalytics && effectiveEmp && (
        <>
          {/* AI-Style Automated Insights Strip */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {smartTakeaways.map((note, idx) => (
              <div
                key={idx}
                className={`p-3.5 rounded-xl border flex items-start gap-2.5 shadow-2xs ${
                  note.tone === 'emerald'
                    ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/70 text-emerald-950 dark:text-emerald-200'
                    : note.tone === 'amber'
                    ? 'bg-amber-50/80 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/70 text-amber-950 dark:text-amber-200'
                    : 'bg-indigo-50/70 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800/70 text-indigo-950 dark:text-indigo-200'
                }`}
              >
                <Sparkles className="w-4 h-4 shrink-0 mt-0.5 text-indigo-600 dark:text-indigo-400" />
                <p className="text-xs leading-relaxed font-medium">{note.text}</p>
              </div>
            ))}
          </div>

          {/* 4 Smart KPI Metric Cards with Animated Progress Bars */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="font-bold uppercase tracking-wider text-[10px]">Attendance Consistency</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-black font-mono text-slate-900 dark:text-slate-100">
                  {selectedAnalytics.attendanceRate}%
                </span>
                <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                  {selectedAnalytics.presentDays} / {Math.max(selectedAnalytics.scheduledWorkdays, selectedAnalytics.presentDays)} days
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500"
                  style={{ width: `${selectedAnalytics.attendanceRate}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-400">
                {selectedAnalytics.absentDays} absent · {selectedAnalytics.leaveDays} approved leave
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="font-bold uppercase tracking-wider text-[10px]">Net Hours Worked</span>
                <Clock className="w-4 h-4 text-blue-600" />
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-black font-mono text-blue-600 dark:text-blue-400">
                  {formatMinutesToHoursMinutes(selectedAnalytics.totalWorkedMinutes)}
                </span>
                <span className="text-[11px] font-mono text-slate-500">
                  Avg {formatMinutesToHoursMinutes(selectedAnalytics.avgDailyMinutes)}/day
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-600 to-indigo-500 transition-all duration-500"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.round((selectedAnalytics.avgDailyMinutes / Math.max(60, expectedShiftMins)) * 100)
                    )}%`,
                  }}
                />
              </div>
              <p className="text-[11px] text-slate-400">
                Shift target: {selectedAnalytics.shift?.expectedHours || 8}h/day ({selectedAnalytics.shift?.name || 'Standard'})
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="font-bold uppercase tracking-wider text-[10px]">Overtime & Breaks</span>
                <Flame className="w-4 h-4 text-amber-500" />
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-black font-mono text-amber-600 dark:text-amber-400">
                  +{formatMinutesToHoursMinutes(selectedAnalytics.totalOvertimeMinutes)}
                </span>
                <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                  {selectedAnalytics.overtimeDays} OT day{selectedAnalytics.overtimeDays === 1 ? '' : 's'}
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-500"
                  style={{
                    width: `${
                      selectedAnalytics.totalWorkedMinutes > 0
                        ? Math.min(
                            100,
                            Math.round(
                              (selectedAnalytics.totalOvertimeMinutes / selectedAnalytics.totalWorkedMinutes) * 100
                            ) * 3
                          )
                        : 0
                    }%`,
                  }}
                />
              </div>
              <p className="text-[11px] text-slate-400">
                Total breaks taken: {selectedAnalytics.totalBreakMinutes}m
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="font-bold uppercase tracking-wider text-[10px]">Punctuality & Audit</span>
                <TrendingUp className="w-4 h-4 text-purple-600" />
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-black font-mono text-purple-600 dark:text-purple-400">
                  {selectedAnalytics.punctualityRate}%
                </span>
                <span className="text-[11px] font-semibold text-purple-700 dark:text-purple-300">
                  {selectedAnalytics.onTimeDays} On-Time / {selectedAnalytics.lateDays} Late
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-purple-600 to-fuchsia-500 transition-all duration-500"
                  style={{ width: `${selectedAnalytics.punctualityRate}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-400">
                Verified: {selectedAnalytics.adminVerifiedDays} Admin · {selectedAnalytics.accountsVerifiedDays} Accounts
              </p>
            </div>
          </div>

          {/* GRAPHICAL BAR CHART #1: Daily Worked Hours & Overtime Column Bar Graph */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-indigo-600" />
                  <span>Daily Worked Hours & Overtime Graphical Bar Chart ({rangeLabel})</span>
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Hover or tap any daily bar to inspect arrival time, breaks, regular vs overtime hours, and audit status.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold">
                <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                  <span className="w-3 h-3 rounded-xs bg-gradient-to-t from-blue-600 to-cyan-400 inline-block" />
                  Regular
                </span>
                <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                  <span className="w-3 h-3 rounded-xs bg-gradient-to-t from-amber-500 to-orange-400 inline-block" />
                  Overtime
                </span>
                <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-500 inline-block" />
                  Late
                </span>
                <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" />
                  Absent
                </span>
              </div>
            </div>

            {/* Chart Viewport: accurate shared-scale SVG chart */}
            {(() => {
              const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
              const mapStatus = (d: (typeof selectedAnalytics.dailySeries)[number]) =>
                d.dayStatus === 'off_day' ? (d.isWorkday ? 'pending' : 'off') : d.dayStatus;
              const nowD = new Date();
              return (
                <div className="space-y-5">
                  <HoursBarChart
                    height={280}
                    targetHours={selectedAnalytics.shift?.expectedHours || 8}
                    activeKey={hoveredDate || pinnedDate}
                    onHover={setHoveredDate}
                    onSelect={setPinnedDate}
                    days={selectedAnalytics.dailySeries.map((d) => ({
                      key: d.date,
                      weekday: WD[d.weekday] || '',
                      dateLabel: d.date.slice(5),
                      regularMin: d.regularMinutes,
                      overtimeMin: d.overtimeMinutes,
                      status: mapStatus(d),
                    }))}
                  />
                  {selectedAnalytics.dailySeries.length <= 31 && (
                    <div>
                      <h3 className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                        Arrival and departure timeline
                      </h3>
                      <p className="text-[11px] text-slate-500 mb-2">
                        Each bar runs from punch-in to punch-out. The green band is the shift, amber is the grace period.
                      </p>
                      <PunchTimeline
                        shiftStart={selectedAnalytics.shift?.startTime}
                        shiftEnd={selectedAnalytics.shift?.endTime}
                        graceMinutes={selectedAnalytics.shift?.graceMinutes || 0}
                        activeKey={hoveredDate || pinnedDate}
                        onHover={setHoveredDate}
                        onSelect={setPinnedDate}
                        days={selectedAnalytics.dailySeries.map((d) => ({
                          key: d.date,
                          weekday: WD[d.weekday] || '',
                          dateLabel: d.date.slice(5),
                          status: mapStatus(d),
                          timeIn: d.record?.timeIn,
                          timeOut: d.record?.timeOut,
                          isOpen: Boolean(d.record?.timeIn && !d.record?.timeOut),
                          nowMinutes: nowD.getHours() * 60 + nowD.getMinutes(),
                          breaks: (d.record?.breaks || []).map((x) => ({ start: x.start, end: x.end })),
                        }))}
                      />
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Selected / Hovered Day Breakdown Strip */}
            {inspectedDay && (
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="px-2.5 py-1 rounded-lg bg-slate-900 text-white dark:bg-indigo-600 font-mono font-bold text-[11px]">
                    {inspectedDay.date}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      inspectedDay.dayStatus === 'on_time'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                        : inspectedDay.dayStatus === 'late'
                        ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300'
                        : inspectedDay.dayStatus === 'leave'
                        ? 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300'
                        : inspectedDay.dayStatus === 'absent'
                        ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                        : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {inspectedDay.dayStatus.replace('_', ' ')}
                  </span>
                  {inspectedDay.record?.timeIn ? (
                    <span className="font-mono text-slate-700 dark:text-slate-200 font-semibold">
                      In: {formatTime12h(inspectedDay.record.timeIn)} · Out:{' '}
                      {inspectedDay.record.timeOut ? formatTime12h(inspectedDay.record.timeOut) : 'Still In'}
                    </span>
                  ) : (
                    <span className="text-slate-500">No check-in recorded</span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
                  <span>
                    Regular: <strong>{formatMinutesToHoursMinutes(inspectedDay.regularMinutes)}</strong>
                  </span>
                  <span className="text-amber-600 dark:text-amber-400">
                    OT: <strong>{formatMinutesToHoursMinutes(inspectedDay.overtimeMinutes)}</strong>
                  </span>
                  <span>
                    Break: <strong>{inspectedDay.breakMinutes}m</strong>
                  </span>
                  <span className="text-blue-600 dark:text-blue-400 font-bold">
                    Total: {formatMinutesToHoursMinutes(inspectedDay.totalWorkedMinutes)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* 2-Column Analytical Bar Breakdown + Employee Comparison Leaderboard */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Horizontal Distribution Bar Graph */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs p-5 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Attendance & Compliance Distribution Bars
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Proportional breakdown for {effectiveEmp.name} across {dateSeries.length} days
                </p>
              </div>

              <div className="space-y-3">
                {[
                  {
                    label: 'On-Time Present Days',
                    value: selectedAnalytics.onTimeDays,
                    denom: Math.max(1, dateSeries.length),
                    barClass: 'from-emerald-500 to-teal-400',
                  },
                  {
                    label: 'Late Arrivals',
                    value: selectedAnalytics.lateDays,
                    denom: Math.max(1, selectedAnalytics.presentDays),
                    barClass: 'from-purple-600 to-fuchsia-500',
                  },
                  {
                    label: 'Overtime Days Logged',
                    value: selectedAnalytics.overtimeDays,
                    denom: Math.max(1, selectedAnalytics.presentDays),
                    barClass: 'from-amber-500 to-orange-400',
                  },
                  {
                    label: 'Absent Days',
                    value: selectedAnalytics.absentDays,
                    denom: Math.max(1, selectedAnalytics.scheduledWorkdays || dateSeries.length),
                    barClass: 'from-rose-600 to-pink-500',
                  },
                  {
                    label: 'Admin Verified Days',
                    value: selectedAnalytics.adminVerifiedDays,
                    denom: Math.max(1, selectedAnalytics.presentDays),
                    barClass: 'from-indigo-600 to-blue-500',
                  },
                  {
                    label: 'Accounts Verified Days',
                    value: selectedAnalytics.accountsVerifiedDays,
                    denom: Math.max(1, selectedAnalytics.presentDays),
                    barClass: 'from-cyan-600 to-emerald-500',
                  },
                ].map((row) => {
                  const pct = Math.min(100, Math.round((row.value / row.denom) * 100));
                  return (
                    <div key={row.label} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">{row.label}</span>
                        <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                          {row.value} <span className="text-[10px] text-slate-400">({pct}%)</span>
                        </span>
                      </div>
                      <div className="w-full h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full bg-gradient-to-r ${row.barClass} transition-all duration-500`}
                          style={{ width: `${row.value > 0 ? Math.max(4, pct) : 0}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {(selectedAnalytics.noInternetEvents > 0 || selectedAnalytics.autoClosedDays > 0) && (
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap gap-2 text-[11px]">
                  {selectedAnalytics.noInternetEvents > 0 && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800">
                      <WifiOff className="w-3 h-3" />
                      <span>{selectedAnalytics.noInternetEvents} Offline / No Internet day(s)</span>
                    </span>
                  )}
                  {selectedAnalytics.autoClosedDays > 0 && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                      <AlertTriangle className="w-3 h-3 text-amber-500" />
                      <span>{selectedAnalytics.autoClosedDays} Auto Shift+2h Closed</span>
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Ranked All-Employee Bar Comparison Panel (Click any bar to jump to that employee!) */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    All-Staff Bar Ranking
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Click any employee bar to switch individual view
                  </p>
                </div>

                <select
                  value={compareMetric}
                  onChange={(e) => setCompareMetric(e.target.value as CompareMetricKey)}
                  className="px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200"
                >
                  <option value="hours">Total Hours</option>
                  <option value="attendance">Attendance %</option>
                  <option value="punctuality">Punctuality %</option>
                  <option value="overtime">Overtime Hours</option>
                </select>
              </div>

              <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                {teamComparisonRows.map((row) => {
                  const val =
                    compareMetric === 'hours'
                      ? row.totalWorkedMinutes
                      : compareMetric === 'attendance'
                      ? row.attendanceRate
                      : compareMetric === 'punctuality'
                      ? row.punctualityRate
                      : row.totalOvertimeMinutes;
                  const labelVal =
                    compareMetric === 'hours' || compareMetric === 'overtime'
                      ? formatMinutesToHoursMinutes(val)
                      : `${val}%`;
                  const pct = Math.min(100, Math.round((val / Math.max(1, maxComparisonVal)) * 100));
                  const isActiveEmp = row.employee.id === effectiveEmp.id;

                  return (
                    <button
                      key={row.employee.id}
                      type="button"
                      onClick={() => {
                        setSelectedEmpId(row.employee.id);
                        setHoveredDate(null);
                        setPinnedDate(null);
                      }}
                      className={`w-full text-left p-2 rounded-xl border transition-all cursor-pointer ${
                        isActiveEmp
                          ? 'bg-indigo-50/90 dark:bg-indigo-950/40 border-indigo-400 dark:border-indigo-600'
                          : 'bg-slate-50/60 dark:bg-slate-800/40 border-transparent hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                          {row.employee.name}{' '}
                          <span className="text-[10px] font-mono text-slate-400">({row.employee.employeeCode})</span>
                        </span>
                        <span className="font-mono font-bold text-indigo-700 dark:text-indigo-300 shrink-0">
                          {labelVal}
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-slate-200/70 dark:bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            isActiveEmp
                              ? 'bg-gradient-to-r from-indigo-600 to-blue-500'
                              : 'bg-gradient-to-r from-slate-500 to-slate-400 dark:from-slate-600 dark:to-slate-500'
                          }`}
                          style={{ width: `${val > 0 ? Math.max(4, pct) : 0}%` }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}

      {/* TEAM COMPARISON MODE VIEW */}
      {viewMode === 'team' && (
        <div className="space-y-6">
          {/* Team Daily Aggregate Bar Chart */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-blue-600" />
                  <span>Daily Team Man-Hours & Attendance Volume ({rangeLabel})</span>
                </h2>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Aggregate daily working hours across all {activeEmployees.length} active employees
                </p>
              </div>
            </div>

            <div className="overflow-x-auto pb-2">
              {(() => {
                const maxTeamDayMins = Math.max(60, ...teamDailySeries.map((d) => d.totalMinutes));
                return (
                  <div className="relative h-60 min-w-[540px] flex items-end gap-1.5 sm:gap-2 px-3 pt-6 pb-8 border border-slate-100 dark:border-slate-800 rounded-xl bg-slate-50/70 dark:bg-slate-950/60">
                    {teamDailySeries.map((day) => {
                      const barPx = Math.round((day.totalMinutes / maxTeamDayMins) * 165);
                      const otPx = Math.min(barPx, Math.round((day.totalOtMinutes / maxTeamDayMins) * 165));
                      const regPx = Math.max(0, barPx - otPx);
                      return (
                        <div
                          key={day.date}
                          className="relative flex-1 min-w-[20px] h-full flex flex-col justify-end items-center"
                          title={`${day.date}: ${day.presentCount} present, ${formatMinutesToHoursMinutes(day.totalMinutes)} worked`}
                        >
                          {day.totalMinutes > 0 && (
                            <span className="text-[9px] font-mono font-bold text-slate-600 dark:text-slate-300 mb-1">
                              {Math.round(day.totalMinutes / 60)}h
                            </span>
                          )}
                          <div className="w-full max-w-[32px] flex flex-col-reverse items-center rounded-t-lg overflow-hidden">
                            {regPx > 0 && (
                              <div
                                className="w-full bg-gradient-to-t from-indigo-600 to-blue-400"
                                style={{ height: `${Math.max(4, regPx)}px` }}
                              />
                            )}
                            {otPx > 0 && (
                              <div
                                className="w-full bg-gradient-to-t from-amber-500 to-orange-400"
                                style={{ height: `${Math.max(3, otPx)}px` }}
                              />
                            )}
                            {day.totalMinutes === 0 && (
                              <div className="w-full h-1.5 rounded-full bg-slate-300/60 dark:bg-slate-700/60" />
                            )}
                          </div>
                          <span className="absolute -bottom-6 text-[9px] font-mono text-slate-500">
                            {day.date.slice(5)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* All Employees Horizontal Multi-Metric Graphical Comparison Grid */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Every Employee — Graphical Performance Comparison
                </h3>
                <p className="text-[11px] text-slate-500">
                  Select any employee row to open their individual chart or download their Official Timesheet PDF
                </p>
              </div>

              <div className="flex items-center gap-2">
                {(['hours', 'attendance', 'punctuality', 'overtime'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setCompareMetric(m)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold capitalize cursor-pointer ${
                      compareMetric === m
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              {teamComparisonRows.map((row, idx) => {
                const val =
                  compareMetric === 'hours'
                    ? row.totalWorkedMinutes
                    : compareMetric === 'attendance'
                    ? row.attendanceRate
                    : compareMetric === 'punctuality'
                    ? row.punctualityRate
                    : row.totalOvertimeMinutes;
                const pct = Math.min(100, Math.round((val / Math.max(1, maxComparisonVal)) * 100));

                return (
                  <div
                    key={row.employee.id}
                    className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700 bg-slate-50/50 dark:bg-slate-950/30 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedEmpId(row.employee.id);
                        setViewMode('individual');
                      }}
                      className="flex-1 text-left space-y-1.5 cursor-pointer"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold flex items-center justify-center">
                            {idx + 1}
                          </span>
                          <span className="font-bold text-slate-900 dark:text-slate-100">
                            {row.employee.name}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">
                            {row.employee.employeeCode} · {row.employee.department}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] font-mono">
                          <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                            {row.attendanceRate}% Att
                          </span>
                          <span className="text-purple-600 dark:text-purple-400 font-bold">
                            {row.punctualityRate}% On-Time
                          </span>
                          <span className="text-blue-600 dark:text-blue-400 font-bold">
                            {formatMinutesToHoursMinutes(row.totalWorkedMinutes)}
                          </span>
                        </div>
                      </div>

                      <div className="w-full h-2.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-indigo-600 via-blue-500 to-cyan-400 transition-all duration-500"
                          style={{ width: `${val > 0 ? Math.max(4, pct) : 0}%` }}
                        />
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        downloadOfficialTimesheetPdf({
                          employee: row.employee,
                          allEmployees: employees,
                          records: row.periodRecords,
                          shifts,
                          settings,
                          periodLabel: `${rangeStart} to ${rangeEnd} (${rangeLabel})`,
                          generatedBy: currentUser,
                        })
                      }
                      className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs cursor-pointer"
                    >
                      <Download className="w-3 h-3" />
                      <span>PDF Timesheet</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
