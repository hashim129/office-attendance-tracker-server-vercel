import React from 'react';
import { ActiveDesktopTab } from '../../types';
import { CrmState } from '../../crm/useCrm';

type Tone = 'blue' | 'violet' | 'emerald' | 'amber' | 'rose' | 'slate';

// Whole class names are written out so the style sheet always includes them.
const TONES: Record<Tone, string> = {
  blue: 'from-blue-600 via-indigo-600 to-violet-600',
  violet: 'from-violet-600 via-purple-600 to-fuchsia-600',
  emerald: 'from-emerald-600 via-teal-600 to-cyan-600',
  amber: 'from-amber-500 via-orange-500 to-rose-500',
  rose: 'from-rose-600 via-pink-600 to-fuchsia-600',
  slate: 'from-slate-700 via-slate-800 to-indigo-900',
};

interface Hero { tone: Tone; line: string; chips?: string[] }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A short, friendly sentence for every page, so the site talks to the employee instead of only showing tables. */
function heroFor(tab: ActiveDesktopTab, crm: CrmState, isAdmin: boolean): Hero | null {
  const { badges, data } = crm;
  switch (tab) {
    case 'clock': return null; // the punch clock has its own greeting
    case 'my-attendance': return { tone: 'blue', line: 'Your days, hours and remarks in one place.' };
    case 'team-attendance': return { tone: 'blue', line: 'See who is in, on a break or away, right now.' };
    case 'leaves': return { tone: 'blue', line: 'Need time off? Ask here and get an answer quickly.' };
    case 'insights': return { tone: 'slate', line: 'Trends that show how the team is really doing.' };
    case 'employees': return { tone: 'slate', line: 'Everyone on the team, their roles and access.' };
    case 'shifts': return { tone: 'slate', line: 'Set when the day starts, ends and who works when.' };
    case 'reports': return { tone: 'slate', line: 'Attendance, remarks and payroll ready to download.' };
    case 'settings': return { tone: 'slate', line: 'Office, network and security settings.' };
    case 'crm-customers': return { tone: 'violet', line: 'Every great trip starts with a good conversation.', chips: [plural(data.customers.length, 'customer')] };
    case 'crm-tasks': return {
      tone: 'violet',
      line: badges.tasksOpen > 0 ? `You have ${plural(badges.tasksOpen, 'follow-up')} waiting. One at a time, you've got this!` : 'You are all caught up. Nice work!',
      chips: badges.tasksNew > 0 ? [`${badges.tasksNew} new`] : [],
    };
    case 'crm-meetings': {
      const upcoming = data.meetings.filter((m) => m.status === 'scheduled' && Date.parse(m.endAt) >= Date.now()).length;
      return { tone: 'violet', line: upcoming ? `${plural(upcoming, 'CEO meeting')} coming up. Pick a free time or check what is booked.` : 'The CEO calendar is open. Pick a free time to book.', chips: isAdmin && badges.meetingsPending ? [`${badges.meetingsPending} waiting for approval`] : [] };
    }
    case 'crm-inventory': return { tone: 'amber', line: 'Need something for your desk? Ask here.', chips: badges.inventoryPending ? [`${badges.inventoryPending} to handle`] : [] };
    case 'crm-sales': return { tone: 'emerald', line: 'Every coupon is a happy traveller. Keep them coming!', chips: badges.salesPending ? [`${badges.salesPending} waiting`] : [] };
    case 'crm-purchases': return { tone: 'amber', line: 'Everything the office bought, tracked in one list.' };
    case 'crm-invoices': {
      const unpaid = data.invoices.filter((i) => i.status === 'unpaid').length;
      return { tone: 'emerald', line: unpaid ? `${plural(unpaid, 'invoice')} still waiting for payment.` : 'All invoices are settled. Lovely!', chips: badges.invoiceNew ? [`${badges.invoiceNew} new`] : [] };
    }
    case 'crm-receipts': return { tone: 'emerald', line: 'Money received, recorded and ready for Accounts.', chips: badges.receiptNew ? [`${badges.receiptNew} new`] : [] };
    case 'crm-notifications': return { tone: 'rose', line: badges.unreadTotal ? `${plural(badges.unreadTotal, 'new notification')} for you.` : 'Nothing new. You are up to date!' };
    default: return null;
  }
}

interface Props {
  tab: ActiveDesktopTab;
  name: string;
  isAdmin: boolean;
  crm: CrmState;
  now?: Date;
}

export const PageHero: React.FC<Props> = ({ tab, name, isAdmin, crm, now = new Date() }) => {
  const hero = heroFor(tab, crm, isAdmin);
  if (!hero) return null;
  const h = now.getHours();
  const greeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const first = (name || '').trim().split(/\s+/)[0] || 'there';
  return (
    <div className={`hero-card relative overflow-hidden rounded-2xl p-4 sm:p-5 mb-4 sm:mb-5 bg-gradient-to-r ${TONES[hero.tone]} text-white shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-3`}>
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
  );
};
