import React, { useMemo, useState } from 'react';
import { fmtTime } from './ui';

/** Something already in the CEO's schedule. */
export interface CeoBusy { id: string; title: string; startAt: string; endAt: string; kind?: string }

export const SLOT_MIN = 15;
export const SLOT_CHOICES = [15, 30, 45, 60];
const FIRST_HOUR = 8;
const LAST_HOUR = 20; // slots run from 8:00 am to 8:00 pm
const SLOT_MS = SLOT_MIN * 60000;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const slotsOfDay = (dayMs: number) => {
  const out: number[] = [];
  for (let t = dayMs + FIRST_HOUR * 3600000; t < dayMs + LAST_HOUR * 3600000; t += SLOT_MS) out.push(t);
  return out;
};

/** Everything that books the CEO: scheduled meetings, requests waiting for approval and Meeting follow-ups. */
export const ceoBusyList = (
  meetings: { id: string; title: string; startAt: string; endAt: string; status: string }[],
  booked: CeoBusy[],
): CeoBusy[] => [
  ...meetings.filter((m) => m.status === 'scheduled' || m.status === 'pending_approval')
    .map((m) => ({ id: m.id, title: m.status === 'scheduled' ? m.title : `${m.title} (waiting for approval)`, startAt: m.startAt, endAt: m.endAt, kind: m.status === 'scheduled' ? 'meeting' : 'request' })),
  ...booked.filter((b) => !meetings.some((m) => m.id === b.id)),
];

const busyAt = (busy: CeoBusy[], t: number) => busy.find((b) => Date.parse(b.startAt) < t + SLOT_MS && Date.parse(b.endAt) > t);

interface Props {
  busy: CeoBusy[];
  /** a booking that is being edited: its own time does not count as busy */
  exceptId?: string;
  /** picker mode: chosen start (ISO) and length in minutes */
  startIso?: string | null;
  minutes?: number;
  onChange?: (startIso: string, minutes: number) => void;
  /** overview mode (no length chips): a free slot was tapped */
  onPick?: (startIso: string) => void;
  now?: number;
}

/** CEO's day in 15-minute slots. Free slots are green; booked ones are grey and cannot be chosen. */
export const CeoSlotPicker: React.FC<Props> = ({ busy: allBusy, exceptId, startIso, minutes = SLOT_MIN, onChange, onPick, now = Date.now() }) => {
  const busy = useMemo(() => allBusy.filter((b) => b.id !== exceptId), [allBusy, exceptId]);
  const today = startOfDay(new Date(now));
  const [day, setDay] = useState<number>(() => (startIso ? startOfDay(new Date(startIso)) : today));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => today + i * 86400000), [today]);
  const chosen = startIso ? Date.parse(startIso) : NaN;
  const isFree = (t: number) => t >= now && !busyAt(busy, t);
  const freeCount = (d: number) => slotsOfDay(d).filter(isFree).length;
  const slots = slotsOfDay(day);
  const firstFree = slots.find(isFree);
  // how many 15-minute slots in a row are free from the chosen start
  const run = (t: number) => { let n = 0; while (n < 4 && isFree(t + n * SLOT_MS) && t + n * SLOT_MS < day + LAST_HOUR * 3600000) n++; return n; };
  const freeRun = Number.isFinite(chosen) ? run(chosen) : 0;

  const pick = (t: number) => {
    if (onPick) { onPick(new Date(t).toISOString()); return; }
    const n = run(t);
    onChange?.(new Date(t).toISOString(), Math.min(minutes, n * SLOT_MIN) || SLOT_MIN);
  };

  const hours: number[][] = [];
  for (let i = 0; i < slots.length; i += 4) hours.push(slots.slice(i, i + 4));

  return (
    <div className="space-y-2" data-ceo-slots>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {days.map((d) => {
          const free = freeCount(d);
          const active = d === day;
          return (
            <button key={d} type="button" onClick={() => setDay(d)}
              className={`shrink-0 px-2.5 py-1.5 rounded-lg border text-[11px] cursor-pointer transition-all active:scale-[0.97] ${active ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
              <span className="block font-semibold">{new Date(d).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}</span>
              <span className="block text-[10px] opacity-80">{free ? `${free} free` : 'Fully booked'}</span>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-600 dark:text-slate-300">
        {firstFree !== undefined
          ? <><b className="text-emerald-700 dark:text-emerald-400">{slots.filter(isFree).length} free slots</b> of 15 minutes left · next free at <b>{fmtTime(new Date(firstFree).toISOString())}</b></>
          : <b className="text-red-600">No free slots left on this day. Please pick another day.</b>}
      </p>
      <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
        {hours.map((row) => (
          <div key={row[0]} className="grid grid-cols-4 gap-1">
            {row.map((t) => {
              const b = busyAt(busy, t);
              const past = t < now;
              const selected = Number.isFinite(chosen) && t >= chosen && t < chosen + minutes * 60000;
              const cls = selected ? 'bg-blue-600 border-blue-600 text-white'
                : b ? 'bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-400 line-through cursor-not-allowed'
                : past ? 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-300 dark:text-slate-600 cursor-not-allowed'
                : 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 cursor-pointer';
              return (
                <button key={t} type="button" disabled={Boolean(b) || past} onClick={() => pick(t)} title={b ? `Booked: ${b.title} (${fmtTime(b.startAt)} – ${fmtTime(b.endAt)})` : past ? 'Time has passed' : 'Free'}
                  className={`px-1 py-1 rounded-md border text-[11px] font-semibold transition-colors ${cls}`}>
                  {fmtTime(new Date(t).toISOString())}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {!onPick && (
        <div>
          <span className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Length {Number.isFinite(chosen) ? `· starts ${fmtTime(new Date(chosen).toISOString())}` : '· tap a free time first'}</span>
          <div className="flex flex-wrap gap-1.5">
            {SLOT_CHOICES.map((m) => {
              const ok = freeRun * SLOT_MIN >= m;
              return (
                <button key={m} type="button" disabled={!ok} onClick={() => onChange?.(new Date(chosen).toISOString(), m)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${minutes === m && ok ? 'bg-blue-600 border-blue-600 text-white' : ok ? 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800' : 'border-slate-200 dark:border-slate-800 text-slate-300 dark:text-slate-600 cursor-not-allowed'}`}>
                  {m} min{m > 15 ? ` (${m / 15} slots)` : ''}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
