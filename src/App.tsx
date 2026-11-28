import React, { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import {
  ActiveDesktopTab,
  AppMode,
  AttendanceRecord,
  CeoComment,
  Employee,
  LeaveRequest,
  OfficeSettings,
  PunchLocation,
  ShiftSchedule,
} from './types';
import { checkPunchLocation, needsPhoneLocation } from './lib/phoneLocation';
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
  formatTime12h,
} from './lib/attendanceCalculations';
import { detectClientNetwork } from './lib/ipSecurity';
import { getDeviceDetails } from './lib/deviceSecurity';
import { WindowsTitleBar } from './components/common/WindowsTitleBar';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { LoginView } from './components/desktop/LoginView';
import { AppLoginView } from './components/mobile/AppLoginView';
import { PhoneShell } from './components/mobile/PhoneShell';
import { MyWeekCard } from './components/mobile/MyWeekCard';
import { PhoneAppSettings } from './components/mobile/PhoneAppSettings';
import { TaskBoard } from './components/mobile/TaskBoard';
import { ThemePicker } from './components/common/ThemePicker';
import { WhatsNewWalkthrough } from './components/common/WhatsNew';
import { AnnouncementPopup } from './components/common/Announcements';
import { updateWidget, haptic } from './lib/phoneApp';
import { celebrate, once } from './lib/celebrate';
import { isPhoneApp } from './lib/phoneLocation';
import { DesktopHeader } from './components/desktop/DesktopHeader';
import { DesktopSidebar } from './components/desktop/DesktopSidebar';
import { PunchClockTab } from './components/desktop/PunchClockTab';
import { ChangePasswordModal } from './components/common/ChangePasswordModal';
import { verifyAdminPin, rememberSession, takePendingToken, takeMustChangePin } from './lib/pinAuth';
import { QuickJump } from './components/common/QuickJump';
import { CRM_ENABLED } from './crm/config';
import { useCrm } from './crm/useCrm';
import { PageHero } from './components/common/PageHero';
import { DirectivePopup } from './components/common/DirectivePopup';
import { LiveAlerts } from './crm/LiveAlerts';
import { AccountsAckReminder } from './crm/AfterCreate';
import { AppUpdateWatcher } from './components/common/AppUpdateWatcher';
import {pageEnabled} from './lib/pageAccess';
const EmployeeUniverse = lazy(() => import('./components/desktop/EmployeeUniverse').then(m=>({default:m.EmployeeUniverse})));
const SuperAdminTab = lazy(() => import('./components/desktop/SuperAdminTab').then(m=>({default:m.SuperAdminTab})));
const EmployeeProfileTab = lazy(() => import('./components/desktop/EmployeeProfileTab').then(m=>({default:m.EmployeeProfileTab})));

const IS_VERCEL_PREVIEW = typeof window !== 'undefined' && window.location.hostname.endsWith('.vercel.app') && window.location.hostname !== 'office-attendance-tracker-server-vercel-hashim129.vercel.app';

function TabLoader() {
  return (
    <div role="status" aria-label="Loading page" className="space-y-3 py-2">
      <div className="skeleton h-16 rounded-xl" />
      <div className="skeleton h-28 rounded-xl" />
      <div className="skeleton h-28 rounded-xl" />
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
const StatsAvatar = lazy(() => import('./components/desktop/UniverseOffice').then(m=>({default:m.AvatarStage})));
const PersonalDesk = lazy(() => import('./components/desktop/UniverseOffice').then(m=>({default:m.PersonalDesk})));
const LiveDashboardTab = lazy(() => import('./components/desktop/LiveDashboardTab').then((m) => ({ default: m.LiveDashboardTab })));
const CrmPage = lazy(() => import('./crm/CrmPage').then((m) => ({ default: m.CrmPage })));
const KioskMode = lazy(() => import('./components/kiosk/KioskMode').then((m) => ({ default: m.KioskMode })));

export default function App() {
  const [appMode, setAppMode] = useState<AppMode>(loadSavedMode());
  const [isDark, setIsDark] = useState<boolean>(() => {
    // one-time: people who had switched to dark before keep dark
    if (!localStorage.getItem('office_theme_migrated')) {
      if (localStorage.getItem('office_theme') === 'dark' && !localStorage.getItem('office_theme_choice')) localStorage.setItem('office_theme_choice', 'dark');
      localStorage.setItem('office_theme_migrated', '1');
    }
    const saved = localStorage.getItem('office_theme_choice') || '';
    if (saved) return saved === 'dark';
    // follow the phone / computer setting until the person picks light or dark themselves
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
  });
  useEffect(() => {
    if (localStorage.getItem('office_theme_choice')) return;
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const on = () => { if (!localStorage.getItem('office_theme_choice')) setIsDark(mq.matches); };
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);

  // Database State
  const [employees, setEmployees] = useState<Employee[]>([]);
  // The built-in "Office Administrator" account is kept out of every stats / attendance screen.
  const statEmployees = useMemo(() => employees.filter((e) => e.id !== 'emp-101' && !e.isSuperAdmin), [employees]);
  const [shifts, setShifts] = useState<ShiftSchedule[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [ceoComments, setCeoComments] = useState<CeoComment[]>([]);
  const [settings, setSettings] = useState<OfficeSettings>(loadSettings());
  const [previewBetaEnabled, setPreviewBetaEnabled] = useState<boolean>(() => IS_VERCEL_PREVIEW && localStorage.getItem('office_preview_redesign_beta') === 'true');
  const betaEnabled = IS_VERCEL_PREVIEW ? previewBetaEnabled : settings.redesignedUiBetaEnabled === true;
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
  // Android phone app (or ?applogin=1 for a preview) gets the phone-style sign-in screen
  const useAppLogin = useMemo(() => isPhoneApp() || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('applogin') === '1'), []);
  const [siteDisabled, setSiteDisabled] = useState<boolean>(() => localStorage.getItem('office_site_disabled_v1') === 'true');
  // High-security face scan punch (admin turns it on in Office Settings; off by default)
  const [faceEnrolledIds, setFaceEnrolledIds] = useState<string[]>([]);
  const [locatingPunch, setLocatingPunch] = useState(false);
  const [faceStatusLoaded, setFaceStatusLoaded] = useState(false);
  const [enrollSelf, setEnrollSelf] = useState<{ employeeId: string; run: (() => void) | null } | null>(null);
  const enrollPromptShownRef = useRef<Set<string>>(new Set());
  const [faceRequest, setFaceRequest] = useState<{ employeeId: string; run: () => void } | null>(null);
  const [activeTab, setActiveTabState] = useState<ActiveDesktopTab>('clock');
  const [focusedRecordId, setFocusedRecordId] = useState<string | undefined>();
  const setActiveTab = (tab: ActiveDesktopTab, refId?: string) => {
    setFocusedRecordId(refId);
    setActiveTabState(tab);
  };
  useEffect(() => {
    const onSiteDisabled = () => { setSiteDisabled(true); setCurrentUser(null); };
    const onSiteEnabled = () => setSiteDisabled(false);
    const onSiteStatusChanged = (event: Event) => setSiteDisabled((event as CustomEvent<boolean>).detail === true);
    window.addEventListener('office-site-disabled', onSiteDisabled);
    window.addEventListener('office-site-enabled', onSiteEnabled);
    window.addEventListener('office-site-status-changed', onSiteStatusChanged);
    return () => { window.removeEventListener('office-site-disabled', onSiteDisabled); window.removeEventListener('office-site-enabled', onSiteEnabled); window.removeEventListener('office-site-status-changed', onSiteStatusChanged); };
  }, []);
  useEffect(() => {
    if (!currentUser || currentUser.isSuperAdmin) return;
    let active = true;
    const checkSiteAvailability = async () => {
      try {
        const response = await fetch(`/api/site-status?t=${Date.now()}`, { cache: 'no-store' });
        const data = await response.json();
        if (!active) return;
        if (data?.disabled === true) {
          localStorage.setItem('office_site_disabled_v1', 'true');
          clearSession();
          setSiteDisabled(true);
          setCurrentUser(null);
        } else if (data?.disabled === false) {
          localStorage.removeItem('office_site_disabled_v1');
          setSiteDisabled(false);
        }
      } catch { /* availability checks are retried on the next interval */ }
    };
    void checkSiteAvailability();
    const timer = window.setInterval(checkSiteAvailability, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [currentUser?.id, currentUser?.isSuperAdmin]);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState<boolean>(false);
  const [forcedPinChange, setForcedPinChange] = useState<boolean>(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(0);
  useEffect(() => { const on = () => setWhatsNewOpen((n) => n + 1); window.addEventListener('open-whats-new', on); return () => window.removeEventListener('open-whats-new', on); }, []);
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
    if (currentUser && activeTab === 'team-attendance' && !['admin', 'ceo'].includes(currentUser.role) && currentUser.teamPresenceAccess !== true) setActiveTab('clock');
  }, [currentUser, activeTab]);
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

    // Coming back to the app (phone app resumed, window focused): fetch the latest straight away.
    let lastResumeSync = 0;
    const syncOnResume = () => {
      if (!bootFinished || document.visibilityState !== 'visible' || Date.now() - lastResumeSync < 3000) return;
      lastResumeSync = Date.now();
      if (hasPendingCloudWrites()) { void flushPendingCloudWrites({ respectCooldown: true }); return; }
      void syncDatabaseFromServer(false).then((updated) => { if (updated) refreshFromLocal(true); }).catch(() => {});
    };
    document.addEventListener('visibilitychange', syncOnResume);
    window.addEventListener('focus', syncOnResume);
    window.addEventListener('online', syncOnResume);

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
      document.removeEventListener('visibilitychange', syncOnResume);
      window.removeEventListener('focus', syncOnResume);
      window.removeEventListener('online', syncOnResume);
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
    try { localStorage.setItem('office_theme_choice', isDark ? 'light' : 'dark'); } catch { /* ignore */ }
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
    if (takeMustChangePin()) { setForcedPinChange(true); setIsChangePasswordOpen(true); }
    saveSession(employee.id, keepLoggedIn, takePendingToken(employee.id));
    if (employee.isSuperAdmin) { setSiteDisabled(false); localStorage.removeItem('office_site_disabled_v1'); }
    // The pre-login endpoint returns only a safe directory projection. Fetch the full
    // authorized database snapshot immediately after the server has issued the session.
    void syncDatabaseFromServer(true).then((updated) => {
      if (updated && refreshFromLocalRef.current) refreshFromLocalRef.current(true);
    });
  };

  const handleLogout = () => {
    // phone app: stop this person's notifications on this phone
    try { (window as any).BahaarApp?.unregisterPush?.(); } catch { /* not the phone app */ }
    clearSession();
    setCurrentUser(null);
  };

  // Phone app home-screen widget: today's status and the right punch button.
  const myToday = currentUser ? records.find((r) => r.employeeId === currentUser.id && r.date === getTodayDateString()) : undefined;
  useEffect(() => {
    if (!currentUser?.id || appMode === 'kiosk') return;
    const r = myToday;
    const fmt = (t?: string | null) => (t ? formatTime12h(t) : '');
    if (r?.timeIn && !r.timeOut) updateWidget({ title: `Working since ${fmt(r.timeIn)}`, line: 'Tap Punch out when you finish', punchedIn: true, canPunch: true });
    else if (r?.timeOut) updateWidget({ title: `Day done · ${fmt(r.timeIn)} – ${fmt(r.timeOut)}`, line: 'See you tomorrow', punchedIn: false, canPunch: false });
    else updateWidget({ title: 'Not punched in yet', line: 'Tap Punch in when you reach the office', punchedIn: false, canPunch: true });
  }, [currentUser?.id, myToday?.timeIn, myToday?.timeOut, appMode]);
  const lastPunchRef = useRef<string>('');
  useEffect(() => {
    const key = `${myToday?.timeIn || ''}|${myToday?.timeOut || ''}`;
    if (lastPunchRef.current && lastPunchRef.current !== key) {
      haptic('success');
      // first punch-in of the month gets a small celebration
      const today = getTodayDateString();
      if (currentUser && myToday?.timeIn && !myToday.timeOut && !records.some((r) => r.employeeId === currentUser.id && r.date < today && r.date.slice(0, 7) === today.slice(0, 7) && r.timeIn)) {
        once(`celebrate-month-${currentUser.id}-${today.slice(0, 7)}`, () => celebrate(`First punch of ${new Date().toLocaleDateString('en-GB', { month: 'long' })}. Have a great month!`));
      }
    }
    lastPunchRef.current = key;
  }, [myToday?.timeIn, myToday?.timeOut]);

  // Sales target reached this month: celebrate once.
  const bizMe = CRM_ENABLED ? crm.data.business?.me : null;
  const bizMonth = CRM_ENABLED ? crm.data.business?.monthKey : '';
  useEffect(() => {
    if (!currentUser?.id || !bizMe || !(bizMe.target > 0) || bizMe.amount < bizMe.target) return;
    once(`celebrate-target-${currentUser.id}-${bizMonth}`, () => celebrate('Monthly sales target reached. Well done!'));
  }, [currentUser?.id, bizMe?.amount, bizMe?.target, bizMonth]);

  // Phone app: after sign-in, register this phone for notifications (also when the app is closed).
  useEffect(() => {
    if (!currentUser?.id || appMode === 'kiosk') return;
    const bridge = (window as any).BahaarApp;
    const token = getSessionToken();
    if (!bridge?.registerPush || !token) return;
    try { bridge.registerPush(token); } catch { /* older app without push */ }
  }, [currentUser?.id, appMode]);

  // -------------------------------------------------------------
  // Attendance Clock In / Out / Break Engine
  // -------------------------------------------------------------
  const handleTimeIn = (employeeId: string, notes?: string, loc?: PunchLocation) => {
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
        notes,
        clientIp: currentClientIp,
        deviceId,
        deviceName: deviceLabel,
        isDeviceMismatch: false,
        deviceMismatchReason: undefined,
        recordUpdatedAt: nowIso,
        lastEditedByRole: actorRole,
        actorAction: 'time_in',
        ...(loc ? { punchLocations: { ...(nextRecords[existingIdx].punchLocations || {}), in: loc } } : {}),
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
        ...(loc ? { punchLocations: { in: loc } } : {}),
      };
      nextRecords = [changedRecord, ...nextRecords];
    }

    recordsRef.current = nextRecords;
    setRecords(nextRecords);
    saveAttendanceRecords(nextRecords, changedRecord, actorRole);
  };

  const handleUpdatePunchNote = async (employeeId: string, notes: string): Promise<boolean> => {
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
      return saveAttendanceRecords(updatedRecords, changedRecord, actorRole);
    }
    return false;
  };

  const handleTimeOut = (employeeId: string, notes?: string, loc?: PunchLocation) => {
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
      notes,
      deviceId: currentRec.deviceId || deviceId,
      deviceName: currentRec.deviceName || deviceLabel,
      isDeviceMismatch: currentRec.isDeviceMismatch || isMismatch,
      deviceMismatchReason:
        currentRec.deviceMismatchReason ||
        (isMismatch ? `Punched out from unapproved device "${deviceLabel}"` : undefined),
      recordUpdatedAt: nowIso,
      lastEditedByRole: actorRole,
      actorAction: 'time_out',
      ...(loc ? { punchLocations: { ...(currentRec.punchLocations || {}), out: loc } } : {}),
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
    if (settings.faceScanPunchEnabled || settings.faceEnrollRequired || currentUser?.faceEnrollRequired || currentUser?.role === 'admin') refreshFaceStatus();
  }, [settings.faceScanPunchEnabled, settings.faceEnrollRequired, currentUser?.faceEnrollRequired, currentUser?.id, currentUser?.role]);

  /** Face set-up is required for everyone (office setting) or for this person (Employees → Edit). */
  const faceRequiredFor = (employeeId: string) =>
    Boolean(settings.faceEnrollRequired || employees.find((e) => e.id === employeeId)?.faceEnrollRequired);
  // Per-person rule: they cannot use the app until their face is set up (shown right after signing in).
  const mustEnrollNow = Boolean(
    currentUser?.faceEnrollRequired && appMode !== 'kiosk' && faceStatusLoaded && !faceEnrolledIds.includes(currentUser.id),
  );

  // When the admin requires every person to enroll their face, ask once after sign-in (and again at any punch).
  useEffect(() => {
    if (
      (settings.faceEnrollRequired || currentUser?.faceEnrollRequired) &&
      faceStatusLoaded &&
      currentUser?.id &&
      appMode !== 'kiosk' &&
      !faceEnrolledIds.includes(currentUser.id) &&
      !enrollPromptShownRef.current.has(currentUser.id)
    ) {
      enrollPromptShownRef.current.add(currentUser.id);
      setEnrollSelf({ employeeId: currentUser.id, run: null });
    }
  }, [settings.faceEnrollRequired, currentUser?.faceEnrollRequired, faceStatusLoaded, faceEnrolledIds, currentUser?.id, appMode]);

  const gatePunch = (employeeId: string, run: () => void) => {
    if (faceRequiredFor(employeeId) && !faceEnrolledIds.includes(employeeId)) {
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

  // Phone location check (admin switch): take the phone's location first, then the usual face / punch steps.
  const withPhoneLocation = (employeeId: string, run: (loc?: PunchLocation) => void) => {
    const emp = employees.find((e) => e.id === employeeId);
    if (appMode === 'kiosk' || !emp || !needsPhoneLocation(settings, emp)) { run(); return; }
    setLocatingPunch(true);
    void checkPunchLocation(settings, emp).then((verdict) => {
      setLocatingPunch(false);
      if (!verdict.ok) { alert(verdict.message); return; }
      run(verdict.loc);
    });
  };
  const handleGatedTimeIn = (id: string, notes?: string) => withPhoneLocation(id, (loc) => gatePunch(id, () => handleTimeIn(id, notes, loc)));
  const handleGatedTimeOut = (id: string, notes?: string) => withPhoneLocation(id, (loc) => gatePunch(id, () => handleTimeOut(id, notes, loc)));
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
      <AppUpdateWatcher />
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
        useAppLogin ? (
          <AppLoginView
            employees={employees}
            onLogin={handleLogin}
            companyName={settings.companyName}
            isSyncing={isInitialCloudSyncing}
            siteDisabled={siteDisabled}
          />
        ) : <LoginView
          employees={employees}
          onLogin={handleLogin}
          companyName={settings.companyName}
          isSyncing={isInitialCloudSyncing}
          siteDisabled={siteDisabled}
        />
      ) : (
        <div className={`app-reveal flex-1 flex flex-col ${betaEnabled && activeTab !== 'clock' ? 'min-h-screen workforce-redesign-beta' : 'min-h-[calc(100vh-2.5rem)]'} min-w-0 w-full overflow-x-clip`}>
          {/* Header */}
          <DesktopHeader
            currentUser={currentUser}
            activeTab={activeTab}
            onLogout={handleLogout}
            onSwitchToKiosk={() => handleToggleMode('kiosk')}
            ceoComments={ceoComments}
            onMarkCeoCommentRead={handleMarkCeoCommentRead}
            onOpenChangePassword={() => setIsChangePasswordOpen(true)}
            onOpenProfile={(currentUser.isSuperAdmin === true || currentUser.featureAccess?.['employee-profile'] !== false) ? () => setActiveTab('employee-profile') : undefined}
            showAvatar={settings.employeeUniverseBetaEnabled === true}
            isNetworkOnline={isNetworkOnline}
            cloudSyncState={cloudSyncState}
            onRetrySync={() => void retryCloudOutboxNow()}
            onOpenMobileNav={() => setIsMobileNavOpen(true)}
            crmUnread={CRM_ENABLED ? crm.badges.unreadTotal : 0}
            crmLatest={CRM_ENABLED ? crm.badges.unreadLatest : []}
            onCrmRefresh={CRM_ENABLED ? () => void crm.refresh() : undefined}
            onOpenCrmNotifications={CRM_ENABLED ? () => setActiveTab('crm-notifications') : undefined}
            onOpenCrmRecord={setActiveTab}
            isDark={isDark}
            onToggleTheme={handleToggleTheme}
            redesignedUiBetaEnabled={betaEnabled}
            headerBetaEnabled={settings.headerBetaEnabled === true}
          />

          {CRM_ENABLED && !forcedPinChange && <WhatsNewWalkthrough currentUser={currentUser} onNavigate={(t) => setActiveTab(t)} openRequest={whatsNewOpen} />}
          {CRM_ENABLED && <AnnouncementPopup trigger={(crm.badges.unreadLatest || []).filter((n) => String(n.refId || '').startsWith('ann-')).map((n) => n.refId).join(',') || currentUser.id} />}
          <PhoneShell
            currentUser={currentUser}
            activeTab={activeTab}
            onSelectTab={(t) => setActiveTab(t)}
            onOpenRecord={(t, ref) => setActiveTab(t, ref)}
            onOpenMore={() => setIsMobileNavOpen(true)}
            unread={CRM_ENABLED ? crm.badges.unreadTotal : 0}
            online={isNetworkOnline}
            onRefresh={async () => {
              const updated = await syncDatabaseFromServer(true);
              if (updated && refreshFromLocalRef.current) refreshFromLocalRef.current(true);
              if (CRM_ENABLED) await crm.refresh();
            }}
            leaves={leaves}
            employees={employees}
            onReviewLeave={(id, status) => handleReviewLeave(id, status)}
            blockScreenshots={settings.blockScreenshots === true}
            latest={CRM_ENABLED ? crm.badges.unreadLatest : []}
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
              {currentUser&&!pageEnabled(currentUser,activeTab)?<div className="mx-auto max-w-xl rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-900">Access to this page has been disabled by your Super Admin.</div>:<div key={activeTab} className="page-enter min-w-0">
                <PageHero
                  tab={activeTab}
                  name={currentUser?.name || ''}
                  characterId={currentUser?.gameCharacterId}
                  appearance={currentUser?.avatarAppearance}
                  petId={currentUser?.gamePetId}
                  employeeUniverseEnabled={settings.employeeUniverseBetaEnabled === true}
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
                <PunchClockTab
                  belowPunch={<div className="grid gap-4 lg:grid-cols-2" data-below-punch><MyWeekCard records={records} employeeId={currentUser.id} shift={shifts.find((sh) => sh.id === currentUser.shiftId)} business={CRM_ENABLED ? crm.data.business : null} /><TaskBoard /></div>}
                  desk={currentUser && settings.employeeUniverseBetaEnabled === true ? <PersonalDesk compact employee={currentUser} record={records.find(r=>r.employeeId===currentUser.id && r.date===getTodayDateString())} settings={settings} online={isNetworkOnline}/> : null}
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

              {activeTab === 'my-attendance' && (<>
                {settings.employeeUniverseBetaEnabled === true && <div className="mb-3 w-48"><StatsAvatar id={currentUser.gameCharacterId||'human-1'} appearance={currentUser.avatarAppearance} animated label={currentUser.name+' · attendance avatar'}/></div>}
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
                /></>
              )}

              {activeTab === 'employee-profile' && currentUser && <EmployeeProfileTab beta={settings.employeeUniverseBetaEnabled===true} employee={currentUser} onOpenChangePassword={() => setIsChangePasswordOpen(true)} onSaved={(profile) => {
                setCurrentUser(user => user ? {...user,...profile} : user);
                setEmployees(list => list.map(employee => employee.id===currentUser.id ? {...employee,...profile} : employee));
              }} />}
              {activeTab === 'employee-profile' && currentUser && <PhoneAppSettings />}
              {activeTab === 'employee-profile' && currentUser && <ThemePicker />}

              {CRM_ENABLED && (activeTab === 'crm-customers' || activeTab === 'crm-tasks' || activeTab === 'crm-meetings' || activeTab === 'crm-inventory' || activeTab === 'crm-sales' || activeTab === 'crm-purchases' || activeTab === 'crm-invoices' || activeTab === 'crm-receipts' || activeTab === 'crm-portal' || activeTab === 'crm-notifications' || activeTab === 'crm-payment-tree' || activeTab === 'crm-media' || activeTab === 'crm-profit') && (
                <CrmPage section={activeTab} crm={crm} employees={statEmployees} currentUser={currentUser} onNavigate={setActiveTab} focusId={focusedRecordId} onClearFocus={() => setFocusedRecordId(undefined)} customerPortalBetaEnabled={settings.customerPortalBetaEnabled !== false} />
              )}

              {activeTab === 'live-dashboard' && currentUser && (['admin', 'ceo'].includes(currentUser.role) || currentUser.liveDashboardAccess) && (
                <LiveDashboardTab
                  settings={settings} online={isNetworkOnline}
                  currentUser={currentUser}
                  employees={statEmployees}
                  records={records}
                  shifts={shifts}
                  leaves={leaves}
                  crm={crm}
                  onNavigate={setActiveTab}
                  redesignedUiBetaEnabled={betaEnabled}
                  employeeUniverseEnabled={settings.employeeUniverseBetaEnabled === true}
                />
              )}

              {activeTab === 'leaves' && (
                <LeaveManagementTab
                  currentUser={currentUser}
                  employees={statEmployees}
                  leaves={leaves}
                  onApplyLeave={handleApplyLeave}
                  onReviewLeave={handleReviewLeave}
                  annualAllowance={Number(settings.annualLeaveDays) || 14}
                  onChangeAllowance={(days) => handleUpdateSettings({ ...settings, annualLeaveDays: days })}
                />
              )}

              {/* Team Attendance & Office Presence (P/A) - Accessible by All Employees */}
              {activeTab === 'team-attendance' && (['admin', 'ceo'].includes(currentUser.role) || currentUser.teamPresenceAccess === true) && (
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
                  employees={statEmployees}
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
                  employeeUniverseEnabled={settings.employeeUniverseBetaEnabled === true}
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
                    leaves={leaves}
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
              {currentUser.isSuperAdmin&&activeTab==='superadmin'&&<SuperAdminTab/>}
                  </Suspense>
              </ErrorBoundary>
              {CRM_ENABLED && <LiveAlerts crm={crm} onOpen={setActiveTab} />}
              {CRM_ENABLED && <AccountsAckReminder crm={crm} onOpen={setActiveTab} />}
              {currentUser && <DirectivePopup comments={ceoComments} userId={currentUser.id} onRead={handleMarkCeoCommentRead} />}
      <QuickJump currentUser={currentUser} crmEnabled={CRM_ENABLED} onSelectTab={setActiveTab} />
      {currentUser && settings.employeeUniverseBetaEnabled === true && (
        <Suspense fallback={null}><EmployeeUniverse
          chatEnabled={currentUser.isSuperAdmin === true || currentUser.featureAccess?.['employee-universe'] !== false}
          currentUser={currentUser}
          employees={statEmployees}
          onProfileSaved={(gameCharacterId, gamePetId, avatarAppearance) => {
            setCurrentUser((user) => user ? { ...user, gameCharacterId, avatarAppearance, gamePetId: gamePetId === 'none' ? undefined : gamePetId } : user);
            setEmployees((list) => list.map((employee) => employee.id === currentUser.id ? { ...employee, gameCharacterId, avatarAppearance, gamePetId: gamePetId === 'none' ? undefined : gamePetId } : employee));
          }}
        /></Suspense>
      )}
            </div>}
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

      {/* Per-person rule: nothing else can be used until the face is set up */}
      {mustEnrollNow && !enrollSelf && (
        <div className="fixed inset-0 z-[120] bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" data-face-gate>
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 p-6 text-center space-y-4 shadow-2xl">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center text-3xl">🙂</div>
            <h2 className="text-lg font-black text-slate-900 dark:text-slate-100">Set up your face to continue</h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">Your administrator requires a face set-up for your account before you can use the office app. It takes a few seconds, once.</p>
            <button type="button" className="w-full rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold py-3 cursor-pointer" onClick={() => currentUser && setEnrollSelf({ employeeId: currentUser.id, run: null })} data-face-gate-start>Set up my face</button>
            <button type="button" className="w-full rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-semibold py-2.5 cursor-pointer" onClick={handleLogout}>Sign out</button>
          </div>
        </div>
      )}
      {locatingPunch && (
        <div className="fixed inset-x-0 top-20 z-[110] flex justify-center pointer-events-none" role="status">
          <div className="rounded-full bg-slate-900/90 text-white text-sm font-semibold px-4 py-2 shadow-xl inline-flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" /> Checking your location…</div>
        </div>
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
          onClose={() => { setIsChangePasswordOpen(false); setForcedPinChange(false); }}
          currentUser={currentUser}
          onUpdatePin={handleUpdatePin}
          forced={forcedPinChange}
        />
      )}
    </div>
  );
}
