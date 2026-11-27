import React, { useMemo } from 'react';
import type { AttendanceRecord, ShiftSchedule } from '../../types';
import { calculateWorkedMinutes, getCurrentTimeString, getTodayDateString, isLateArrival } from '../../lib/attendanceCalculations';
import type { CrmBusiness } from '../../crm/crmApi';

/** "My week" card on the Punch page: hours, on-time days and (for sales staff) this month against the target. */
export const MyWeekCard: React.FC<{ records: AttendanceRecord[]; employeeId: string; shift?: ShiftSchedule; business?: CrmBusiness | null }> = ({ records, employeeId, shift, business }) => {
  const stats = useMemo(() => {
    const today = getTodayDateString();
    const t = new Date(`${today}T00:00:00Z`);
    const monday = new Date(t.getTime() - ((t.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
    const mine = records.filter((r) => r.employeeId === employeeId && r.date >= monday && r.date <= today && r.timeIn);
    let minutes = 0;
    for (const r of mine) {
      try { minutes += Math.max(0, calculateWorkedMinutes(r.timeIn, r.timeOut || (r.date === today ? getCurrentTimeString() : undefined), r.breaks).totalWorkedMinutes || 0); } catch { /* skip */ }
    }
    const onTime = shift ? mine.filter((r) => !isLateArrival(r.timeIn, shift)).length : mine.length;
    return { days: mine.length, hours: Math.floor(minutes / 60), mins: minutes % 60, onTime };
  }, [records, employeeId, shift]);
  const me = business?.me;
  const cur = business?.targets?.currency || 'PKR';
  const pct = me && me.target > 0 ? Math.min(100, Math.round((me.amount / me.target) * 100)) : 0;
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4" data-my-week>
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">My week</p>
      <div className="mt-3 grid grid-cols-3 gap-3 text-center">
        <div><p className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">{stats.hours}h {String(stats.mins).padStart(2, '0')}m</p><p className="text-[11px] text-slate-500">worked</p></div>
        <div><p className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">{stats.days}</p><p className="text-[11px] text-slate-500">days in</p></div>
        <div><p className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">{stats.onTime}/{stats.days}</p><p className="text-[11px] text-slate-500">on time</p></div>
      </div>
      {me && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-medium text-slate-700 dark:text-slate-200">Sales this month · {me.count} invoice{me.count === 1 ? '' : 's'}</span>
            <span className="tabular-nums text-slate-500">{cur} {Math.round(me.amount).toLocaleString()}{me.target > 0 ? ` / ${Math.round(me.target).toLocaleString()}` : ''}</span>
          </div>
          {me.target > 0 && <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden"><div className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-blue-600'}`} style={{ width: `${pct}%` }} /></div>}
          {me.target > 0 && <p className="mt-1 text-[11px] text-slate-500">{pct >= 100 ? 'Target reached this month. Well done.' : `${pct}% of your monthly target`}</p>}
        </div>
      )}
    </div>
  );
};
export default MyWeekCard;
