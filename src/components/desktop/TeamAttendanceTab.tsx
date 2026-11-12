import React, { useState, useMemo } from 'react';
import {
  Calendar,
  Clock,
  Edit3,
  Filter,
  Search,
  Users,
  CheckCircle2,
  Coffee,
  AlertTriangle,
  UserX,
  FileSpreadsheet,
  ShieldCheck,
  CheckCheck,
  Check,
  Sunrise,
  Sunset,
  Crown,
  MessageSquare,
  Send,
  LogOut,
  WifiOff,
  FileText,
  Download,
  X,
} from 'lucide-react';
import {
  AttendanceRecord,
  CeoComment,
  Employee,
  OfficeSettings,
  ShiftSchedule,
} from '../../types';
import {
  calculateWorkedMinutes,
  deriveLiveAttendanceState,
  DerivedWorkingState,
  formatMinutesToHoursMinutes,
  formatTime12h,
  getDayName,
  getLiveWorkedStats,
  getTodayDateString,
  isLateArrival,
} from '../../lib/attendanceCalculations';
import { exportAttendanceToCsv } from '../../lib/exportUtils';
import { downloadOfficialTimesheetPdf } from '../../lib/pdfTimesheet';
import { Modal } from '../common/Modal';

export type RosterCategoryKey =
  | 'present'
  | 'absent'
  | 'in'
  | 'no_internet'
  | 'break'
  | 'out'
  | 'admin_verified'
  | 'accounts_verified';

/** Resolves accurate offline/disconnect badge copy and tooltip for still-clocked-in employees. */
function getOfflineBadgeMeta(record?: AttendanceRecord | null): {
  timeOutLabel: string;
  statusLabel: string;
  tooltip: string;
} {
  if (!record?.lastHeartbeatAt) {
    return {
      timeOutLabel: 'Offline (In)',
      statusLabel: 'Offline · In',
      tooltip: 'Clocked in without an active online portal/desktop heartbeat (Kiosk or Admin punch)',
    };
  }
  const lastSeen = new Date(record.lastHeartbeatAt).toLocaleTimeString();
  if (record.monitoringPaused) {
    return {
      timeOutLabel: 'Offline · Tab Closed',
      statusLabel: 'Offline · Tab Closed',
      tooltip: `Browser tab closed · Last seen ${lastSeen} · Still Clocked In`,
    };
  }
  return {
    timeOutLabel: 'No Internet (In)',
    statusLabel: 'No Internet · In',
    tooltip: `Internet lost · Last seen ${lastSeen} · Still Clocked In`,
  };
}

interface TeamAttendanceTabProps {
  employees: Employee[];
  records: AttendanceRecord[];
  shifts: ShiftSchedule[];
  settings: OfficeSettings;
  onUpdateRecord: (updated: AttendanceRecord) => void;
  onBatchUpdateRecords?: (updates: AttendanceRecord[]) => void;
  adminUser: Employee;
  currentUser?: Employee;
  ceoComments?: CeoComment[];
  onAddCeoComment?: (comment: Omit<CeoComment, 'id' | 'createdAt'>) => void;
  onOpenPrintModal?: (employee: Employee | null, filteredRecords: AttendanceRecord[]) => void;
  isNetworkOnline?: boolean;
}

export const TeamAttendanceTab: React.FC<TeamAttendanceTabProps> = ({
  employees,
  records,
  shifts,
  settings,
  onUpdateRecord,
  onBatchUpdateRecords,
  adminUser,
  currentUser,
  ceoComments = [],
  onAddCeoComment,
  onOpenPrintModal,
  isNetworkOnline = true,
}) => {
  const effectiveUser = currentUser || adminUser;
  const isAdmin = effectiveUser.role === 'admin';
  const isAccountsOfficer = effectiveUser.role === 'accounts';
  const isCeo = effectiveUser.role === 'ceo';
  const canManage = isAdmin || isAccountsOfficer || isCeo;

  const [selectedDate, setSelectedDate] = useState<string>(getTodayDateString());
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryModalKey, setCategoryModalKey] = useState<RosterCategoryKey | null>(null);
  const [categorySearch, setCategorySearch] = useState<string>('');

  // Comprehensive Adjustment Modal State
  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [editWorkingStatus, setEditWorkingStatus] = useState<'working' | 'completed' | 'break' | 'absent'>('working');
  const [hasPunchIn, setHasPunchIn] = useState<boolean>(true);
  const [editTimeIn, setEditTimeIn] = useState<string>('09:00:00');
  const [hasPunchOut, setHasPunchOut] = useState<boolean>(false);
  const [editTimeOut, setEditTimeOut] = useState<string>('17:00:00');
  const [editStatus, setEditStatus] = useState<AttendanceRecord['status']>('present');
  const [editPunchNote, setEditPunchNote] = useState<string>('');
  const [editAuditReason, setEditAuditReason] = useState<string>('');

  // CEO Mention / Comment Modal State
  const [mentioningEmployee, setMentioningEmployee] = useState<Employee | null>(null);
  const [mentionMessage, setMentionMessage] = useState<string>('');

  const departments = useMemo(() => {
    return Array.from(new Set(employees.map((e) => e.department))).sort();
  }, [employees]);

  const empMap = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const shiftMap = useMemo(() => new Map(shifts.map((s) => [s.id, s])), [shifts]);

  // Records for the selected date
  const dateRecords = useMemo(() => {
    return records.filter((r) => r.date === selectedDate);
  }, [records, selectedDate]);

  const dateRecordMap = useMemo(() => {
    return new Map(dateRecords.map((r) => [r.employeeId, r]));
  }, [dateRecords]);

  // Verification Handlers
  const handleToggleAdminVerify = (record: AttendanceRecord) => {
    const isCurrentlyVerified = !!record.adminVerification?.verified;
    const nowIso = new Date().toISOString();
    const updated: AttendanceRecord = {
      ...record,
      adminVerification: {
        verified: !isCurrentlyVerified,
        verifiedAt: !isCurrentlyVerified ? nowIso : undefined,
        verifiedByName: !isCurrentlyVerified ? effectiveUser.name : undefined,
        verifiedById: !isCurrentlyVerified ? effectiveUser.id : undefined,
      },
      recordUpdatedAt: nowIso,
      lastEditedByRole: effectiveUser.role,
      actorAction: 'verify',
    };
    onUpdateRecord(updated);
  };

  const handleToggleAccountsVerify = (record: AttendanceRecord) => {
    const isCurrentlyVerified = !!record.accountsVerification?.verified;
    const nowIso = new Date().toISOString();
    const updated: AttendanceRecord = {
      ...record,
      accountsVerification: {
        verified: !isCurrentlyVerified,
        verifiedAt: !isCurrentlyVerified ? nowIso : undefined,
        verifiedByName: !isCurrentlyVerified ? effectiveUser.name : undefined,
        verifiedById: !isCurrentlyVerified ? effectiveUser.id : undefined,
      },
      recordUpdatedAt: nowIso,
      lastEditedByRole: effectiveUser.role,
      actorAction: 'verify',
    };
    onUpdateRecord(updated);
  };

  const handleBatchVerifyToday = (roleType: 'admin' | 'accounts') => {
    const targetKey = roleType === 'admin' ? 'adminVerification' : 'accountsVerification';
    const roleLabel = roleType === 'admin' ? 'Admin' : 'Accounts Officer';
    const nowIso = new Date().toISOString();
    const updates: AttendanceRecord[] = [];

    dateRecords.forEach((rec) => {
      if (rec.timeIn && (!rec[targetKey] || !rec[targetKey]?.verified)) {
        updates.push({
          ...rec,
          [targetKey]: {
            verified: true,
            verifiedAt: nowIso,
            verifiedByName: effectiveUser.name,
            verifiedById: effectiveUser.id,
          },
          recordUpdatedAt: nowIso,
          lastEditedByRole: effectiveUser.role,
          actorAction: 'verify',
        });
      }
    });

    if (updates.length === 0) {
      alert(`All attendance records for ${selectedDate} are already verified by ${roleLabel}.`);
      return;
    }

    if (onBatchUpdateRecords) {
      onBatchUpdateRecords(updates);
    } else {
      updates.forEach((u) => onUpdateRecord(u));
    }
  };

  const todayStr = getTodayDateString();

  // Combine active employees with their record on selectedDate
  const teamRoster = useMemo(() => {
    return employees
      .filter((emp) => emp.isActive)
      .map((emp) => {
        const record = dateRecordMap.get(emp.id);
        const shift = shiftMap.get(emp.shiftId) || shifts[0];
        const derivedStatus = deriveLiveAttendanceState({
          record,
          settings,
          todayStr,
          isCurrentUserOffline: !isNetworkOnline && emp.id === effectiveUser.id,
          isCurrentUserConnected: isNetworkOnline && emp.id === effectiveUser.id,
        });
        const isClockedIn = derivedStatus === 'in' || derivedStatus === 'no_internet';
        const isOnBreak = derivedStatus === 'break';
        const isCompleted = derivedStatus === 'out';
        const isAbsent = derivedStatus === 'absent';

        return {
          employee: emp,
          record,
          shift,
          derivedStatus,
          isClockedIn,
          isOnBreak,
          isCompleted,
          isAbsent,
        };
      })
      .filter((item) => {
        if (departmentFilter !== 'all' && item.employee.department !== departmentFilter) {
          return false;
        }
        if (statusFilter !== 'all') {
          if (statusFilter === 'present' && !item.record?.timeIn) return false;
          if (statusFilter === 'in' && item.derivedStatus !== 'in') return false;
          if (statusFilter === 'no_internet' && item.derivedStatus !== 'no_internet') return false;
          if (statusFilter === 'break' && item.derivedStatus !== 'break') return false;
          if (statusFilter === 'out' && item.derivedStatus !== 'out') return false;
          if (statusFilter === 'absent' && item.derivedStatus !== 'absent') return false;
          if (statusFilter === 'late' && item.record?.status !== 'late') return false;
          if (statusFilter === 'admin_verified' && !item.record?.adminVerification?.verified) return false;
          if (statusFilter === 'accounts_verified' && !item.record?.accountsVerification?.verified) return false;
          if (statusFilter === 'admin_unverified') {
            if (!item.record || item.record.adminVerification?.verified) return false;
          }
          if (statusFilter === 'accounts_unverified') {
            if (!item.record || item.record.accountsVerification?.verified) return false;
          }
          if (statusFilter === 'auto_punched') {
            if (!item.record?.isAutoPunchedOut) return false;
          }
          if (statusFilter === 'auto_inactivity') {
            if (
              !item.record?.isAutoPunchedOut ||
              (item.record.autoPunchOutReason !== 'shift_end_2h' &&
                item.record.autoPunchOutReason !== 'inactivity_2h')
            ) {
              return false;
            }
          }
        }
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          const matchName = item.employee.name.toLowerCase().includes(q);
          const matchCode = item.employee.employeeCode.toLowerCase().includes(q);
          const matchDept = item.employee.department.toLowerCase().includes(q);
          if (!matchName && !matchCode && !matchDept) return false;
        }
        return true;
      })
      .sort((a, b) => {
        // Working status priority: Working 'in' (1) -> No Internet 'no_internet' (2) -> On break 'break' (3) -> Completed 'out' (4) -> Absent 'absent' (5)
        const priority: Record<DerivedWorkingState, number> = {
          in: 1,
          no_internet: 2,
          break: 3,
          out: 4,
          absent: 5,
        };
        const rankDiff = priority[a.derivedStatus] - priority[b.derivedStatus];
        if (rankDiff !== 0) return rankDiff;

        // Secondary sort: If both currently in, sort by timeIn earliest first
        if (
          (a.derivedStatus === 'in' || a.derivedStatus === 'no_internet') &&
          a.record?.timeIn &&
          b.record?.timeIn
        ) {
          return a.record.timeIn.localeCompare(b.record.timeIn);
        }
        // Otherwise sort alphabetically by name
        return a.employee.name.localeCompare(b.employee.name);
      });
  }, [employees, dateRecordMap, shiftMap, shifts, departmentFilter, statusFilter, searchQuery, settings, todayStr, isNetworkOnline, effectiveUser.id]);

  // Presence & Verification counts
  const liveCounts = useMemo(() => {
    let inCount = 0;
    let noInternetCount = 0;
    let breakCount = 0;
    let completedCount = 0;
    let absentCount = 0;
    let lateCount = 0;
    let adminVerifiedCount = 0;
    let accountsVerifiedCount = 0;
    let autoPunchedCount = 0;
    let presentPCount = 0;
    let absentACount = 0;

    employees.filter((e) => e.isActive).forEach((emp) => {
      const rec = dateRecordMap.get(emp.id);
      if (!rec || !rec.timeIn) {
        absentCount++;
        absentACount++;
      } else {
        presentPCount++;
        if (rec.status === 'late') lateCount++;
        if (rec.isAutoPunchedOut) autoPunchedCount++;
        if (rec.adminVerification?.verified) adminVerifiedCount++;
        if (rec.accountsVerification?.verified) accountsVerifiedCount++;
        const state = deriveLiveAttendanceState({
          record: rec,
          settings,
          todayStr,
          isCurrentUserOffline: !isNetworkOnline && emp.id === effectiveUser.id,
          isCurrentUserConnected: isNetworkOnline && emp.id === effectiveUser.id,
        });
        if (state === 'out') {
          completedCount++;
        } else if (state === 'break') {
          breakCount++;
        } else if (state === 'no_internet') {
          noInternetCount++;
        } else {
          inCount++;
        }
      }
    });

    return {
      inCount,
      noInternetCount,
      breakCount,
      completedCount,
      absentCount,
      lateCount,
      adminVerifiedCount,
      accountsVerifiedCount,
      autoPunchedCount,
      presentPCount,
      absentACount,
    };
  }, [employees, dateRecordMap, settings, todayStr, isNetworkOnline, effectiveUser.id]);

  const ROSTER_CATEGORY_META: Record<
    RosterCategoryKey,
    { title: string; subtitle: string; badgeClass: string }
  > = {
    present: {
      title: "Present ('P') Employees",
      subtitle: 'All staff who marked attendance / clocked in on this date',
      badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-200',
    },
    absent: {
      title: "Absent ('A') Employees",
      subtitle: 'Staff who have not arrived or have no check-in record on this date',
      badgeClass: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-200',
    },
    in: {
      title: 'Clocked In (Online)',
      subtitle: 'Staff actively online and working at their desks',
      badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-200',
    },
    no_internet: {
      title: 'Offline / No Internet (Still In)',
      subtitle: 'Clocked-in staff without an active heartbeat, internet loss, or tab closed',
      badgeClass: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-200',
    },
    break: {
      title: 'Employees Currently On Break',
      subtitle: 'Staff on temporary lunch, coffee, or short break pause',
      badgeClass: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-200',
    },
    out: {
      title: 'Shift Ended (Punched Out)',
      subtitle: 'Staff who have completed their shift or auto-punched out on this date',
      badgeClass: 'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200',
    },
    admin_verified: {
      title: 'Admin Verified Attendance',
      subtitle: 'Attendance logs verified by Office Administrator',
      badgeClass: 'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950/60 dark:text-purple-200',
    },
    accounts_verified: {
      title: 'Accounts Verified Attendance',
      subtitle: 'Attendance logs verified by Accounts Officer',
      badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-200',
    },
  };

  const categoryListItems = useMemo(() => {
    if (!categoryModalKey) return [];
    const q = categorySearch.trim().toLowerCase();

    return employees
      .filter((emp) => emp.isActive)
      .map((emp) => {
        const record = dateRecordMap.get(emp.id);
        const shift = shiftMap.get(emp.shiftId) || shifts[0];
        const derivedStatus = deriveLiveAttendanceState({
          record,
          settings,
          todayStr,
          isCurrentUserOffline: !isNetworkOnline && emp.id === effectiveUser.id,
          isCurrentUserConnected: isNetworkOnline && emp.id === effectiveUser.id,
        });
        return { employee: emp, record, shift, derivedStatus };
      })
      .filter((item) => {
        if (departmentFilter !== 'all' && item.employee.department !== departmentFilter) {
          return false;
        }
        if (categoryModalKey === 'present') return Boolean(item.record?.timeIn);
        if (categoryModalKey === 'absent') return !item.record?.timeIn;
        if (categoryModalKey === 'in') return item.derivedStatus === 'in';
        if (categoryModalKey === 'no_internet') return item.derivedStatus === 'no_internet';
        if (categoryModalKey === 'break') return item.derivedStatus === 'break';
        if (categoryModalKey === 'out') return item.derivedStatus === 'out';
        if (categoryModalKey === 'admin_verified') return Boolean(item.record?.adminVerification?.verified);
        if (categoryModalKey === 'accounts_verified') return Boolean(item.record?.accountsVerification?.verified);
        return true;
      })
      .filter((item) => {
        if (!q) return true;
        return (
          item.employee.name.toLowerCase().includes(q) ||
          item.employee.employeeCode.toLowerCase().includes(q) ||
          item.employee.department.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.employee.name.localeCompare(b.employee.name));
  }, [
    categoryModalKey,
    categorySearch,
    employees,
    dateRecordMap,
    shiftMap,
    shifts,
    departmentFilter,
    settings,
    todayStr,
    isNetworkOnline,
    effectiveUser.id,
  ]);

  const handleClickCategoryCard = (key: RosterCategoryKey) => {
    setCategorySearch('');
    setStatusFilter(key);
    setCategoryModalKey(key);
  };

  const handleOpenEmployeeTimesheet = (emp: Employee) => {
    const empRecords = records.filter((r) => r.employeeId === emp.id);
    if (onOpenPrintModal) {
      onOpenPrintModal(emp, empRecords);
    } else {
      downloadOfficialTimesheetPdf({
        employee: emp,
        allEmployees: employees,
        records: empRecords,
        shifts,
        settings,
        generatedBy: effectiveUser,
      });
    }
  };

  // Open adjustment modal with separate options for punch in, punch out, and working status
  const handleOpenAdjustment = (emp: Employee, existingRecord?: AttendanceRecord) => {
    setEditingEmployee(emp);
    const shift = shiftMap.get(emp.shiftId) || shifts[0];
    if (existingRecord && existingRecord.timeIn) {
      setEditingRecord(existingRecord);
      setHasPunchIn(true);
      setEditTimeIn(existingRecord.timeIn);
      const hasOut = !!existingRecord.timeOut;
      setHasPunchOut(hasOut);
      setEditTimeOut(hasOut ? existingRecord.timeOut! : shift.endTime);

      const onBreak = existingRecord.breaks?.some((b) => !b.end);
      if (onBreak) {
        setEditWorkingStatus('break');
      } else if (hasOut) {
        setEditWorkingStatus('completed');
      } else {
        setEditWorkingStatus('working');
      }

      setEditStatus(existingRecord.status);
      setEditPunchNote(existingRecord.notes || '');
      setEditAuditReason(existingRecord.adjustmentNote || '');
    } else {
      // New punch record or employee marked absent
      setEditingRecord(existingRecord || null);
      setHasPunchIn(true);
      setEditTimeIn(shift.startTime);
      setHasPunchOut(false);
      setEditTimeOut(shift.endTime);
      setEditWorkingStatus('working');
      setEditStatus('present');
      setEditPunchNote('');
      setEditAuditReason('Manual retroactive attendance entry by administrator');
    }
  };

  // Quick 1-click admin clock in / clock out directly from table
  const handleQuickAdminPunch = (emp: Employee, action: 'in' | 'out') => {
    const shift = shiftMap.get(emp.shiftId) || shifts[0];
    const nowTime = new Date().toTimeString().slice(0, 8);
    const nowIso = new Date().toISOString();
    const existing = dateRecordMap.get(emp.id);

    if (action === 'in') {
      const isLate = isLateArrival(nowTime, shift);
      const isSelfOrDesktopMonitored =
        emp.id === effectiveUser.id ||
        existing?.heartbeatSource === 'web-client' ||
        existing?.heartbeatSource === 'windows-agent';
      const cleanedNotes = (existing?.notes || '')
        .replace(/\s*·?\s*(Clocked Out by Admin|Auto system Punched out|Auto Punched Out\s*\([^)]*\))/gi, '')
        .trim();

      const updated: AttendanceRecord = {
        ...(existing || {
          id: `att-${selectedDate}-${emp.id}`,
          employeeId: emp.id,
          date: selectedDate,
          day: getDayName(selectedDate),
          breaks: [],
        }),
        timeIn: nowTime,
        timeOut: undefined,
        clearTimeOut: true,
        isAutoPunchedOut: false,
        autoPunchOutReason: undefined,
        disconnectedAt: undefined,
        monitoringPaused: false,
        heartbeatSource: isSelfOrDesktopMonitored
          ? existing?.heartbeatSource || 'web-client'
          : existing?.heartbeatSource || 'kiosk',
        ...(isSelfOrDesktopMonitored
          ? {
              connectionStatus: emp.id === effectiveUser.id && !isNetworkOnline ? ('no_internet' as const) : ('online' as const),
              lastHeartbeatAt: nowIso,
              lastActivityAt: nowIso,
            }
          : {}),
        totalWorkedMinutes: 0,
        regularMinutes: 0,
        overtimeMinutes: 0,
        status: isLate ? 'late' : 'present',
        notes: cleanedNotes ? `${cleanedNotes} · Clocked In by Admin` : 'Clocked In by Admin',
        isManuallyAdjusted: true,
        adjustmentNote: `Quick Clock In by ${effectiveUser.name}`,
        adjustedBy: `${effectiveUser.name} (${effectiveUser.role.toUpperCase()})`,
        recordUpdatedAt: nowIso,
        lastEditedByRole: effectiveUser.role,
        actorAction: 'admin_edit',
        adminOverrideAt: nowIso,
        adminKeepOpen: true,
      };
      onUpdateRecord(updated);
    } else {
      if (!existing || !existing.timeIn) {
        alert('Cannot punch out: Employee has no punch-in recorded for today.');
        return;
      }
      const closedBreaks = (existing.breaks || []).map((b) =>
        !b.end ? { ...b, end: nowTime } : b
      );
      const worked = calculateWorkedMinutes(existing.timeIn, nowTime, closedBreaks, shift.expectedHours);
      const updated: AttendanceRecord = {
        ...existing,
        timeOut: nowTime,
        clearTimeOut: false,
        isAutoPunchedOut: false,
        autoPunchOutReason: undefined,
        breaks: closedBreaks,
        totalWorkedMinutes: worked.totalWorkedMinutes,
        regularMinutes: worked.regularMinutes,
        overtimeMinutes: worked.overtimeMinutes,
        notes: existing.notes ? `${existing.notes} · Clocked Out by Admin` : 'Clocked Out by Admin',
        isManuallyAdjusted: true,
        adjustmentNote: `Quick Clock Out by ${effectiveUser.name}`,
        adjustedBy: `${effectiveUser.name} (${effectiveUser.role.toUpperCase()})`,
        recordUpdatedAt: nowIso,
        lastEditedByRole: effectiveUser.role,
        actorAction: 'admin_edit',
        adminOverrideAt: nowIso,
        adminKeepOpen: false,
      };
      onUpdateRecord(updated);
    }
  };

  const handleSaveAdjustment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEmployee) return;

    const shift = shiftMap.get(editingEmployee.shiftId) || shifts[0];
    const nowTime = new Date().toTimeString().slice(0, 8);
    const nowIso = new Date().toISOString();

    // Determine final timeIn, timeOut, breaks, and clearTimeOut flag
    let finalTimeIn: string = '';
    let finalTimeOut: string | undefined = undefined;
    let finalStatus: AttendanceRecord['status'] = editStatus;
    let updatedBreaks = [...(editingRecord?.breaks || [])];
    let shouldClearTimeOut = false;

    if (editWorkingStatus === 'absent' || !hasPunchIn) {
      finalTimeIn = '';
      finalTimeOut = undefined;
      finalStatus = 'absent';
      updatedBreaks = [];
      shouldClearTimeOut = true;
    } else {
      finalTimeIn = editTimeIn.trim() || shift.startTime;

      if (editWorkingStatus === 'working') {
        finalTimeOut = undefined;
        shouldClearTimeOut = true;
        updatedBreaks = updatedBreaks.map((b) => (!b.end ? { ...b, end: nowTime } : b));
        if (finalStatus === 'absent') finalStatus = 'present';
      } else if (editWorkingStatus === 'break') {
        finalTimeOut = undefined;
        shouldClearTimeOut = true;
        if (!updatedBreaks.some((b) => !b.end)) {
          updatedBreaks.push({
            id: `brk-${Date.now()}`,
            start: nowTime,
            type: 'lunch',
          });
        }
        if (finalStatus === 'absent') finalStatus = 'present';
      } else if (editWorkingStatus === 'completed' || hasPunchOut) {
        finalTimeOut = editTimeOut.trim() || shift.endTime;
        updatedBreaks = updatedBreaks.map((b) => (!b.end ? { ...b, end: finalTimeOut } : b));
        if (finalStatus === 'absent') finalStatus = 'present';
      } else {
        finalTimeOut = undefined;
        shouldClearTimeOut = true;
        if (finalStatus === 'absent') finalStatus = 'present';
      }
    }

    const worked = finalTimeIn && finalTimeOut
      ? calculateWorkedMinutes(finalTimeIn, finalTimeOut, updatedBreaks, shift.expectedHours)
      : finalTimeIn
      ? calculateWorkedMinutes(finalTimeIn, undefined, updatedBreaks, shift.expectedHours)
      : { totalWorkedMinutes: 0, regularMinutes: 0, overtimeMinutes: 0 };

    const isReopeningActiveShift = shouldClearTimeOut && editWorkingStatus !== 'absent' && Boolean(finalTimeIn);
    const isSelfOrDesktopMonitored =
      editingEmployee.id === effectiveUser.id ||
      editingRecord?.heartbeatSource === 'web-client' ||
      editingRecord?.heartbeatSource === 'windows-agent';

    let finalPunchNote = editPunchNote.trim();
    if (isReopeningActiveShift && finalPunchNote) {
      finalPunchNote = finalPunchNote
        .replace(/\s*·?\s*(Clocked Out by Admin|Auto system Punched out|Auto Punched Out\s*\([^)]*\))/gi, '')
        .trim();
    }

    const finalAuditReason =
      editAuditReason.trim() ||
      (isReopeningActiveShift
        ? 'Marked Currently Working by Administrator'
        : editWorkingStatus === 'absent'
        ? 'Marked Absent by Administrator'
        : 'Manual attendance adjustment by Administrator');

    const updated: AttendanceRecord = {
      ...(editingRecord || {
        id: `att-${selectedDate}-${editingEmployee.id}`,
        employeeId: editingEmployee.id,
        date: selectedDate,
        day: getDayName(selectedDate),
        breaks: [],
      }),
      timeIn: finalTimeIn,
      timeOut: finalTimeOut,
      clearTimeOut: shouldClearTimeOut,
      isAutoPunchedOut: shouldClearTimeOut ? false : false,
      autoPunchOutReason: undefined,
      disconnectedAt: isReopeningActiveShift ? undefined : editingRecord?.disconnectedAt,
      monitoringPaused: false,
      ...(isReopeningActiveShift
        ? {
            heartbeatSource: isSelfOrDesktopMonitored
              ? editingRecord?.heartbeatSource || 'web-client'
              : editingRecord?.heartbeatSource || 'kiosk',
            ...(isSelfOrDesktopMonitored
              ? {
                  connectionStatus:
                    editingEmployee.id === effectiveUser.id && !isNetworkOnline
                      ? ('no_internet' as const)
                      : ('online' as const),
                  lastHeartbeatAt: nowIso,
                  lastActivityAt: nowIso,
                }
              : {}),
          }
        : {}),
      breaks: updatedBreaks,
      totalWorkedMinutes: worked.totalWorkedMinutes,
      regularMinutes: worked.regularMinutes,
      overtimeMinutes: worked.overtimeMinutes,
      status: finalStatus,
      notes: finalPunchNote || undefined,
      isManuallyAdjusted: true,
      adjustmentNote: finalAuditReason,
      adjustedBy: `${effectiveUser.name} (${effectiveUser.employeeCode || effectiveUser.role.toUpperCase()})`,
      recordUpdatedAt: nowIso,
      lastEditedByRole: effectiveUser.role,
      actorAction: 'admin_edit',
      adminOverrideAt: nowIso,
      adminKeepOpen: isReopeningActiveShift,
    };

    onUpdateRecord(updated);
    setEditingRecord(null);
    setEditingEmployee(null);
  };

  const handleOpenMentionModal = (emp: Employee) => {
    setMentioningEmployee(emp);
    setMentionMessage('');
  };

  const handleSendCeoMention = (e: React.FormEvent) => {
    e.preventDefault();
    if (!mentioningEmployee || !mentionMessage.trim() || !onAddCeoComment) return;

    onAddCeoComment({
      employeeId: mentioningEmployee.id,
      employeeName: mentioningEmployee.name,
      fromName: effectiveUser.name,
      fromRole: effectiveUser.role,
      message: mentionMessage.trim(),
      date: selectedDate,
    });

    alert(`Directive/Mention successfully sent to ${mentioningEmployee.name}! It will appear in their notifications and dashboard.`);
    setMentioningEmployee(null);
    setMentionMessage('');
  };

  const handleExportToday = () => {
    exportAttendanceToCsv({
      records: dateRecords,
      employees,
      shifts,
      settings,
      startDate: selectedDate,
      endDate: selectedDate,
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Banner: Date Selector & Live Counts */}
      <div className="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
            <Users className="w-3.5 h-3.5" />
            <span>Team Attendance & Roster</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-1.5">
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Office Presence:
            </h1>
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-emerald-100/90 dark:bg-emerald-950/80 border-2 border-emerald-400 dark:border-emerald-600 shadow-xs">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-sm font-black text-emerald-900 dark:text-emerald-200">
                {selectedDate}
              </span>
              <span className="text-emerald-500 font-bold">•</span>
              <span className="text-sm font-black text-emerald-800 dark:text-emerald-300 uppercase tracking-wide">
                {getDayName(selectedDate)}
              </span>
            </div>
          </div>
        </div>

        {/* Date Selector & Export Button */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs">
            <Calendar className="w-4 h-4 text-slate-400" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent text-slate-900 dark:text-slate-100 focus:outline-none font-medium cursor-pointer"
            />
          </div>

          <button
            onClick={() => setSelectedDate(getTodayDateString())}
            className="px-3 py-1.5 text-xs rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 transition-colors font-medium cursor-pointer"
          >
            Today
          </button>

          {(isAdmin || isAccountsOfficer) && (
            <button
              onClick={() => handleBatchVerifyToday(isAdmin ? 'admin' : 'accounts')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer text-white ${
                isAdmin
                  ? 'bg-purple-600 hover:bg-purple-700'
                  : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
              title={`Batch verify all active attendance records for ${selectedDate}`}
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>Verify All ({isAdmin ? 'Admin' : 'Accounts'})</span>
            </button>
          )}

          {canManage && (
            <button
              type="button"
              onClick={() => {
                if (onOpenPrintModal) {
                  onOpenPrintModal(null, dateRecords);
                } else {
                  downloadOfficialTimesheetPdf({
                    employee: null,
                    allEmployees: employees,
                    records: dateRecords,
                    shifts,
                    settings,
                    periodLabel: `Roster Date: ${selectedDate}`,
                    generatedBy: effectiveUser,
                  });
                }
              }}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors cursor-pointer"
              title="Download or preview official A4 PDF timesheet"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Official PDF</span>
            </button>
          )}

          <button
            onClick={handleExportToday}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Export Roster CSV</span>
          </button>
        </div>
      </div>

      {/* Clickable Presence & Verification KPI Summary Cards (Click any tab for employee list) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2.5">
        {/* Total Present ('P') */}
        <button
          type="button"
          onClick={() => handleClickCategoryCard('present')}
          title="Click to view list of all Present ('P') employees"
          className={`text-left p-3 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/40 border-2 shadow-2xs transition-all hover:scale-[1.01] hover:shadow-sm cursor-pointer ${
            statusFilter === 'present'
              ? 'border-emerald-600 ring-2 ring-emerald-400/50'
              : 'border-emerald-400/90 dark:border-emerald-600'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black text-emerald-800 dark:text-emerald-300 uppercase tracking-wider">
              Present ('P')
            </span>
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          </div>
          <div className="text-xl font-black font-mono text-emerald-700 dark:text-emerald-300 mt-1">
            {liveCounts.presentPCount}
          </div>
          <span className="text-[10px] font-medium text-emerald-600/90 dark:text-emerald-400">Active present · View list</span>
        </button>

        {/* Total Absent ('A') */}
        <button
          type="button"
          onClick={() => handleClickCategoryCard('absent')}
          title="Click to view list of all Absent ('A') employees"
          className={`text-left p-3 rounded-xl bg-rose-50/80 dark:bg-rose-950/40 border shadow-2xs transition-all hover:scale-[1.01] hover:shadow-sm cursor-pointer ${
            statusFilter === 'absent'
              ? 'border-rose-600 ring-2 ring-rose-400/50'
              : 'border-rose-300 dark:border-rose-800'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black text-rose-800 dark:text-rose-300 uppercase tracking-wider">
              Absent ('A')
            </span>
            <span className="w-2 h-2 rounded-full bg-rose-500" />
          </div>
          <div className="text-xl font-black font-mono text-rose-700 dark:text-rose-300 mt-1">
            {liveCounts.absentACount}
          </div>
          <span className="text-[10px] font-medium text-rose-600/90 dark:text-rose-400">Not arrived · View list</span>
        </button>

        {/* Working at desk (Online) */}
        <button
          type="button"
          onClick={() => handleClickCategoryCard('in')}
          title="Click to view list of all Clocked In (Online) employees"
          className={`text-left p-3 rounded-xl bg-white dark:bg-slate-900 border shadow-2xs transition-all hover:scale-[1.01] hover:border-emerald-400 hover:shadow-sm cursor-pointer ${
            statusFilter === 'in'
              ? 'border-emerald-500 ring-2 ring-emerald-400/40'
              : 'border-slate-200 dark:border-slate-800'
          }`}
        >
          <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Clocked In (Online)
          </span>
          <div className="text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">
            {liveCounts.inCount}
          </div>
          <span className="text-[10px] text-slate-400">At desks · View list</span>
        </button>

        {/* No Internet / Offline (Still In) */}
        <button
          type="button"
          onClick={() => handleClickCategoryCard('no_internet')}
          title="Click to view list of all Offline / No Internet (In) employees"
          className={`text-left p-3 rounded-xl border shadow-2xs transition-all hover:scale-[1.01] hover:shadow-sm cursor-pointer ${
            statusFilter === 'no_internet'
              ? 'border-amber-600 ring-2 ring-amber-400/50 bg-amber-50 dark:bg-amber-950/60'
              : liveCounts.noInternetCount > 0
              ? 'bg-amber-50/90 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700'
              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
              Offline / No Internet (In)
            </span>
            <WifiOff className={`w-3 h-3 text-amber-600 ${liveCounts.noInternetCount > 0 ? 'animate-pulse' : 'opacity-40'}`} />
          </div>
          <div className="text-xl font-bold font-mono text-amber-600 dark:text-amber-400 mt-1">
            {liveCounts.noInternetCount}
          </div>
          <span className="text-[10px] text-slate-400">No internet · View list</span>
        </button>

        {/* On Break */}
        <button
          type="button"
          onClick={() => handleClickCategoryCard('break')}
          title="Click to view list of employees currently On Break"
          className={`text-left p-3 rounded-xl bg-white dark:bg-slate-900 border shadow-2xs transition-all hover:scale-[1.01] hover:border-amber-400 hover:shadow-sm cursor-pointer ${
            statusFilter === 'break'
              ? 'border-amber-500 ring-2 ring-amber-400/40'
              : 'border-slate-200 dark:border-slate-800'
          }`}
        >
          <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            On Break
          </span>
          <div className="text-xl font-bold font-mono text-amber-600 dark:text-amber-400 mt-1">
            {liveCounts.breakCount}
          </div>
          <span className="text-[10px] text-slate-400">Temporary pause · List</span>
        </button>

        {/* Completed / Shift Ended */}
        <button
          type="button"
          onClick={() => handleClickCategoryCard('out')}
          title="Click to view list of employees whose Shift Ended"
          className={`text-left p-3 rounded-xl bg-white dark:bg-slate-900 border shadow-2xs transition-all hover:scale-[1.01] hover:border-slate-400 hover:shadow-sm cursor-pointer ${
            statusFilter === 'out'
              ? 'border-slate-600 ring-2 ring-slate-400/40'
              : 'border-slate-200 dark:border-slate-800'
          }`}
        >
          <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Shift Ended
          </span>
          <div className="text-xl font-bold font-mono text-slate-700 dark:text-slate-300 mt-1">
            {liveCounts.completedCount}
          </div>
          <span className="text-[10px] text-slate-400">Punched out · View list</span>
        </button>

        {/* Admin Verified */}
        <button
          type="button"
          onClick={() => handleClickCategoryCard('admin_verified')}
          title="Click to view list of Admin Verified employees"
          className={`text-left p-3 rounded-xl bg-white dark:bg-slate-900 border shadow-2xs transition-all hover:scale-[1.01] hover:border-purple-400 hover:shadow-sm cursor-pointer ${
            statusFilter === 'admin_verified'
              ? 'border-purple-500 ring-2 ring-purple-400/40'
              : 'border-purple-200/60 dark:border-purple-900/40'
          }`}
        >
          <span className="text-[10px] font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wider">
            Admin Verified
          </span>
          <div className="text-xl font-bold font-mono text-purple-700 dark:text-purple-300 mt-1">
            {liveCounts.adminVerifiedCount}
          </div>
          <span className="text-[10px] text-slate-400">Validated · View list</span>
        </button>

        {/* Accounts Verified */}
        <button
          type="button"
          onClick={() => handleClickCategoryCard('accounts_verified')}
          title="Click to view list of Accounts Verified employees"
          className={`text-left p-3 rounded-xl bg-white dark:bg-slate-900 border shadow-2xs transition-all hover:scale-[1.01] hover:border-emerald-400 hover:shadow-sm cursor-pointer ${
            statusFilter === 'accounts_verified'
              ? 'border-emerald-500 ring-2 ring-emerald-400/40'
              : 'border-emerald-200/60 dark:border-emerald-900/40'
          }`}
        >
          <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
            Accounts Verified
          </span>
          <div className="text-xl font-bold font-mono text-emerald-700 dark:text-emerald-300 mt-1">
            {liveCounts.accountsVerifiedCount}
          </div>
          <span className="text-[10px] text-slate-400">Validated · View list</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-wrap items-center justify-between gap-3">
        {/* Search */}
        <div className="relative min-w-[240px]">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search employee name or code..."
            className="w-full pl-9 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-slate-100 focus:outline-none"
          />
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
        </div>

        {/* Department and Status Selectors */}
        <div className="flex flex-wrap items-center gap-3">
          {statusFilter !== 'all' && (
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200 border border-blue-300 dark:border-blue-700 hover:bg-blue-200 cursor-pointer"
            >
              <span>Filter: {statusFilter.replace('_', ' ')}</span>
              <X className="w-3 h-3" />
            </button>
          )}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Dept:</span>
            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-slate-100"
            >
              <option value="all">All Departments</option>
              {departments.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-slate-100"
            >
              <option value="all">All Statuses</option>
              <option value="present">Present ('P')</option>
              <option value="in">Currently In (Online)</option>
              <option value="no_internet">Offline / No Internet (In)</option>
              <option value="break">On Break</option>
              <option value="out">Shift Finished</option>
              <option value="late">Late Arrival</option>
              <option value="absent">Absent / Not In</option>
              <option value="admin_verified">Admin Verified</option>
              <option value="accounts_verified">Accounts Verified</option>
              <option value="admin_unverified">Pending Admin Verification</option>
              <option value="accounts_unverified">Pending Accounts Verification</option>
              <option value="auto_punched">All Auto Punched Out</option>
              <option value="auto_inactivity">Auto Punched (Shift End + 2h)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Roster Table */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <th className="py-3 px-3">Employee</th>
                <th className="py-3 px-3">Department & Shift</th>
                <th className="py-3 px-3 text-center">P / A Status</th>
                <th className="py-3 px-3">Time In</th>
                <th className="py-3 px-3">Time Out</th>
                <th className="py-3 px-3 text-right">Hours</th>
                <th className="py-3 px-3 text-center">Working Status</th>
                <th className="py-3 px-3 text-center">Admin Verify</th>
                <th className="py-3 px-3 text-center">Accounts Verify</th>
                {(isAdmin || isAccountsOfficer || isCeo) && (
                  <th className="py-3 px-3 text-right">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {teamRoster.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin || isAccountsOfficer || isCeo ? 10 : 9} className="py-12 text-center text-slate-400">
                    No employees matched the selected filters.
                  </td>
                </tr>
              ) : (
                teamRoster.map(({ employee, record, shift, derivedStatus }) => {
                  return (
                    <tr
                      key={employee.id}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/50 transition-colors"
                    >
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 flex items-center justify-center font-bold text-xs">
                            {employee.name.charAt(0)}
                          </div>
                          <div>
                            <p className="font-semibold text-slate-900 dark:text-slate-100">
                              {employee.name}
                            </p>
                            <p className="text-[11px] text-slate-400 font-mono">
                              {employee.employeeCode}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <p className="text-slate-700 dark:text-slate-300 font-medium">
                          {employee.department}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {shift.name} ({formatTime12h(shift.startTime)})
                        </p>
                      </td>

                      {/* P / A Status Column */}
                      <td className="py-3 px-3 text-center">
                        {record?.timeIn ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-black tracking-wide bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-400 dark:border-emerald-600 shadow-2xs">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                            <span className="text-xs font-black">P</span>
                            <span className="font-semibold text-[10px] uppercase tracking-wide">Present</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-black tracking-wide bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-300 dark:border-rose-800 shadow-2xs">
                            <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                            <span className="text-xs font-black">A</span>
                            <span className="font-semibold text-[10px] uppercase tracking-wide">Absent</span>
                          </span>
                        )}
                      </td>

                      {/* Time In Column */}
                      <td className="py-3 px-3">
                        {record?.timeIn ? (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 shadow-2xs font-mono font-bold text-xs">
                            <Sunrise className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                            <span>{formatTime12h(record.timeIn)}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400 font-sans font-normal">—</span>
                        )}
                      </td>

                      {/* Time Out Column (Strictly Punch Out Time Only) */}
                      <td className="py-3 px-3">
                        {record?.timeOut ? (
                          <div className="inline-flex flex-col">
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 shadow-2xs font-mono font-bold text-xs">
                              <Sunset className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                              <span>{formatTime12h(record.timeOut)}</span>
                            </div>
                            {record.isAutoPunchedOut && (
                              <span className="text-[9px] text-amber-600 dark:text-amber-400 font-sans font-semibold mt-0.5">
                                {record.autoPunchOutReason === 'shift_end_2h'
                                  ? `Auto (Shift End +${settings.autoPunchOutOnInactiveHours ?? 2}h)`
                                  : record.autoPunchOutReason === 'inactivity_2h'
                                  ? 'Auto Closed'
                                  : 'Auto 11:59 PM'}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 font-mono">—</span>
                        )}
                      </td>

                      <td className="py-3 px-3 text-right font-mono font-bold tabular-nums">
                        {record
                          ? formatMinutesToHoursMinutes(
                              getLiveWorkedStats({ record, shift, settings, liveState: derivedStatus })
                                .totalWorkedMinutes
                            )
                          : '0h 00m'}
                      </td>

                      <td className="py-3 px-3 text-center">
                        {derivedStatus === 'break' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                            <Coffee className="w-3 h-3" />
                            <span>On Break</span>
                          </span>
                        ) : derivedStatus === 'no_internet' ? (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200 border border-amber-300 dark:border-amber-700"
                            title={getOfflineBadgeMeta(record).tooltip}
                          >
                            <WifiOff className="w-3 h-3 text-amber-600 dark:text-amber-400 animate-pulse" />
                            <span>{getOfflineBadgeMeta(record).statusLabel}</span>
                          </span>
                        ) : derivedStatus === 'in' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Clocked In</span>
                          </span>
                        ) : derivedStatus === 'out' ? (
                          <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            Completed
                          </span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                            Not In
                          </span>
                        )}
                        {record?.status === 'late' && (
                          <span className="ml-1 inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300">
                            LATE
                          </span>
                        )}
                        {record?.isAutoPunchedOut && (
                          <span
                            className="ml-1 inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300"
                            title={
                              record.autoPunchOutReason === 'shift_end_2h'
                                ? `Automatically punched out ${settings.autoPunchOutOnInactiveHours ?? 2}h after shift ended (not live online)`
                                : 'Automatically closed at 11:59 PM'
                            }
                          >
                            {record.autoPunchOutReason === 'shift_end_2h' ? 'Auto Shift+2h' : 'Auto Closed'}
                          </span>
                        )}
                      </td>

                      {/* Admin Verification Column */}
                      <td className="py-3 px-3 text-center">
                        {record?.timeIn ? (
                          record.adminVerification?.verified ? (
                            <div className="inline-flex flex-col items-center">
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300"
                                title={`Verified by ${record.adminVerification.verifiedByName || 'Admin'} on ${
                                  record.adminVerification.verifiedAt
                                    ? new Date(record.adminVerification.verifiedAt).toLocaleTimeString()
                                    : ''
                                }`}
                              >
                                <ShieldCheck className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                                <span>Verified</span>
                              </span>
                              <span className="text-[9px] text-slate-400 truncate max-w-[85px] mt-0.5">
                                {record.adminVerification.verifiedByName || 'Admin'}
                              </span>
                            </div>
                          ) : (
                            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                              Pending
                            </span>
                          )
                        ) : (
                          <span className="text-slate-400 font-sans">—</span>
                        )}
                      </td>

                      {/* Accounts Verification Column */}
                      <td className="py-3 px-3 text-center">
                        {record?.timeIn ? (
                          record.accountsVerification?.verified ? (
                            <div className="inline-flex flex-col items-center">
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                                title={`Verified by ${record.accountsVerification.verifiedByName || 'Accounts'} on ${
                                  record.accountsVerification.verifiedAt
                                    ? new Date(record.accountsVerification.verifiedAt).toLocaleTimeString()
                                    : ''
                                }`}
                              >
                                <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                <span>Verified</span>
                              </span>
                              <span className="text-[9px] text-slate-400 truncate max-w-[85px] mt-0.5">
                                {record.accountsVerification.verifiedByName || 'Accounts'}
                              </span>
                            </div>
                          ) : (
                            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                              Pending
                            </span>
                          )
                        ) : (
                          <span className="text-slate-400 font-sans">—</span>
                        )}
                      </td>

                      {/* Actions Column (Admin, Accounts Officer & CEO) */}
                      {(isAdmin || isAccountsOfficer || isCeo) && (
                        <td className="py-3 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            <button
                              type="button"
                              onClick={() => handleOpenEmployeeTimesheet(employee)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 transition-colors cursor-pointer"
                              title={`Preview & download official PDF timesheet for ${employee.name}`}
                            >
                              <FileText className="w-3 h-3" />
                              <span>PDF</span>
                            </button>

                            {/* CEO / Management Mention Directive */}
                            {(isCeo || isAdmin) && onAddCeoComment && (
                              <button
                                onClick={() => handleOpenMentionModal(employee)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-amber-500 hover:bg-amber-600 text-white shadow-2xs transition-colors cursor-pointer"
                                title={`Send executive directive or mention comment to ${employee.name}`}
                              >
                                <MessageSquare className="w-3 h-3" />
                                <span>Mention</span>
                              </button>
                            )}

                            {/* Admin Verification Action */}
                            {isAdmin && record?.timeIn && (
                              <button
                                onClick={() => handleToggleAdminVerify(record)}
                                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                                  record.adminVerification?.verified
                                    ? 'bg-purple-50 text-purple-700 hover:bg-purple-100 dark:bg-purple-950/40 dark:text-purple-300'
                                    : 'bg-purple-600 text-white hover:bg-purple-700'
                                }`}
                                title="Toggle Admin Attendance Verification"
                              >
                                <ShieldCheck className="w-3 h-3" />
                                <span>{record.adminVerification?.verified ? 'Admin ✓' : 'Verify (Admin)'}</span>
                              </button>
                            )}

                            {/* Accounts Verification Action */}
                            {isAccountsOfficer && record?.timeIn && (
                              <button
                                onClick={() => handleToggleAccountsVerify(record)}
                                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                                  record.accountsVerification?.verified
                                    ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300'
                                    : 'bg-emerald-600 text-white hover:bg-emerald-700'
                                }`}
                                title="Toggle Accounts Officer Attendance Verification"
                              >
                                <CheckCircle2 className="w-3 h-3" />
                                <span>{record.accountsVerification?.verified ? 'Accounts ✓' : 'Verify (Accounts)'}</span>
                              </button>
                            )}

                            {/* Quick 1-Click Clock In / Clock Out by Admin */}
                            {isAdmin && (
                              !record?.timeIn ? (
                                <button
                                  onClick={() => handleQuickAdminPunch(employee, 'in')}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs transition-colors cursor-pointer"
                                  title={`Immediately punch clock-in for ${employee.name} right now`}
                                >
                                  <Sunrise className="w-3 h-3" />
                                  <span>Clock In</span>
                                </button>
                              ) : !record?.timeOut ? (
                                <button
                                  onClick={() => handleQuickAdminPunch(employee, 'out')}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-amber-600 hover:bg-amber-700 text-white shadow-2xs transition-colors cursor-pointer"
                                  title={`Immediately punch clock-out for ${employee.name} right now`}
                                >
                                  <Sunset className="w-3 h-3" />
                                  <span>Clock Out</span>
                                </button>
                              ) : null
                            )}

                            {/* Manual Edit Punch Logs & Working Status (Admin Only) */}
                            {isAdmin && (
                              <button
                                onClick={() => handleOpenAdjustment(employee, record)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-2xs transition-colors cursor-pointer"
                                title="Edit employee punch in, punch out, or working status"
                              >
                                <Edit3 className="w-3 h-3" />
                                <span>{record?.timeIn ? 'Edit Punch' : 'Add Punch'}</span>
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Comprehensive Manual Punch & Working Status Adjustment Modal */}
      {editingEmployee && (
        <Modal
          isOpen={!!editingEmployee}
          onClose={() => {
            setEditingEmployee(null);
            setEditingRecord(null);
          }}
          title={`Edit Attendance & Punch Log: ${editingEmployee.name}`}
          subtitle={`Employee Code: ${editingEmployee.employeeCode} · Shift: ${(shiftMap.get(editingEmployee.shiftId) || shifts[0]).name} · Date: ${selectedDate} (${getDayName(selectedDate)})`}
        >
          <form onSubmit={handleSaveAdjustment} className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
            {/* 1. Working Status Selector (4 Distinct Options) */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 space-y-2">
              <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                1. Select Employee Working Status
              </label>
              <div className="grid grid-cols-2 gap-2">
                {/* Option: Currently Working */}
                <button
                  type="button"
                  onClick={() => {
                    setEditWorkingStatus('working');
                    setHasPunchIn(true);
                    setHasPunchOut(false);
                    if (editStatus === 'absent') setEditStatus('present');
                    setEditPunchNote((prev) =>
                      prev
                        .replace(/\s*·?\s*(Clocked Out by Admin|Auto system Punched out|Auto Punched Out\s*\([^)]*\))/gi, '')
                        .trim()
                    );
                    setEditAuditReason((prev) =>
                      !prev.trim() || /Quick Clock Out|Auto system Punched out/i.test(prev)
                        ? 'Re-opened to Currently Working by Administrator'
                        : prev
                    );
                  }}
                  className={`p-2.5 rounded-lg border text-left flex items-start gap-2 transition-all cursor-pointer ${
                    editWorkingStatus === 'working'
                      ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-500 text-emerald-950 dark:text-emerald-200 shadow-2xs ring-1 ring-emerald-400'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-slate-300'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 mt-1 shrink-0 animate-pulse" />
                  <div>
                    <p className="text-xs font-bold">Currently Working</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">Clocked In · Shift In Progress</p>
                  </div>
                </button>

                {/* Option: Shift Ended / Punched Out */}
                <button
                  type="button"
                  onClick={() => {
                    setEditWorkingStatus('completed');
                    setHasPunchIn(true);
                    setHasPunchOut(true);
                    if (editStatus === 'absent') setEditStatus('present');
                  }}
                  className={`p-2.5 rounded-lg border text-left flex items-start gap-2 transition-all cursor-pointer ${
                    editWorkingStatus === 'completed'
                      ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-500 text-blue-950 dark:text-blue-200 shadow-2xs ring-1 ring-blue-400'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-slate-300'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500 mt-1 shrink-0" />
                  <div>
                    <p className="text-xs font-bold">Shift Completed</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">Punched Out · Shift Finished</p>
                  </div>
                </button>

                {/* Option: On Break */}
                <button
                  type="button"
                  onClick={() => {
                    setEditWorkingStatus('break');
                    setHasPunchIn(true);
                    setHasPunchOut(false);
                    if (editStatus === 'absent') setEditStatus('present');
                    setEditPunchNote((prev) =>
                      prev
                        .replace(/\s*·?\s*(Clocked Out by Admin|Auto system Punched out|Auto Punched Out\s*\([^)]*\))/gi, '')
                        .trim()
                    );
                  }}
                  className={`p-2.5 rounded-lg border text-left flex items-start gap-2 transition-all cursor-pointer ${
                    editWorkingStatus === 'break'
                      ? 'bg-amber-50 dark:bg-amber-950/60 border-amber-500 text-amber-950 dark:text-amber-200 shadow-2xs ring-1 ring-amber-400'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-slate-300'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500 mt-1 shrink-0" />
                  <div>
                    <p className="text-xs font-bold">On Lunch / Tea Break</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">Temporary Pause in Shift</p>
                  </div>
                </button>

                {/* Option: Absent / Not In */}
                <button
                  type="button"
                  onClick={() => {
                    setEditWorkingStatus('absent');
                    setHasPunchIn(false);
                    setHasPunchOut(false);
                    setEditStatus('absent');
                  }}
                  className={`p-2.5 rounded-lg border text-left flex items-start gap-2 transition-all cursor-pointer ${
                    editWorkingStatus === 'absent'
                      ? 'bg-rose-50 dark:bg-rose-950/60 border-rose-500 text-rose-950 dark:text-rose-200 shadow-2xs ring-1 ring-rose-400'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-slate-300'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 mt-1 shrink-0" />
                  <div>
                    <p className="text-xs font-bold">Absent / Not In</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">Clear punches & mark absent</p>
                  </div>
                </button>
              </div>
            </div>

            {/* 2. Separate Option to Edit Punch In */}
            <div className={`p-3.5 rounded-xl border transition-all ${
              hasPunchIn
                ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700'
                : 'bg-slate-100/70 dark:bg-slate-900/40 border-dashed border-slate-300 dark:border-slate-700 opacity-70'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasPunchIn}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setHasPunchIn(checked);
                      if (!checked) {
                        setEditWorkingStatus('absent');
                        setHasPunchOut(false);
                      } else if (editWorkingStatus === 'absent') {
                        setEditWorkingStatus('working');
                      }
                    }}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 cursor-pointer"
                  />
                  <span className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Sunrise className="w-3.5 h-3.5 text-emerald-600" />
                    <span>2. Separate Option: Edit Punch In Time</span>
                  </span>
                </label>
                {hasPunchIn ? (
                  <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded">
                    Punch In Active
                  </span>
                ) : (
                  <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/60 px-2 py-0.5 rounded">
                    Punch In Disabled (Absent)
                  </span>
                )}
              </div>

              {hasPunchIn && (
                <div className="space-y-2 mt-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={editTimeIn}
                      onChange={(e) => setEditTimeIn(e.target.value)}
                      placeholder="09:00:00"
                      pattern="^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$"
                      required={hasPunchIn}
                      className="flex-1 text-xs font-mono px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const shift = shiftMap.get(editingEmployee.shiftId) || shifts[0];
                        setEditTimeIn(shift.startTime);
                      }}
                      className="px-2.5 py-2 text-[11px] font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                      title="Set to scheduled shift start time"
                    >
                      Shift Start
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditTimeIn(new Date().toTimeString().slice(0, 8))}
                      className="px-2.5 py-2 text-[11px] font-medium bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/60 rounded-lg text-emerald-800 dark:text-emerald-300 transition-colors cursor-pointer"
                      title="Set to right now"
                    >
                      Current Time
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 3. Separate Option to Edit Punch Out */}
            <div className={`p-3.5 rounded-xl border transition-all ${
              hasPunchOut
                ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700'
                : 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasPunchOut}
                    disabled={!hasPunchIn}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setHasPunchOut(checked);
                      if (checked) {
                        setEditWorkingStatus('completed');
                        if (!editTimeOut) {
                          const shift = shiftMap.get(editingEmployee.shiftId) || shifts[0];
                          setEditTimeOut(shift.endTime);
                        }
                      } else {
                        setEditWorkingStatus('working');
                        setEditPunchNote((prev) =>
                          prev
                            .replace(/\s*·?\s*(Clocked Out by Admin|Auto system Punched out|Auto Punched Out\s*\([^)]*\))/gi, '')
                            .trim()
                        );
                        setEditAuditReason((prev) =>
                          !prev.trim() || /Quick Clock Out|Auto system Punched out/i.test(prev)
                            ? 'Re-opened to Currently Working by Administrator'
                            : prev
                        );
                      }
                    }}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 cursor-pointer disabled:opacity-50"
                  />
                  <span className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Sunset className="w-3.5 h-3.5 text-amber-600" />
                    <span>3. Separate Option: Edit Punch Out Time</span>
                  </span>
                </label>
                {hasPunchOut ? (
                  <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 px-2 py-0.5 rounded">
                    Punch Out Recorded (Shift Finished)
                  </span>
                ) : (
                  <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/80 px-2 py-0.5 rounded flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Currently Working (No Punch Out)
                  </span>
                )}
              </div>

              {hasPunchOut ? (
                <div className="space-y-2 mt-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={editTimeOut}
                      onChange={(e) => setEditTimeOut(e.target.value)}
                      placeholder="17:00:00"
                      pattern="^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$"
                      required={hasPunchOut}
                      className="flex-1 text-xs font-mono px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const shift = shiftMap.get(editingEmployee.shiftId) || shifts[0];
                        setEditTimeOut(shift.endTime);
                      }}
                      className="px-2.5 py-2 text-[11px] font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                      title="Set to scheduled shift end time"
                    >
                      Shift End
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditTimeOut(new Date().toTimeString().slice(0, 8))}
                      className="px-2.5 py-2 text-[11px] font-medium bg-amber-100 hover:bg-amber-200 dark:bg-amber-950/60 dark:hover:bg-amber-900/60 rounded-lg text-amber-800 dark:text-amber-300 transition-colors cursor-pointer"
                      title="Set to right now"
                    >
                      Current Time
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-emerald-700 dark:text-emerald-300 font-medium">
                  ✓ The punch-out time is intentionally left blank so this employee continues working their shift.
                </p>
              )}
            </div>

            {/* 4. Attendance Classification & Notes */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Attendance Classification
                </label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as AttendanceRecord['status'])}
                  className="w-full text-xs px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                >
                  <option value="present">Present (On-Time)</option>
                  <option value="late">Late Arrival</option>
                  <option value="half_day">Half Day</option>
                  <option value="on_leave">On Approved Leave</option>
                  <option value="absent">Absent</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Punch Note / Remark (Optional)
                </label>
                <input
                  type="text"
                  value={editPunchNote}
                  onChange={(e) => setEditPunchNote(e.target.value)}
                  placeholder="e.g. Worked from branch office"
                  className="w-full text-xs px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            {/* 5. Mandatory Audit Note */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Audit Reason for Manual Adjustment / Override
              </label>
              <textarea
                value={editAuditReason}
                onChange={(e) => setEditAuditReason(e.target.value)}
                placeholder="e.g. Employee punch was corrected by administrator due to forgotten badge or network issue."
                rows={2}
                className="w-full text-xs px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Security signature: Logged under administrator {effectiveUser.name} ({effectiveUser.role.toUpperCase()}).
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setEditingEmployee(null);
                  setEditingRecord(null);
                }}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-xs cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Save Attendance & Status Adjustment</span>
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* CEO / Management Mention Modal */}
      {mentioningEmployee && (
        <Modal
          isOpen={!!mentioningEmployee}
          onClose={() => {
            setMentioningEmployee(null);
            setMentionMessage('');
          }}
          title={`Executive Mention / Directive: ${mentioningEmployee.name}`}
          subtitle={`Department: ${mentioningEmployee.department} · Code: ${mentioningEmployee.employeeCode}`}
        >
          <form onSubmit={handleSendCeoMention} className="space-y-4">
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex items-start gap-2.5">
              <Crown className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-900 dark:text-amber-200">
                <p className="font-bold">
                  Sending as {effectiveUser.role.toUpperCase()}: {effectiveUser.name}
                </p>
                <p className="mt-0.5 text-amber-700 dark:text-amber-300">
                  This directive will be delivered immediately to{' '}
                  <strong>{mentioningEmployee.name}</strong> as a high-priority notification.
                </p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Directive / Comment Message
              </label>
              <textarea
                value={mentionMessage}
                onChange={(e) => setMentionMessage(e.target.value)}
                placeholder="e.g. Great punctuality this week! Please make sure to review client reports before 4 PM."
                rows={4}
                required
                className="w-full text-xs px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setMentioningEmployee(null);
                  setMentionMessage('');
                }}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-lg shadow-xs cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send Mention Notification</span>
              </button>
            </div>
          </form>
        </Modal>
      )}
      {/* Category Drill-Down Employee List Modal (Triggered on clicking Present / Absent / Clocked In / Offline / Break / Shift End cards) */}
      {categoryModalKey && (
        <Modal
          isOpen={!!categoryModalKey}
          onClose={() => setCategoryModalKey(null)}
          title={`${ROSTER_CATEGORY_META[categoryModalKey].title} (${categoryListItems.length})`}
          subtitle={`${ROSTER_CATEGORY_META[categoryModalKey].subtitle} · Date: ${selectedDate}`}
          maxWidth="xl"
        >
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <input
                  type="text"
                  value={categorySearch}
                  onChange={(e) => setCategorySearch(e.target.value)}
                  placeholder="Filter list by name, ID, or department..."
                  className="w-full pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-slate-100 focus:outline-none"
                />
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
              </div>

              <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${ROSTER_CATEGORY_META[categoryModalKey].badgeClass}`}>
                {categoryListItems.length} Employee{categoryListItems.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden max-h-[55vh] overflow-y-auto">
              {categoryListItems.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-400">
                  No employees currently fall under this category for {selectedDate}.
                </div>
              ) : (
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="py-2 px-3">#</th>
                      <th className="py-2 px-3">Employee</th>
                      <th className="py-2 px-3">Department & Shift</th>
                      <th className="py-2 px-3">Time In</th>
                      <th className="py-2 px-3">Time Out</th>
                      <th className="py-2 px-3 text-right">Worked</th>
                      <th className="py-2 px-3">Status Detail</th>
                      {canManage && <th className="py-2 px-3 text-right">Timesheet</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {categoryListItems.map(({ employee, record, shift, derivedStatus }, idx) => {
                      const workedMins = record
                        ? getLiveWorkedStats({ record, shift, settings, liveState: derivedStatus }).totalWorkedMinutes
                        : 0;
                      const detailLabel =
                        derivedStatus === 'in'
                          ? 'Clocked In (Online)'
                          : derivedStatus === 'no_internet'
                          ? getOfflineBadgeMeta(record).statusLabel
                          : derivedStatus === 'break'
                          ? 'On Break'
                          : derivedStatus === 'out'
                          ? record?.isAutoPunchedOut
                            ? 'Shift Ended (Auto Out)'
                            : 'Shift Ended'
                          : 'Absent / Not Punched In';

                      return (
                        <tr key={employee.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="py-2.5 px-3 font-mono text-slate-400">{idx + 1}</td>
                          <td className="py-2.5 px-3">
                            <p className="font-semibold text-slate-900 dark:text-slate-100">{employee.name}</p>
                            <p className="text-[10px] font-mono text-slate-400">{employee.employeeCode}</p>
                          </td>
                          <td className="py-2.5 px-3">
                            <p className="text-slate-700 dark:text-slate-300">{employee.department}</p>
                            <p className="text-[10px] text-slate-400">{shift?.name || 'Standard'}</p>
                          </td>
                          <td className="py-2.5 px-3 font-mono font-semibold text-emerald-700 dark:text-emerald-300">
                            {record?.timeIn ? formatTime12h(record.timeIn) : '—'}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-700 dark:text-slate-300">
                            {record?.timeOut ? formatTime12h(record.timeOut) : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold">
                            {record?.timeIn ? formatMinutesToHoursMinutes(workedMins) : '0h 00m'}
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${
                                derivedStatus === 'in'
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                  : derivedStatus === 'no_internet' || derivedStatus === 'break'
                                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                  : derivedStatus === 'out'
                                  ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                  : 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                              }`}
                            >
                              {detailLabel}
                            </span>
                          </td>
                          {canManage && (
                            <td className="py-2.5 px-3 text-right">
                              <button
                                type="button"
                                onClick={() => {
                                  setCategoryModalKey(null);
                                  handleOpenEmployeeTimesheet(employee);
                                }}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold cursor-pointer"
                              >
                                <Download className="w-3 h-3" />
                                <span>PDF</span>
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setStatusFilter('all');
                  setCategoryModalKey(null);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Reset Table Filter (Show All)
              </button>

              <button
                type="button"
                onClick={() => setCategoryModalKey(null)}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white dark:bg-blue-600 dark:hover:bg-blue-700 cursor-pointer"
              >
                Done / View Filtered Roster
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
