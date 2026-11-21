import React from 'react';

export const inputCls =
  'w-full text-xs px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40';
export const cardCls = 'bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs';
export const btnPrimary =
  'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-all duration-200 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer';
export const btnGhost =
  'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200 active:scale-[0.97] disabled:opacity-50 cursor-pointer';
export const btnDanger =
  'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-red-300 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-all duration-200 active:scale-[0.97] disabled:opacity-50 cursor-pointer';

export const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <label className="block">
    <span className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">{label}</span>
    {children}
    {hint && <span className="block text-[10px] text-slate-400 mt-1">{hint}</span>}
  </label>
);

/** Reminders that need an answer: the shift-end question and the "still working?" question before auto punch-out. */
export const isWorkPrompt = (id: unknown): boolean => /-(end|ask-\d+-\d+)$/.test(String(id));

export const Pill: React.FC<{ tone: 'blue' | 'green' | 'amber' | 'red' | 'slate' | 'violet'; children: React.ReactNode }> = ({ tone, children }) => {
  const tones = {
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border-blue-200 dark:border-blue-900',
    green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border-amber-200 dark:border-amber-900',
    red: 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300 border-red-200 dark:border-red-900',
    slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700',
    violet: 'bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300 border-violet-200 dark:border-violet-900',
  }[tone];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${tones}`}>{children}</span>;
};

export const ErrorNote: React.FC<{ message: string }> = ({ message }) =>
  message ? (
    <div role="alert" className="text-xs px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900">
      {message}
    </div>
  ) : null;

export const fmtDateTime = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};
export const fmtTime = (iso: string): string => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const fmtDay = (iso: string): string => new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

/** ISO string -> value for <input type="datetime-local"> in the viewer's local time. */
export const toLocalInput = (iso?: string | null): string => {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const fromLocalInput = (v: string): string | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

export const KIND_LABEL: Record<string, string> = { meeting: 'Meeting follow-up', corporate: 'Corporate follow-up', internal: 'Internal follow-up', regular: 'Regular customers follow-up', personal: 'Personal follow-up' };
/** Each category has its own colour so a list can be read at a glance. */
export const KIND_TONE: Record<string, 'blue' | 'green' | 'amber' | 'red' | 'slate' | 'violet'> = { meeting: 'violet', corporate: 'blue', internal: 'slate', regular: 'green', personal: 'amber' };
export const KIND_BAR: Record<string, string> = { meeting: 'border-l-violet-500', corporate: 'border-l-blue-500', internal: 'border-l-slate-400', regular: 'border-l-emerald-500', personal: 'border-l-amber-500' };
export const STATUS_LABEL: Record<string, string> = { pending: 'Pending', completed: 'Completed', not_completed: 'Not completed', rescheduled: 'Rescheduled' };

// ---------------------------------------------------------------- Add to calendar
export interface CalEvent {
  title: string;
  startIso: string;
  endIso?: string; // defaults to 30 minutes after the start
  location?: string;
  description?: string;
}

const utcStamp = (iso: string): string => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const endOf = (ev: CalEvent): string => ev.endIso || new Date(Date.parse(ev.startIso) + 30 * 60000).toISOString();
const icsEscape = (v: string): string => v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

export const googleCalendarUrl = (ev: CalEvent): string => {
  const q = new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates: `${utcStamp(ev.startIso)}/${utcStamp(endOf(ev))}` });
  if (ev.location) q.set('location', ev.location);
  if (ev.description) q.set('details', ev.description);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
};

/** Standard calendar file: opens in Outlook, Apple Calendar and most phone calendars. */
export const downloadIcs = (ev: CalEvent): void => {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Office Attendance Tracker//CRM//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${Date.parse(ev.startIso)}-${Math.random().toString(36).slice(2, 10)}@office-attendance`,
    `DTSTAMP:${utcStamp(new Date().toISOString())}`,
    `DTSTART:${utcStamp(ev.startIso)}`,
    `DTEND:${utcStamp(endOf(ev))}`,
    `SUMMARY:${icsEscape(ev.title)}`,
    ...(ev.description ? [`DESCRIPTION:${icsEscape(ev.description)}`] : []),
    ...(ev.location ? [`LOCATION:${icsEscape(ev.location)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${ev.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'event'}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** "Add to calendar" button for anyone: the date and time are already set by whoever created the item. */
export const AddToCalendar: React.FC<{ event: CalEvent }> = ({ event }) => {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="relative inline-block" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <button type="button" className={btnGhost} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        Add to calendar
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg p-1">
          <a
            role="menuitem"
            href={googleCalendarUrl(event)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 rounded-md text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Google Calendar
          </a>
          <button
            role="menuitem"
            type="button"
            onClick={() => { downloadIcs(event); setOpen(false); }}
            className="w-full text-left px-3 py-2 rounded-md text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            Outlook / Apple / phone (.ics file)
          </button>
        </div>
      )}
    </div>
  );
};

/** Re-renders every second (or the given interval) so countdowns stay live. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** "2d 3h", "1h 05m 12s", "4m 09s" — always the two or three most useful units. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (d > 0) return `${d}d ${h}h ${pad(m)}m`;
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
  return `${m}m ${pad(s)}s`;
}

/**
 * Live remaining time. For a meeting pass endIso too: it then says "Starts in…", "In progress" and "Ended".
 * For a follow-up/task it says "Due in…" and "Overdue by…".
 */
export const Countdown: React.FC<{ atIso: string | null | undefined; endIso?: string | null; kind: 'due' | 'start' }> = ({ atIso, endIso, kind }) => {
  const now = useNow(1000);
  if (!atIso) return null;
  const at = Date.parse(atIso);
  if (!Number.isFinite(at)) return null;
  const diff = at - now;
  let text: string;
  let cls: string;
  if (kind === 'start' && endIso && now >= Date.parse(endIso)) {
    text = `Ended ${formatRemaining(now - Date.parse(endIso))} ago`;
    cls = 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
  } else if (kind === 'start' && endIso && now >= at && now < Date.parse(endIso)) {
    text = `In progress · ends in ${formatRemaining(Date.parse(endIso) - now)}`;
    cls = 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900';
  } else if (diff <= 0) {
    text = kind === 'start' ? `Started ${formatRemaining(-diff)} ago` : `Overdue by ${formatRemaining(-diff)}`;
    cls = 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-900';
  } else {
    text = `${kind === 'start' ? 'Starts in' : 'Due in'} ${formatRemaining(diff)}`;
    cls = diff < 3600000
      ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900'
      : 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900';
  }
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold font-mono tabular-nums border whitespace-nowrap ${cls}`} title="Live remaining time">{text}</span>;
};

const SEG_COLOR = { green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500', blue: 'bg-blue-500', slate: 'bg-slate-400', violet: 'bg-violet-500' } as const;
export interface StatSegment { label: string; count: number; tone: keyof typeof SEG_COLOR }

/** One live stacked bar with a legend: "how many are in each state". It redraws whenever the page data refreshes. */
export const StatBar: React.FC<{ title: string; segments: StatSegment[] }> = ({ title, segments }) => {
  const total = segments.reduce((a, s) => a + s.count, 0);
  return (
    <div className={`${cardCls} p-4`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">{title}</h3>
        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live · {total} total</span>
      </div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="img" aria-label={segments.map((s) => `${s.label} ${s.count}`).join(', ')}>
        {total > 0 && segments.filter((s) => s.count > 0).map((s) => (
          <div key={s.label} className={`${SEG_COLOR[s.tone]} transition-all duration-500`} style={{ width: `${(s.count / total) * 100}%` }} title={`${s.label}: ${s.count}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {segments.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
            <span className={`w-2.5 h-2.5 rounded-sm ${SEG_COLOR[s.tone]}`} />
            {s.label} <b className="font-mono tabular-nums text-slate-900 dark:text-slate-100">{s.count}</b>
            {total > 0 && <span className="text-slate-400">({Math.round((s.count / total) * 100)}%)</span>}
          </span>
        ))}
      </div>
    </div>
  );
};
