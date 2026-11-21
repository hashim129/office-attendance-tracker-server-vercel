import React, { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { ActiveDesktopTab, AttendanceRecord } from '../../types';
import { parseTimeToMinutes } from '../../lib/attendanceCalculations';
import { CrmState } from '../../crm/useCrm';

// Every page has its own colours. Whole class names are written out so the style sheet always includes them.
const GRADIENTS: Record<string, string> = {
  'my-attendance': 'from-sky-500 via-blue-600 to-indigo-600',
  'team-attendance': 'from-cyan-500 via-teal-500 to-emerald-500',
  leaves: 'from-amber-400 via-orange-500 to-pink-500',
  insights: 'from-fuchsia-600 via-purple-600 to-indigo-700',
  employees: 'from-slate-700 via-slate-800 to-blue-900',
  shifts: 'from-indigo-500 via-blue-700 to-cyan-600',
  reports: 'from-emerald-600 via-green-600 to-lime-500',
  settings: 'from-zinc-700 via-neutral-800 to-slate-900',
  'crm-customers': 'from-violet-600 via-purple-600 to-pink-500',
  'crm-tasks': 'from-rose-500 via-fuchsia-600 to-violet-600',
  'crm-meetings': 'from-indigo-600 via-violet-600 to-fuchsia-600',
  'crm-inventory': 'from-orange-500 via-amber-500 to-yellow-500',
  'crm-sales': 'from-emerald-500 via-teal-600 to-cyan-600',
  'crm-purchases': 'from-teal-600 via-cyan-600 to-sky-600',
  'crm-invoices': 'from-blue-600 via-indigo-600 to-purple-600',
  'crm-receipts': 'from-lime-600 via-emerald-600 to-teal-600',
  'crm-notifications': 'from-rose-600 via-pink-600 to-orange-500',
};
const FALLBACK_GRADIENT = 'from-blue-600 via-indigo-600 to-violet-600';

const PAGE_TITLES: Record<string, string> = {
  'my-attendance': 'My Attendance', 'team-attendance': 'Team Presence', leaves: 'Leave Requests', insights: 'Smart Insights',
  employees: 'Team Roster', shifts: 'Shifts', reports: 'Reports & Payroll', settings: 'Settings', 'crm-customers': 'Customers',
  'crm-tasks': 'Follow-ups & Tasks', 'crm-meetings': 'Meetings', 'crm-inventory': 'Inventory', 'crm-sales': 'Sales',
  'crm-purchases': 'Purchases', 'crm-invoices': 'Invoices', 'crm-receipts': 'Receipts', 'crm-notifications': 'Notifications',
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
    case 'leaves': return { line: 'Need time off? Ask here and get an answer quickly.' };
    case 'insights': return { line: 'Trends that show how the team is really doing.' };
    case 'employees': return { line: 'Everyone on the team, their roles and access.' };
    case 'shifts': return { line: 'Set when the day starts, ends and who works when.' };
    case 'reports': return { line: 'Attendance, remarks and payroll ready to download.' };
    case 'settings': return { line: 'Office, network and security settings.' };
    case 'crm-customers': return { line: 'Every great trip starts with a good conversation.', chips: [plural(data.customers.length, 'customer'), ...(badges.customersNew > 0 ? [`${badges.customersNew} new`] : [])] };
    case 'crm-tasks': return {
      line: badges.tasksOpen > 0 ? `You have ${plural(badges.tasksOpen, 'follow-up')} waiting. One at a time, you've got this!` : 'You are all caught up. Nice work!',
      chips: badges.tasksNew > 0 ? [`${badges.tasksNew} new`] : [],
    };
    case 'crm-meetings': {
      const upcoming = data.meetings.filter((m) => m.status === 'scheduled' && Date.parse(m.endAt) >= Date.now()).length;
      return { line: upcoming ? `${plural(upcoming, 'CEO meeting')} coming up. Pick a free time or check what is booked.` : 'The CEO calendar is open. Pick a free time to book.', chips: isAdmin && badges.meetingsPending ? [`${badges.meetingsPending} waiting for approval`] : [] };
    }
    case 'crm-inventory': return { line: 'Need something for your desk? Ask here.', chips: badges.inventoryPending ? [`${badges.inventoryPending} to handle`] : [] };
    case 'crm-sales': return { line: 'Every coupon is a happy traveller. Keep them coming!', chips: badges.salesPending ? [`${badges.salesPending} waiting`] : [] };
    case 'crm-purchases': return { line: 'Everything the office bought, tracked in one list.' };
    case 'crm-invoices': {
      const unpaid = data.invoices.filter((i) => i.status === 'unpaid').length;
      return { line: unpaid ? `${plural(unpaid, 'invoice')} still waiting for payment.` : 'All invoices are settled. Lovely!', chips: badges.invoiceNew ? [`${badges.invoiceNew} new`] : [] };
    }
    case 'crm-receipts': return { line: 'Money received, recorded and ready for Accounts.', chips: badges.receiptNew ? [`${badges.receiptNew} new`] : [] };
    case 'crm-notifications': return { line: badges.unreadTotal ? `${plural(badges.unreadTotal, 'new notification')} for you.` : 'Nothing new. You are up to date!' };
    default: return null;
  }
}

interface Props {
  tab: ActiveDesktopTab;
  name: string;
  isAdmin: boolean;
  crm: CrmState;
  /** Today's attendance record of the signed-in person (drives the live punch-in time in the sticky bar). */
  todayRecord?: AttendanceRecord;
  unreadDirectives?: number;
  onNavigate?: (tab: ActiveDesktopTab) => void;
}

const pad = (n: number) => String(n).padStart(2, '0');

export const PageHero: React.FC<Props> = ({ tab, name, isAdmin, crm, todayRecord, unreadDirectives = 0, onNavigate }) => {
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
  const h = now.getHours();
  const greeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const first = (name || '').trim().split(/\s+/)[0] || 'there';
  const grad = GRADIENTS[tab] || FALLBACK_GRADIENT;
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
          className={`absolute inset-x-0 top-0 flex items-center justify-between gap-3 rounded-xl px-3 sm:px-4 py-2 bg-gradient-to-r ${grad} text-white shadow-lg shadow-slate-900/20 transition-all duration-300 ease-out ${stuck ? 'translate-y-0 opacity-100' : '-translate-y-6 opacity-0 pointer-events-none'}`}
        >
          <div className="min-w-0 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-white/90 animate-pulse shrink-0" />
            <p className="text-sm font-extrabold truncate min-w-[4rem]">{PAGE_TITLES[tab] || 'Dashboard'}</p>
            <p className="hidden md:block text-xs text-white/80 truncate">· {greeting}, {first}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate?.('crm-notifications')}
              className="relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 hover:bg-white/25 border border-white/25 text-[11px] font-bold cursor-pointer"
              tabIndex={stuck ? 0 : -1}
            >
              <Bell className="w-3.5 h-3.5" />
              <span className={unread > 0 ? '' : 'hidden sm:inline'}>{unread > 0 ? `${unread} new` : 'All caught up'}</span>
              {unread > 0 && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-300 animate-ping" />}
            </button>
            <button
              type="button"
              onClick={() => onNavigate?.('clock')}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/25 hover:bg-black/35 border border-white/20 text-[11px] font-bold font-mono cursor-pointer"
              tabIndex={stuck ? 0 : -1}
            >
              <span className={`w-2 h-2 rounded-full ${punch.live ? 'bg-emerald-300 animate-pulse' : 'bg-white/60'}`} />
              <span>{punch.text}</span>
            </button>
          </div>
        </div>
      </div>

      <div ref={heroRef} className={`hero-card relative overflow-hidden rounded-2xl p-4 sm:p-5 mb-4 sm:mb-5 bg-gradient-to-r ${grad} text-white shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-3`}>
        <span aria-hidden className="hero-blob pointer-events-none absolute -right-10 -top-12 w-44 h-44 rounded-full bg-white/10" />
        <span aria-hidden className="hero-blob-slow pointer-events-none absolute right-24 -bottom-16 w-36 h-36 rounded-full bg-white/10" />
        <div className="relative min-w-0">
          <h2 className="text-lg sm:text-xl font-extrabold leading-tight tracking-tight">{greeting}, {first}!</h2>
          <p className="text-xs sm:text-sm text-white/85 mt-0.5">{hero.line}</p>
        </div>
        {hero.chips && hero.chips.length > 0 && (
          <div className="relative flex flex-wrap items-center gap-2 text-[11px] font-semibold shrink-0">
            {hero.chips.map((c) => (
              <span key={c} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 border border-white/25 backdrop-blur-sm">
                <span className="w-2 h-2 rounded-full bg-white/90 animate-pulse" />
                {c}
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  );
};
