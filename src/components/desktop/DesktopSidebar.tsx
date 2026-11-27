import React, { useLayoutEffect, useRef, useState } from 'react';
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
  Contact,
  ClipboardList,
  CalendarClock,
  Package,
  Receipt,
  ReceiptText,
  SlidersHorizontal,
  ShoppingBag,
  FileText,
  BellRing,
  Globe,
  ExternalLink,
  Gauge,
  ContactRound,
  ShieldCheck,
  GitBranch,
  Coins,
} from 'lucide-react';
import { ActiveDesktopTab, Employee, OfficeSettings } from '../../types';
import { CrmBadges } from '../../crm/crmApi';

interface DesktopSidebarProps {
  currentUser: Employee;
  activeTab: ActiveDesktopTab;
  onSelectTab: (tab: ActiveDesktopTab) => void;
  pendingLeavesCount: number;
  settings: OfficeSettings;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
  crmEnabled?: boolean;
  crmBadges?: CrmBadges;
  redesignedUiBetaEnabled?: boolean;
}

const NAV_GRADIENTS: [string, string][] = [
  ['#0ea5e9', '#2563eb'], ['#8b5cf6', '#6366f1'], ['#ec4899', '#f43f5e'], ['#f59e0b', '#f97316'], ['#10b981', '#14b8a6'],
  ['#06b6d4', '#3b82f6'], ['#d946ef', '#8b5cf6'], ['#f43f5e', '#fb923c'], ['#84cc16', '#22c55e'], ['#6366f1', '#a855f7'],
];

export const DesktopSidebar: React.FC<DesktopSidebarProps> = ({
  currentUser,
  activeTab,
  onSelectTab,
  pendingLeavesCount,
  settings,
  isMobileOpen = false,
  onCloseMobile,
  crmEnabled = false,
  crmBadges,
  redesignedUiBetaEnabled = false,
}) => {
  const isAdmin = currentUser.role === 'admin';
  const isCeo = currentUser.role === 'ceo';
  const isAccounts = currentUser.role === 'accounts';
  const canOpenPage=(page: import('../../types').ActiveDesktopTab)=>currentUser.isSuperAdmin===true||currentUser.featureAccess?.[page]!==false;
  const [activeTeamSource, setActiveTeamSource] = useState<'workspace' | 'ceo' | 'admin'>(() => (isAdmin ? 'admin' : isCeo ? 'ceo' : 'workspace'));

  // Sliding highlight that glides to whichever menu item is active
  const navRef = useRef<HTMLDivElement | null>(null);
  const [pills, setPills] = useState<{ top: number; height: number; g1: string; g2: string }[]>([]);
  useLayoutEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const measure = () => {
      // every menu button gets its own pair of gradient colours (used for hover, icon tile and the active highlight)
      const all = Array.from(el.querySelectorAll<HTMLButtonElement>('button'));
      all.forEach((b, i) => { const [g1, g2] = NAV_GRADIENTS[i % NAV_GRADIENTS.length]; b.style.setProperty('--g1', g1); b.style.setProperty('--g2', g2); });
      const active = all.filter((b) => b.classList.contains('text-white') && b.classList.contains('shadow-xs'));
      setPills(active.map((b) => ({ top: b.offsetTop, height: b.offsetHeight, g1: b.style.getPropertyValue('--g1'), g2: b.style.getPropertyValue('--g2') })));
    };
    measure();
    window.addEventListener('resize', measure);
    const t = window.setTimeout(measure, 350);
    return () => {
      window.removeEventListener('resize', measure);
      window.clearTimeout(t);
    };
  }, [activeTab, currentUser.role, pendingLeavesCount, activeTeamSource, crmEnabled]);

  const handleTabClick = (tab: ActiveDesktopTab, teamSource?: 'workspace' | 'ceo' | 'admin') => {
    if (teamSource) setActiveTeamSource(teamSource);
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
        className={`fixed inset-y-0 left-0 z-50 flex flex-col justify-start transition-transform duration-300 ease-in-out ${isMobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'} md:static md:translate-x-0 md:flex md:flex-col md:justify-start w-64 bg-slate-50/95 md:bg-slate-50/70 dark:bg-slate-900/95 md:dark:bg-slate-900/60 border-r border-slate-200 dark:border-slate-800 shrink-0 select-none`}
      >
      {!redesignedUiBetaEnabled ? <div className="shrink-0 px-4 py-3 border-b border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0"><div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-xs shrink-0"><Building2 className="w-5 h-5" /></div><div className="min-w-0"><h1 className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">{settings.companyName}</h1><p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">Office Attendance Hub</p></div></div>
        {onCloseMobile && <button type="button" onClick={onCloseMobile} className="md:hidden p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer" aria-label="Close Menu"><X className="w-4 h-4" /></button>}
      </div> : <div className="md:hidden flex justify-end px-3 py-2">{onCloseMobile && <button type="button" onClick={onCloseMobile} className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" aria-label="Close Menu"><X className="w-4 h-4" /></button>}</div>}

      {/* Nav List */}
      <div ref={navRef} className="nav-scope relative flex-1 pt-2 pb-3 px-3 space-y-1 overflow-y-auto" onClick={(e) => {
        const btn = (e.target as HTMLElement).closest('button');
        if (btn && onCloseMobile) onCloseMobile();
      }}>
        {pills.map((p, i) => (
          <div key={i} className="nav-pill absolute left-3 right-3 pointer-events-none" style={{ top: p.top, height: p.height, background: `linear-gradient(135deg, ${p.g1}, ${p.g2})`, boxShadow: `0 10px 22px -10px color-mix(in srgb, ${p.g1} 75%, transparent), inset 0 1px 0 rgba(255,255,255,0.3)` }} aria-hidden="true" />
        ))}
        <div className="space-y-6">
          {/* Employee Section (Available to All) */}
        <div>
          <p className="px-3 text-[10px] font-bold tracking-wider uppercase text-slate-400 dark:text-slate-500 mb-2">
            My Workspace
          </p>
          <div className="space-y-1">
            {canOpenPage('clock') && <button
              onClick={() => handleTabClick('clock')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 active:scale-[0.98] ${
                activeTab === 'clock'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
              }`}
            >
              <Clock className="w-4 h-4 shrink-0" />
              <span>Punch Clock</span>
            </button>}

            {canOpenPage('live-dashboard') && (['admin', 'ceo'].includes(currentUser.role) || currentUser.liveDashboardAccess) && (
              <button
                onClick={() => handleTabClick('live-dashboard')}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 active:scale-[0.98] ${
                  activeTab === 'live-dashboard'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                }`}
                title="Open attendance statistics, upcoming tasks and required actions"
              >
                <Gauge className="w-4 h-4 shrink-0" />
                <span>Live Dashboard</span>
              </button>
            )}

            {canOpenPage('my-attendance') && <button
              onClick={() => handleTabClick('my-attendance')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 active:scale-[0.98] ${
                activeTab === 'my-attendance'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
              }`}
            >
              <CalendarCheck className="w-4 h-4 shrink-0" />
              <span>My Attendance & Stats</span>
            </button>}

            {/* My Profile moved to the profile menu in the top bar */}

            {canOpenPage('team-attendance')&&(['admin', 'ceo'].includes(currentUser.role) || currentUser.teamPresenceAccess === true) && (
              <button
                onClick={() => handleTabClick('team-attendance', 'workspace')}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 active:scale-[0.98] ${
                  activeTab === 'team-attendance' && activeTeamSource === 'workspace'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                }`}
                data-active={activeTab === 'team-attendance' && activeTeamSource === 'workspace' ? 'true' : undefined}
                title="View all employees' time in and presence status"
              >
                <UserCheck className="w-4 h-4 shrink-0" />
                <span>Team Presence (P/A)</span>
              </button>
            )}

            {canOpenPage('leaves')&&<button
              onClick={() => onSelectTab('leaves')}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 active:scale-[0.98] ${
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
            </button>}

          </div>
        </div>

        {/* CRM (travel agency customers, follow-ups and CEO meetings). Hidden when CRM_ENABLED is false. */}
        {crmEnabled && (
          <div>
            <p className="px-3 text-[10px] font-bold tracking-wider uppercase text-slate-400 dark:text-slate-500 mb-2">
              CRM
            </p>
            <div className="space-y-1">
              {([
                { tab: 'crm-customers' as const, label: 'Customers', Icon: Contact, badge: crmBadges?.customersNew || 0, tone: 'bg-amber-500' },
                { tab: 'crm-tasks' as const, label: 'Follow-ups & Tasks', Icon: ClipboardList, badge: crmBadges?.tasksNew || 0, tone: 'bg-amber-500' },
                { tab: 'crm-meetings' as const, label: 'Meetings', Icon: CalendarClock, badge: (crmBadges?.meetingsNew || 0) + (crmBadges?.meetingsPending || 0), tone: 'bg-amber-500' },
              ]).filter(({tab})=>canOpenPage(tab)).map(({ tab, label, Icon, badge, tone }) => (
                <button
                  key={tab}
                  onClick={() => onSelectTab(tab)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 active:scale-[0.98] ${
                    activeTab === tab
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{label}</span>
                  </div>
                  {badge > 0 && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${tone} text-white`}>{badge}</span>
                  )}
                </button>
              ))}

              {canOpenPage('crm-customers')&&settings.customerPortalBetaEnabled !== false && (currentUser.role === 'admin' || currentUser.customerPortalAccess) && (
                <a
                  href="/customers"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50/80 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/50 border border-blue-200/80 dark:border-blue-800/60 transition-all duration-200 active:scale-[0.98]"
                  title="Open the public Bahaar Journeys Customers Page (/customers)"
                >
                  <div className="flex items-center gap-2.5">
                    <Globe className="w-4 h-4 shrink-0 text-blue-600 dark:text-blue-400" />
                    <span>Customer Portal</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-blue-600 text-white">
                      BETA
                    </span>
                    <ExternalLink className="w-3.5 h-3.5 text-blue-500" />
                  </div>
                </a>
              )}
            </div>
          </div>
        )}

        {/* Media Team: weekly social media posting calendar */}
        {crmEnabled && canOpenPage('crm-media') && (['admin', 'ceo'].includes(currentUser.role) || currentUser.mediaTeam) && (
          <div>
            <p className="px-3 text-[10px] font-bold tracking-wider uppercase text-slate-400 dark:text-slate-500 mb-2">Media Team</p>
            <div className="space-y-1 mb-1">
              <button
                onClick={() => onSelectTab('crm-media')}
                data-nav-media
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 active:scale-[0.98] ${
                  activeTab === 'crm-media' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center gap-3"><CalendarDays className="w-4 h-4 shrink-0" /><span>Posting Calendar</span></div>
              </button>
            </div>
          </div>
        )}

        {/* Sales coupons, inventory requests and notification history: for every employee. */}
        {crmEnabled && (
          <div>
            <p className="px-3 text-[10px] font-bold tracking-wider uppercase text-slate-400 dark:text-slate-500 mb-2">
              Office
            </p>
            <div className="space-y-1 mb-1">
              {([
                { tab: 'crm-sales' as const, label: 'Sales', Icon: Receipt, badge: (crmBadges?.salesNew || 0) + (crmBadges?.salesPending || 0) },
                { tab: 'crm-purchases' as const, label: 'Purchases', Icon: ShoppingBag, badge: 0 },
                { tab: 'crm-receipts' as const, label: 'Receipts', Icon: ReceiptText, badge: crmBadges?.receiptNew || 0 },
                { tab: 'crm-invoices' as const, label: 'Invoices', Icon: FileText, badge: crmBadges?.invoiceNew || 0 },
                { tab: 'crm-payment-tree' as const, label: 'Payment Tree', Icon: GitBranch, badge: 0 },
                { tab: 'crm-profit' as const, label: 'Profit & Commission', Icon: Coins, badge: 0 },
                { tab: 'crm-portal' as const, label: 'Portal Control', Icon: SlidersHorizontal, badge: 0 },
                { tab: 'crm-notifications' as const, label: 'Notifications', Icon: BellRing, badge: crmBadges?.unreadTotal || 0 },
              ]).filter((i) => canOpenPage(i.tab)).filter((i) => i.tab !== 'crm-sales' || ['admin', 'accounts', 'ceo'].includes(currentUser.role) || Boolean(currentUser.salesAccess)).filter((i) => (i.tab !== 'crm-payment-tree' && i.tab !== 'crm-profit') || ['admin', 'accounts', 'ceo'].includes(currentUser.role)).filter((i) => i.tab !== 'crm-portal' || (['admin', 'ceo'].includes(currentUser.role) && settings.customerPortalBetaEnabled !== false)).map(({ tab, label, Icon, badge }) => (
                <button
                  key={tab}
                  onClick={() => onSelectTab(tab)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 active:scale-[0.98] ${
                    activeTab === tab
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{label}</span>
                  </div>
                  {badge > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500 text-white">{badge}</span>}
                </button>
              ))}
            </div>
            {canOpenPage('crm-inventory')&&<button
              onClick={() => onSelectTab('crm-inventory')}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 active:scale-[0.98] ${
                activeTab === 'crm-inventory'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
              }`}
            >
              <div className="flex items-center gap-3">
                <Package className="w-4 h-4 shrink-0" />
                <span>Inventory</span>
              </div>
              {(crmBadges?.inventoryNew || 0) > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500 text-white">{crmBadges?.inventoryNew}</span>
              )}
            </button>}
          </div>
        )}

        {/* Accounts Officer Center (Attendance Verification & Reports) */}
        {currentUser.role === 'accounts' && (
          <div>
            <p className="px-3 text-[10px] font-bold tracking-wider uppercase text-emerald-600 dark:text-emerald-400 mb-2">
              Accounts & Audit
            </p>
            <div className="space-y-1">
              {canOpenPage('team-attendance')&&<button
                onClick={() => onSelectTab('team-attendance')}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 active:scale-[0.98] ${
                  activeTab === 'team-attendance'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                }`}
              >
                <UserCheck className="w-4 h-4 shrink-0" />
                <span>Attendance Verification</span>
              </button>}

              {canOpenPage('insights')&&<button
                onClick={() => onSelectTab('insights')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 active:scale-[0.98] ${
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
              </button>}

              {canOpenPage('reports')&&<button
                onClick={() => onSelectTab('reports')}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 active:scale-[0.98] ${
                  activeTab === 'reports'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                }`}
              >
                <FileSpreadsheet className="w-4 h-4 shrink-0" />
                <span>Reports & Payroll</span>
              </button>}
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
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 active:scale-[0.98] ${
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
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 active:scale-[0.98] ${
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
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 active:scale-[0.98] ${
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
                onClick={() => handleTabClick('team-attendance', 'admin')}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 active:scale-[0.98] ${
                  activeTab === 'team-attendance' && activeTeamSource === 'admin'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                }`}
              data-active={activeTab === 'team-attendance' && activeTeamSource === 'admin' ? 'true' : undefined}
                >
                <UserCheck className="w-4 h-4 shrink-0" />
                <span>Team Roster & Logs</span>
              </button>

              <button
                onClick={() => onSelectTab('insights')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 active:scale-[0.98] ${
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
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 active:scale-[0.98] ${
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
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 active:scale-[0.98] ${
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
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 active:scale-[0.98] ${
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
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 active:scale-[0.98] ${
                  activeTab === 'settings'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                }`}
              >
                <Settings className="w-4 h-4 shrink-0" />
                <span>Office & Server Settings</span>
              </button>
              {currentUser.isSuperAdmin&&<button onClick={()=>handleTabClick('superadmin')} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-bold transition-all ${activeTab==='superadmin'?'bg-violet-700 text-white shadow-xs':'text-violet-800 bg-violet-50 hover:bg-violet-100 dark:text-violet-200 dark:bg-violet-950/40 dark:hover:bg-violet-900/50'}`}><ShieldCheck className="w-4 h-4"/><span>Super Admin Console</span></button>}
            </div>
          </div>
        )}
      </div>
      </div>

      {/* Footer Status */}
      <div className="mt-auto shrink-0 p-3 border-t border-slate-200/80 dark:border-slate-800/80 text-[11px] text-slate-500 dark:text-slate-400">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px]">Windows Server v2.4</span>
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" title="Server Active" />
        </div>
      </div>
    </aside>
    </>
  );
};
