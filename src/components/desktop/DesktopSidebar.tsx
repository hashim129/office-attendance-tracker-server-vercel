import React from 'react';
import {
  Clock,
  CalendarCheck,
  Users,
  UserCheck,
  CalendarRange,
  FileSpreadsheet,
  Settings,
  CalendarDays,
  Building2,
  BarChart3,
  X,
} from 'lucide-react';
import { ActiveDesktopTab, Employee, OfficeSettings } from '../../types';

interface DesktopSidebarProps {
  currentUser: Employee;
  activeTab: ActiveDesktopTab;
  onSelectTab: (tab: ActiveDesktopTab) => void;
  pendingLeavesCount: number;
  settings: OfficeSettings;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const DesktopSidebar: React.FC<DesktopSidebarProps> = ({
  currentUser,
  activeTab,
  onSelectTab,
  pendingLeavesCount,
  settings,
  isMobileOpen = false,
  onCloseMobile,
}) => {
  const isAdmin = currentUser.role === 'admin';
  const isCeo = currentUser.role === 'ceo';
  const isAccounts = currentUser.role === 'accounts';

  const handleTabClick = (tab: ActiveDesktopTab) => {
    onSelectTab(tab);
    onCloseMobile?.();
  };

  return (
    <>
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-2xs md:hidden"
          onClick={() => onCloseMobile?.()}
        />
      )}
      <aside
        className={`${
          isMobileOpen ? 'fixed inset-y-0 left-0 z-50 flex shadow-2xl' : 'hidden'
        } md:static md:flex w-64 bg-slate-50/95 md:bg-slate-50/70 dark:bg-slate-900/95 md:dark:bg-slate-900/60 border-r border-slate-200 dark:border-slate-800 flex-col shrink-0 select-none`}
      >
      {/* Brand & Office Server Header */}
      <div className="p-4 border-b border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-xs shrink-0">
            <Building2 className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
              {settings.companyName}
            </h1>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              Office Attendance Hub
            </p>
          </div>
        </div>
        {onCloseMobile && (
          <button
            type="button"
            onClick={onCloseMobile}
            className="md:hidden p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
            aria-label="Close Menu"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Nav List */}
      <div className="flex-1 py-4 px-3 space-y-6 overflow-y-auto" onClick={(e) => {
        const btn = (e.target as HTMLElement).closest('button');
        if (btn && onCloseMobile) onCloseMobile();
      }}>
        {/* Employee Section (Available to All) */}
        <div>
          <p className="px-3 text-[10px] font-bold tracking-wider uppercase text-slate-400 dark:text-slate-500 mb-2">
            My Workspace
          </p>
          <div className="space-y-1">
            <button
              onClick={() => handleTabClick('clock')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                activeTab === 'clock'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
              }`}
            >
              <Clock className="w-4 h-4 shrink-0" />
              <span>Punch Clock</span>
            </button>

            <button
              onClick={() => onSelectTab('my-attendance')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                activeTab === 'my-attendance'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
              }`}
            >
              <CalendarCheck className="w-4 h-4 shrink-0" />
              <span>My Attendance & Stats</span>
            </button>

            <button
              onClick={() => onSelectTab('team-attendance')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                activeTab === 'team-attendance'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
              }`}
              title="View all employees' time in and presence status"
            >
              <UserCheck className="w-4 h-4 shrink-0" />
              <span>Team Presence (P/A)</span>
            </button>

            <button
              onClick={() => onSelectTab('leaves')}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                activeTab === 'leaves'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
              }`}
            >
              <div className="flex items-center gap-3">
                <CalendarDays className="w-4 h-4 shrink-0" />
                <span>Leave Requests</span>
              </div>
              {isAdmin && pendingLeavesCount > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500 text-white">
                  {pendingLeavesCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Accounts Officer Center (Attendance Verification & Reports) */}
        {currentUser.role === 'accounts' && (
          <div>
            <p className="px-3 text-[10px] font-bold tracking-wider uppercase text-emerald-600 dark:text-emerald-400 mb-2">
              Accounts & Audit
            </p>
            <div className="space-y-1">
              <button
                onClick={() => onSelectTab('team-attendance')}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  activeTab === 'team-attendance'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                }`}
              >
                <UserCheck className="w-4 h-4 shrink-0" />
                <span>Attendance Verification</span>
              </button>

              <button
                onClick={() => onSelectTab('insights')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  activeTab === 'insights'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                }`}
                title="Smart graphical bar insights per employee & team"
              >
                <span className="flex items-center gap-3">
                  <BarChart3 className="w-4 h-4 shrink-0" />
                  <span>Smart Insights</span>
                </span>
                <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded ${activeTab === 'insights' ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'}`}>
                  NEW
                </span>
              </button>

              <button
                onClick={() => onSelectTab('reports')}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  activeTab === 'reports'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                }`}
              >
                <FileSpreadsheet className="w-4 h-4 shrink-0" />
                <span>Reports & Payroll</span>
              </button>
            </div>
          </div>
        )}

        {/* Executive Suite (Restricted to CEO Role - View Stats Only) */}
        {isCeo && (
          <div>
            <p className="px-3 text-[10px] font-bold tracking-wider uppercase text-amber-600 dark:text-amber-400 mb-2 flex items-center gap-1.5">
              <span>Executive Command · Stats Only</span>
            </p>
            <div className="space-y-1">
              <button
                onClick={() => onSelectTab('team-attendance')}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  activeTab === 'team-attendance'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                }`}
                title="View presence, working status & stats of all employees"
              >
                <UserCheck className="w-4 h-4 shrink-0" />
                <span>Team Presence & Roster Stats</span>
              </button>

              <button
                onClick={() => onSelectTab('insights')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  activeTab === 'insights'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                }`}
                title="Smart graphical bar insights per employee & team"
              >
                <span className="flex items-center gap-3">
                  <BarChart3 className="w-4 h-4 shrink-0" />
                  <span>Smart Insights & Graphs</span>
                </span>
                <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded ${activeTab === 'insights' ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}`}>
                  NEW
                </span>
              </button>

              <button
                onClick={() => onSelectTab('reports')}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  activeTab === 'reports'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                }`}
                title="View company-wide attendance analytics, hours worked, and punctuality stats"
              >
                <FileSpreadsheet className="w-4 h-4 shrink-0" />
                <span>Executive Analytics & Stats</span>
              </button>
            </div>
          </div>
        )}

        {/* Admin Center (Restricted to Admin Role only) */}
        {isAdmin && (
          <div>
            <p className="px-3 text-[10px] font-bold tracking-wider uppercase text-slate-400 dark:text-slate-500 mb-2">
              Admin Management
            </p>
            <div className="space-y-1">
              <button
                onClick={() => onSelectTab('team-attendance')}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  activeTab === 'team-attendance'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                }`}
              >
                <UserCheck className="w-4 h-4 shrink-0" />
                <span>Team Roster & Logs</span>
              </button>

              <button
                onClick={() => onSelectTab('insights')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  activeTab === 'insights'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                }`}
                title="Smart graphical bar insights per employee & team"
              >
                <span className="flex items-center gap-3">
                  <BarChart3 className="w-4 h-4 shrink-0" />
                  <span>Smart Insights & Graphs</span>
                </span>
                <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded ${activeTab === 'insights' ? 'bg-white/20 text-white' : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'}`}>
                  NEW
                </span>
              </button>

              <button
                onClick={() => onSelectTab('employees')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  activeTab === 'employees'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                }`}
                title="Manage employees and shift assignments"
              >
                <div className="flex items-center gap-3">
                  <Users className="w-4 h-4 shrink-0" />
                  <span>Employees Directory</span>
                </div>
              </button>

              <button
                onClick={() => onSelectTab('shifts')}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  activeTab === 'shifts'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                }`}
              >
                <CalendarRange className="w-4 h-4 shrink-0" />
                <span>Shift Schedules</span>
              </button>

              <button
                onClick={() => onSelectTab('reports')}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  activeTab === 'reports'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                }`}
              >
                <FileSpreadsheet className="w-4 h-4 shrink-0" />
                <span>Reports & Payroll</span>
              </button>

              <button
                onClick={() => onSelectTab('settings')}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  activeTab === 'settings'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                }`}
              >
                <Settings className="w-4 h-4 shrink-0" />
                <span>Office & Server Settings</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer Status */}
      <div className="p-3 border-t border-slate-200/80 dark:border-slate-800/80 text-[11px] text-slate-500 dark:text-slate-400">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px]">Windows Server v2.4</span>
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" title="Server Active" />
        </div>
      </div>
    </aside>
    </>
  );
};
