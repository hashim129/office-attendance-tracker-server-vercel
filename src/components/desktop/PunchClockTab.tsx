import React, { useState, useEffect, useMemo } from 'react';
import {
  Clock,
  Coffee,
  LogIn,
  LogOut,
  Calendar,
  AlertCircle,
  Timer,
  Info,
  Wifi,
  WifiOff,
  ShieldAlert,
  ShieldCheck,
  Save,
  Check,
  MessageSquare,
  Crown,
  Terminal,
  Download,
  Home,
  Users,
  Search,
  Sparkles,
} from 'lucide-react';
import {
  AttendanceRecord,
  CeoComment,
  Employee,
  OfficeSettings,
  ShiftSchedule,
} from '../../types';
import {
  calculateBreaksDuration,
  calculateWorkedMinutes,
  deriveLiveAttendanceState,
  formatMinutesToHoursMinutes,
  formatTime12h,
  getDayName,
  getShiftEndWindowMs,
  getTodayDateString,
  isLateArrival,
  parseTimeToMinutes,
  playPunchSound,
} from '../../lib/attendanceCalculations';
import { crmCall } from '../../crm/crmApi';
import { verifyOfficeIpAccess } from '../../lib/ipSecurity';
import {
  canEmployeeAutoPunch,
  downloadAutoStartScriptForUser,
} from '../../lib/autoStartScript';

interface CoworkerPresenceItem {
  employee: Employee;
  record: AttendanceRecord | undefined;
  status: 'in' | 'offline' | 'break' | 'out' | 'absent';
  elapsedMins: number;
}

interface PunchClockTabProps {
  currentUser: Employee;
  allEmployees?: Employee[];
  shifts: ShiftSchedule[];
  records: AttendanceRecord[];
  onTimeIn: (employeeId: string, notes?: string) => void;
  onTimeOut: (employeeId: string, notes?: string) => void;
  onStartBreak: (employeeId: string, type: 'lunch' | 'coffee' | 'short_break') => void;
  onEndBreak: (employeeId: string) => void;
  onUpdatePunchNote?: (employeeId: string, notes: string) => void;
  settings: OfficeSettings;
  currentClientIp?: string;
  currentClientIsp?: string;
  alternateIp?: string;
  isNetworkOnline?: boolean;
  ceoComments?: CeoComment[];
  onMarkCeoCommentRead?: (commentId: string) => void;
  onOpenChangePassword?: () => void;
}

export const PunchClockTab: React.FC<PunchClockTabProps> = ({
  currentUser,
  allEmployees = [],
  shifts,
  records,
  onTimeIn,
  onTimeOut,
  onStartBreak,
  onEndBreak,
  onUpdatePunchNote,
  settings,
  currentClientIp = 'Detecting...',
  currentClientIsp = 'Unknown ISP',
  alternateIp,
  isNetworkOnline = true,
  ceoComments = [],
  onMarkCeoCommentRead,
  onOpenChangePassword,
}) => {
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [actionNotes, setActionNotes] = useState<string>('');
  const [showNoteInput, setShowNoteInput] = useState<boolean>(false);
  const [noteSavedFeedback, setNoteSavedFeedback] = useState<boolean>(false);
  const [batDownloaded, setBatDownloaded] = useState<boolean>(false);
  const [verifyingWork, setVerifyingWork] = useState<boolean>(false);
  const [workVerifiedAt, setWorkVerifiedAt] = useState<string | null>(null);

  const canPersonalAutoStart = canEmployeeAutoPunch(currentUser, settings);

  const handleDownloadAutoStartBat = async () => {
    await downloadAutoStartScriptForUser({ employee: currentUser, settings });
    setBatDownloaded(true);
    setTimeout(() => setBatDownloaded(false), 3000);
  };

  // Live timer interval
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const todayStr = getTodayDateString();
  const dayName = getDayName(todayStr);
  const userShift = shifts.find((s) => s.id === currentUser.shiftId) || shifts[0];

  // Find today's record for this employee
  const todayRecord = records.find(
    (r) => r.employeeId === currentUser.id && r.date === todayStr
  );

  // Sync existing note into actionNotes state
  useEffect(() => {
    if (todayRecord?.notes !== undefined) {
      setActionNotes(todayRecord.notes || '');
    }
  }, [todayRecord?.notes]);

  // Today's Coworker Live Presence (Specific Day Only)
  const [coworkerSearch, setCoworkerSearch] = useState<string>('');
  const [coworkerFilter, setCoworkerFilter] = useState<'all' | 'in' | 'offline' | 'break' | 'out' | 'absent'>('all');

  const coworkerPresenceList: CoworkerPresenceItem[] = useMemo(() => {
    const list = (allEmployees && allEmployees.length > 0 ? allEmployees : [currentUser])
      .filter((e: Employee) => e.isActive)
      .sort((a: Employee, b: Employee) => a.name.localeCompare(b.name));

    return list.map((emp: Employee): CoworkerPresenceItem => {
      const rec = records.find((r: AttendanceRecord) => r.employeeId === emp.id && r.date === todayStr);
      let status: 'in' | 'offline' | 'break' | 'out' | 'absent' = 'absent';
      let elapsedMins = 0;

      if (rec?.timeIn) {
        if (rec.timeOut) {
          status = 'out';
          const calc = calculateWorkedMinutes(rec.timeIn, rec.timeOut, rec.breaks);
          elapsedMins = calc.totalWorkedMinutes;
        } else if (Array.isArray(rec.breaks) && rec.breaks.some((b) => !b.end)) {
          status = 'break';
        } else {
          status = 'in';
          // Signed in but nothing heard from their browser / Windows app lately → show as offline (never for yourself).
          if (
            emp.id !== currentUser.id &&
            deriveLiveAttendanceState({ record: rec, settings, todayStr, nowMs: currentTime.getTime() }) === 'no_internet'
          ) {
            status = 'offline';
          }
          const inM = parseTimeToMinutes(rec.timeIn);
          const now = currentTime;
          const nowM = now.getHours() * 60 + now.getMinutes();
          const raw = nowM >= inM ? nowM - inM : 24 * 60 - inM + nowM;
          const breakM = calculateBreaksDuration(rec.breaks);
          elapsedMins = Math.max(0, raw - breakM);
        }
      }

      return {
        employee: emp,
        record: rec,
        status,
        elapsedMins,
      };
    });
  }, [allEmployees, currentUser, records, todayStr, currentTime, settings]);

  const filteredCoworkers = useMemo<CoworkerPresenceItem[]>(() => {
    return coworkerPresenceList.filter((item: CoworkerPresenceItem) => {
      if (coworkerFilter !== 'all' && item.status !== coworkerFilter) return false;
      if (coworkerSearch.trim()) {
        const q = coworkerSearch.toLowerCase();
        const matchesName = item.employee.name.toLowerCase().includes(q);
        const matchesDept = (item.employee.department || '').toLowerCase().includes(q);
        const matchesCode = (item.employee.employeeCode || '').toLowerCase().includes(q);
        if (!matchesName && !matchesDept && !matchesCode) return false;
      }
      return true;
    });
  }, [coworkerPresenceList, coworkerFilter, coworkerSearch]);

  const coworkerCounts = useMemo(() => {
    let inCount = 0;
    let offlineCount = 0;
    let breakCount = 0;
    let outCount = 0;
    let absentCount = 0;
    coworkerPresenceList.forEach((c: CoworkerPresenceItem) => {
      if (c.status === 'in') inCount++;
      else if (c.status === 'offline') offlineCount++;
      else if (c.status === 'break') breakCount++;
      else if (c.status === 'out') outCount++;
      else absentCount++;
    });
    return {
      total: coworkerPresenceList.length,
      present: inCount + offlineCount + breakCount + outCount,
      in: inCount,
      offline: offlineCount,
      break: breakCount,
      out: outCount,
      absent: absentCount,
    };
  }, [coworkerPresenceList]);

  const liveState = deriveLiveAttendanceState({
    record: todayRecord,
    settings,
    todayStr,
    isCurrentUserOffline: !isNetworkOnline,
    isCurrentUserConnected: isNetworkOnline,
  });
  const isClockedIn = !!todayRecord && !!todayRecord.timeIn && !todayRecord.timeOut;
  const isCompleted = liveState === 'out';
  const activeBreak = todayRecord?.breaks?.find((b) => !b.end);
  const isOnBreak = liveState === 'break';
  const isNoInternet = liveState === 'no_internet';

  // Office Wi-Fi IP Security Check
  const ipCheck = verifyOfficeIpAccess(currentClientIp, settings, currentUser, currentClientIsp, alternateIp);
  const isPunchBlockedByIp = !ipCheck.allowed;
  // Allowed only because of the Work From Home permission: this punch becomes a separate "Work From Home" shift.
  const isRemoteWfhPunch = Boolean(ipCheck.remote) && !todayRecord?.timeIn;
  const wfhReasonMissing = isRemoteWfhPunch && actionNotes.trim().length < 3;
  const isPunchBlocked = isPunchBlockedByIp;
  // Network, connection and automation details are for administrators only; staff just punch in and out.
  const isAdminUser = currentUser.role === 'admin';

  const graceHours = Number(settings.autoPunchOutOnInactiveHours ?? 2) || 2;
  const effectiveConfirmedMs = useMemo(() => {
    const raw = workVerifiedAt || todayRecord?.workConfirmedAt;
    return raw ? Date.parse(raw) : NaN;
  }, [workVerifiedAt, todayRecord?.workConfirmedAt]);

  const shiftWindow = useMemo(() => {
    if (!todayRecord?.timeIn || todayRecord.timeOut) return null;
    return getShiftEndWindowMs(todayRecord.date, todayRecord.timeIn, userShift, graceHours, effectiveConfirmedMs);
  }, [todayRecord?.date, todayRecord?.timeIn, todayRecord?.timeOut, userShift, graceHours, effectiveConfirmedMs]);

  const nowMs = currentTime.getTime();
  const isFinalVerificationDue = Boolean(
    isClockedIn &&
    shiftWindow &&
    !userShift?.isNoRestriction &&
    Number.isFinite(shiftWindow.verifyAtMs) &&
    nowMs >= shiftWindow.verifyAtMs - 15 * 60 * 1000
  );
  // Right after the shift ends, ask whether the person is staying for extra hours (a click pauses the automatic punch-out).
  const isShiftEndAsk = Boolean(
    isClockedIn &&
    shiftWindow &&
    !userShift?.isNoRestriction &&
    Number.isFinite(shiftWindow.shiftEndMs) &&
    nowMs >= shiftWindow.shiftEndMs &&
    !(Number.isFinite(effectiveConfirmedMs) && effectiveConfirmedMs >= shiftWindow.shiftEndMs)
  );
  const isOvertimeVerificationDue = isFinalVerificationDue || isShiftEndAsk;
  const verifyMinsRemaining = shiftWindow && Number.isFinite(shiftWindow.checkAtMs)
    ? Math.max(0, Math.ceil((shiftWindow.checkAtMs - nowMs) / 60000))
    : 0;

  const handleConfirmStillWorking = async () => {
    if (verifyingWork) return;
    setVerifyingWork(true);
    try {
      const res = await crmCall<{ confirmedAt?: string }>('work_confirm');
      setWorkVerifiedAt(res?.confirmedAt || new Date().toISOString());
    } catch (err: any) {
      alert(err?.message || 'Could not verify working status. Please try again.');
    } finally {
      setVerifyingWork(false);
    }
  };

  // Calculate live elapsed seconds for work and break
  const getElapsedTimeString = (startTimeStr: string): string => {
    const startMins = parseTimeToMinutes(startTimeStr);
    const nowMins = currentTime.getHours() * 60 + currentTime.getMinutes();
    const diffMins = Math.max(0, nowMins - startMins);
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    const secs = currentTime.getSeconds();
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleTimeInClick = () => {
    if (isPunchBlockedByIp) {
      alert(ipCheck.reason || 'Access Denied: Connect to Authorized Office Wi-Fi to mark attendance.');
      return;
    }
    if (todayRecord?.timeIn) {
      alert(`Daily Limit: You have already punched Time In for today at ${formatTime12h(todayRecord.timeIn)}. Employees are permitted only ONE clock-in per day.`);
      return;
    }

    if (wfhReasonMissing) {
      alert('Work From Home: please write the Reason for Working from Home in the Note box before you punch in.');
      return;
    }

    playPunchSound('in');
    onTimeIn(currentUser.id, actionNotes.trim() || undefined);
    setShowNoteInput(false);
  };

  const handleTimeOutClick = () => {
    if (isPunchBlockedByIp) {
      alert(ipCheck.reason || 'Access Denied: Connect to Authorized Office Wi-Fi to mark attendance.');
      return;
    }
    if (confirm('Confirm Clock Out for today? Once clocked out, your shift for today will be complete.')) {
      playPunchSound('out');
      onTimeOut(currentUser.id, actionNotes.trim() || undefined);
      setShowNoteInput(false);
    }
  };

  const handleBreakToggle = () => {
    if (isPunchBlockedByIp) {
      alert(ipCheck.reason || 'Access Denied: Connect to Authorized Office Wi-Fi to mark attendance.');
      return;
    }
    if (isOnBreak) {
      playPunchSound('break');
      onEndBreak(currentUser.id);
    } else {
      playPunchSound('break');
      onStartBreak(currentUser.id, 'lunch');
    }
  };

  const handleSaveNoteRealTime = () => {
    if (!onUpdatePunchNote) return;
    onUpdatePunchNote(currentUser.id, actionNotes.trim());
    setNoteSavedFeedback(true);
    setTimeout(() => setNoteSavedFeedback(false), 2500);
  };

  const formattedDigitalClock = currentTime.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  const formattedDate = currentTime.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const myDirectives = (ceoComments || []).filter(
    (c) => c.employeeId === currentUser.id && !c.isRead
  );

  const greetingWord = currentTime.getHours() < 12 ? 'Good morning' : currentTime.getHours() < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = (currentUser.name || '').trim().split(/\s+/)[0] || 'there';
  const greetingLine = todayRecord?.timeOut
    ? `You wrapped up at ${formatTime12h(todayRecord.timeOut)}. Great work today, rest well!`
    : todayRecord?.timeIn
    ? `You have been clocked in since ${formatTime12h(todayRecord.timeIn)}. Keep up the good work!`
    : userShift?.startTime
    ? `Your shift starts at ${formatTime12h(userShift.startTime)}. Press Time In when you are ready.`
    : 'Press Time In when you are ready to start your day.';

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Friendly greeting */}
      <div className="rounded-2xl p-4 sm:p-5 bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 text-white shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg sm:text-xl font-bold leading-tight">{greetingWord}, {firstName}!</h2>
          <p className="text-xs sm:text-sm text-blue-100 mt-0.5">{greetingLine}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold shrink-0">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 border border-white/20">
            <span className="w-2 h-2 rounded-full bg-emerald-300 animate-pulse" />
            {coworkerCounts.in} online now
          </span>
          {coworkerCounts.offline > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 border border-white/20">
              <span className="w-2 h-2 rounded-full bg-slate-300" />
              {coworkerCounts.offline} offline
            </span>
          )}
        </div>
      </div>

      {/* Unread Executive Directives Banner */}
      {myDirectives.length > 0 && (
        <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/60 border-2 border-amber-300 dark:border-amber-700 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200 font-bold text-xs">
              <Crown className="w-4 h-4 text-amber-600" />
              <span>Executive Directives & Mentions ({myDirectives.length})</span>
            </div>
            <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium uppercase tracking-wider">
              Immediate Action
            </span>
          </div>
          <div className="space-y-2">
            {myDirectives.map((comment) => (
              <div
                key={comment.id}
                className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800 flex items-start justify-between gap-3 shadow-2xs"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      {comment.fromName} ({comment.fromRole.toUpperCase()})
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {new Date(comment.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-xs text-slate-700 dark:text-slate-300 font-medium">
                    "{comment.message}"
                  </p>
                </div>
                {onMarkCeoCommentRead && (
                  <button
                    onClick={() => onMarkCeoCommentRead(comment.id)}
                    className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/40 dark:hover:bg-amber-900/60 text-amber-800 dark:text-amber-200 text-xs font-bold transition-colors cursor-pointer"
                    title="Acknowledge directive"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Acknowledge</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Banner: Welcome & Live Windows Clock */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-xs border border-slate-200 dark:border-slate-800 flex flex-col md:flex-row items-center justify-between gap-6">
        <div>
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-emerald-100/90 dark:bg-emerald-950/80 border-2 border-emerald-400 dark:border-emerald-600 shadow-2xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-black text-emerald-900 dark:text-emerald-200">
              {formattedDate}
            </span>
            <span className="text-emerald-500 font-bold">•</span>
            <span className="text-xs font-black text-emerald-800 dark:text-emerald-300 uppercase tracking-wide">
              {dayName}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-2">
            Welcome back, {currentUser.name}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Assigned Shift: <strong className="text-slate-700 dark:text-slate-300">{userShift.name}</strong>
            {userShift.isNoRestriction ? (
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                24/7 Flexible · No Shift Restriction
              </span>
            ) : (
              <span> ({formatTime12h(userShift.startTime)} – {formatTime12h(userShift.endTime)}) · {userShift.graceMinutes}m grace period</span>
            )}
          </p>
          {isAdminUser && currentUser.allowWorkFromHome && (
            <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-700/70 text-emerald-800 dark:text-emerald-200 text-xs font-semibold shadow-2xs">
              <Home className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>{isRemoteWfhPunch ? 'Work From Home shift · Reason note required' : 'Work From Home allowed · counted separately when you are off the office network'}</span>
            </div>
          )}
        </div>

        {/* Big Live Digital Clock Display */}
        <div className="bg-slate-950 text-white dark:bg-black rounded-xl px-6 py-4 border border-slate-800 shadow-inner flex flex-col items-center">
          <span className="text-[10px] font-mono tracking-widest text-slate-400 uppercase">
            Office Server Time
          </span>
          <div className="text-3xl sm:text-4xl font-mono font-bold tracking-wider text-blue-400 mt-0.5 tabular-nums">
            {formattedDigitalClock}
          </div>
          <span className="text-[11px] text-emerald-400 font-bold mt-1 tracking-wide">
            {dayName} · Live Sync
          </span>
        </div>
      </div>

      {/* Main Punch Interaction Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Punch Clock Card */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-xs border border-slate-200 dark:border-slate-800 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-600" />
              <span>Shift Attendance Punch</span>
            </h2>

            {/* Current State Indicator */}
            <div>
              {isOnBreak ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                  <Coffee className="w-3.5 h-3.5" />
                  <span>On Lunch Break</span>
                </span>
              ) : isNoInternet ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200 border border-amber-300 dark:border-amber-700">
                  <WifiOff className="w-3.5 h-3.5 animate-pulse" />
                  <span>No Internet · Still In</span>
                </span>
              ) : isClockedIn ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>Clocked In (Active)</span>
                </span>
              ) : isCompleted ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Shift Completed (1 Punch / Day)</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                  <span>Not Clocked In Today</span>
                </span>
              )}
            </div>
          </div>

          {/* Active Counters if Clocked In */}
          {isClockedIn && (
            <div className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800">
              <div>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">
                  Time In Recorded
                </span>
                <p className="text-xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-0.5">
                  {formatTime12h(todayRecord?.timeIn)}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {todayRecord?.status === 'late' ? (
                    <span className="text-amber-600 dark:text-amber-400 font-medium">
                      Late Arrival (Past {userShift.graceMinutes}m grace)
                    </span>
                  ) : (
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                      On-Time Arrival
                    </span>
                  )}
                </p>
              </div>

              <div>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">
                  {isOnBreak ? 'Active Break Duration' : 'Elapsed Shift Duration'}
                </span>
                <p className="text-xl font-bold font-mono text-blue-600 dark:text-blue-400 mt-0.5 tabular-nums">
                  {isOnBreak && activeBreak
                    ? getElapsedTimeString(activeBreak.start)
                    : todayRecord?.timeIn
                    ? getElapsedTimeString(todayRecord.timeIn)
                    : '00:00:00'}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Target: {userShift.expectedHours} hours
                </p>
              </div>
            </div>
          )}

          {/* Separate Live Attendance & Connection Status Bar (admin only) */}
          {isAdminUser && (
          <div
            className={`p-3 rounded-xl border flex items-start justify-between gap-3 ${
              isNoInternet
                ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200'
                : isOnBreak
                ? 'bg-amber-50/70 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200'
                : isClockedIn
                ? 'bg-emerald-50/80 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200'
            }`}
          >
            <div className="flex items-start gap-2.5">
              {isNoInternet ? (
                <WifiOff className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5 animate-pulse" />
              ) : isOnBreak ? (
                <Coffee className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              ) : (
                <Wifi className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              )}
              <div className="text-xs">
                <div className="font-bold">
                  {isNoInternet
                    ? 'Attendance Status: Device Internet Disconnected — Offline (Still In)'
                    : isOnBreak
                    ? 'Attendance Status: On Break (Timer Active)'
                    : isClockedIn
                    ? 'Attendance Status: Connected Online · Clocked In & Working'
                    : isCompleted
                    ? `Attendance Status: Shift Completed (Punched Out at ${formatTime12h(todayRecord?.timeOut)})`
                    : 'Attendance Status: Connected Online · Ready to Punch In'}
                </div>
                <p className="text-[11px] opacity-90 mt-0.5">
                  {isNoInternet
                    ? `You remain marked Clocked In while reconnecting. You are automatically logged out ${settings.autoPunchOutOnInactiveHours ?? 2}h after your shift ends.`
                    : `Live internet connected · You are automatically logged out ${settings.autoPunchOutOnInactiveHours ?? 2}h after your shift ends.`}
                </p>
              </div>
            </div>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded border shrink-0 uppercase tracking-wider ${
                isNetworkOnline
                  ? 'bg-emerald-100/90 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700'
                  : 'bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-700'
              }`}
            >
              {isNetworkOnline ? 'Online' : 'Offline'}
            </span>
          </div>
          )}

          {/* Security Status Banners */}
          <div className="space-y-2">
            {/* 1. Office Wi-Fi Public IP Verification Banner */}
            {settings.enforceOfficeIpLock && (
              isPunchBlockedByIp ? (
                /* Everyone sees the blocked message, but employees don't see raw IP */
                <div className="p-3 rounded-xl border flex items-start justify-between gap-3 bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900/60 text-rose-800 dark:text-rose-200">
                  <div className="flex items-start gap-2.5">
                    <ShieldAlert className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                    <div className="text-xs">
                      <div className="font-bold">Attendance Locked — Unauthorized Network</div>
                      <p className="text-[11px] opacity-90 mt-0.5">
                        {isAdminUser
                          ? ipCheck.reason
                          : 'Please connect to the authorized Office Wi-Fi network to mark attendance.'}
                      </p>
                    </div>
                  </div>
                  {isAdminUser && (
                    <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-white/80 dark:bg-slate-900/80 border border-current/20 shrink-0">
                      IP: {currentClientIp}
                      {currentClientIsp && currentClientIsp !== 'Unknown ISP' && currentClientIsp !== 'Detected via IP' ? ` · ${currentClientIsp}` : ''}
                    </span>
                  )}
                </div>
              ) : (
                /* Verified — only admin/CEO see the full green banner with IP */
                isAdminUser && (
                  <div className="p-3 rounded-xl border flex items-start justify-between gap-3 bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-200">
                    <div className="flex items-start gap-2.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                      <div className="text-xs">
                        <div className="font-bold">
                          {`Verified Office Wi-Fi (${ipCheck.matchedLabel || 'Authorized Office Network'})`}
                        </div>
                        <p className="text-[11px] opacity-90 mt-0.5">
                          Your connection matches an authorized Office Wi-Fi network.
                        </p>
                      </div>
                    </div>
                    <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-white/80 dark:bg-slate-900/80 border border-current/20 shrink-0">
                      IP: {currentClientIp}
                      {currentClientIsp && currentClientIsp !== 'Unknown ISP' && currentClientIsp !== 'Detected via IP' ? ` · ${currentClientIsp}` : ''}
                    </span>
                  </div>
                )
              )
            )}
          </div>

          {/* Action Buttons */}
          <div className="space-y-4 pt-1">
            {isOvertimeVerificationDue && !todayRecord?.timeOut && (
              <div className="p-3.5 rounded-xl border-2 border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/50 text-amber-950 dark:text-amber-100 space-y-2.5 shadow-xs">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-xs space-y-1">
                    <p className="font-bold">
                      {isFinalVerificationDue ? `Overtime Verification (${graceHours}h After Shift End) — Are you currently working?` : 'Your shift has ended — are you working extra hours?'}
                    </p>
                    <p className="text-[11px] text-amber-800 dark:text-amber-200">
                      {isFinalVerificationDue
                        ? <>Please verify if you are still actively working on overtime. If not verified within <b>{verifyMinsRemaining} min</b>, the system will automatically punch you out and record your overtime separately under auto punch-out remarks.</>
                        : <>Press “Yes” to stay punched in — the automatic punch-out is paused and you will be asked again after {graceHours} hours. If you are finished, punch out now.</>}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={verifyingWork}
                    onClick={handleConfirmStillWorking}
                    className="px-3.5 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer disabled:opacity-60"
                  >
                    {verifyingWork ? 'Verifying…' : '✓ Yes, I Am Currently Working (Continue Overtime)'}
                  </button>
                  <button
                    type="button"
                    onClick={handleTimeOutClick}
                    className="px-3.5 py-2 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white cursor-pointer"
                  >
                    No, Punch Out Now
                  </button>
                </div>
              </div>
            )}
            {!todayRecord?.timeIn ? (
              <button
                onClick={handleTimeInClick}
                disabled={isPunchBlocked}
                className={`w-full py-4 px-6 rounded-xl font-semibold text-base transition-all flex items-center justify-center gap-3 shadow-md ${
                  isPunchBlocked
                    ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed shadow-none'
                    : 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white shadow-emerald-600/20 cursor-pointer'
                }`}
              >
                <LogIn className="w-5 h-5" />
                <span>
                  {isPunchBlockedByIp
                    ? 'Connect to Office Wi-Fi to Punch In'
                    : 'Punch Time In (Once Daily)'}
                </span>
              </button>
            ) : !todayRecord.timeOut ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                  onClick={handleBreakToggle}
                  disabled={isPunchBlocked}
                  className={`py-3.5 px-5 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2.5 shadow-xs ${
                    isPunchBlocked
                      ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                      : isOnBreak
                      ? 'bg-amber-600 hover:bg-amber-700 text-white cursor-pointer'
                      : 'bg-amber-100 hover:bg-amber-200 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200 dark:hover:bg-amber-900/60 border border-amber-300 dark:border-amber-800 cursor-pointer'
                  }`}
                >
                  <Coffee className="w-4 h-4" />
                  <span>{isOnBreak ? 'End Lunch Break' : 'Start Lunch Break'}</span>
                </button>

                <button
                  onClick={handleTimeOutClick}
                  disabled={isOnBreak || isPunchBlocked}
                  className={`py-3.5 px-5 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2.5 shadow-xs ${
                    isOnBreak || isPunchBlocked
                      ? 'bg-slate-100 text-slate-400 dark:bg-slate-800 cursor-not-allowed'
                      : 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-600/20 cursor-pointer'
                  }`}
                  title={
                    isPunchBlockedByIp
                      ? 'Connect to Office Wi-Fi to clock out'
                      : isOnBreak
                      ? 'Please end break before clocking out'
                      : 'Record Time Out for today'
                  }
                >
                  <LogOut className="w-4 h-4" />
                  <span>Punch Time Out</span>
                </button>
              </div>
            ) : (
              <div className="p-4 bg-emerald-50 dark:bg-emerald-950/30 rounded-xl border border-emerald-200 dark:border-emerald-800/50 text-center space-y-1">
                <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                  Daily Attendance Completed
                </p>
                <p className="text-xs text-emerald-700 dark:text-emerald-400">
                  Time In: {formatTime12h(todayRecord.timeIn)} · Time Out: {formatTime12h(todayRecord.timeOut)} · Total Worked: {formatMinutesToHoursMinutes(todayRecord.totalWorkedMinutes)}
                  {(todayRecord.overtimeMinutes || 0) > 0 ? ` · Overtime: ${formatMinutesToHoursMinutes(todayRecord.overtimeMinutes)}` : ''}
                </p>
                {todayRecord.isAutoPunchedOut && (
                  <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                    {`System Notice: Auto punched out ${settings.autoPunchOutOnInactiveHours ?? 2}h after shift ended · Overtime counted in remarks: ${formatMinutesToHoursMinutes(todayRecord.overtimeMinutes || 0)}`}
                  </p>
                )}
                <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-1">
                  Employees are permitted ONE attendance punch cycle per day. For any manual adjustments, please contact the Administrator.
                </p>
              </div>
            )}

            {/* Real-Time Punch Note / Remark Section: staff only see it when a Work From Home reason is required */}
            {(isAdminUser || isRemoteWfhPunch) && (
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
                  <MessageSquare className="w-3.5 h-3.5 text-blue-600" />
                  <span>{isRemoteWfhPunch ? 'Note: Reason for Working from Home (required)' : 'Punch Note / Daily Remark'}</span>
                </div>
                {noteSavedFeedback && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 animate-in fade-in">
                    <Check className="w-3.5 h-3.5" />
                    <span>Saved in Real-Time!</span>
                  </span>
                )}
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <input
                  type="text"
                  value={actionNotes}
                  onChange={(e) => setActionNotes(e.target.value)}
                  placeholder={isRemoteWfhPunch ? 'Why are you working from home today? (required before Time In)' : 'e.g. Working from client branch in morning / Doctor appointment'}
                  className={`flex-1 text-xs px-3 py-2 bg-white dark:bg-slate-900 border rounded-lg ${wfhReasonMissing ? 'border-amber-500 ring-1 ring-amber-400' : 'border-slate-300 dark:border-slate-700'} text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500`}
                />

                {todayRecord ? (
                  <button
                    type="button"
                    onClick={handleSaveNoteRealTime}
                    className="px-3.5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer shrink-0"
                    title="Save remark to database immediately"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Save Remark</span>
                  </button>
                ) : (
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 self-center px-1">
                    Will save automatically with Time In
                  </span>
                )}
              </div>

              {todayRecord?.notes && !noteSavedFeedback && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Current Saved Note: <strong className="text-slate-700 dark:text-slate-300">{todayRecord.notes}</strong>
                </p>
              )}
            </div>
            )}
          </div>
        </div>

        {/* Right Col: Today's Timeline Card */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-xs border border-slate-200 dark:border-slate-800 space-y-4">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Timer className="w-4 h-4 text-slate-500" />
            <span>Today's Activity Log</span>
          </h3>

          {!todayRecord ? (
            <div className="py-8 text-center text-xs text-slate-400">
              No punch recorded yet today. Click "Punch Time In" when you begin work.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-800">
                <LogIn className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">Time In</span>
                    <span className="font-mono font-medium text-slate-600 dark:text-slate-400">
                      {formatTime12h(todayRecord.timeIn)}
                    </span>
                  </div>
                  {todayRecord.notes && (
                    <p className="text-[11px] text-slate-500 mt-0.5 break-words">
                      Note: {todayRecord.notes}
                    </p>
                  )}
                </div>
              </div>

              {/* Breaks */}
              {todayRecord.breaks.map((b, idx) => (
                <div
                  key={b.id || idx}
                  className="flex items-start gap-3 p-3 rounded-lg bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/30 text-xs"
                >
                  <Coffee className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-amber-900 dark:text-amber-200 capitalize">
                        {b.type} Break
                      </span>
                      <span className="font-mono text-amber-800 dark:text-amber-300">
                        {formatTime12h(b.start)} {b.end ? `– ${formatTime12h(b.end)}` : '(Active)'}
                      </span>
                    </div>
                  </div>
                </div>
              ))}

              {/* Time Out */}
              {todayRecord.timeOut && (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-800">
                  <LogOut className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">Time Out</span>
                      <span className="font-mono font-medium text-slate-600 dark:text-slate-400">
                        {formatTime12h(todayRecord.timeOut)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Shift Details Helper */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 space-y-1">
            <div className="flex justify-between">
              <span>Shift:</span>
              <span className="font-medium text-slate-700 dark:text-slate-300">{userShift.name}</span>
            </div>
            <div className="flex justify-between">
              <span>Expected Hours:</span>
              <span className="font-medium text-slate-700 dark:text-slate-300">{userShift.expectedHours}h daily</span>
            </div>
            <div className="flex justify-between">
              <span>Daily Punch Policy:</span>
              <span className="font-medium text-blue-600 dark:text-blue-400">1 Punch Cycle / Day</span>
            </div>
          </div>
        </div>
      </div>

      {/* Today's Team Live Presence Board (Today Only - Available to All Employees) */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-900/50 flex items-center justify-center">
                <Users className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <span>Today's Team Live Presence</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                    {dayName}, {todayStr}
                  </span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Live presence board for today. See who is online right now, who is offline, on a break, or finished for the day.
                </p>
              </div>
            </div>
          </div>

          {/* Quick Filter Buttons */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => setCoworkerFilter('all')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                coworkerFilter === 'all'
                  ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              All ({coworkerCounts.total})
            </button>
            <button
              type="button"
              onClick={() => setCoworkerFilter('in')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                coworkerFilter === 'in'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Online ({coworkerCounts.in})</span>
            </button>
            <button
              type="button"
              onClick={() => setCoworkerFilter('offline')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                coworkerFilter === 'offline'
                  ? 'bg-slate-700 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-slate-400" />
              <span>Offline ({coworkerCounts.offline})</span>
            </button>
            <button
              type="button"
              onClick={() => setCoworkerFilter('break')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                coworkerFilter === 'break'
                  ? 'bg-amber-600 text-white'
                  : 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 hover:bg-amber-100'
              }`}
            >
              <Coffee className="w-3 h-3 text-amber-500" />
              <span>Break ({coworkerCounts.break})</span>
            </button>
            <button
              type="button"
              onClick={() => setCoworkerFilter('out')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                coworkerFilter === 'out'
                  ? 'bg-blue-600 text-white'
                  : 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 hover:bg-blue-100'
              }`}
            >
              <LogOut className="w-3 h-3 text-blue-500" />
              <span>Shift Ended ({coworkerCounts.out})</span>
            </button>
            <button
              type="button"
              onClick={() => setCoworkerFilter('absent')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                coworkerFilter === 'absent'
                  ? 'bg-rose-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
              }`}
            >
              Absent / Not In ({coworkerCounts.absent})
            </button>
          </div>
        </div>

        {/* Search coworker bar */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
          <input
            type="text"
            value={coworkerSearch}
            onChange={(e) => setCoworkerSearch(e.target.value)}
            placeholder="Search coworker by name, department, or employee ID..."
            className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
        </div>

        {/* Coworker Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 max-h-[380px] overflow-y-auto pr-1">
          {filteredCoworkers.map(({ employee: emp, record: rec, status, elapsedMins }: CoworkerPresenceItem) => {
            const isMe = emp.id === currentUser.id;
            return (
              <div
                key={emp.id}
                className={`p-3 rounded-xl border transition-all ${
                  isMe
                    ? 'bg-blue-50/70 dark:bg-blue-950/40 border-blue-300 dark:border-blue-700 shadow-2xs'
                    : 'bg-slate-50/70 dark:bg-slate-800/50 border-slate-200/80 dark:border-slate-700/80'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xs shrink-0 shadow-2xs">
                      {emp.name.split(' ').map((n: string) => n[0]).slice(0, 2).join('')}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate flex items-center gap-1.5">
                        <span>{emp.name}</span>
                        {isMe && (
                          <span className="text-[9px] font-black uppercase px-1 rounded bg-blue-600 text-white">
                            You
                          </span>
                        )}
                      </p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                        {emp.department || emp.designation || 'Staff'}
                      </p>
                    </div>
                  </div>

                  {/* Status Badge */}
                  {status === 'in' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/90 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span>Online</span>
                    </span>
                  )}
                  {status === 'offline' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                      <span>Offline</span>
                    </span>
                  )}
                  {status === 'break' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950/90 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 shrink-0">
                      <Coffee className="w-3 h-3 text-amber-600" />
                      <span>Break</span>
                    </span>
                  )}
                  {status === 'out' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 dark:bg-blue-950/90 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-700 shrink-0">
                      <span>Out</span>
                    </span>
                  )}
                  {status === 'absent' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200/80 dark:bg-slate-800 text-slate-600 dark:text-slate-400 shrink-0">
                      <span>Absent</span>
                    </span>
                  )}
                </div>

                {/* Sub info / Timestamps for today */}
                <div className="mt-2.5 pt-2 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between text-[10px] font-mono text-slate-600 dark:text-slate-400">
                  {rec?.timeIn ? (
                    <>
                      <span>In: {formatTime12h(rec.timeIn)}</span>
                      {status === 'in' || status === 'offline' ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                          {formatMinutesToHoursMinutes(elapsedMins)}
                        </span>
                      ) : status === 'out' && rec.timeOut ? (
                        <span>Out: {formatTime12h(rec.timeOut)}</span>
                      ) : (
                        <span>{status === 'break' ? 'On Break' : ''}</span>
                      )}
                    </>
                  ) : (
                    <span className="text-slate-400 italic">Not punched in today</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Windows Boot Auto-Start Card (admin only; per-employee download lives in the Employees directory) */}
      {isAdminUser && (
      <div className="bg-gradient-to-r from-indigo-50 via-blue-50 to-slate-50 dark:from-indigo-950/30 dark:via-blue-950/20 dark:to-slate-900 rounded-2xl p-4 sm:p-5 border border-indigo-200/80 dark:border-indigo-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center shrink-0">
            <Terminal className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {canPersonalAutoStart
                  ? 'Automate Daily Check-In on Windows Startup'
                  : 'Windows Auto-Start App (.bat)'}
              </h3>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300">
                {canPersonalAutoStart ? 'Auto Punch .BAT' : 'Manual ID Punch'}
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
              {canPersonalAutoStart
                ? 'Download and install once on your office Windows PC to auto-start on boot/login and punch Time In automatically on office Wi-Fi (1 punch/day).'
                : 'Download and run once on Windows to automatically start Attendance Tracker at boot/login — select your Employee ID & PIN to punch manually.'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleDownloadAutoStartBat}
          className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer shrink-0 ${
            batDownloaded
              ? 'bg-emerald-600 text-white'
              : 'bg-indigo-600 hover:bg-indigo-700 text-white'
          }`}
        >
          {batDownloaded ? <Check className="w-4 h-4" /> : <Download className="w-4 h-4" />}
          <span>
            {batDownloaded ? 'Downloaded .bat!' : 'Download Auto-Start (.bat)'}
          </span>
        </button>
      </div>
      )}
    </div>
  );
};
