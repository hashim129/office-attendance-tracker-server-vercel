import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Cake, Flame, PartyPopper, X } from 'lucide-react';
import { AttendanceRecord, Employee, ShiftSchedule } from '../../types';
import { isLateArrival } from '../../lib/attendanceCalculations';

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/* ------------------------------------------------------------------ */
/* On-time streak                                                      */
/* ------------------------------------------------------------------ */

/** Working days in a row (counting back from today) on which the employee punched in on time. Today only counts once punched in. */
export function computeStreak(records: AttendanceRecord[], employeeId: string, shift: ShiftSchedule | undefined, workDays: number[], todayStr: string): number {
  if (!shift) return 0;
  const mine = new Map(records.filter((r) => r.employeeId === employeeId && r.timeIn).map((r) => [r.date, r]));
  let streak = 0;
  const d = new Date(`${todayStr}T12:00:00`);
  for (let i = 0; i < 120; i++) {
    if (workDays.includes(d.getDay())) {
      const r = mine.get(ymd(d));
      if (r) {
        if (isLateArrival(r.timeIn, shift)) break;
        streak++;
      } else if (i > 0) break;
    }
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

export const StreakChip: React.FC<{ streak: number }> = ({ streak }) => {
  if (streak < 2) return null;
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-400/25 border border-orange-200/40 text-white" title="Working days in a row that you punched in on time">
      <Flame className="w-3.5 h-3.5 text-amber-200 streak-flame" />
      {streak}-day on-time streak
    </span>
  );
};

/* ------------------------------------------------------------------ */
/* Punch-in celebration                                                */
/* ------------------------------------------------------------------ */

export const PunchCelebration: React.FC<{ name: string; late: boolean; streak: number; timeLabel: string; onDone: () => void }> = ({ name, late, streak, timeLabel, onDone }) => {
  // The parent re-renders every second, so keep the latest callback in a ref and start the timer only once.
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    const id = window.setTimeout(() => doneRef.current(), 3600);
    return () => window.clearTimeout(id);
  }, []);
  const bits = useMemo(
    () => Array.from({ length: 26 }, (_, i) => ({ a: (i / 26) * 360, d: 90 + ((i * 37) % 110), c: ['#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#a78bfa'][i % 5], s: 6 + (i % 4) * 2, t: (i % 6) * 0.04 })),
    [],
  );
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-900/40 backdrop-blur-[2px] pc-fade" onClick={onDone} role="status" aria-live="polite">
      <div className="relative w-[min(88vw,22rem)] rounded-3xl bg-white dark:bg-slate-900 p-7 text-center shadow-2xl pc-pop">
        <div className="pc-bits" aria-hidden="true">
          {bits.map((b, i) => (
            <span key={i} style={{ ['--a' as string]: `${b.a}deg`, ['--d' as string]: `${b.d}px`, background: b.c, width: b.s, height: b.s, animationDelay: `${b.t}s` }} />
          ))}
        </div>
        <svg viewBox="0 0 52 52" className="mx-auto w-20 h-20" aria-hidden="true">
          <circle className="pc-ring" cx="26" cy="26" r="23" fill="none" stroke={late ? '#f59e0b' : '#10b981'} strokeWidth="3.5" />
          <path className="pc-tick" d="M15 27l8 8 14-16" fill="none" stroke={late ? '#f59e0b' : '#10b981'} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h3 className="mt-3 text-lg font-extrabold text-slate-900 dark:text-slate-100">{late ? `Punched in, ${name}` : `You're on time, ${name}!`}</h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{late ? `Recorded at ${timeLabel}. Have a great day!` : `Punched in at ${timeLabel}. Have a great day!`}</p>
        {streak >= 2 && (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-orange-100 dark:bg-orange-900/40 px-3 py-1 text-xs font-bold text-orange-700 dark:text-orange-300">
            <Flame className="w-3.5 h-3.5 streak-flame" /> {streak}-day on-time streak
          </p>
        )}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Birthdays and work anniversaries                                    */
/* ------------------------------------------------------------------ */

export interface Moment {
  id: string;
  employeeId: string;
  name: string;
  kind: 'birthday' | 'anniversary';
  years: number;
  inDays: number; // 0 = today
  date: Date;
}

/** Birthdays and work anniversaries happening in the next `withinDays` days (0 = today only). */
export function getMoments(employees: Employee[], todayStr: string, withinDays = 0): Moment[] {
  const today = new Date(`${todayStr}T12:00:00`);
  const out: Moment[] = [];
  for (const e of employees) {
    if (!e.isActive) continue;
    const pairs: { kind: Moment['kind']; src?: string }[] = [
      { kind: 'birthday', src: e.birthday },
      { kind: 'anniversary', src: e.joinedDate },
    ];
    for (const { kind, src } of pairs) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(src || ''));
      if (!m) continue;
      for (let k = 0; k <= withinDays; k++) {
        const d = new Date(today);
        d.setDate(today.getDate() + k);
        if (d.getMonth() + 1 === Number(m[2]) && d.getDate() === Number(m[3])) {
          const years = d.getFullYear() - Number(m[1]);
          if (kind === 'anniversary' && years < 1) continue;
          out.push({ id: `${kind}-${e.id}-${ymd(d)}`, employeeId: e.id, name: e.name, kind, years, inDays: k, date: d });
        }
      }
    }
  }
  return out.sort((a, b) => a.inDays - b.inDays || a.kind.localeCompare(b.kind));
}

const dismissKey = (todayStr: string) => `bj_moments_${todayStr}`;
const readDismissed = (todayStr: string): string[] => {
  try {
    return JSON.parse(window.localStorage.getItem(dismissKey(todayStr)) || '[]');
  } catch {
    return [];
  }
};

/** Celebration cards for today's birthdays and anniversaries. Each can be closed for the day. */
export const MomentCards: React.FC<{ employees: Employee[]; currentUserId: string; todayStr: string }> = ({ employees, currentUserId, todayStr }) => {
  const [closed, setClosed] = useState<string[]>(() => readDismissed(todayStr));
  const moments = useMemo(() => getMoments(employees, todayStr, 0).filter((m) => !closed.includes(m.id)), [employees, todayStr, closed]);
  if (moments.length === 0) return null;
  const close = (id: string) => {
    const next = [...closed, id];
    setClosed(next);
    try {
      window.localStorage.setItem(dismissKey(todayStr), JSON.stringify(next));
    } catch {
      /* closes for this visit only */
    }
  };
  return (
    <div className="space-y-2">
      {moments.map((m) => {
        const mine = m.employeeId === currentUserId;
        const first = m.name.trim().split(/\s+/)[0];
        const birthday = m.kind === 'birthday';
        return (
          <div key={m.id} className={`moment-card relative overflow-hidden rounded-2xl p-4 text-white shadow-xs flex items-center gap-3 ${birthday ? 'bg-gradient-to-r from-pink-500 via-rose-500 to-orange-400' : 'bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500'}`}>
            <span className="moment-spark" aria-hidden="true" />
            <div className="w-11 h-11 rounded-2xl bg-white/20 flex items-center justify-center shrink-0 moment-bob">
              {birthday ? <Cake className="w-6 h-6" /> : <PartyPopper className="w-6 h-6" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm sm:text-base font-extrabold leading-tight">
                {birthday
                  ? mine ? `Happy Birthday, ${first}! 🎂` : `It's ${first}'s birthday today! 🎂`
                  : mine ? `${m.years} ${m.years === 1 ? 'year' : 'years'} with Bahaar Journeys, ${first}! 🎉` : `${first} completes ${m.years} ${m.years === 1 ? 'year' : 'years'} with us today 🎉`}
              </p>
              <p className="text-xs text-white/85 mt-0.5">{birthday ? (mine ? 'Wishing you a wonderful day from the whole team.' : 'Say a quick happy birthday when you see them.') : mine ? 'Thank you for being part of the journey.' : 'Congratulate them when you see them.'}</p>
            </div>
            <button aria-label="Close" onClick={() => close(m.id)} className="shrink-0 rounded-full p-1.5 hover:bg-white/20 cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
