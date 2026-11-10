import React, { useState, useEffect } from 'react';
import {
  ActiveDesktopTab,
  AppMode,
  AttendanceRecord,
  CeoComment,
  DeviceChangeRequest,
  DeviceHistoryEntry,
  Employee,
  LeaveRequest,
  OfficeSettings,
  ShiftSchedule,
} from './types';
import {
  clearSession,
  hasPendingCloudWrites,
  loadAttendanceRecords,
  loadCeoComments,
  loadEmployees,
  loadLeaves,
  loadSavedMode,
  loadSession,
  loadSettings,
  loadShifts,
  registerCloudSyncListener,
  saveAttendanceRecords,
  saveCeoComments,
  saveEmployeeDelete,
  saveEmployeeUpsert,
  saveLeaves,
  saveMode,
  saveSession,
  saveSettings,
  saveShifts,
  syncDatabaseFromServer,
} from './lib/storage';
import {
  autoCloseForgottenPunches,
  calculateWorkedMinutes,
  getCurrentTimeString,
  getDayName,
  getTodayDateString,
  isLateArrival,
} from './lib/attendanceCalculations';
import { detectClientNetwork } from './lib/ipSecurity';
import { getDeviceDetails } from './lib/deviceSecurity';
import { WindowsTitleBar } from './components/common/WindowsTitleBar';
import { LoginView } from './components/desktop/LoginView';
import { DesktopHeader } from './components/desktop/DesktopHeader';
import { DesktopSidebar } from './components/desktop/DesktopSidebar';
import { PunchClockTab } from './components/desktop/PunchClockTab';
import { MyAttendanceTab } from './components/desktop/MyAttendanceTab';
import { TeamAttendanceTab } from './components/desktop/TeamAttendanceTab';
import { EmployeesDirectoryTab } from './components/desktop/EmployeesDirectoryTab';
import { ShiftManagementTab } from './components/desktop/ShiftManagementTab';
import { LeaveManagementTab } from './components/desktop/LeaveManagementTab';
import { ReportsTab } from './components/desktop/ReportsTab';
import { OfficeSettingsTab } from './components/desktop/OfficeSettingsTab';
import { PrintableTimesheetModal } from './components/desktop/PrintableTimesheetModal';
import { ChangePasswordModal } from './components/common/ChangePasswordModal';
import { RequestDeviceChangeModal } from './components/common/RequestDeviceChangeModal';
import { KioskMode } from './components/kiosk/KioskMode';

export default function App() {
  const [appMode, setAppMode] = useState<AppMode>(loadSavedMode());
  const [isDark, setIsDark] = useState<boolean>(() => {
    return localStorage.getItem('office_theme') === 'dark';
  });

  // Database State
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<ShiftSchedule[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [ceoComments, setCeoComments] = useState<CeoComment[]>([]);
  const [settings, setSettings] = useState<OfficeSettings>(loadSettings());
  const [currentClientIp, setCurrentClientIp] = useState<string>('Detecting...');
  const [currentClientIsp, setCurrentClientIsp] = useState<string>('Detecting...');
  const [isInitialCloudSyncing, setIsInitialCloudSyncing] = useState<boolean>(true);

  // Current Session & Workspace Navigation
  const [currentUser, setCurrentUser] = useState<Employee | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveDesktopTab>('clock');

  // Password & Device Modals
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState<boolean>(false);
  const [isRequestDeviceOpen, setIsRequestDeviceOpen] = useState<boolean>(false);

  // Printable Timesheet Modal State
  const [printModalState, setPrintModalState] = useState<{
    isOpen: boolean;
    employee: Employee | null;
    filteredRecords: AttendanceRecord[];
  }>({
    isOpen: false,
    employee: null,
    filteredRecords: [],
  });

  // Initial Data Load & Server Sync
  useEffect(() => {
    const refreshFromLocal = (verifySession = false) => {
      const loadedEmps = loadEmployees();
      const loadedShifts = loadShifts();
      const loadedRecords = loadAttendanceRecords();
      const loadedLeaves = loadLeaves();
      const loadedComments = loadCeoComments();
      const loadedSettings = loadSettings();

      setEmployees(loadedEmps);
      setShifts(loadedShifts);
      setRecords(loadedRecords);
      setLeaves(loadedLeaves);
      setCeoComments(loadedComments);
      setSettings(loadedSettings);

      const session = loadSession();
      if (session) {
        const matched = loadedEmps.find((e) => e.id === session.userId && e.isActive !== false);
        if (matched) {
          setCurrentUser(matched);
        } else if (verifySession) {
          clearSession();
          setCurrentUser(null);
        }
      }
    };

    // Load cached data immediately for instant UI, WITHOUT pushing stale records back to server!
    refreshFromLocal(false);

    // Subscribe to post-write server merges so state reflects authoritative cloud DB
    registerCloudSyncListener(() => {
      refreshFromLocal(true);
    });

    void detectClientNetwork().then((net) => {
      setCurrentClientIp(net.ip);
      setCurrentClientIsp(net.isp);
    });

    let bootFinished = false;
    // Sync authoritative database from Cloud /api/db FIRST before any client auto-close writes
    void syncDatabaseFromServer(true)
      .then((updated) => {
        if (updated) {
          refreshFromLocal(true);
        }
      })
      .finally(() => {
        bootFinished = true;
        setIsInitialCloudSyncing(false);

        // Now check if any past open punch missed 11:59 PM
        const currentRecs = loadAttendanceRecords();
        const currentShifts = loadShifts();
        const { updatedRecords, hasChanges } = autoCloseForgottenPunches(currentRecs, currentShifts);
        if (hasChanges) {
          setRecords(updatedRecords);
          const changedOne = updatedRecords.find(
            (u, idx) => currentRecs[idx] && u.isAutoPunchedOut !== currentRecs[idx].isAutoPunchedOut
          );
          if (changedOne) {
            saveAttendanceRecords(updatedRecords, changedOne);
          } else {
            saveAttendanceRecords(updatedRecords);
          }
        }
      });

    const syncInterval = setInterval(() => {
      if (!bootFinished) return;
      void syncDatabaseFromServer(false).then((updated) => {
        if (updated) refreshFromLocal(true);
      });
    }, 4000);

    // Periodic check to auto punch out at 11:59 PM without requiring manual reload
    const autoPunchInterval = setInterval(() => {
      if (!bootFinished) return;
      setRecords((prev) => {
        const currentShifts = loadShifts();
        const { updatedRecords, hasChanges } = autoCloseForgottenPunches(prev, currentShifts);
        if (hasChanges) {
          const changedOne = updatedRecords.find(
            (u, idx) => prev[idx] && u.isAutoPunchedOut !== prev[idx].isAutoPunchedOut
          );
          saveAttendanceRecords(updatedRecords, changedOne);
          return updatedRecords;
        }
        return prev;
      });
    }, 15000);

    const ipInterval = setInterval(() => {
      void detectClientNetwork().then((net) => {
        setCurrentClientIp(net.ip);
        setCurrentClientIsp(net.isp);
      });
    }, 30000);

    // Prevent accidental tab reload/close while a cloud DB save is still in flight
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasPendingCloudWrites()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(syncInterval);
      clearInterval(autoPunchInterval);
      clearInterval(ipInterval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      registerCloudSyncListener(null);
    };
  }, []);

  // Theme synchronization
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('office_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('office_theme', 'light');
    }
  }, [isDark]);

  const handleToggleTheme = () => {
    setIsDark(!isDark);
  };

  const handleToggleMode = (mode: AppMode) => {
    // Switching INTO Lobby Kiosk Mode from desktop/login requires Admin role or Admin PIN
    // so colleagues on mobile phones cannot enter Kiosk Mode to punch each other's PINs!
    if (mode === 'kiosk' && appMode !== 'kiosk') {
      const isSignedInAdmin = currentUser?.role === 'admin';
      if (!isSignedInAdmin) {
        const enteredPin = prompt(
          'Administrator Verification Required:\n\nEnter Administrator PIN to launch Lobby Kiosk Terminal mode:'
        );
        if (enteredPin === null) return;
        const matchedAdmin = employees.find(
          (e) => e.role === 'admin' && e.isActive !== false && e.pin === enteredPin.trim()
        );
        if (!matchedAdmin) {
          alert('Invalid Administrator PIN. Only an Administrator can activate Lobby Kiosk Mode.');
          return;
        }
      }
    }
    setAppMode(mode);
    saveMode(mode);
  };

  const handleLogin = (employee: Employee, keepLoggedIn: boolean) => {
    setCurrentUser(employee);
    saveSession(employee.id, keepLoggedIn);
  };

  const handleLogout = () => {
    clearSession();
    setCurrentUser(null);
  };

  // -------------------------------------------------------------
  // Attendance Clock In / Out / Break Engine
  // -------------------------------------------------------------
  const handleTimeIn = (employeeId: string, notes?: string) => {
    const todayStr = getTodayDateString();
    const dayName = getDayName(todayStr);
    const nowTime = getCurrentTimeString();
    const emp = employees.find((e) => e.id === employeeId);
    if (!emp) return;
    const shift = shifts.find((s) => s.id === emp?.shiftId) || shifts[0];
    const late = isLateArrival(nowTime, shift);

    const existingIdx = records.findIndex(
      (r) => r.employeeId === employeeId && r.date === todayStr
    );

    // DAILY LIMIT ENFORCEMENT: Each employee is restricted to 1 attendance punch daily
    if (existingIdx >= 0 && records[existingIdx].timeIn) {
      alert(
        `Daily Punch Limit: ${emp.name} already clocked in today at ${records[existingIdx].timeIn}. Only ONE clock-in is permitted per day. If a modification is required, contact the Administrator.`
      );
      return;
    }

    // Capture device details & detect mismatch
    const { deviceId, deviceLabel } = getDeviceDetails();
    const isMismatch = !!(emp.registeredDeviceId && emp.registeredDeviceId !== deviceId);

    let nextRecords = [...records];
    let changedRecord: AttendanceRecord;

    if (existingIdx >= 0) {
      changedRecord = {
        ...nextRecords[existingIdx],
        timeIn: nowTime,
        status: late ? 'late' : 'present',
        notes: notes || nextRecords[existingIdx].notes,
        clientIp: currentClientIp,
        deviceId,
        deviceName: deviceLabel,
        isDeviceMismatch: isMismatch,
        deviceMismatchReason: isMismatch
          ? `Punched from device "${deviceLabel}" instead of approved phone "${emp.registeredDeviceName || 'Registered Phone'}"`
          : undefined,
      };
      nextRecords[existingIdx] = changedRecord;
    } else {
      changedRecord = {
        id: `att-${todayStr}-${employeeId}`,
        employeeId,
        date: todayStr,
        day: dayName,
        timeIn: nowTime,
        breaks: [],
        totalWorkedMinutes: 0,
        regularMinutes: 0,
        overtimeMinutes: 0,
        status: late ? 'late' : 'present',
        notes,
        clientIp: currentClientIp,
        deviceId,
        deviceName: deviceLabel,
        isDeviceMismatch: isMismatch,
        deviceMismatchReason: isMismatch
          ? `Punched from device "${deviceLabel}" instead of approved phone "${emp.registeredDeviceName || 'Registered Phone'}"`
          : undefined,
      };
      nextRecords = [changedRecord, ...nextRecords];
    }

    setRecords(nextRecords);
    saveAttendanceRecords(nextRecords, changedRecord);
  };

  const handleUpdatePunchNote = (employeeId: string, notes: string) => {
    const todayStr = getTodayDateString();
    const existingIdx = records.findIndex(
      (r) => r.employeeId === employeeId && r.date === todayStr
    );

    if (existingIdx >= 0) {
      const updatedRecords = [...records];
      const changedRecord = {
        ...updatedRecords[existingIdx],
        notes,
      };
      updatedRecords[existingIdx] = changedRecord;
      setRecords(updatedRecords);
      saveAttendanceRecords(updatedRecords, changedRecord);
    }
  };

  const handleTimeOut = (employeeId: string, notes?: string) => {
    const todayStr = getTodayDateString();
    const nowTime = getCurrentTimeString();
    const emp = employees.find((e) => e.id === employeeId);
    const shift = shifts.find((s) => s.id === emp?.shiftId) || shifts[0];

    const existingIdx = records.findIndex(
      (r) => r.employeeId === employeeId && r.date === todayStr
    );

    if (existingIdx === -1) return;

    const currentRec = records[existingIdx];

    // Close any active open break
    const updatedBreaks = currentRec.breaks.map((b) => {
      if (!b.end) {
        return { ...b, end: nowTime };
      }
      return b;
    });

    const worked = calculateWorkedMinutes(
      currentRec.timeIn,
      nowTime,
      updatedBreaks,
      shift.expectedHours
    );

    const { deviceId, deviceLabel } = getDeviceDetails();
    const isMismatch = !!(emp?.registeredDeviceId && emp.registeredDeviceId !== deviceId);

    const updated: AttendanceRecord = {
      ...currentRec,
      timeOut: nowTime,
      breaks: updatedBreaks,
      totalWorkedMinutes: worked.totalWorkedMinutes,
      regularMinutes: worked.regularMinutes,
      overtimeMinutes: worked.overtimeMinutes,
      notes: notes || currentRec.notes,
      deviceId: currentRec.deviceId || deviceId,
      deviceName: currentRec.deviceName || deviceLabel,
      isDeviceMismatch: currentRec.isDeviceMismatch || isMismatch,
      deviceMismatchReason:
        currentRec.deviceMismatchReason ||
        (isMismatch ? `Punched out from unapproved device "${deviceLabel}"` : undefined),
    };

    const nextRecords = [...records];
    nextRecords[existingIdx] = updated;
    setRecords(nextRecords);
    saveAttendanceRecords(nextRecords, updated);
  };

  const handleStartBreak = (
    employeeId: string,
    type: 'lunch' | 'coffee' | 'short_break'
  ) => {
    const todayStr = getTodayDateString();
    const nowTime = getCurrentTimeString();
    const existingIdx = records.findIndex(
      (r) => r.employeeId === employeeId && r.date === todayStr
    );

    if (existingIdx === -1) return;

    const currentRec = records[existingIdx];
    const newBreak = {
      id: `brk-${Date.now()}`,
      start: nowTime,
      type,
    };

    const updated: AttendanceRecord = {
      ...currentRec,
      breaks: [...currentRec.breaks, newBreak],
    };

    const nextRecords = [...records];
    nextRecords[existingIdx] = updated;
    setRecords(nextRecords);
    saveAttendanceRecords(nextRecords, updated);
  };

  const handleEndBreak = (employeeId: string) => {
    const todayStr = getTodayDateString();
    const nowTime = getCurrentTimeString();
    const existingIdx = records.findIndex(
      (r) => r.employeeId === employeeId && r.date === todayStr
    );

    if (existingIdx === -1) return;

    const currentRec = records[existingIdx];
    const updatedBreaks = currentRec.breaks.map((b) => {
      if (!b.end) {
        return { ...b, end: nowTime };
      }
      return b;
    });

    const updated: AttendanceRecord = {
      ...currentRec,
      breaks: updatedBreaks,
    };

    const nextRecords = [...records];
    nextRecords[existingIdx] = updated;
    setRecords(nextRecords);
    saveAttendanceRecords(nextRecords, updated);
  };

  // -------------------------------------------------------------
  // Admin Data Modification Handlers
  // -------------------------------------------------------------
  const handleAddEmployee = (empData: Omit<Employee, 'id'>) => {
    const newEmp: Employee = {
      ...empData,
      id: `emp-${Date.now()}`,
    };
    const nextEmps = [...employees, newEmp];
    setEmployees(nextEmps);
    saveEmployeeUpsert(nextEmps, newEmp);
  };

  const handleUpdateEmployee = (updatedEmp: Employee) => {
    const nextEmps = employees.map((e) => (e.id === updatedEmp.id ? updatedEmp : e));
    setEmployees(nextEmps);
    saveEmployeeUpsert(nextEmps, updatedEmp);
    if (currentUser?.id === updatedEmp.id) {
      setCurrentUser(updatedEmp);
    }
  };

  const handleDeleteEmployee = (empId: string) => {
    const nextEmps = employees.filter((e) => e.id !== empId);
    setEmployees(nextEmps);
    saveEmployeeDelete(nextEmps, empId);
  };

  const handleUpdatePin = (employeeId: string, newPin: string) => {
    const target = employees.find((e) => e.id === employeeId);
    if (!target) return;
    const updatedEmp: Employee = { ...target, pin: newPin };
    const nextEmps = employees.map((e) => (e.id === employeeId ? updatedEmp : e));
    setEmployees(nextEmps);
    saveEmployeeUpsert(nextEmps, updatedEmp);
    if (currentUser?.id === employeeId) {
      setCurrentUser(updatedEmp);
    }
  };

  const handleRequestDeviceChange = (
    employeeId: string,
    requestedDeviceId: string,
    requestedDeviceName: string,
    reason?: string
  ) => {
    const emp = employees.find((e) => e.id === employeeId);
    if (!emp) return;

    const request: DeviceChangeRequest = {
      id: `devreq-${Date.now()}`,
      employeeId,
      employeeName: emp.name,
      requestedDeviceId,
      requestedDeviceName,
      previousDeviceId: emp.registeredDeviceId,
      previousDeviceName: emp.registeredDeviceName,
      requestedAt: new Date().toISOString(),
      reason,
      status: 'pending',
    };

    const updatedEmp: Employee = {
      ...emp,
      pendingDeviceRequest: request,
    };

    const nextEmps = employees.map((e) => (e.id === employeeId ? updatedEmp : e));
    setEmployees(nextEmps);
    saveEmployeeUpsert(nextEmps, updatedEmp);
    if (currentUser?.id === employeeId) {
      setCurrentUser(updatedEmp);
    }
  };

  const handleApproveDeviceChange = (employeeId: string) => {
    const emp = employees.find((e) => e.id === employeeId);
    if (!emp || !emp.pendingDeviceRequest) return;

    const req = emp.pendingDeviceRequest;
    const historyEntry: DeviceHistoryEntry = {
      id: `hist-${Date.now()}`,
      action: emp.registeredDeviceId ? 'changed' : 'bound',
      deviceId: req.requestedDeviceId,
      deviceName: req.requestedDeviceName,
      changedBy: currentUser?.name || 'Administrator',
      changedAt: new Date().toISOString(),
      reason: req.reason || 'Admin approval',
    };

    const updatedEmp: Employee = {
      ...emp,
      registeredDeviceId: req.requestedDeviceId,
      registeredDeviceName: req.requestedDeviceName,
      registeredAt: new Date().toISOString(),
      deviceBoundApprovedBy: currentUser?.name || 'Administrator',
      deviceBoundApprovedAt: new Date().toISOString(),
      pendingDeviceRequest: undefined,
      deviceChangeHistory: [historyEntry, ...(emp.deviceChangeHistory || [])],
    };

    const nextEmps = employees.map((e) => (e.id === employeeId ? updatedEmp : e));
    setEmployees(nextEmps);
    saveEmployeeUpsert(nextEmps, updatedEmp, { clearPendingRequest: true });
    if (currentUser?.id === employeeId) {
      setCurrentUser(updatedEmp);
    }
    alert(`Device binding approved for ${emp.name}! Their account is now permanently bound to "${req.requestedDeviceName}".`);
  };

  const handleDirectBindDevice = (employeeId: string, deviceId: string, deviceName: string) => {
    const emp = employees.find((e) => e.id === employeeId);
    if (!emp) return;

    const historyEntry: DeviceHistoryEntry = {
      id: `hist-${Date.now()}`,
      action: emp.registeredDeviceId ? 'changed' : 'bound',
      deviceId,
      deviceName,
      changedBy: currentUser?.name || 'Administrator',
      changedAt: new Date().toISOString(),
      reason: 'Admin direct binding from detected punch device',
    };

    const updatedEmp: Employee = {
      ...emp,
      registeredDeviceId: deviceId,
      registeredDeviceName: deviceName,
      registeredAt: new Date().toISOString(),
      deviceBoundApprovedBy: currentUser?.name || 'Administrator',
      deviceBoundApprovedAt: new Date().toISOString(),
      pendingDeviceRequest: undefined,
      deviceChangeHistory: [historyEntry, ...(emp.deviceChangeHistory || [])],
    };

    const nextEmps = employees.map((e) => (e.id === employeeId ? updatedEmp : e));
    setEmployees(nextEmps);
    saveEmployeeUpsert(nextEmps, updatedEmp, { clearPendingRequest: true });
    if (currentUser?.id === employeeId) {
      setCurrentUser(updatedEmp);
    }
  };

  const handleRejectDeviceChange = (employeeId: string) => {
    const emp = employees.find((e) => e.id === employeeId);
    if (!emp || !emp.pendingDeviceRequest) return;

    const updatedEmp: Employee = {
      ...emp,
      pendingDeviceRequest: undefined,
    };

    const nextEmps = employees.map((e) => (e.id === employeeId ? updatedEmp : e));
    setEmployees(nextEmps);
    saveEmployeeUpsert(nextEmps, updatedEmp, { clearPendingRequest: true });
    if (currentUser?.id === employeeId) {
      setCurrentUser(updatedEmp);
    }
    alert(`Device binding request for ${emp.name} has been rejected.`);
  };

  const handleResetDeviceBound = (employeeId: string) => {
    const emp = employees.find((e) => e.id === employeeId);
    if (!emp) return;

    if (
      !confirm(
        `Reset personal device bound for "${emp.name}"?\n\nTheir current phone pairing ("${emp.registeredDeviceName || 'Registered Device'}") will be unlinked. The employee will need to submit a new phone binding request for Administrator approval.`
      )
    ) {
      return;
    }

    const historyEntry: DeviceHistoryEntry = {
      id: `hist-${Date.now()}`,
      action: 'reset',
      deviceId: emp.registeredDeviceId,
      deviceName: emp.registeredDeviceName,
      changedBy: currentUser?.name || 'Administrator',
      changedAt: new Date().toISOString(),
      reason: 'Admin reset device bound',
    };

    const updatedEmp: Employee = {
      ...emp,
      registeredDeviceId: undefined,
      registeredDeviceName: undefined,
      registeredAt: undefined,
      deviceBoundApprovedBy: undefined,
      deviceBoundApprovedAt: undefined,
      pendingDeviceRequest: undefined,
      deviceChangeHistory: [historyEntry, ...(emp.deviceChangeHistory || [])],
    };

    const nextEmps = employees.map((e) => (e.id === employeeId ? updatedEmp : e));
    setEmployees(nextEmps);
    saveEmployeeUpsert(nextEmps, updatedEmp, {
      allowClearDevice: true,
      clearPendingRequest: true,
    });
    if (currentUser?.id === employeeId) {
      setCurrentUser(updatedEmp);
    }
  };

  const handleAddShift = (shiftData: Omit<ShiftSchedule, 'id'>) => {
    const newShift: ShiftSchedule = {
      ...shiftData,
      id: `shift-${Date.now()}`,
    };
    const nextShifts = [...shifts, newShift];
    setShifts(nextShifts);
    saveShifts(nextShifts);
  };

  const handleUpdateShift = (updatedShift: ShiftSchedule) => {
    const nextShifts = shifts.map((s) => (s.id === updatedShift.id ? updatedShift : s));
    setShifts(nextShifts);
    saveShifts(nextShifts);
  };

  const handleApplyLeave = (
    leaveData: Omit<LeaveRequest, 'id' | 'appliedAt' | 'status'>
  ) => {
    const newLeave: LeaveRequest = {
      ...leaveData,
      id: `leave-${Date.now()}`,
      status: 'pending',
      appliedAt: new Date().toISOString(),
    };
    const nextLeaves = [newLeave, ...leaves];
    setLeaves(nextLeaves);
    saveLeaves(nextLeaves, newLeave);
  };

  const handleReviewLeave = (
    leaveId: string,
    status: 'approved' | 'rejected',
    reviewNote?: string
  ) => {
    let changedLeave: LeaveRequest | undefined;
    const nextLeaves = leaves.map((l) => {
      if (l.id === leaveId) {
        changedLeave = {
          ...l,
          status,
          reviewNote,
          reviewedBy: currentUser?.id,
        };
        return changedLeave;
      }
      return l;
    });
    setLeaves(nextLeaves);
    saveLeaves(nextLeaves, changedLeave);
  };

  const handleUpdateRecord = (updatedRecord: AttendanceRecord) => {
    const existingIdx = records.findIndex((r) => r.id === updatedRecord.id);
    // Clean local state copy without transient clearTimeOut flag
    const localRec = { ...updatedRecord };
    delete localRec.clearTimeOut;

    let nextRecords = [...records];
    if (existingIdx >= 0) {
      nextRecords[existingIdx] = localRec;
    } else {
      nextRecords = [localRec, ...nextRecords];
    }
    setRecords(nextRecords);
    saveAttendanceRecords(nextRecords, updatedRecord);
  };

  const handleAddCeoComment = (commentData: Omit<CeoComment, 'id' | 'createdAt'>) => {
    const newComment: CeoComment = {
      ...commentData,
      id: `ceo-note-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      createdAt: new Date().toISOString(),
      isRead: false,
    };
    const nextComments = [newComment, ...ceoComments];
    setCeoComments(nextComments);
    saveCeoComments(nextComments, newComment);
  };

  const handleMarkCeoCommentRead = (commentId: string) => {
    let changedComment: CeoComment | undefined;
    const nextComments = ceoComments.map((c) => {
      if (c.id === commentId) {
        changedComment = { ...c, isRead: true };
        return changedComment;
      }
      return c;
    });
    setCeoComments(nextComments);
    saveCeoComments(nextComments, changedComment);
  };

  const handleUpdateSettings = (newSettings: OfficeSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
  };

  const handleReloadAllData = () => {
    setEmployees(loadEmployees());
    setShifts(loadShifts());
    setRecords(loadAttendanceRecords());
    setLeaves(loadLeaves());
    setCeoComments(loadCeoComments());
    setSettings(loadSettings());
  };

  const handleOpenPrintModal = (
    emp: Employee | null,
    filteredRecords: AttendanceRecord[]
  ) => {
    setPrintModalState({
      isOpen: true,
      employee: emp,
      filteredRecords,
    });
  };

  const pendingLeavesCount = leaves.filter((l) => l.status === 'pending').length;

  return (
    <div
      id="windows-window-frame"
      className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-all duration-200"
    >
      {/* Windows 11 Title Bar */}
      <WindowsTitleBar
        appMode={appMode}
        onToggleMode={handleToggleMode}
        isDark={isDark}
        onToggleTheme={handleToggleTheme}
        serverHost={settings.serverHostName}
        serverPort={settings.serverPort}
      />

      {/* Screen Mode Render */}
      {appMode === 'kiosk' ? (
        <KioskMode
          employees={employees}
          shifts={shifts}
          records={records}
          settings={settings}
          onTimeIn={handleTimeIn}
          onTimeOut={handleTimeOut}
          onStartBreak={handleStartBreak}
          onEndBreak={handleEndBreak}
          onExitKiosk={() => handleToggleMode('desktop')}
          currentClientIp={currentClientIp}
        />
      ) : !currentUser ? (
        <LoginView
          employees={employees}
          onLogin={handleLogin}
          companyName={settings.companyName}
          isSyncing={isInitialCloudSyncing}
        />
      ) : (
        <div className="flex-1 flex flex-col min-h-[calc(100vh-2.5rem)] overflow-hidden">
          {/* Header */}
          <DesktopHeader
            currentUser={currentUser}
            activeTab={activeTab}
            onLogout={handleLogout}
            onSwitchToKiosk={() => handleToggleMode('kiosk')}
            ceoComments={ceoComments}
            onMarkCeoCommentRead={handleMarkCeoCommentRead}
            onOpenChangePassword={() => setIsChangePasswordOpen(true)}
          />

          {/* Body Split: Sidebar + Active Viewport */}
          <div className="flex-1 flex overflow-hidden">
            <DesktopSidebar
              currentUser={currentUser}
              activeTab={activeTab}
              onSelectTab={setActiveTab}
              pendingLeavesCount={pendingLeavesCount}
              settings={settings}
            />

            <main className="flex-1 p-6 lg:p-8 overflow-y-auto bg-slate-50/50 dark:bg-slate-950/40">
              {activeTab === 'clock' && (
                <PunchClockTab
                  currentUser={currentUser}
                  allEmployees={employees}
                  shifts={shifts}
                  records={records}
                  onTimeIn={handleTimeIn}
                  onTimeOut={handleTimeOut}
                  onStartBreak={handleStartBreak}
                  onEndBreak={handleEndBreak}
                  onUpdatePunchNote={handleUpdatePunchNote}
                  settings={settings}
                  currentClientIp={currentClientIp}
                  ceoComments={ceoComments}
                  onMarkCeoCommentRead={handleMarkCeoCommentRead}
                  onOpenRequestDevice={() => setIsRequestDeviceOpen(true)}
                  onOpenChangePassword={() => setIsChangePasswordOpen(true)}
                />
              )}

              {activeTab === 'my-attendance' && (
                <MyAttendanceTab
                  currentUser={currentUser}
                  records={records}
                  shifts={shifts}
                  settings={settings}
                  onOpenPrintModal={handleOpenPrintModal}
                  ceoComments={ceoComments}
                  onMarkCeoCommentRead={handleMarkCeoCommentRead}
                  onOpenRequestDevice={() => setIsRequestDeviceOpen(true)}
                  onOpenChangePassword={() => setIsChangePasswordOpen(true)}
                />
              )}

              {activeTab === 'leaves' && (
                <LeaveManagementTab
                  currentUser={currentUser}
                  employees={employees}
                  leaves={leaves}
                  onApplyLeave={handleApplyLeave}
                  onReviewLeave={handleReviewLeave}
                />
              )}

              {/* Team Attendance & Office Presence (P/A) - Accessible by All Employees */}
              {activeTab === 'team-attendance' && (
                <TeamAttendanceTab
                  employees={employees}
                  records={records}
                  shifts={shifts}
                  settings={settings}
                  onUpdateRecord={handleUpdateRecord}
                  adminUser={currentUser}
                  currentUser={currentUser}
                  ceoComments={ceoComments}
                  onAddCeoComment={handleAddCeoComment}
                />
              )}

              {currentUser.role === 'admin' && activeTab === 'employees' && (
                <EmployeesDirectoryTab
                  employees={employees}
                  shifts={shifts}
                  records={records}
                  onAddEmployee={handleAddEmployee}
                  onUpdateEmployee={handleUpdateEmployee}
                  onDeleteEmployee={handleDeleteEmployee}
                  currentUserId={currentUser.id}
                  onApproveDeviceChange={handleApproveDeviceChange}
                  onRejectDeviceChange={handleRejectDeviceChange}
                  onResetDeviceBound={handleResetDeviceBound}
                  onDirectBindDevice={handleDirectBindDevice}
                />
              )}

              {currentUser.role === 'admin' && activeTab === 'shifts' && (
                <ShiftManagementTab
                  shifts={shifts}
                  onAddShift={handleAddShift}
                  onUpdateShift={handleUpdateShift}
                />
              )}

              {/* Reports & Payroll - Allowed for Admin, Accounts Officer, and CEO */}
              {(currentUser.role === 'admin' || currentUser.role === 'accounts' || currentUser.role === 'ceo') &&
                activeTab === 'reports' && (
                  <ReportsTab
                    employees={employees}
                    records={records}
                    shifts={shifts}
                    settings={settings}
                    onOpenPrintModal={handleOpenPrintModal}
                    currentUser={currentUser}
                    onAddCeoComment={handleAddCeoComment}
                    onUpdateRecord={handleUpdateRecord}
                  />
                )}

              {currentUser.role === 'admin' && activeTab === 'settings' && (
                <OfficeSettingsTab
                  settings={settings}
                  onUpdateSettings={handleUpdateSettings}
                  onReloadAllData={handleReloadAllData}
                  currentClientIp={currentClientIp}
                  currentClientIsp={currentClientIsp}
                />
              )}
            </main>
          </div>
        </div>
      )}

      {/* Printable Timesheet Document Preview Modal */}
      {printModalState.isOpen && (
        <PrintableTimesheetModal
          isOpen={printModalState.isOpen}
          onClose={() =>
            setPrintModalState({
              isOpen: false,
              employee: null,
              filteredRecords: [],
            })
          }
          employee={printModalState.employee}
          allEmployees={employees}
          records={printModalState.filteredRecords}
          settings={settings}
        />
      )}

      {/* Change Password / PIN Modal */}
      {currentUser && (
        <ChangePasswordModal
          isOpen={isChangePasswordOpen}
          onClose={() => setIsChangePasswordOpen(false)}
          currentUser={currentUser}
          onUpdatePin={handleUpdatePin}
        />
      )}

      {/* Request Phone / Device Change Modal */}
      {currentUser && (
        <RequestDeviceChangeModal
          isOpen={isRequestDeviceOpen}
          onClose={() => setIsRequestDeviceOpen(false)}
          currentUser={currentUser}
          onRequestDeviceChange={handleRequestDeviceChange}
        />
      )}
    </div>
  );
}
