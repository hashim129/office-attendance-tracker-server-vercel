import React, { useEffect, useRef, useState } from 'react';
import { hasProfilePicture } from '../../lib/profilePictures';
import { Bell } from 'lucide-react';
import { ActiveDesktopTab, AttendanceRecord } from '../../types';
import { parseTimeToMinutes } from '../../lib/attendanceCalculations';
import { CrmState } from '../../crm/useCrm';
import { EmployeeAvatar } from './EmployeeIdentity';

// Each page keeps one quiet accent colour (a thin bar and dot), instead of loud multi-colour gradients.
const ACCENTS: Record<string, string> = {
  'my-attendance': '#2563eb', 'team-attendance': '#0d9488', leaves: '#d97706', insights: '#7c3aed', employees: '#334155',
  shifts: '#4f46e5', reports: '#16a34a', settings: '#52525b', 'crm-customers': '#7c3aed', 'crm-tasks': '#e11d48',
  'crm-meetings': '#4f46e5', 'crm-inventory': '#ea580c', 'crm-sales': '#059669', 'crm-purchases': '#0891b2',
  'crm-invoices': '#2563eb', 'crm-receipts': '#16a34a', 'crm-payment-tree': '#4f46e5', 'crm-media': '#c13584',
  'crm-portal': '#0284c7', 'crm-notifications': '#e11d48', 'live-dashboard': '#2563eb',
};
const FALLBACK_ACCENT = '#2563eb';

const PAGE_TITLES: Record<string, string> = {
  'my-attendance': 'My Attendance', 'team-attendance': 'Team Presence', leaves: 'Leave Requests', insights: 'Smart Insights',
  employees: 'Team Roster', shifts: 'Shifts', reports: 'Reports & Payroll', settings: 'Settings', 'crm-customers': 'Customers',
  'crm-tasks': 'Follow-ups & Tasks', 'crm-meetings': 'Meetings', 'crm-inventory': 'Inventory', 'crm-sales': 'Sales',
  'crm-purchases': 'Purchases', 'crm-invoices': 'Invoices', 'crm-receipts': 'Receipts', 'crm-payment-tree': 'Payment Tree', 'crm-media': 'Posting Calendar', 'crm-portal': 'Portal Control', 'crm-notifications': 'Notifications', 'live-dashboard': 'Live Dashboard',
};

interface Hero { line: string; chips?: string[] }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A short, friendly sentence for every page, so the site talks to the employee instead of only showing tables. */
function heroFor(tab: ActiveDesktopTab, crm: CrmState, isAdmin: boolean): Hero | null {
  const { badges, data } = crm;
  switch (tab) {
    case 'clock': return null; // the punch clock has its own greeting
    case 'my-attendance': return { line: 'Your days, hours and remarks in one place.' };
    case 'team-attendance': return { line: 'See who is in, on a break or away, right now.' };
    case 'leaves': return { line: 'Apply for leave and see the decision.' };
    case 'insights': return { line: 'Trends that show how the team is really doing.' };
    case 'employees': return { line: 'Everyone on the team, their roles and access.' };
    case 'shifts': return { line: 'Set when the day starts, ends and who works when.' };
    case 'reports': return { line: 'Attendance, remarks and payroll ready to download.' };
    case 'settings': return { line: 'Office, network and security settings.' };
    case 'crm-customers': return { line: 'Customers you have added or that are shared with you.', chips: [plural(data.customers.length, 'customer'), ...(badges.customersNew > 0 ? [`${badges.customersNew} new`] : [])] };
    case 'crm-tasks': return {
      line: badges.tasksOpen > 0 ? `${plural(badges.tasksOpen, 'follow-up')} open.` : 'No open follow-ups.',
      chips: badges.tasksNew > 0 ? [`${badges.tasksNew} new`] : [],
    };
    case 'crm-meetings': {
      const upcoming = data.meetings.filter((m) => m.status === 'scheduled' && Date.parse(m.endAt) >= Date.now()).length;
      return { line: upcoming ? `${plural(upcoming, 'CEO meeting')} coming up. Pick a free time or check what is booked.` : 'The CEO calendar is open. Pick a free time to book.', chips: isAdmin && badges.meetingsPending ? [`${badges.meetingsPending} waiting for approval`] : [] };
    }
    case 'crm-inventory': return { line: 'Request office items and track your requests.', chips: badges.inventoryPending ? [`${badges.inventoryPending} to handle`] : [] };
    case 'crm-sales': return { line: 'Added automatically from invoices. Counts towards sales targets.' };
    case 'crm-purchases': return { line: 'Everything the office bought, tracked in one list.' };
    case 'crm-invoices': {
      const unpaid = data.invoices.filter((i) => i.status === 'unpaid').length;
      return { line: unpaid ? `${plural(unpaid, 'invoice')} still waiting for payment.` : 'All invoices are settled.', chips: badges.invoiceNew ? [`${badges.invoiceNew} new`] : [] };
    }
    case 'crm-receipts': return { line: 'Money received, recorded and ready for Accounts.', chips: badges.receiptNew ? [`${badges.receiptNew} new`] : [] };
    case 'crm-payment-tree': return { line: 'Every invoice with its purchases, receipts and sales, linked in one tree.' };
    case 'crm-media': return { line: 'This week’s social media posts, platform by platform.' };
    case 'live-dashboard': return { line: 'Who is in, who is late and how the month is going, all in one live view.' };
    case 'crm-portal': return { line: 'Banner, offers, animations, destinations and WhatsApp for your customers, all in one place.' };
    case 'crm-notifications': return { line: badges.unreadTotal ? `${plural(badges.unreadTotal, 'new notification')} for you.` : 'No new notifications.' };
    default: return null;
  }
}

interface Props {
  tab: ActiveDesktopTab;
  name: string;
  characterId?: string;
  appearance?: Record<string, string>;
  petId?: string;
  employeeUniverseEnabled?: boolean;
  isAdmin: boolean;
  crm: CrmState;
  /** Today's attendance record of the signed-in person (drives the live punch-in time in the sticky bar). */
  todayRecord?: AttendanceRecord;
  unreadDirectives?: number;
  onNavigate?: (tab: ActiveDesktopTab) => void;
}

const pad = (n: number) => String(n).padStart(2, '0');

export const PageHero: React.FC<Props> = ({ tab, name, characterId, appearance, petId, employeeUniverseEnabled = false, isAdmin, crm, todayRecord, unreadDirectives = 0, onNavigate }) => {
  const hero = heroFor(tab, crm, isAdmin);
  const heroRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // The big banner folds into a slim bar once it scrolls out of view.
  useEffect(() => {
    const el = heroRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [tab, Boolean(hero)]);

  // The live clock only ticks while the slim bar is showing.
  useEffect(() => {
    if (!stuck) return;
    setNow(new Date());
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, [stuck]);

  if (!hero) return null;
  const accent = ACCENTS[tab] || FALLBACK_ACCENT;
  const unread = (crm.badges?.unreadTotal || 0) + unreadDirectives;

  let punch: { text: string; live: boolean } = { text: 'Not clocked in', live: false };
  if (todayRecord?.timeIn && !todayRecord.timeOut) {
    const start = parseTimeToMinutes(todayRecord.timeIn);
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const diff = nowMins >= start ? nowMins - start : nowMins + 1440 - start;
    punch = { text: `In · ${pad(Math.floor(diff / 60))}:${pad(diff % 60)}:${pad(now.getSeconds())}`, live: true };
  } else if (todayRecord?.timeOut) {
    punch = { text: 'Shift complete', live: false };
  }

  return (
    <>
      {/* Slim bar that stays on screen while scrolling: page name, new alerts and the live punch-in time */}
      <div className="sticky top-0 z-30 h-0" aria-hidden={!stuck}>
        <div
          className={`hero-bar absolute inset-x-0 top-0 flex items-center justify-between gap-3 rounded-xl px-3 sm:px-4 py-2 bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 shadow-sm transition-all duration-300 ease-out ${stuck ? 'translate-y-0 opacity-100' : '-translate-y-6 opacity-0 pointer-events-none'}`}
        >
          <div className="min-w-0 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: accent }} />
            <p className="text-sm font-semibold truncate min-w-[4rem]">{PAGE_TITLES[tab] || 'Dashboard'}</p>
            {((employeeUniverseEnabled && characterId) || hasProfilePicture(appearance)) && <EmployeeAvatar characterId={characterId} petId={petId} appearance={appearance} name={name} size="xs" />}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate?.('crm-notifications')}
              className="relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-[11px] font-semibold cursor-pointer"
              tabIndex={stuck ? 0 : -1}
            >
              <Bell className="w-3.5 h-3.5" />
              <span className={unread > 0 ? '' : 'hidden sm:inline'}>{unread > 0 ? `${unread} new` : 'No new'}</span>
              {unread > 0 && <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500" />}
            </button>
            <button
              type="button"
              onClick={() => onNavigate?.('clock')}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-[11px] font-semibold tabular-nums cursor-pointer"
              tabIndex={stuck ? 0 : -1}
            >
              <span className={`w-2 h-2 rounded-full ${punch.live ? 'bg-emerald-500' : 'bg-slate-300'}`} />
              <span>{punch.text}</span>
            </button>
          </div>
        </div>
      </div>

      <div ref={heroRef} className="hero-card relative overflow-hidden rounded-xl pl-5 pr-4 py-3.5 sm:py-4 mb-4 sm:mb-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <span aria-hidden className="absolute left-0 top-0 bottom-0 w-1" style={{ background: accent }} />
        <div className="relative min-w-0">
          <div className="flex items-center gap-2">
            {((employeeUniverseEnabled && characterId) || hasProfilePicture(appearance)) && <EmployeeAvatar characterId={characterId} petId={petId} appearance={appearance} name={name} size="sm" />}
            <h2 className="text-base sm:text-lg font-bold leading-tight text-slate-900 dark:text-slate-100">{PAGE_TITLES[tab] || 'Dashboard'}</h2>
          </div>
          <p className="text-xs sm:text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">{hero.line}</p>
        </div>
        {hero.chips && hero.chips.length > 0 && (
          <div className="relative flex flex-wrap items-center gap-2 text-[11px] font-medium shrink-0">
            {hero.chips.map((c) => (
              <span key={c} className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">{c}</span>
            ))}
          </div>
        )}
      </div>
    </>
  );
};
