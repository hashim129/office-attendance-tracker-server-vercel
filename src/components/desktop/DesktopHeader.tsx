import { crmCall } from '../../crm/crmApi';
import { isWorkPrompt } from '../../crm/ui';
import React, { useState } from 'react';
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
  isNetworkOnline?: boolean;
  cloudSyncState?: CloudSyncState;
  onRetrySync?: () => void;
  onOpenMobileNav?: () => void;
  /** CRM notification history: unread count and a way to open the page. */
  crmUnread?: number;
  crmLatest?: { id: string; category: string; message: string }[];
  onCrmRefresh?: () => void;
  onOpenCrmNotifications?: () => void;
  isDark?: boolean;
  onToggleTheme?: () => void;
}

export const DesktopHeader: React.FC<DesktopHeaderProps> = ({
  currentUser,
  activeTab,
  onLogout,
  onSwitchToKiosk,
  ceoComments = [],
  onMarkCeoCommentRead,
  onOpenChangePassword,
  isNetworkOnline = true,
  cloudSyncState,
  onRetrySync,
  onOpenMobileNav,
  crmUnread = 0,
  crmLatest = [],
  onCrmRefresh,
  onOpenCrmNotifications,
  isDark = false,
  onToggleTheme,
}) => {
  const [showNotifications, setShowNotifications] = useState(false);
  const [showCrmBell, setShowCrmBell] = useState(false);
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
        return 'Punch Clock & Active Shift';
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
      case 'crm-portal':
        return 'Customer Portal Control';
      case 'crm-notifications':
        return 'Notifications & History';
      default:
        return 'Workspace';
    }
  };

  return (
    <div className="min-h-[68px] px-3 sm:px-6 lg:px-8 py-2.5 border-b border-slate-200/90 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl flex items-center justify-between gap-3 shrink-0 relative z-30 shadow-[0_4px_18px_rgba(15,23,42,0.035)]">
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
        <img src="/bahaar-logo.png" alt="Bahaar Journeys" className="h-9 w-auto max-w-[190px] object-contain object-left shrink-0" />
        <span className="hidden lg:inline text-xs text-slate-400 dark:text-slate-500 border-l border-slate-200 dark:border-slate-700 pl-3">Office Attendance Hub</span>
      </div>

      {/* Right Controls: Cloud Sync, Connection State, Notifications, Kiosk Mode Shortcut & User Profile */}
      <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
        {onToggleTheme && <button type="button" onClick={onToggleTheme} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800" aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"} title={isDark ? "Light theme" : "Dark theme"}>{isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}</button>}
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
        <div className="relative">
          <button
            type="button"
            onClick={() => { setShowNotifications((v) => !v); setShowCrmBell(false); }}
            className="relative rounded-xl p-2.5 text-slate-500 transition-colors hover:bg-blue-50 hover:text-blue-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-blue-300"
            title="Smart notification center"
            aria-label={`Notifications, ${unreadCount + crmUnread} unread`}
            aria-expanded={showNotifications}
          >
            <BellRing className="h-4 w-4" />
            {(unreadCount + crmUnread) > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{Math.min(unreadCount + crmUnread, 99)}{unreadCount + crmUnread > 99 ? '+' : ''}</span>}
          </button>
          {showNotifications && (
            <div className="absolute right-0 z-50 mt-2 w-[min(92vw,25rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
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
          )}
        </div>
        {currentUser.role === 'admin' && (
          <button
            onClick={onSwitchToKiosk}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
            title="Switch to Lobby Punch-Clock Terminal"
          >
            <Monitor className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span>Lobby Kiosk Mode</span>
          </button>
        )}

        <div className="h-5 w-px bg-slate-200 dark:bg-slate-800 hidden sm:block" />

        {/* Profile Card */}
        <div className="flex items-center gap-2.5 sm:gap-3 pl-2 sm:pl-3 border-l border-slate-200 dark:border-slate-700">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900/70 dark:to-indigo-900/50 text-blue-700 dark:text-blue-200 flex items-center justify-center font-bold text-sm ring-1 ring-blue-200/80 dark:ring-blue-800/70 shadow-sm">
            {currentUser.name.charAt(0)}
          </div>
          <div className="hidden md:block text-left">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-bold text-slate-900 dark:text-slate-100">
                {currentUser.name}
              </span>
              <span
                className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded ${
                  currentUser.role === 'admin'
                    ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300'
                    : currentUser.role === 'ceo'
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200 border border-amber-300 dark:border-amber-700 font-black'
                    : currentUser.role === 'accounts'
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
                    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                }`}
              >
                {currentUser.role === 'ceo'
                  ? 'CEO'
                  : currentUser.role === 'accounts'
                  ? 'Accounts Officer'
                  : currentUser.role}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {currentUser.department} · {currentUser.employeeCode}
            </p>
          </div>

          {/* Change PIN / Password button */}
          {onOpenChangePassword && (
            <button
              onClick={onOpenChangePassword}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:text-blue-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-blue-400 dark:hover:bg-slate-800 transition-colors cursor-pointer border border-slate-200 dark:border-slate-700"
              title="Change your portal password / PIN"
            >
              <KeyRound className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span className="hidden sm:inline">Password</span>
            </button>
          )}

          {/* Logout / Switch User */}
          <button
            onClick={onLogout}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title="Sign out or switch employee"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
