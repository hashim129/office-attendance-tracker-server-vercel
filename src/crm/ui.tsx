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

export const KIND_LABEL: Record<string, string> = { meeting: 'Meeting follow-up', corporate: 'Corporate follow-up', internal: 'Internal follow-up', regular: 'Regular customers follow-up' };
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
