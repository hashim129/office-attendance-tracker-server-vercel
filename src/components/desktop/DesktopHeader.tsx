import { crmCall } from '../../crm/crmApi';
import { notificationDestination } from '../../crm/notificationTarget';
import { isWorkPrompt } from '../../crm/ui';
import React, { useEffect, useRef, useState } from 'react';
import { EmployeeAvatar } from '../common/EmployeeIdentity';
import { hasProfilePicture } from '../../lib/profilePictures';
import {
  LogOut,
  Shield,
  User,
  Monitor,
  Bell,
  BellRing,
  Crown,
  Check,
  MessageSquare,
  KeyRound,
  Wifi,
  WifiOff,
  RefreshCw,
  CheckCircle2,
  Cloud,
  Menu,
  Moon,
  Sun,
  ChevronDown,
  ContactRound,
} from 'lucide-react';
import { ActiveDesktopTab, AppMode, CeoComment, Employee } from '../../types';
import { CloudSyncState } from '../../lib/storage';

interface DesktopHeaderProps {
  currentUser: Employee;
  activeTab: ActiveDesktopTab;
  onLogout: () => void;
  onSwitchToKiosk: () => void;
  ceoComments?: CeoComment[];
  onMarkCeoCommentRead?: (commentId: string) => void;
  onOpenChangePassword?: () => void;
  /** Opens My Profile (the profile now lives in this header menu). */
  onOpenProfile?: () => void;
  /** Show the 3D avatar look (Employee Universe on). */
  showAvatar?: boolean;
  isNetworkOnline?: boolean;
  cloudSyncState?: CloudSyncState;
  onRetrySync?: () => void;
  onOpenMobileNav?: () => void;
  /** CRM notification history: unread count and a way to open the page. */
  crmUnread?: number;
  crmLatest?: { id: string; category: string; refId?: string; message: string }[];
  onCrmRefresh?: () => void;
  onOpenCrmNotifications?: () => void;
  onOpenCrmRecord?: (tab: ActiveDesktopTab, refId?: string) => void;
  isDark?: boolean;
  onToggleTheme?: () => void;
  redesignedUiBetaEnabled?: boolean;
  headerBetaEnabled?: boolean;
}

export const DesktopHeader: React.FC<DesktopHeaderProps> = ({
  currentUser,
  activeTab,
  onLogout,
  onSwitchToKiosk,
  ceoComments = [],
  onMarkCeoCommentRead,
  onOpenChangePassword,
  onOpenProfile,
  showAvatar = false,
  isNetworkOnline = true,
  cloudSyncState,
  onRetrySync,
  onOpenMobileNav,
  crmUnread = 0,
  crmLatest = [],
  onCrmRefresh,
  onOpenCrmNotifications,
  onOpenCrmRecord,
  isDark = false,
  onToggleTheme,
  redesignedUiBetaEnabled = false,
  headerBetaEnabled = false,
}) => {
  const [showNotifications, setShowNotifications] = useState(false);
  const [showCrmBell, setShowCrmBell] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const profileRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!showProfile) return;
    const close = (e: MouseEvent | TouchEvent) => { if (profileRef.current && !profileRef.current.contains(e.target as Node)) setShowProfile(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowProfile(false); };
    document.addEventListener('mousedown', close); document.addEventListener('touchstart', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close); document.removeEventListener('keydown', esc); };
  }, [showProfile]);
  const notifRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!showNotifications) return;
    const close = (e: MouseEvent | TouchEvent) => { if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotifications(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowNotifications(false); };
    document.addEventListener('mousedown', close); document.addEventListener('touchstart', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close); document.removeEventListener('keydown', esc); };
  }, [showNotifications]);
  const [confirmingWork, setConfirmingWork] = useState(false);
  const [workConfirmFeedback, setWorkConfirmFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const confirmWorking = async () => {
    setConfirmingWork(true);
    setWorkConfirmFeedback(null);
    try {
      await crmCall('work_confirm');
      setWorkConfirmFeedback({ type: 'success', message: 'Confirmed. Your overtime session has been extended.' });
      onCrmRefresh?.();
    } catch (error) {
      setWorkConfirmFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'Confirmation could not be saved. Please try again.',
      });
    } finally {
      setConfirmingWork(false);
    }
  };

  // Filter notifications sent to this employee
  const myNotifications = ceoComments.filter((c) => c.employeeId === currentUser.id);
  const unreadCount = myNotifications.filter((c) => !c.isRead).length;

  const getTabLabel = (tab: ActiveDesktopTab): string => {
    switch (tab) {
      case 'clock':
        return 'Live Dashboard & Punch Clock';
      case 'my-attendance':
        return 'My Attendance & Personal Stats';
      case 'team-attendance':
        return currentUser.role === 'ceo'
          ? 'Team Presence & Executive Mentions'
          : currentUser.role === 'accounts'
          ? 'Attendance Verification & Audit'
          : 'Office Team Attendance & Live Roster';
      case 'employees':
        return 'Staff Directory & Management';
      case 'shifts':
        return 'Shift Schedules & Working Rules';
      case 'leaves':
        return 'Leave & Vacation Requests';
      case 'reports':
        return currentUser.role === 'ceo'
          ? 'All Staff Attendance & Performance Analytics'
          : 'Attendance Analytics & Timesheets';
      case 'insights':
        return 'Smart Attendance Insights & Bar Analytics';
      case 'settings':
        return 'Office & Local Server Configuration';
      case 'crm-customers':
        return 'CRM · Customers';
      case 'crm-tasks':
        return 'CRM · Follow-ups & Tasks';
      case 'crm-meetings':
        return 'CRM · CEO Meetings';
      case 'crm-inventory':
        return 'Inventory Requests';
      case 'crm-sales':
        return 'Sales Coupons';
      case 'crm-purchases':
        return 'Purchases · Vendor Bookings & Payables';
      case 'crm-invoices':
        return 'Invoices';
      case 'crm-receipts':
        return 'Receipts';
      case 'crm-payment-tree':
        return 'Payment Tree';
      case 'live-dashboard':
        return 'Live Dashboard';
      case 'crm-portal':
        return 'Customer Portal Control';
      case 'crm-notifications':
        return 'Notifications & History';
      default:
        return 'Workspace';
    }
  };

  return (
    <div className={`min-h-[72px] px-3 sm:px-5 lg:px-7 py-2.5 border-b flex items-center justify-between gap-3 shrink-0 relative z-30 transition-colors duration-200 ${
      headerBetaEnabled
        ? 'border-slate-200/80 dark:border-slate-700/80 bg-[linear-gradient(105deg,rgba(255,255,255,0.98),rgba(239,246,255,0.94),rgba(255,255,255,0.98))] dark:bg-[linear-gradient(105deg,rgba(15,23,42,0.98),rgba(23,37,64,0.96),rgba(15,23,42,0.98))] shadow-[0_8px_28px_rgba(15,23,42,0.07)]'
        : 'border-slate-200/90 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl shadow-[0_4px_18px_rgba(15,23,42,0.035)]'
    }`}>
      {/* Left: Mobile Nav Toggle + Breadcrumb */}
      <div className="flex items-center gap-2.5 text-xs min-w-0 flex-1">
        {onOpenMobileNav && (
          <button
            type="button"
            onClick={onOpenMobileNav}
            className="md:hidden p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0 cursor-pointer"
            title="Open Navigation Menu"
            aria-label="Open Navigation Menu"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}
        {headerBetaEnabled ? (
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-14 sm:h-16 items-center rounded-xl bg-white px-3 sm:px-4 dark:bg-slate-900 shrink-0">
              <img src="/bahaar-logo.png" alt="Bahaar Journeys" className="h-12 sm:h-14 w-auto max-w-[230px] object-contain object-left shrink-0" />
            </div>
            <div className="hidden sm:block min-w-0 border-l border-slate-200 dark:border-slate-700 pl-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-600 dark:text-blue-400">Bahaar Journeys</p>
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">Office Attendance Hub</p>
            </div>
          </div>
        ) : (
          <>
            <span className="hidden sm:inline text-[11px] uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500 font-bold">Workspace</span>
            <span className="hidden sm:inline text-slate-300 dark:text-slate-700">/</span>
            <h2 className="text-sm sm:text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 truncate border-l-2 border-blue-500 pl-3">{getTabLabel(activeTab)}</h2>
          </>
        )}
      </div>

      {/* Right Controls: Cloud Sync, Connection State, Notifications, Kiosk Mode Shortcut & User Profile */}
      <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
        {redesignedUiBetaEnabled && onToggleTheme && <button type="button" onClick={onToggleTheme} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800" aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"} title={isDark ? "Light theme" : "Dark theme"}>{isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}</button>}
        {cloudSyncState && cloudSyncState.status === 'saving' && (
          <span
            className="inline-flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
            title="Saving changes promptly to cloud database..."
          >
            <RefreshCw className="w-3 h-3 animate-spin" />
            <span>Saving{cloudSyncState.pendingCount > 1 ? ` (${cloudSyncState.pendingCount})` : '...'}</span>
          </span>
        )}
        {cloudSyncState && (cloudSyncState.status === 'retrying' || cloudSyncState.status === 'error') && (
          <button
            type="button"
            onClick={onRetrySync}
            className="inline-flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 hover:bg-amber-200 text-amber-900 dark:bg-amber-950/80 dark:text-amber-200 border border-amber-300 dark:border-amber-700 transition-colors cursor-pointer"
            title={cloudSyncState.lastError ? `Cloud save pending (${cloudSyncState.lastError}). Click to retry now.` : 'Click to retry cloud save now'}
          >
            <RefreshCw className="w-3 h-3" />
            <span>Retry Save ({cloudSyncState.pendingCount || 1})</span>
          </button>
        )}
        {cloudSyncState && cloudSyncState.status === 'saved' && (
          <span
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold bg-emerald-50/80 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/70"
            title={`All changes saved to cloud${cloudSyncState.lastSavedAt ? ` at ${new Date(cloudSyncState.lastSavedAt).toLocaleTimeString()}` : ''}`}
          >
            <Cloud className="w-3 h-3" />
            <CheckCircle2 className="w-2.5 h-2.5" />
            <span>Saved</span>
          </span>
        )}
        {!isNetworkOnline && (
          <span
            className="inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-300 dark:border-amber-700"
            title="Device is offline. Changes will save automatically when reconnected."
          >
            <WifiOff className="w-3 h-3" />
            <span>Offline</span>
          </span>
        )}
        <div className="relative" ref={notifRef}>
          <button
            type="button"
            onClick={() => { setShowNotifications((v) => !v); setShowCrmBell(false); setShowProfile(false); }}
            className={`relative rounded-xl p-2.5 transition-all hover:-translate-y-0.5 hover:shadow-sm ${headerBetaEnabled ? 'bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-600/20 hover:from-blue-700 hover:to-indigo-700' : 'text-slate-500 hover:bg-blue-50 hover:text-blue-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-blue-300'}`}
            title="Smart notification center"
            aria-label={`Notifications, ${unreadCount + crmUnread} unread`}
            aria-expanded={showNotifications}
          >
            <BellRing className="h-4 w-4" />
            {(unreadCount + crmUnread) > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{Math.min(unreadCount + crmUnread, 99)}{unreadCount + crmUnread > 99 ? '+' : ''}</span>}
          </button>
          {showNotifications && (
            <>
            {/* phones: dimmed background + a sheet that slides up from the bottom (it never runs off the screen) */}
            <div className="notif-backdrop fixed inset-0 z-40 bg-slate-950/50 sm:hidden" aria-hidden="true" onClick={() => setShowNotifications(false)} data-notif-backdrop />
            <div data-notif-panel className="notif-sheet fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:mt-2 sm:w-[25rem] sm:max-h-none sm:rounded-2xl">
              <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-slate-300 dark:bg-slate-700 sm:hidden" aria-hidden="true" />
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Notification Center</h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{unreadCount + crmUnread} unread · Updates for your workspace</p>
                </div>
                <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">LIVE</span>
              </div>
              <div className="max-h-[min(65vh,28rem)] overflow-y-auto p-3">
                {crmLatest.map((n) => (
                  <div key={`crm-${n.id}`} className="mb-2 rounded-xl border border-slate-100 p-3 text-xs dark:border-slate-800">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="font-bold text-blue-700 dark:text-blue-300">{n.category || 'Workspace update'}</span>
                      <span className="text-[10px] text-slate-400">CRM</span>
                    </div>
                    <p className="leading-relaxed text-slate-700 dark:text-slate-200">{n.message}</p>
                    {onOpenCrmRecord && <button className="mt-2 font-semibold text-blue-600 underline" onClick={() => { setShowNotifications(false); onOpenCrmRecord(notificationDestination(n.category, n.refId), n.refId); }}>Open record →</button>}
                    {isWorkPrompt(n.id) && (
                      <div className="mt-2">
                        <button disabled={confirmingWork} onClick={() => void confirmWorking()} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-60">
                          {confirmingWork ? 'Saving confirmation…' : workConfirmFeedback?.type === 'success' ? 'Confirmed' : "Yes, I'm working"}
                        </button>
                        {workConfirmFeedback && <p role="status" aria-live="polite" className={`mt-1 text-[11px] ${workConfirmFeedback.type === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>{workConfirmFeedback.message}</p>}
                      </div>
                    )}
                  </div>
                ))}
                {myNotifications.map((c) => (
                  <div key={`directive-${c.id}`} className={`mb-2 rounded-xl border p-3 text-xs ${!c.isRead ? 'border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/30' : 'border-slate-100 dark:border-slate-800'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-amber-700 dark:text-amber-400">{c.fromName} · {c.fromRole.toUpperCase()}</span>
                      <span className="text-[10px] text-slate-400">{c.date}</span>
                    </div>
                    <p className="mt-1 leading-relaxed text-slate-800 dark:text-slate-200">{c.message}</p>
                    {!c.isRead && onMarkCeoCommentRead && <button onClick={() => onMarkCeoCommentRead(c.id)} className="mt-2 inline-flex items-center gap-1 font-semibold text-emerald-700 hover:underline dark:text-emerald-400"><Check className="h-3 w-3" /> Mark as read</button>}
                  </div>
                ))}
                {crmLatest.length === 0 && myNotifications.length === 0 && <div className="py-10 text-center"><Bell className="mx-auto mb-2 h-6 w-6 text-slate-300" /><p className="text-xs font-semibold text-slate-600 dark:text-slate-300">You're all caught up</p><p className="mt-1 text-[11px] text-slate-400">New reminders and updates will appear here.</p></div>}
              </div>
              {onOpenCrmNotifications && <button onClick={() => { setShowNotifications(false); onOpenCrmNotifications(); }} className="w-full border-t border-slate-100 px-4 py-3 text-left text-xs font-bold text-blue-700 hover:bg-slate-50 dark:border-slate-800 dark:text-blue-300 dark:hover:bg-slate-800">Open notification history <span aria-hidden="true">→</span></button>}
            </div>
            </>
          )}
        </div>
        {currentUser.role === 'admin' && (
          <button
            onClick={onSwitchToKiosk}
            className={`hidden sm:flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all hover:-translate-y-0.5 hover:shadow-md cursor-pointer ${headerBetaEnabled ? 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-md shadow-blue-600/20 hover:from-indigo-700 hover:to-blue-700' : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'}`}
            title="Switch to Lobby Punch-Clock Terminal"
          >
            <Monitor className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span>Lobby Kiosk Mode</span>
          </button>
        )}

        <div className="h-5 w-px bg-slate-200 dark:bg-slate-800 hidden sm:block" />

        {/* Compact profile menu: profile, password and sign-out in one place */}
        <div className="relative" ref={profileRef}>
          <button
            type="button"
            onClick={() => { setShowProfile((v) => !v); setShowNotifications(false); }}
            className={`group flex items-center gap-2 rounded-2xl border py-1 pl-1 pr-2 sm:pr-2.5 transition-all hover:-translate-y-0.5 hover:shadow-md active:scale-[.98] ${showProfile ? 'border-blue-300 bg-blue-50/80 shadow-sm dark:border-blue-700 dark:bg-slate-800' : 'border-slate-200 bg-white/80 dark:border-slate-700 dark:bg-slate-900/80'}`}
            aria-haspopup="menu"
            aria-expanded={showProfile}
            title="My profile & account"
          >
            {(showAvatar && currentUser.gameCharacterId) || hasProfilePicture(currentUser.avatarAppearance)
              ? <EmployeeAvatar characterId={showAvatar ? currentUser.gameCharacterId : undefined} appearance={currentUser.avatarAppearance} name={currentUser.name} size="sm" />
              : <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-sm font-bold text-white shadow-sm">{currentUser.name.charAt(0)}</span>}
            <span className="hidden md:flex flex-col items-start leading-tight">
              <span className="max-w-[140px] truncate text-[13px] font-bold text-slate-900 dark:text-slate-100">{currentUser.name}</span>
              <span className={`mt-0.5 rounded px-1.5 text-[9px] font-black uppercase tracking-wider ${currentUser.role === 'admin' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300' : currentUser.role === 'ceo' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200' : currentUser.role === 'accounts' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'}`}>{currentUser.role === 'ceo' ? 'CEO' : currentUser.role === 'accounts' ? 'Accounts' : currentUser.role}</span>
            </span>
            <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform duration-300 ${showProfile ? 'rotate-180 text-blue-600' : ''}`} />
          </button>
          {showProfile && (
            <div role="menu" className="header-menu-pop absolute right-0 z-50 mt-2 w-[min(92vw,18.5rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
              <div className="relative overflow-hidden bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 px-4 py-4 text-white">
                <div className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-white/15" aria-hidden />
                <div className="relative flex items-center gap-3">
                  <EmployeeAvatar characterId={showAvatar ? currentUser.gameCharacterId : undefined} petId={showAvatar ? currentUser.gamePetId : undefined} appearance={currentUser.avatarAppearance} name={currentUser.name} size="md" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black">{currentUser.name}</p>
                    <p className="truncate text-[11px] text-white/80">{currentUser.designation || currentUser.department}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-white/70">{currentUser.department} · {currentUser.employeeCode}</p>
                  </div>
                </div>
              </div>
              <div className="p-1.5">
                {onOpenProfile && (
                  <button role="menuitem" onClick={() => { setShowProfile(false); onOpenProfile(); }} className="header-menu-item flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs font-semibold text-slate-700 hover:bg-blue-50 dark:text-slate-200 dark:hover:bg-slate-800">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"><ContactRound className="h-4 w-4" /></span>
                    <span className="flex-1"><span className="block">My profile & avatar</span><span className="block text-[10px] font-normal text-slate-500">Details, picture, 3D look</span></span>
                  </button>
                )}
                {onOpenChangePassword && (
                  <button role="menuitem" onClick={() => { setShowProfile(false); onOpenChangePassword(); }} className="header-menu-item flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs font-semibold text-slate-700 hover:bg-emerald-50 dark:text-slate-200 dark:hover:bg-slate-800">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"><KeyRound className="h-4 w-4" /></span>
                    <span className="flex-1"><span className="block">Change password</span><span className="block text-[10px] font-normal text-slate-500">Update your password / PIN</span></span>
                  </button>
                )}
                {currentUser.role === 'admin' && (
                  <button role="menuitem" onClick={() => { setShowProfile(false); onSwitchToKiosk(); }} className="header-menu-item flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs font-semibold text-slate-700 hover:bg-indigo-50 dark:text-slate-200 dark:hover:bg-slate-800 sm:hidden">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"><Monitor className="h-4 w-4" /></span>
                    <span className="flex-1">Lobby kiosk mode</span>
                  </button>
                )}
                <div className="my-1 h-px bg-slate-100 dark:bg-slate-800" />
                <button role="menuitem" onClick={() => { setShowProfile(false); onLogout(); }} className="header-menu-item flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 dark:bg-rose-950"><LogOut className="h-4 w-4" /></span>
                  <span className="flex-1">Sign out</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
