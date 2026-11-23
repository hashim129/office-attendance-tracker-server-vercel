import React, { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import {
  ActiveDesktopTab,
  AppMode,
  AttendanceRecord,
  CeoComment,
  Employee,
  LeaveRequest,
  OfficeSettings,
  ShiftSchedule,
} from './types';
import {
  clearSession,
  CloudSyncState,
  flushPendingCloudWrites,
  getCloudSyncStatus,
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
  retryCloudOutboxNow,
  saveAttendanceRecords,
  fetchFaceEnrolledIds,
  getSessionToken,
  saveCeoComments,
  saveEmployeeDelete,
  saveEmployeeUpsert,
  saveLeaves,
  saveMode,
  saveSession,
  saveSettings,
  saveShifts,
  subscribeCloudSyncStatus,
  syncDatabaseFromServer,
  updateAttendanceRecordsLocalCacheOnly,
} from './lib/storage';
import {
  calculateWorkedMinutes,
  getCurrentTimeString,
  getDayName,
  getTodayDateString,
  isLateArrival,
} from './lib/attendanceCalculations';
import { detectClientNetwork } from './lib/ipSecurity';
import { getDeviceDetails } from './lib/deviceSecurity';
import { WindowsTitleBar } from './components/common/WindowsTitleBar';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { LoginView } from './components/desktop/LoginView';
import { DesktopHeader } from './components/desktop/DesktopHeader';
import { DesktopSidebar } from './components/desktop/DesktopSidebar';
import { PunchClockTab } from './components/desktop/PunchClockTab';
import { ChangePasswordModal } from './components/common/ChangePasswordModal';
import { verifyAdminPin, rememberSession, takePendingToken } from './lib/pinAuth';
import { QuickJump } from './components/common/QuickJump';
import { CRM_ENABLED } from './crm/config';
import { useCrm } from './crm/useCrm';
import { PageHero } from './components/common/PageHero';
import { DirectivePopup } from './components/common/DirectivePopup';
import { LiveAlerts } from './crm/LiveAlerts';

const IS_VERCEL_PREVIEW = typeof window !== 'undefined' && window.location.hostname.endsWith('.vercel.app') && window.location.hostname !== 'office-attendance-tracker-server-vercel-hashim129.vercel.app';

function TabLoader() {
  return (
    <div role="status" aria-label="Loading page" className="flex items-center justify-center py-24">
      <div className="w-8 h-8 rounded-full border-[3px] border-slate-200 dark:border-slate-700 border-t-blue-600 animate-spin" />
    </div>
  );
}

// Pages are loaded only when opened, so the first screen appears much faster.
const MyAttendanceTab = lazy(() => import('./components/desktop/MyAttendanceTab').then((m) => ({ default: m.MyAttendanceTab })));
const TeamAttendanceTab = lazy(() => import('./components/desktop/TeamAttendanceTab').then((m) => ({ default: m.TeamAttendanceTab })));
const EmployeesDirectoryTab = lazy(() => import('./components/desktop/EmployeesDirectoryTab').then((m) => ({ default: m.EmployeesDirectoryTab })));
const ShiftManagementTab = lazy(() => import('./components/desktop/ShiftManagementTab').then((m) => ({ default: m.ShiftManagementTab })));
const LeaveManagementTab = lazy(() => import('./components/desktop/LeaveManagementTab').then((m) => ({ default: m.LeaveManagementTab })));
const ReportsTab = lazy(() => import('./components/desktop/ReportsTab').then((m) => ({ default: m.ReportsTab })));
const SmartInsightsTab = lazy(() => import('./components/desktop/SmartInsightsTab').then((m) => ({ default: m.SmartInsightsTab })));
const OfficeSettingsTab = lazy(() => import('./components/desktop/OfficeSettingsTab').then((m) => ({ default: m.OfficeSettingsTab })));
const PrintableTimesheetModal = lazy(() => import('./components/desktop/PrintableTimesheetModal').then((m) => ({ default: m.PrintableTimesheetModal })));
const FaceScanModal = lazy(() => import('./components/common/FaceScanModal').then((m) => ({ default: m.FaceScanModal })));
const LiveDashboardTab = lazy(() => import('./components/desktop/LiveDashboardTab').then((m) => ({ default: m.LiveDashboardTab })));
const CrmPage = lazy(() => import('./crm/CrmPage').then((m) => ({ default: m.CrmPage })));
const KioskMode = lazy(() => import('./components/kiosk/KioskMode').then((m) => ({ default: m.KioskMode })));

export default function App() {
  const [appMode, setAppMode] = useState<AppMode>(loadSavedMode());
  const [isDark, setIsDark] = useState<boolean>(() => {
    return localStorage.getItem('office_theme') === 'dark';
  });

  // Database State
  const [employees, setEmployees] = useState<Employee[]>([]);
  // The built-in "Office Administrator" account is kept out of every stats / attendance screen.
  const statEmployees = useMemo(() => employees.filter((e) => e.id !== 'emp-101'), [employees]);
  const [shifts, setShifts] = useState<ShiftSchedule[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [ceoComments, setCeoComments] = useState<CeoComment[]>([]);
  const [settings, setSettings] = useState<OfficeSettings>(loadSettings());
  const [previewBetaEnabled, setPreviewBetaEnabled] = useState<boolean>(() => IS_VERCEL_PREVIEW && localStorage.getItem('office_preview_redesign_beta') === 'true');
  const betaEnabled = IS_VERCEL_PREVIEW ? previewBetaEnabled : settings.redesignedUiBetaEnabled !== false;
  const handlePreviewBetaChange = (enabled: boolean) => {
    setPreviewBetaEnabled(enabled);
    localStorage.setItem('office_preview_redesign_beta', enabled ? 'true' : 'false');
  };
  const [currentClientIp, setCurrentClientIp] = useState<string>('Detecting...');
  const [currentClientIsp, setCurrentClientIsp] = useState<string>('Detecting...');
  const [alternateIp, setAlternateIp] = useState<string | undefined>(undefined);
  const [isInitialCloudSyncing, setIsInitialCloudSyncing] = useState<boolean>(true);
  const [isNetworkOnline, setIsNetworkOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [cloudSyncState, setCloudSyncState] = useState<CloudSyncState>(() => getCloudSyncStatus());

  // Current Session & Workspace Navigation
  const [currentUser, setCurrentUser] = useState<Employee | null>(null);
  // High-security face scan punch (admin turns it on in Office Settings; off by default)
  const [faceEnrolledIds, setFaceEnrolledIds] = useState<string[]>([]);
  const [faceStatusLoaded, setFaceStatusLoaded] = useState(false);
  const [enrollSelf, setEnrollSelf] = useState<{ employeeId: string; run: (() => void) | null } | null>(null);
  const enrollPromptShownRef = useRef<Set<string>>(new Set());
  const [faceRequest, setFaceRequest] = useState<{ employeeId: string; run: () => void } | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveDesktopTab>('clock');
  const [isMobileNavOpen, setIsMobileNavOpen] = useState<boolean>(false);
  const crm = useCrm(Boolean(currentUser), activeTab.startsWith('crm-') || activeTab === 'live-dashboard' || (betaEnabled && activeTab === 'clock'));

  // Password Modal
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState<boolean>(false);

  // Live refs for background timers & heartbeats
  const lastInteractionRef = useRef<number>(Date.now());
  const currentUserRef = useRef<Employee | null>(null);
  const employeesRef = useRef<Employee[]>([]);
  const recordsRef = useRef<AttendanceRecord[]>([]);
  const appModeRef = useRef<AppMode>(appMode);
  const refreshFromLocalRef = useRef<((verifySession?: boolean) => void) | null>(null);

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);
  useEffect(() => {
    employeesRef.current = employees;
  }, [employees]);
  useEffect(() => {
    recordsRef.current = records;
  }, [records]);
  useEffect(() => {
    appModeRef.current = appMode;
  }, [appMode]);

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

      employeesRef.current = loadedEmps;
      recordsRef.current = loadedRecords;
      setEmployees(loadedEmps);
      setShifts(loadedShifts);
      setRecords(loadedRecords);
      setLeaves(loadedLeaves);
      setCeoComments(loadedComments);
      setSettings(loadedSettings);

      const session = loadSession();
      if (session) {
        const matched = loadedEmps.find((e) => e.id === session.userId && e.isActive !== false);
        if (matched && !session.token && matched.hasPin && !matched.pin) {
          // Cloud mode: older saved logins have no secure token, so sign in once more.
          clearSession();
          setCurrentUser(null);
        } else if (matched) {
          setCurrentUser(matched);
        } else if (verifySession) {
          clearSession();
          setCurrentUser(null);
        }
      }
    };
    refreshFromLocalRef.current = refreshFromLocal;

    // Load cached data immediately for instant UI, WITHOUT pushing stale records back to server!
    refreshFromLocal(false);

    const unsubscribeStatus = subscribeCloudSyncStatus(setCloudSyncState);

    // Subscribe to post-write server merges so state reflects authoritative cloud DB
    registerCloudSyncListener(() => {
      refreshFromLocal(true);
    });

    const handleNetworkDetection = (net: { ip: string; ipv4?: string; ipv6?: string; isp: string }) => {
      setCurrentClientIp(net.ip);
      setCurrentClientIsp(net.isp);
      if (net.ipv4 && net.ip !== net.ipv4) {
        setAlternateIp(net.ipv4);
      } else if (net.ipv6 && net.ip !== net.ipv6) {
        setAlternateIp(net.ipv6);
      }
    };

    void detectClientNetwork().then(handleNetworkDetection);

    let bootFinished = false;
    // Flush any queued offline outbox mutations FIRST before pulling from server, so nothing is ever lost on reload
    void flushPendingCloudWrites()
      .then(() => syncDatabaseFromServer(true))
      .then((updated) => {
        if (updated) {
          refreshFromLocal(true);
        }
      })
      .finally(() => {
        bootFinished = true;
        setIsInitialCloudSyncing(false);
      });

    let hiddenPollSkipCount = 0;
    const syncInterval = setInterval(() => {
      if (!bootFinished) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        hiddenPollSkipCount += 1;
        if (hiddenPollSkipCount % 3 !== 0) return;
      } else {
        hiddenPollSkipCount = 0;
      }

      if (hasPendingCloudWrites()) {
        void flushPendingCloudWrites({ respectCooldown: true });
        return;
      }

      void syncDatabaseFromServer(false)
        .then((updated) => {
          if (typeof navigator !== 'undefined' && navigator.onLine) {
            setIsNetworkOnline(true);
          }
          if (updated) refreshFromLocal(true);
        })
        .catch(() => {
          setIsNetworkOnline(false);
        });
    }, 6000);

    const ipInterval = setInterval(() => {
      void detectClientNetwork().then(handleNetworkDetection);
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
      clearInterval(ipInterval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      registerCloudSyncListener(null);
      unsubscribeStatus();
    };
  }, []);



  // Sync on tab visibility, focus, and network reconnect without spamming heartbeats
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        lastInteractionRef.current = Date.now();
        void flushPendingCloudWrites({ respectCooldown: false })
          .then(() => syncDatabaseFromServer(true))
          .then((updated) => {
            if (updated && refreshFromLocalRef.current) refreshFromLocalRef.current(true);
          });
      }
    };

    const handleFocus = () => {
      lastInteractionRef.current = Date.now();
      void flushPendingCloudWrites({ respectCooldown: false })
        .then(() => syncDatabaseFromServer(false))
        .then((updated) => {
          if (updated && refreshFromLocalRef.current) refreshFromLocalRef.current(true);
        });
    };

    const handleOnline = () => {
      setIsNetworkOnline(true);
      void flushPendingCloudWrites({ respectCooldown: false })
        .then(() => syncDatabaseFromServer(true))
        .then((updated) => {
          if (updated && refreshFromLocalRef.current) refreshFromLocalRef.current(true);
        });
    };

    const handleOffline = () => {
      setIsNetworkOnline(false);
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // If the administrator disables this person's profile while they are signed in, sign them out.
  useEffect(() => {
    if (!currentUser?.id) return;
    const me = employees.find((e) => e.id === currentUser.id);
    if (me && me.isActive === false) {
      handleLogout();
      alert('Your profile has been disabled by the administrator. Please contact them if you think this is a mistake.');
    }
  }, [employees, currentUser?.id]);

  // Browser presence: while a person is signed in on the web page, tell the server "still here" every 30 s,
  // so Team Presence shows live Online / Offline even without the Windows app. Closing the tab marks them offline.
  useEffect(() => {
    if (!currentUser?.id || appMode === 'kiosk') return;
    const employeeId = currentUser.id;
    const markActive = () => {
      lastInteractionRef.current = Date.now();
    };
    const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'];
    events.forEach((ev) => window.addEventListener(ev, markActive, { passive: true }));

    const startToken = getSessionToken();
    const send = (closing: boolean) => {
      const token = closing ? getSessionToken() || startToken : getSessionToken();
      if (!token) return;
      const idleMs = Date.now() - lastInteractionRef.current;
      try {
        void fetch('/api/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          keepalive: true,
          body: JSON.stringify({
            employeeId,
            sessionToken: token,
            isUserActive: idleMs < 5 * 60 * 1000,
            ...(closing ? { closing: true } : {}),
          }),
        }).catch(() => undefined);
      } catch {
        /* ignore */
      }
    };

    send(false);
    const timer = setInterval(() => {
      if (typeof navigator === 'undefined' || navigator.onLine) send(false);
    }, 30000);
    const onPageHide = () => send(true);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      clearInterval(timer);
      events.forEach((ev) => window.removeEventListener(ev, markActive));
      window.removeEventListener('pagehide', onPageHide);
      send(true); // signed out / switched mode: show offline straight away
    };
  }, [currentUser?.id, appMode]);

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

  const handleToggleMode = async (mode: AppMode) => {
    // Switching INTO Lobby Kiosk Mode from desktop/login requires Admin role or Admin PIN
    // so colleagues on mobile phones cannot enter Kiosk Mode to punch each other's PINs!
    if (mode === 'kiosk' && appMode !== 'kiosk') {
      const isSignedInAdmin = currentUser?.role === 'admin';
      if (!isSignedInAdmin) {
        const enteredPin = prompt(
          'Administrator Verification Required:\n\nEnter Administrator PIN to launch Lobby Kiosk Terminal mode:'
        );
        if (enteredPin === null) return;
        const adminCheck = await verifyAdminPin(enteredPin, employees);
        if (!adminCheck.ok) {
          alert(adminCheck.error || 'Invalid Administrator PIN. Only an Administrator can activate Lobby Kiosk Mode.');
          return;
        }
      }
    }
    setAppMode(mode);
    saveMode(mode);
  };

  const handleLogin = (employee: Employee, keepLoggedIn: boolean) => {
    setCurrentUser(employee);
    saveSession(employee.id, keepLoggedIn, takePendingToken(employee.id));
    // The pre-login endpoint returns only a safe directory projection. Fetch the full
    // authorized database snapshot immediately after the server has issued the session.
    void syncDatabaseFromServer(true).then((updated) => {
      if (updated && refreshFromLocalRef.current) refreshFromLocalRef.current(true);
    });
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

    const currentRecords = recordsRef.current;
    const existingIdx = currentRecords.findIndex(
      (r) => r.employeeId === employeeId && r.date === todayStr
    );

    // DAILY LIMIT ENFORCEMENT: Each employee is restricted to 1 attendance punch daily
    if (existingIdx >= 0 && currentRecords[existingIdx].timeIn) {
      alert(
        `Daily Punch Limit: ${emp.name} already clocked in today at ${currentRecords[existingIdx].timeIn}. Only ONE clock-in is permitted per day. If a modification is required, contact the Administrator.`
      );
      return;
    }

    // Capture informational device details & presence metadata
    const { deviceId, deviceLabel } = getDeviceDetails();
    const nowIso = new Date().toISOString();
    const isOnlineNow = typeof navigator !== 'undefined' ? navigator.onLine : true;
    lastInteractionRef.current = Date.now();
    const actorRole = appMode === 'kiosk' ? 'employee' : currentUserRef.current?.role || emp.role;

    const presenceFields: Partial<AttendanceRecord> =
      appMode === 'kiosk'
        ? { heartbeatSource: 'kiosk' }
        : {
            lastHeartbeatAt: nowIso,
            lastActivityAt: nowIso,
            connectionStatus: isOnlineNow ? 'online' : 'no_internet',
            heartbeatSource: 'web-client',
            heartbeatDeviceId: deviceId,
            monitoringPaused: false,
          };

    let nextRecords = [...currentRecords];
    let changedRecord: AttendanceRecord;

    if (existingIdx >= 0) {
      changedRecord = {
        ...nextRecords[existingIdx],
        ...presenceFields,
        timeIn: nowTime,
        status: late ? 'late' : 'present',
        notes: notes || nextRecords[existingIdx].notes,
        clientIp: currentClientIp,
        deviceId,
        deviceName: deviceLabel,
        isDeviceMismatch: false,
        deviceMismatchReason: undefined,
        recordUpdatedAt: nowIso,
        lastEditedByRole: actorRole,
        actorAction: 'time_in',
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
        isDeviceMismatch: false,
        ...presenceFields,
        recordUpdatedAt: nowIso,
        lastEditedByRole: actorRole,
        actorAction: 'time_in',
      };
      nextRecords = [changedRecord, ...nextRecords];
    }

    recordsRef.current = nextRecords;
    setRecords(nextRecords);
    saveAttendanceRecords(nextRecords, changedRecord, actorRole);
  };

  const handleUpdatePunchNote = (employeeId: string, notes: string) => {
    const todayStr = getTodayDateString();
    const currentRecords = recordsRef.current;
    const existingIdx = currentRecords.findIndex(
      (r) => r.employeeId === employeeId && r.date === todayStr
    );

    if (existingIdx >= 0) {
      const nowIso = new Date().toISOString();
      const actorRole = currentUserRef.current?.role || 'employee';
      const updatedRecords = [...currentRecords];
      const changedRecord: AttendanceRecord = {
        ...updatedRecords[existingIdx],
        notes,
        recordUpdatedAt: nowIso,
        lastEditedByRole: actorRole,
        actorAction: 'update_note',
      };
      updatedRecords[existingIdx] = changedRecord;
      recordsRef.current = updatedRecords;
      setRecords(updatedRecords);
      saveAttendanceRecords(updatedRecords, changedRecord, actorRole);
    }
  };

  const handleTimeOut = (employeeId: string, notes?: string) => {
    const todayStr = getTodayDateString();
    const nowTime = getCurrentTimeString();
    const emp = employees.find((e) => e.id === employeeId);
    const shift = shifts.find((s) => s.id === emp?.shiftId) || shifts[0];

    const currentRecords = recordsRef.current;
    const existingIdx = currentRecords.findIndex(
      (r) => r.employeeId === employeeId && r.date === todayStr
    );

    if (existingIdx === -1) return;

    const currentRec = currentRecords[existingIdx];
    const nowIso = new Date().toISOString();
    const actorRole = appMode === 'kiosk' ? 'employee' : currentUserRef.current?.role || 'employee';

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
      clearTimeOut: false,
      adminKeepOpen: false,
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
      recordUpdatedAt: nowIso,
      lastEditedByRole: actorRole,
      actorAction: 'time_out',
    };

    const nextRecords = [...currentRecords];
    nextRecords[existingIdx] = updated;
    recordsRef.current = nextRecords;
    setRecords(nextRecords);
    saveAttendanceRecords(nextRecords, updated, actorRole);
  };

  const handleStartBreak = (
    employeeId: string,
    type: 'lunch' | 'coffee' | 'short_break'
  ) => {
    const todayStr = getTodayDateString();
    const nowTime = getCurrentTimeString();
    const currentRecords = recordsRef.current;
    const existingIdx = currentRecords.findIndex(
      (r) => r.employeeId === employeeId && r.date === todayStr
    );

    if (existingIdx === -1) return;

    const nowIso = new Date().toISOString();
    lastInteractionRef.current = Date.now();
    const currentRec = currentRecords[existingIdx];
    const actorRole = appMode === 'kiosk' ? 'employee' : currentUserRef.current?.role || 'employee';
    const newBreak = {
      id: `brk-${Date.now()}`,
      start: nowTime,
      type,
    };

    const updated: AttendanceRecord = {
      ...currentRec,
      breaks: [...currentRec.breaks, newBreak],
      lastActivityAt: nowIso,
      recordUpdatedAt: nowIso,
      lastEditedByRole: actorRole,
      actorAction: 'start_break',
      ...(appMode !== 'kiosk'
        ? {
            lastHeartbeatAt: nowIso,
            connectionStatus: isNetworkOnline ? 'online' : 'no_internet',
          }
        : {}),
    };

    const nextRecords = [...currentRecords];
    nextRecords[existingIdx] = updated;
    recordsRef.current = nextRecords;
    setRecords(nextRecords);
    saveAttendanceRecords(nextRecords, updated, actorRole);
  };

  const handleEndBreak = (employeeId: string) => {
    const todayStr = getTodayDateString();
    const nowTime = getCurrentTimeString();
    const currentRecords = recordsRef.current;
    const existingIdx = currentRecords.findIndex(
      (r) => r.employeeId === employeeId && r.date === todayStr
    );

    if (existingIdx === -1) return;

    const nowIso = new Date().toISOString();
    lastInteractionRef.current = Date.now();
    const currentRec = currentRecords[existingIdx];
    const actorRole = appMode === 'kiosk' ? 'employee' : currentUserRef.current?.role || 'employee';
    const updatedBreaks = currentRec.breaks.map((b) => {
      if (!b.end) {
        return { ...b, end: nowTime };
      }
      return b;
    });

    const updated: AttendanceRecord = {
      ...currentRec,
      breaks: updatedBreaks,
      lastActivityAt: nowIso,
      disconnectedAt: undefined,
      recordUpdatedAt: nowIso,
      lastEditedByRole: actorRole,
      actorAction: 'end_break',
      ...(appMode !== 'kiosk'
        ? {
            lastHeartbeatAt: nowIso,
            connectionStatus: isNetworkOnline ? 'online' : 'no_internet',
            monitoringPaused: false,
          }
        : {}),
    };

    const nextRecords = [...currentRecords];
    nextRecords[existingIdx] = updated;
    recordsRef.current = nextRecords;
    setRecords(nextRecords);
    saveAttendanceRecords(nextRecords, updated, actorRole);
  };

  // -------------------------------------------------------------
  // Admin Data Modification Handlers
  // -------------------------------------------------------------
  // -------------------------------------------------------------
  // Face scan gate: wraps a punch action so it only runs after a successful face scan
  // -------------------------------------------------------------
  useEffect(() => {
    rememberSession(currentUser?.id ?? null);
  }, [currentUser?.id]);

  const refreshFaceStatus = () => {
    void fetchFaceEnrolledIds().then((ids) => {
      setFaceEnrolledIds(ids);
      setFaceStatusLoaded(true);
    });
  };

  useEffect(() => {
    if (settings.faceScanPunchEnabled || settings.faceEnrollRequired || currentUser?.role === 'admin') refreshFaceStatus();
  }, [settings.faceScanPunchEnabled, settings.faceEnrollRequired, currentUser?.id, currentUser?.role]);

  // When the admin requires every person to enroll their face, ask once after sign-in (and again at any punch).
  useEffect(() => {
    if (
      settings.faceEnrollRequired &&
      faceStatusLoaded &&
      currentUser?.id &&
      appMode !== 'kiosk' &&
      !faceEnrolledIds.includes(currentUser.id) &&
      !enrollPromptShownRef.current.has(currentUser.id)
    ) {
      enrollPromptShownRef.current.add(currentUser.id);
      setEnrollSelf({ employeeId: currentUser.id, run: null });
    }
  }, [settings.faceEnrollRequired, faceStatusLoaded, faceEnrolledIds, currentUser?.id, appMode]);

  const gatePunch = (employeeId: string, run: () => void) => {
    if (settings.faceEnrollRequired && !faceEnrolledIds.includes(employeeId)) {
      if (appMode !== 'kiosk' && currentUserRef.current?.id === employeeId) {
        setEnrollSelf({ employeeId, run });
      } else {
        alert('Your administrator requires a face scan before punching. Please sign in to your own account once and set up your face, then try again here.');
      }
      return;
    }
    if (!settings.faceScanPunchEnabled) {
      run();
      return;
    }
    if (faceEnrolledIds.includes(employeeId)) {
      setFaceRequest({ employeeId, run });
      return;
    }
    const actorRole = appMode === 'kiosk' ? 'employee' : currentUserRef.current?.role || 'employee';
    if (actorRole !== 'admin' && settings.faceScanAllowUnenrolled === false) {
      alert('Face scan is required to punch, but your face is not enrolled yet. Please ask the Administrator to enroll you.');
      return;
    }
    run();
  };

  const handleGatedTimeIn = (id: string, notes?: string) => gatePunch(id, () => handleTimeIn(id, notes));
  const handleGatedTimeOut = (id: string, notes?: string) => gatePunch(id, () => handleTimeOut(id, notes));
  const handleGatedStartBreak = (id: string, type: 'lunch' | 'coffee' | 'short_break') =>
    gatePunch(id, () => handleStartBreak(id, type));
  const handleGatedEndBreak = (id: string) => gatePunch(id, () => handleEndBreak(id));

  const handleAddEmployee = (empData: Omit<Employee, 'id'>) => {
    const nowIso = new Date().toISOString();
    const actorRole = currentUserRef.current?.role || 'admin';
    const newEmp: Employee = {
      ...empData,
      id: `emp-${Date.now()}`,
      recordUpdatedAt: nowIso,
      lastEditedByRole: actorRole,
    };
    const nextEmps = [...employees, newEmp];
    setEmployees(nextEmps);
    saveEmployeeUpsert(nextEmps, newEmp, { actorRole });
    return newEmp;
  };

  const handleUpdateEmployee = (updatedEmp: Employee) => {
    const nowIso = new Date().toISOString();
    const actorRole = currentUserRef.current?.role || 'admin';
    const stampedEmp: Employee = {
      ...updatedEmp,
      recordUpdatedAt: nowIso,
      lastEditedByRole: actorRole,
    };
    const nextEmps = employees.map((e) => (e.id === stampedEmp.id ? stampedEmp : e));
    setEmployees(nextEmps);
    saveEmployeeUpsert(nextEmps, stampedEmp, { actorRole });
    if (currentUser?.id === stampedEmp.id) {
      setCurrentUser(stampedEmp);
    }
  };

  const handleDeleteEmployee = (empId: string) => {
    const actorRole = currentUserRef.current?.role || 'admin';
    const nextEmps = employees.filter((e) => e.id !== empId);
    setEmployees(nextEmps);
    saveEmployeeDelete(nextEmps, empId, actorRole);
  };

  const handleUpdatePin = (employeeId: string, newPin: string) => {
    const target = employees.find((e) => e.id === employeeId);
    if (!target) return;
    const nowIso = new Date().toISOString();
    const actorRole = currentUserRef.current?.role || 'employee';
    const updatedEmp: Employee = {
      ...target,
      pin: newPin,
      recordUpdatedAt: nowIso,
      lastEditedByRole: actorRole,
    };
    const nextEmps = employees.map((e) => (e.id === employeeId ? updatedEmp : e));
    setEmployees(nextEmps);
    saveEmployeeUpsert(nextEmps, updatedEmp, { actorRole });
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
    saveShifts(nextShifts, currentUserRef.current?.role || 'admin');
  };

  const handleUpdateShift = (updatedShift: ShiftSchedule) => {
    const nextShifts = shifts.map((s) => (s.id === updatedShift.id ? updatedShift : s));
    setShifts(nextShifts);
    saveShifts(nextShifts, currentUserRef.current?.role || 'admin');
  };

  const handleApplyLeave = async (
    leaveData: Omit<LeaveRequest, 'id' | 'appliedAt' | 'status'>
  ) => {
    const nowIso = new Date().toISOString();
    const actorRole = currentUserRef.current?.role || 'employee';
    const newLeave: LeaveRequest = {
      ...leaveData,
      id: `leave-${Date.now()}`,
      status: 'pending',
      appliedAt: nowIso,
      recordUpdatedAt: nowIso,
      lastEditedByRole: actorRole,
    };
    const nextLeaves = [newLeave, ...leaves];
    setLeaves(nextLeaves);
    await saveLeaves(nextLeaves, newLeave, actorRole);
  };

  const handleReviewLeave = async (
    leaveId: string,
    status: 'approved' | 'rejected',
    reviewNote?: string
  ) => {
    const nowIso = new Date().toISOString();
    const actorRole = currentUserRef.current?.role || 'admin';
    let changedLeave: LeaveRequest | undefined;
    const nextLeaves = leaves.map((l) => {
      if (l.id === leaveId) {
        changedLeave = {
          ...l,
          status,
          reviewNote,
          reviewedBy: currentUser?.id,
          recordUpdatedAt: nowIso,
          lastEditedByRole: actorRole,
        };
        return changedLeave;
      }
      return l;
    });
    setLeaves(nextLeaves);
    await saveLeaves(nextLeaves, changedLeave, actorRole);
  };

  const handleUpdateRecord = (updatedRecord: AttendanceRecord) => {
    const nowIso = new Date().toISOString();
    const actorRole = updatedRecord.lastEditedByRole || currentUserRef.current?.role || 'admin';
    const serverPayload: AttendanceRecord = {
      ...updatedRecord,
      recordUpdatedAt: updatedRecord.recordUpdatedAt || nowIso,
      lastEditedByRole: actorRole,
      ...(actorRole === 'admin' && updatedRecord.actorAction !== 'verify'
        ? { adminOverrideAt: updatedRecord.adminOverrideAt || nowIso }
        : {}),
    };

    // Clean local state copy without transient clearTimeOut flag
    const localRec: AttendanceRecord = { ...serverPayload };
    delete localRec.clearTimeOut;

    const currentRecords = recordsRef.current;
    const existingIdx = currentRecords.findIndex((r) => r.id === localRec.id);
    let nextRecords = [...currentRecords];
    if (existingIdx >= 0) {
      nextRecords[existingIdx] = localRec;
    } else {
      nextRecords = [localRec, ...nextRecords];
    }

    recordsRef.current = nextRecords;
    setRecords(nextRecords);
    saveAttendanceRecords(nextRecords, serverPayload, actorRole);
  };

  const handleBatchUpdateRecords = (updates: AttendanceRecord[]) => {
    if (!updates || updates.length === 0) return;
    const nowIso = new Date().toISOString();
    const defaultRole = currentUserRef.current?.role || 'admin';

    const serverPayloads: AttendanceRecord[] = updates.map((u) => {
      const role = u.lastEditedByRole || defaultRole;
      return {
        ...u,
        recordUpdatedAt: u.recordUpdatedAt || nowIso,
        lastEditedByRole: role,
        ...(role === 'admin' && u.actorAction !== 'verify'
          ? { adminOverrideAt: u.adminOverrideAt || nowIso }
          : {}),
      };
    });

    const payloadMap = new Map(serverPayloads.map((u) => [u.id, u]));
    const currentRecords = recordsRef.current;
    const existingIds = new Set(currentRecords.map((r) => r.id));

    const nextRecords = currentRecords.map((r) => {
      const upd = payloadMap.get(r.id);
      if (!upd) return r;
      const clean = { ...upd };
      delete clean.clearTimeOut;
      return clean;
    });

    for (const upd of serverPayloads) {
      if (!existingIds.has(upd.id)) {
        const clean = { ...upd };
        delete clean.clearTimeOut;
        nextRecords.unshift(clean);
      }
    }

    recordsRef.current = nextRecords;
    setRecords(nextRecords);
    saveAttendanceRecords(nextRecords, serverPayloads, defaultRole);
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
    saveCeoComments(nextComments, newComment, currentUserRef.current?.role || 'ceo');
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
    saveCeoComments(nextComments, changedComment, currentUserRef.current?.role || 'employee');
  };

  const handleUpdateSettings = (newSettings: OfficeSettings) => {
    const stamped: OfficeSettings = {
      ...newSettings,
      settingsUpdatedAt: new Date().toISOString(),
    };
    setSettings(stamped);
    saveSettings(stamped, currentUserRef.current?.role || 'admin');
  };

  const handleRecheckNetwork = async () => {
    const net = await detectClientNetwork();
    setCurrentClientIp(net.ip);
    setCurrentClientIsp(net.isp);
    if (net.ipv4 && net.ip !== net.ipv4) setAlternateIp(net.ipv4);
    else if (net.ipv6 && net.ip !== net.ipv6) setAlternateIp(net.ipv6);
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
      className={`${betaEnabled ? 'min-h-screen' : 'min-h-[calc(100vh-2.5rem)]'} bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-all duration-200`}
    >
      {!betaEnabled && <WindowsTitleBar isDark={isDark} onToggleTheme={handleToggleTheme} serverHost={settings.serverHostName} serverPort={settings.serverPort} />}
      {/* Screen Mode Render */}
      {appMode === 'kiosk' ? (
        <Suspense fallback={<TabLoader />}>
        <KioskMode
          employees={employees}
          shifts={shifts}
          records={records}
          settings={settings}
          onTimeIn={handleGatedTimeIn}
          onTimeOut={handleGatedTimeOut}
          onStartBreak={handleGatedStartBreak}
          onEndBreak={handleGatedEndBreak}
          onKioskAuthenticated={() => {
            void syncDatabaseFromServer(true).then((updated) => {
              if (updated && refreshFromLocalRef.current) refreshFromLocalRef.current(true);
            });
          }}
          onExitKiosk={() => handleToggleMode('desktop')}
          currentClientIp={currentClientIp}
          currentClientIsp={currentClientIsp}
          alternateIp={alternateIp}
        />
        </Suspense>
      ) : !currentUser ? (
        <LoginView
          employees={employees}
          onLogin={handleLogin}
          companyName={settings.companyName}
          isSyncing={isInitialCloudSyncing}
        />
      ) : (
        <div className={`app-reveal flex-1 flex flex-col ${betaEnabled ? 'min-h-screen workforce-redesign-beta' : 'min-h-[calc(100vh-2.5rem)]'} min-w-0 w-full overflow-x-clip`}>
          {/* Header */}
          <DesktopHeader
            currentUser={currentUser}
            activeTab={activeTab}
            onLogout={handleLogout}
            onSwitchToKiosk={() => handleToggleMode('kiosk')}
            ceoComments={ceoComments}
            onMarkCeoCommentRead={handleMarkCeoCommentRead}
            onOpenChangePassword={() => setIsChangePasswordOpen(true)}
            isNetworkOnline={isNetworkOnline}
            cloudSyncState={cloudSyncState}
            onRetrySync={() => void retryCloudOutboxNow()}
            onOpenMobileNav={() => setIsMobileNavOpen(true)}
            crmUnread={CRM_ENABLED ? crm.badges.unreadTotal : 0}
            crmLatest={CRM_ENABLED ? crm.badges.unreadLatest : []}
            onCrmRefresh={CRM_ENABLED ? () => void crm.refresh() : undefined}
            onOpenCrmNotifications={CRM_ENABLED ? () => setActiveTab('crm-notifications') : undefined}
            isDark={isDark}
            onToggleTheme={handleToggleTheme}
            redesignedUiBetaEnabled={betaEnabled}
          />

          {/* Body Split: Sidebar + Active Viewport */}
          <div className="flex-1 flex min-w-0 w-full overflow-x-clip">
            <DesktopSidebar
              currentUser={currentUser}
              activeTab={activeTab}
              onSelectTab={setActiveTab}
              pendingLeavesCount={pendingLeavesCount}
              settings={settings}
              isMobileOpen={isMobileNavOpen}
              onCloseMobile={() => setIsMobileNavOpen(false)}
              crmEnabled={CRM_ENABLED}
              crmBadges={crm.badges}
              redesignedUiBetaEnabled={betaEnabled}
            />

            <main className="flex-1 min-w-0 w-full p-3 sm:p-5 lg:p-6 overflow-x-clip bg-slate-50/50 dark:bg-slate-950/40">
              <div key={activeTab} className="page-enter min-w-0">
                <PageHero
                  tab={activeTab}
                  name={currentUser?.name || ''}
                  isAdmin={currentUser?.role === 'admin' || currentUser?.role === 'ceo'}
                  crm={crm}
                  todayRecord={records.find((r) => r.employeeId === currentUser?.id && r.date === getTodayDateString())}
                  unreadDirectives={ceoComments.filter((c) => c.employeeId === currentUser?.id && !c.isRead).length}
                  onNavigate={setActiveTab}
                />
                <ErrorBoundary>
                  <Suspense fallback={<TabLoader />}>
                {activeTab === 'clock' && (
                <>
                {betaEnabled && currentUser && (['admin', 'ceo'].includes(currentUser.role) || currentUser.liveDashboardAccess) && (
                  <LiveDashboardTab
                    currentUser={currentUser}
                    employees={statEmployees}
                    records={records}
                    shifts={shifts}
                    leaves={leaves}
                    crm={crm}
                    onNavigate={setActiveTab}
                    redesignedUiBetaEnabled={settings.redesignedUiBetaEnabled}
                  />
                )}
                <PunchClockTab
                  onRecheckNetwork={handleRecheckNetwork}
                  currentUser={currentUser}
                  allEmployees={statEmployees}
                  shifts={shifts}
                  records={records}
                  onTimeIn={handleGatedTimeIn}
                  onTimeOut={handleGatedTimeOut}
                  onStartBreak={handleGatedStartBreak}
                  onEndBreak={handleGatedEndBreak}
                  onUpdatePunchNote={handleUpdatePunchNote}
                  settings={settings}
                  currentClientIp={currentClientIp}
                  currentClientIsp={currentClientIsp}
                  alternateIp={alternateIp}
                  isNetworkOnline={isNetworkOnline}
                  ceoComments={ceoComments}
                  onMarkCeoCommentRead={handleMarkCeoCommentRead}
                  onOpenChangePassword={() => setIsChangePasswordOpen(true)}
                />
                </>
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
                  onOpenChangePassword={() => setIsChangePasswordOpen(true)}
                  isNetworkOnline={isNetworkOnline}
                />
              )}

              {CRM_ENABLED && (activeTab === 'crm-customers' || activeTab === 'crm-tasks' || activeTab === 'crm-meetings' || activeTab === 'crm-inventory' || activeTab === 'crm-sales' || activeTab === 'crm-purchases' || activeTab === 'crm-invoices' || activeTab === 'crm-receipts' || activeTab === 'crm-portal' || activeTab === 'crm-notifications') && (
                <CrmPage section={activeTab} crm={crm} employees={employees} currentUser={currentUser} onNavigate={setActiveTab} customerPortalBetaEnabled={settings.customerPortalBetaEnabled !== false} />
              )}

              {activeTab === 'live-dashboard' && currentUser && (['admin', 'ceo'].includes(currentUser.role) || currentUser.liveDashboardAccess) && (
                <LiveDashboardTab
                  currentUser={currentUser}
                  employees={statEmployees}
                  records={records}
                  shifts={shifts}
                  leaves={leaves}
                  crm={crm}
                  onNavigate={setActiveTab}
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
                  employees={statEmployees}
                  records={records}
                  shifts={shifts}
                  settings={settings}
                  onUpdateRecord={handleUpdateRecord}
                  onBatchUpdateRecords={handleBatchUpdateRecords}
                  adminUser={currentUser}
                  currentUser={currentUser}
                  ceoComments={ceoComments}
                  onAddCeoComment={handleAddCeoComment}
                  isNetworkOnline={isNetworkOnline}
                  onOpenPrintModal={handleOpenPrintModal}
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
                  companyName={settings.companyName}
                  allowAutoStartPunch={Boolean(settings.allowAutoStartPunch)}
                  onOpenPrintModal={handleOpenPrintModal}
                  faceEnrolledIds={faceEnrolledIds}
                  onFaceChanged={refreshFaceStatus}
                />
              )}

              {currentUser.role === 'admin' && activeTab === 'shifts' && (
                <ShiftManagementTab
                  shifts={shifts}
                  onAddShift={handleAddShift}
                  onUpdateShift={handleUpdateShift}
                />
              )}

              {/* Smart Attendance Insights - Strictly Restricted to Admin, Accounts, and CEO */}
              {(currentUser.role === 'admin' || currentUser.role === 'accounts' || currentUser.role === 'ceo') &&
                activeTab === 'insights' && (
                  <SmartInsightsTab
                    currentUser={currentUser}
                    employees={statEmployees}
                    records={records}
                    shifts={shifts}
                    leaves={leaves}
                    settings={settings}
                    onOpenPrintModal={handleOpenPrintModal}
                    isNetworkOnline={isNetworkOnline}
                  />
                )}

              {/* Reports & Payroll - Allowed for Admin, Accounts Officer, and CEO */}
              {(currentUser.role === 'admin' || currentUser.role === 'accounts' || currentUser.role === 'ceo') &&
                activeTab === 'reports' && (
                  <ReportsTab
                    employees={statEmployees}
                    records={records}
                    shifts={shifts}
                    settings={settings}
                    onOpenPrintModal={handleOpenPrintModal}
                    currentUser={currentUser}
                    onAddCeoComment={handleAddCeoComment}
                    onUpdateRecord={handleUpdateRecord}
                    isNetworkOnline={isNetworkOnline}
                  />
                )}

              {currentUser.role === 'admin' && activeTab === 'settings' && (
                <OfficeSettingsTab
            previewDeployment={IS_VERCEL_PREVIEW}
            previewBetaEnabled={betaEnabled}
            onPreviewBetaChange={handlePreviewBetaChange}
                  settings={settings}
                  onUpdateSettings={handleUpdateSettings}
                  onReloadAllData={handleReloadAllData}
                  currentClientIp={currentClientIp}
                  currentClientIsp={currentClientIsp}
                />
              )}
                  </Suspense>
              </ErrorBoundary>
              {CRM_ENABLED && <LiveAlerts crm={crm} onOpen={setActiveTab} />}
              {currentUser && <DirectivePopup comments={ceoComments} userId={currentUser.id} onRead={handleMarkCeoCommentRead} />}
      <QuickJump currentUser={currentUser} crmEnabled={CRM_ENABLED} onSelectTab={setActiveTab} />
            </div>
            </main>
          </div>
        </div>
      )}

      {/* Printable Timesheet Document Preview Modal */}
      {printModalState.isOpen && (
        <Suspense fallback={null}><PrintableTimesheetModal
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
          shifts={shifts}
          settings={settings}
          currentUser={currentUser}
        /></Suspense>
      )}

      {/* Face scan before punching (High security) */}
      {faceRequest && (
        <Suspense fallback={null}><FaceScanModal
          isOpen
          mode="verify"
          employeeId={faceRequest.employeeId}
          employeeName={employees.find((e) => e.id === faceRequest.employeeId)?.name || ''}
          onClose={() => setFaceRequest(null)}
          onSuccess={() => {
            const { run } = faceRequest;
            setFaceRequest(null);
            run();
          }}
        /></Suspense>
      )}

      {/* Required face set-up through the person's own login */}
      {enrollSelf && (
        <Suspense fallback={null}><FaceScanModal
          isOpen
          mode="enroll-self"
          employeeId={enrollSelf.employeeId}
          employeeName={employees.find((e) => e.id === enrollSelf.employeeId)?.name || ''}
          onClose={() => setEnrollSelf(null)}
          onSuccess={() => {
            const { run, employeeId } = enrollSelf;
            setEnrollSelf(null);
            setFaceEnrolledIds((ids) => (ids.includes(employeeId) ? ids : [...ids, employeeId]));
            refreshFaceStatus();
            if (run) run();
          }}
        /></Suspense>
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
    </div>
  );
}
