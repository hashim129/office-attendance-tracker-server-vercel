import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, ArrowRight, CalendarCheck2, CalendarClock, CalendarDays, CalendarOff, CheckCircle2, Clock3, FileText, Home, Loader2, LogOut, Medal, PackageCheck, Target, Timer, TrendingUp, Trophy, UserX, Users, Wallet, WifiOff } from 'lucide-react';
import { ActiveDesktopTab, AttendanceRecord, Employee, LeaveRequest, ShiftSchedule } from '../../types';
import { getTodayDateString, isLateArrival, parseTimeToMinutes } from '../../lib/attendanceCalculations';
import { CrmState } from '../../crm/useCrm';
import { crmCall } from '../../crm/crmApi';
import { CountUp } from '../common/CountUp';

type State = 'in' | 'out' | 'leave' | 'absent' | 'waiting' | 'off';

interface Row {
  e: Employee;
  state: State;
  late: boolean;
  wfh: boolean;
  offline: boolean;
  timeIn?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const money = (n: number) => Math.round(n).toLocaleString('en-US');
const clock12 = (t?: string) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`;
};

const Card: React.FC<{ title: string; icon: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }> = ({ title, icon, right, children }) => (
  <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-xs">
    <div className="flex items-center justify-between gap-2 mb-3">
      <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">{icon}{title}</h3>
      {right}
    </div>
    {children}
  </section>
);

const Stat: React.FC<{ label: string; value: number; tone: string; icon: React.ReactNode }> = ({ label, value, tone, icon }) => (
  <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 shadow-xs">
    <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${tone}`}>{icon}</div>
    <p className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-slate-100"><CountUp value={value} /></p>
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
  </div>
);

interface Props {
  currentUser: Employee;
  employees: Employee[];
  records: AttendanceRecord[];
  shifts: ShiftSchedule[];
  leaves: LeaveRequest[];
  crm: CrmState;
  onNavigate: (tab: ActiveDesktopTab) => void;
  redesignedUiBetaEnabled?: boolean;
}

export const LiveDashboardTab: React.FC<Props> = ({ currentUser, employees, records, shifts, leaves, crm, onNavigate, redesignedUiBetaEnabled = false }) => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(id);
  }, []);
  const today = getTodayDateString();
  const isAdmin = ['admin', 'ceo'].includes(currentUser.role);

  const rows: Row[] = useMemo(() => {
    const shiftMap = new Map(shifts.map((s) => [s.id, s]));
    const dow = new Date(`${today}T12:00:00`).getDay();
    const mins = now.getHours() * 60 + now.getMinutes();
    return employees
      .filter((e) => e.isActive && e.id !== 'emp-101')
      .map((e): Row => {
        const shift = shiftMap.get(e.shiftId);
        const rec = records.find((r) => r.employeeId === e.id && r.date === today && r.timeIn);
        const onLeave = leaves.some((l) => l.employeeId === e.id && l.status === 'approved' && l.leaveType !== 'remote_work' && l.startDate <= today && today <= l.endDate);
        const remoteLeave = leaves.some((l) => l.employeeId === e.id && l.status === 'approved' && l.leaveType === 'remote_work' && l.startDate <= today && today <= l.endDate);
        const workday = shift ? shift.workDays.includes(dow) : true;
        let state: State;
        if (rec) state = rec.timeOut ? 'out' : 'in';
        else if (onLeave) state = 'leave';
        else if (!workday) state = 'off';
        else if (shift && mins >= parseTimeToMinutes(shift.startTime) + (shift.graceMinutes || 0)) state = 'absent';
        else state = 'waiting';
        return {
          e,
          state,
          late: Boolean(rec && shift && isLateArrival(rec.timeIn, shift)),
          wfh: Boolean(rec && (e.allowWorkFromHome || remoteLeave)),
          offline: Boolean(rec && !rec.timeOut && rec.connectionStatus === 'no_internet'),
          timeIn: rec?.timeIn,
        };
      });
  }, [employees, records, shifts, leaves, today, now]);

  const count = (f: (r: Row) => boolean) => rows.filter(f).length;
  const inNow = count((r) => r.state === 'in');
  const late = count((r) => r.late);
  const absent = count((r) => r.state === 'absent');
  const onLeave = count((r) => r.state === 'leave');
  const wfh = count((r) => r.wfh);
  const done = count((r) => r.state === 'out');
  const pendingLeaves = leaves.filter((l) => l.status === 'pending').length;

  // Last 14 days: how many people punched in each day
  const trend = useMemo(() => {
    const total = Math.max(1, employees.filter((e) => e.isActive && e.id !== 'emp-101').length);
    const out: { date: string; label: string; present: number; late: number; total: number }[] = [];
    const shiftMap = new Map(shifts.map((s) => [s.id, s]));
    const d = new Date(`${today}T12:00:00`);
    for (let i = 13; i >= 0; i--) {
      const day = new Date(d);
      day.setDate(d.getDate() - i);
      const key = ymd(day);
      const recs = records.filter((r) => r.date === key && r.timeIn);
      const lateCount = recs.filter((r) => {
        const sh = shiftMap.get(employees.find((e) => e.id === r.employeeId)?.shiftId || '');
        return sh ? isLateArrival(r.timeIn, sh) : false;
      }).length;
      out.push({ date: key, label: `${day.getDate()}`, present: recs.length, late: lateCount, total });
    }
    return out;
  }, [records, employees, shifts, today]);
  const maxBar = Math.max(1, ...trend.map((t) => t.present));

  const groups: { key: string; title: string; tone: string; items: Row[] }[] = [
    { key: 'in', title: 'Working now', tone: 'bg-emerald-500', items: rows.filter((r) => r.state === 'in') },
    { key: 'late', title: 'Arrived late', tone: 'bg-amber-500', items: rows.filter((r) => r.late) },
    { key: 'absent', title: 'Not in yet (after shift start)', tone: 'bg-rose-500', items: rows.filter((r) => r.state === 'absent') },
    { key: 'leave', title: 'On leave', tone: 'bg-violet-500', items: rows.filter((r) => r.state === 'leave') },
    { key: 'out', title: 'Finished for the day', tone: 'bg-slate-400', items: rows.filter((r) => r.state === 'out') },
  ];

  const biz = crm.data.business;
  const cur = biz?.targets?.currency || 'PKR';
  const teamDone = biz?.leaderboard ? biz.leaderboard.reduce((a, x) => a + x.amount, 0) : biz?.me?.amount || 0;
  const teamTarget = biz?.targets?.team || 0;
  const pct = (a: number, t: number) => (t > 0 ? Math.min(100, Math.round((a / t) * 100)) : 0);
  const monthLabel = biz ? new Date(`${biz.monthKey}-01T12:00:00`).toLocaleString('en-US', { month: 'long', year: 'numeric' }) : '';

  // Targets editor (Admin / CEO)
  const [editing, setEditing] = useState(false);
  const [teamInput, setTeamInput] = useState('');
  const [people, setPeople] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const openEditor = () => {
    setTeamInput(teamTarget ? String(teamTarget) : '');
    setPeople(Object.fromEntries(Object.entries(biz?.targets?.people || {}).map(([k, v]) => [k, String(v)])));
    setSaveErr('');
    setEditing(true);
  };
  const saveTargets = async () => {
    setSaving(true);
    setSaveErr('');
    try {
      const clean: Record<string, number> = {};
      for (const [k, v] of Object.entries(people)) if (Number(v) > 0) clean[k] = Number(v);
      await crmCall('targets_save', { targets: { currency: cur, team: Number(teamInput) || 0, people: clean } });
      await crm.refresh();
      setEditing(false);
    } catch (e: any) {
      setSaveErr(e?.message || 'Could not save the targets.');
    } finally {
      setSaving(false);
    }
  };
  const salesStaff = employees.filter((e) => e.isActive && e.id !== 'emp-101' && (['accounts', 'ceo', 'admin'].includes(e.role) || e.salesAccess));

  // Payables calendar
  const payables = biz?.payables || null;
  const [calMonth, setCalMonth] = useState(() => today.slice(0, 7));
  const calCells = useMemo(() => {
    const [y, m] = calMonth.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const days = new Date(y, m, 0).getDate();
    const cells: { day: number | null; key: string }[] = [];
    for (let i = 0; i < first.getDay(); i++) cells.push({ day: null, key: `b${i}` });
    for (let d = 1; d <= days; d++) cells.push({ day: d, key: `${calMonth}-${pad(d)}` });
    return cells;
  }, [calMonth]);
  const byDue = useMemo(() => {
    const map = new Map<string, number>();
    (payables || []).forEach((p) => p.dueDate && map.set(p.dueDate, (map.get(p.dueDate) || 0) + 1));
    return map;
  }, [payables]);
  const sortedPay = useMemo(() => [...(payables || [])].sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999')), [payables]);
  const shiftMonth = (delta: number) => {
    const [y, m] = calMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setCalMonth(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  };

  // Command-center metrics use existing CRM data only; no new tables or data writes.
  const endOfWeek = new Date(now);
  endOfWeek.setDate(endOfWeek.getDate() + 7);
  const weekKey = ymd(endOfWeek);
  const openFollowups = crm.data.followups.filter((f) => ['pending', 'rescheduled', 'not_completed'].includes(f.status));
  const overdueFollowups = openFollowups.filter((f) => f.dueAt && f.dueAt.slice(0, 10) < today);
  const dueTodayFollowups = openFollowups.filter((f) => f.dueAt && f.dueAt.slice(0, 10) === today);
  const unscheduledFollowups = openFollowups.filter((f) => !f.dueAt);
  const nextMeetings = crm.data.meetings.filter((m) => m.status === 'scheduled' && m.startAt >= now.toISOString() && m.startAt.slice(0, 10) <= weekKey).sort((a, b) => a.startAt.localeCompare(b.startAt)).slice(0, 5);
  const customerDues = crm.data.invoices.filter((i) => i.kind === 'customer' && i.status === 'unpaid' && i.balance > 0 && i.dueDate).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  const overdueCustomerDues = customerDues.filter((i) => String(i.dueDate) < today);
  const soonCustomerDues = customerDues.filter((i) => String(i.dueDate) >= today && String(i.dueDate) <= weekKey);
  const purchaseDues = (crm.data.purchases || []).flatMap((purchase) => purchase.items.filter((item) => item.paidByMethod === 'unpaid' && item.paymentDueDate).map((item) => ({ id: purchase.id + '-' + item.id, purchaseNo: purchase.purchaseNo, vendor: item.vendorName, currency: purchase.currency, amount: item.payable, dueDate: item.paymentDueDate as string }))).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const overduePurchaseDues = purchaseDues.filter((p) => p.dueDate < today);
  const soonPurchaseDues = purchaseDues.filter((p) => p.dueDate >= today && p.dueDate <= weekKey);
  const pendingSalesApprovals = isAdmin ? crm.data.sales.filter((s) => s.status === 'pending') : [];
  const pendingInventoryApprovals = isAdmin ? crm.data.inventory.filter((r) => r.status === 'pending') : [];
  const requiredMeetingApprovals = isAdmin ? crm.data.meetings.filter((m) => m.status === 'pending_approval') : [];
  const overdueCount = overdueFollowups.length + overduePayables.length + overdueCustomerDues.length + overduePurchaseDues.length;
  const actionCount = pendingLeaves + requiredMeetingApprovals.length + pendingSalesApprovals.length + pendingInventoryApprovals.length + overdueCount + dueTodayFollowups.length;
  const deadlineCount = dueTodayFollowups.length + soonCustomerDues.length + soonPurchaseDues.length + nextMeetings.length + upcomingTasks.length;
  const amountLabel = (currency: string, amount: number) => `${currency} ${money(amount)}`;

  return (
    <div className={`space-y-5  };

  return (
    <div className={`space-y-5 ${redesignedUiBetaEnabled ? "live-dashboard-beta" : ""}`}>
      <div data-dashboard-header className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 p-4 sm:p-5 shadow-xs">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900 dark:text-slate-100">Live Dashboard</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Updated every 30 seconds. {now.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
        {pendingLeaves > 0 && (
          <button onClick={() => onNavigate('leaves')} className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white px-3 py-2 text-xs font-bold cursor-pointer">
            <CalendarOff className="w-4 h-4" /> {pendingLeaves} leave request{pendingLeaves === 1 ? '' : 's'} waiting
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label="Working now" value={inNow} tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" icon={<CheckCircle2 className="w-4 h-4" />} />
        <Stat label="Late today" value={late} tone="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" icon={<Clock3 className="w-4 h-4" />} />
        <Stat label="Not in yet" value={absent} tone="bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" icon={<UserX className="w-4 h-4" />} />
        <Stat label="On leave" value={onLeave} tone="bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" icon={<CalendarOff className="w-4 h-4" />} />
        <Stat label="Working from home" value={wfh} tone="bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300" icon={<Home className="w-4 h-4" />} />
        <Stat label="Finished" value={done} tone="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" icon={<LogOut className="w-4 h-4" />} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Who is where today" icon={<Users className="w-4 h-4 text-blue-600" />}>
          <div className="space-y-3">
            {groups.map((g) => (
              <div key={g.key}>
                <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <span className={`w-2 h-2 rounded-full ${g.tone}`} /> {g.title} <span className="text-slate-400">({g.items.length})</span>
                </p>
                {g.items.length === 0 ? (
                  <p className="mt-1 text-xs text-slate-400">Nobody.</p>
                ) : (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {g.items.map((r) => (
                      <span key={r.e.id} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200">
                        {r.e.name.split(' ')[0]}
                        {r.timeIn && <span className="text-slate-400">{clock12(r.timeIn)}</span>}
                        {r.wfh && <Home className="w-3 h-3 text-sky-500" aria-label="Working from home" />}
                        {r.offline && <WifiOff className="w-3 h-3 text-rose-500" aria-label="No internet" />}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>

        <Card title="Last 14 days" icon={<CalendarClock className="w-4 h-4 text-indigo-600" />} right={<span className="text-[11px] text-slate-400">People who punched in</span>}>
          <div className="flex items-end gap-1.5 h-36">
            {trend.map((t) => (
              <div key={t.date} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full" title={`${t.date}: ${t.present} in, ${t.late} late`}>
                <span className="text-[10px] font-bold text-slate-500 mb-0.5">{t.present || ''}</span>
                <div className="w-full rounded-t-md bg-gradient-to-t from-blue-600 to-sky-400 relative overflow-hidden dash-bar" style={{ height: `${Math.max(3, (t.present / maxBar) * 100)}%` }}>
                  {t.late > 0 && <div className="absolute bottom-0 inset-x-0 bg-amber-400/90" style={{ height: `${(t.late / Math.max(1, t.present)) * 100}%` }} />}
                </div>
                <span className="mt-1 text-[10px] text-slate-400">{t.label}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-400"><span className="inline-block w-2 h-2 rounded-sm bg-amber-400 mr-1" />Amber part of a bar = arrived late.</p>
        </Card>
      </div>

      {biz && (biz.targets || biz.me || biz.leaderboard) && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Card
            title={`Sales target · ${monthLabel}`}
            icon={<Target className="w-4 h-4 text-emerald-600" />}
            right={isAdmin && <button onClick={openEditor} className="text-xs font-bold text-blue-600 hover:underline cursor-pointer">Set targets</button>}
          >
            {teamTarget > 0 || teamDone > 0 ? (
              <>
                <p className="text-2xl font-extrabold text-slate-900 dark:text-slate-100"><CountUp value={teamDone} /> <span className="text-sm font-semibold text-slate-500">{cur}{teamTarget > 0 ? ` of ${money(teamTarget)}` : ''}</span></p>
                {teamTarget > 0 && (
                  <div className="mt-2 h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-[width] duration-1000" style={{ width: `${pct(teamDone, teamTarget)}%` }} />
                  </div>
                )}
                {teamTarget > 0 && <p className="mt-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">{pct(teamDone, teamTarget)}% of the monthly target</p>}
              </>
            ) : (
              <p className="text-xs text-slate-500">No target set yet.{isAdmin ? ' Use "Set targets" to add one.' : ''}</p>
            )}
            {biz.me && (biz.me.target > 0 || biz.me.count > 0) && (
              <div className="mt-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Your month</p>
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{money(biz.me.amount)} {cur} <span className="text-xs font-medium text-slate-500">from {biz.me.count} approved coupon{biz.me.count === 1 ? '' : 's'}</span></p>
                {biz.me.target > 0 && (
                  <div className="mt-1.5 h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden"><div className="h-full rounded-full bg-blue-500 transition-[width] duration-1000" style={{ width: `${pct(biz.me.amount, biz.me.target)}%` }} /></div>
                )}
              </div>
            )}
            <p className="mt-2 text-[10px] text-slate-400">Counts approved sales coupons this month in {cur}. Only totals are shown, never cost or profit.</p>
            {editing && (
              <div className="mt-3 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/60 dark:bg-blue-950/20 p-3 space-y-2">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-200">Team target per month ({cur})
                  <input inputMode="numeric" value={teamInput} onChange={(e) => setTeamInput(e.target.value.replace(/[^\d]/g, ''))} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-sm" />
                </label>
                <p className="text-xs font-bold text-slate-700 dark:text-slate-200">Per person (optional)</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {salesStaff.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                      <span className="w-24 truncate">{s.name}</span>
                      <input inputMode="numeric" value={people[s.id] || ''} onChange={(e) => setPeople({ ...people, [s.id]: e.target.value.replace(/[^\d]/g, '') })} className="flex-1 min-w-0 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-sm" />
                    </label>
                  ))}
                </div>
                {saveErr && <p className="text-xs font-semibold text-rose-600">{saveErr}</p>}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-xs font-medium text-slate-600 cursor-pointer">Cancel</button>
                  <button onClick={saveTargets} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 text-xs font-bold disabled:opacity-60 cursor-pointer">
                    {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save targets
                  </button>
                </div>
              </div>
            )}
          </Card>

          {biz.leaderboard && (
            <Card title="Sales leaderboard" icon={<Trophy className="w-4 h-4 text-amber-500" />} right={<span className="text-[11px] text-slate-400">{monthLabel}</span>}>
              {biz.leaderboard.length === 0 ? (
                <p className="text-xs text-slate-500">No approved sales this month yet.</p>
              ) : (
                <ol className="space-y-2">
                  {biz.leaderboard.map((p, i) => {
                    const top = Math.max(1, biz.leaderboard![0].amount);
                    return (
                      <li key={p.id} className="flex items-center gap-3">
                        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-extrabold shrink-0 ${i === 0 ? 'bg-amber-400 text-white' : i === 1 ? 'bg-slate-300 text-slate-800' : i === 2 ? 'bg-orange-300 text-orange-900' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>
                          {i < 3 ? <Medal className="w-3.5 h-3.5" /> : i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{p.name}</span>
                            <span className="text-xs font-bold text-slate-700 dark:text-slate-300 tabular-nums">{money(p.amount)} {cur}</span>
                          </div>
                          <div className="mt-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                            <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-[width] duration-1000" style={{ width: `${Math.max(2, (p.amount / top) * 100)}%` }} />
                          </div>
                          <p className="mt-0.5 text-[10px] text-slate-400">{p.count} coupon{p.count === 1 ? '' : 's'}{p.target > 0 ? ` · ${pct(p.amount, p.target)}% of ${money(p.target)} target` : ''}</p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </Card>
          )}
        </div>
      )}

      {payables && (
        <Card title="Payables due" icon={<AlertTriangle className="w-4 h-4 text-rose-500" />} right={<span className="text-[11px] text-slate-400">{sortedPay.length} unpaid vendor bill{sortedPay.length === 1 ? '' : 's'}</span>}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="w-full max-w-xs mx-auto lg:mx-0">
              <div className="flex items-center justify-between mb-2">
                <button onClick={() => shiftMonth(-1)} className="px-2 py-1 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer" aria-label="Previous month">‹</button>
                <span className="text-xs font-bold text-slate-800 dark:text-slate-100">{new Date(`${calMonth}-01T12:00:00`).toLocaleString('en-US', { month: 'long', year: 'numeric' })}</span>
                <button onClick={() => shiftMonth(1)} className="px-2 py-1 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer" aria-label="Next month">›</button>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-slate-400 mb-1">{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i}>{d}</span>)}</div>
              <div className="grid grid-cols-7 gap-1">
                {calCells.map((c) => {
                  if (!c.day) return <span key={c.key} />;
                  const n = byDue.get(c.key) || 0;
                  const overdue = n > 0 && c.key < today;
                  return (
                    <span key={c.key} className={`relative h-9 rounded-lg flex items-center justify-center text-xs ${c.key === today ? 'ring-2 ring-blue-500' : ''} ${n ? (overdue ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200 font-bold' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 font-bold') : 'text-slate-600 dark:text-slate-300'}`}>
                      {c.day}
                      {n > 1 && <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-slate-900 text-white text-[9px] flex items-center justify-center">{n}</span>}
                    </span>
                  );
                })}
              </div>
            </div>
            <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              {sortedPay.length === 0 && <li className="text-xs text-slate-500">No unpaid vendor bills. 🎉</li>}
              {sortedPay.map((p) => {
                const overdue = Boolean(p.dueDate && p.dueDate < today);
                return (
                  <li key={p.id} className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${overdue ? 'border-rose-200 bg-rose-50/70 dark:border-rose-900/60 dark:bg-rose-950/20' : 'border-slate-200 dark:border-slate-800'}`}>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">{p.vendor}</p>
                      <p className="text-[10px] text-slate-500">{p.invoiceNo} · {p.dueDate ? `${overdue ? 'Overdue since' : 'Due'} ${p.dueDate}` : 'No due date'}</p>
                    </div>
                    <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100 tabular-nums shrink-0">{p.currency} {money(p.total)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </Card>
      )}

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
          <div><p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-blue-600 dark:text-blue-400">Operations command center</p><h3 className="text-lg font-extrabold text-slate-900 dark:text-slate-100">What needs attention next?</h3><p className="text-xs text-slate-500 dark:text-slate-400">Deadlines, approvals and work that could slip through the cracks.</p></div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">Live overview · refreshed with dashboard data</span>
        </div>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <button type="button" onClick={() => onNavigate('crm-tasks')} className="text-left rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-gradient-to-br from-rose-50 to-white dark:from-rose-950/40 dark:to-slate-900 p-3.5 hover:-translate-y-0.5 transition-transform"><span className="flex justify-between text-rose-700 dark:text-rose-300"><AlertCircle className="w-4 h-4"/><small className="font-bold uppercase">Urgent</small></span><strong className="block mt-2 text-2xl font-black text-slate-900 dark:text-white">{overdueCount}</strong><span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Overdue items</span></button>
          <button type="button" onClick={() => onNavigate('crm-tasks')} className="text-left rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/30 dark:to-slate-900 p-3.5 hover:-translate-y-0.5 transition-transform"><span className="flex justify-between text-amber-700 dark:text-amber-300"><Timer className="w-4 h-4"/><small className="font-bold uppercase">Today</small></span><strong className="block mt-2 text-2xl font-black text-slate-900 dark:text-white">{dueTodayFollowups.length}</strong><span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Follow-ups due today</span></button>
          <button type="button" onClick={() => onNavigate('crm-invoices')} className="text-left rounded-2xl border border-sky-200 dark:border-sky-900/60 bg-gradient-to-br from-sky-50 to-white dark:from-sky-950/30 dark:to-slate-900 p-3.5 hover:-translate-y-0.5 transition-transform"><span className="flex justify-between text-sky-700 dark:text-sky-300"><CalendarDays className="w-4 h-4"/><small className="font-bold uppercase">Next 7 days</small></span><strong className="block mt-2 text-2xl font-black text-slate-900 dark:text-white">{deadlineCount}</strong><span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Upcoming deadlines & events</span></button>
          <button type="button" onClick={() => onNavigate(isAdmin ? 'crm-sales' : 'leaves')} className="text-left rounded-2xl border border-violet-200 dark:border-violet-900/60 bg-gradient-to-br from-violet-50 to-white dark:from-violet-950/30 dark:to-slate-900 p-3.5 hover:-translate-y-0.5 transition-transform"><span className="flex justify-between text-violet-700 dark:text-violet-300"><CheckCircle2 className="w-4 h-4"/><small className="font-bold uppercase">Action queue</small></span><strong className="block mt-2 text-2xl font-black text-slate-900 dark:text-white">{actionCount}</strong><span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Required actions</span></button>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
          <div className="xl:col-span-3 space-y-4">
            <Card title="Priority action queue" icon={<AlertTriangle className="w-4 h-4 text-rose-500"/>} right={<span className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold ${actionCount ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'}`}>{actionCount} open</span>}>
              <div className="space-y-2">
                {pendingLeaves > 0 && <button type="button" onClick={() => onNavigate('leaves')} className="w-full flex items-center justify-between rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/20 p-3 text-left"><span><strong className="block text-xs text-slate-900 dark:text-slate-100">{pendingLeaves} leave request{pendingLeaves === 1 ? '' : 's'} awaiting review</strong><small className="text-[10px] text-slate-500">Review and decide</small></span><ArrowRight className="w-4 h-4 text-amber-600"/></button>}
                {requiredMeetingApprovals.map((m) => <button key={m.id} type="button" onClick={() => onNavigate('crm-meetings')} className="w-full flex items-center justify-between rounded-xl border border-violet-200 dark:border-violet-900/50 bg-violet-50/70 dark:bg-violet-950/20 p-3 text-left"><span><strong className="block text-xs text-slate-900 dark:text-slate-100">{m.title}</strong><small className="text-[10px] text-slate-500">Meeting approval · {new Date(m.startAt).toLocaleString()}</small></span><ArrowRight className="w-4 h-4 text-violet-600"/></button>)}
                {pendingSalesApprovals.length > 0 && <button type="button" onClick={() => onNavigate('crm-sales')} className="w-full flex items-center justify-between rounded-xl border border-sky-200 dark:border-sky-900/50 bg-sky-50/70 dark:bg-sky-950/20 p-3 text-left"><span><strong className="block text-xs text-slate-900 dark:text-slate-100">{pendingSalesApprovals.length} sales records awaiting approval</strong><small className="text-[10px] text-slate-500">Review sales</small></span><ArrowRight className="w-4 h-4 text-sky-600"/></button>}
                {pendingInventoryApprovals.length > 0 && <button type="button" onClick={() => onNavigate('crm-inventory')} className="w-full flex items-center justify-between rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/70 dark:bg-indigo-950/20 p-3 text-left"><span><strong className="block text-xs text-slate-900 dark:text-slate-100">{pendingInventoryApprovals.length} inventory requests awaiting approval</strong><small className="text-[10px] text-slate-500">Review inventory requests</small></span><ArrowRight className="w-4 h-4 text-indigo-600"/></button>}
                {overdueFollowups.slice(0,4).map((f) => <button key={f.id} type="button" onClick={() => onNavigate('crm-tasks')} className="w-full flex items-center justify-between rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/70 dark:bg-rose-950/20 p-3 text-left"><span className="min-w-0"><strong className="block text-xs text-slate-900 dark:text-slate-100 truncate">{f.subject || f.remarks || 'Follow-up'}</strong><small className="text-[10px] text-rose-600 dark:text-rose-300">Overdue · {employees.find((e) => e.id === f.assignedTo)?.name || 'Assigned employee'} · {f.dueAt ? new Date(f.dueAt).toLocaleDateString() : ''}</small></span><ArrowRight className="w-4 h-4 text-rose-600"/></button>)}
                {overduePayables.slice(0,3).map((p) => <button key={p.id} type="button" onClick={() => onNavigate('crm-purchases')} className="w-full flex items-center justify-between rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/70 dark:bg-rose-950/20 p-3 text-left"><span className="min-w-0"><strong className="block text-xs text-slate-900 dark:text-slate-100 truncate">{p.vendor} · {p.currency} {money(p.total)}</strong><small className="text-[10px] text-rose-600 dark:text-rose-300">Vendor bill overdue since {p.dueDate}</small></span><ArrowRight className="w-4 h-4 text-rose-600"/></button>)}
                {overdueCustomerDues.slice(0,3).map((i) => <button key={i.id} type="button" onClick={() => onNavigate('crm-invoices')} className="w-full flex items-center justify-between rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/70 dark:bg-rose-950/20 p-3 text-left"><span className="min-w-0"><strong className="block text-xs text-slate-900 dark:text-slate-100 truncate">{i.invoiceNo} · {i.customerName}</strong><small className="text-[10px] text-rose-600 dark:text-rose-300">Customer balance overdue · {i.currency} {money(i.balance)}</small></span><ArrowRight className="w-4 h-4 text-rose-600"/></button>)}
                {overduePurchaseDues.slice(0,3).map((p) => <button key={p.id} type="button" onClick={() => onNavigate('crm-purchases')} className="w-full flex items-center justify-between rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/70 dark:bg-rose-950/20 p-3 text-left"><span className="min-w-0"><strong className="block text-xs text-slate-900 dark:text-slate-100 truncate">{p.vendor} · {p.currency} {money(p.amount)}</strong><small className="text-[10px] text-rose-600 dark:text-rose-300">Purchase payment overdue · {p.dueDate}</small></span><ArrowRight className="w-4 h-4 text-rose-600"/></button>)}
                {actionCount === 0 && <div className="rounded-xl border border-dashed border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/10 p-5 text-center"><CheckCircle2 className="w-7 h-7 mx-auto text-emerald-500"/><p className="mt-2 text-xs font-bold text-emerald-700 dark:text-emerald-300">All clear — no urgent actions</p><p className="text-[10px] text-slate-500">Your action queue is up to date.</p></div>}
                {actionCount > 0 && <p className="pt-1 text-[10px] text-slate-400">Highest-priority items first. Open each workspace to review the full list.</p>}
              </div>
            </Card>
            <Card title="Upcoming tasks" icon={<CalendarCheck2 className="w-4 h-4 text-indigo-600"/>} right={<button type="button" onClick={() => onNavigate('crm-tasks')} className="text-[11px] font-bold text-blue-600 hover:underline">View all</button>}>
              <div className="space-y-2">
                {upcomingTasks.length === 0 && <p className="text-xs text-slate-500 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 p-4">No upcoming follow-ups scheduled.</p>}
                {upcomingTasks.map((f) => <button key={f.id} type="button" onClick={() => onNavigate('crm-tasks')} className="w-full text-left flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30 px-3 py-2.5 hover:bg-blue-50/70 dark:hover:bg-blue-950/20"><span className="min-w-0"><strong className="block text-xs text-slate-900 dark:text-slate-100 truncate">{f.subject || f.remarks || 'Follow-up'}</strong><small className="text-[10px] text-slate-500">{employees.find((e) => e.id === f.assignedTo)?.name || 'Assigned employee'}</small></span><span className="text-[10px] text-slate-500 shrink-0">{f.dueAt ? new Date(f.dueAt).toLocaleString() : ''}</span></button>)}
              </div>
            </Card>
          </div>
          <div className="xl:col-span-2 space-y-4">
            <Card title="Deadline radar · next 7 days" icon={<CalendarClock className="w-4 h-4 text-sky-600"/>} right={<span className="text-[10px] font-bold text-slate-400">{deadlineCount} tracked</span>}>
              <div className="space-y-2">
                {dueTodayFollowups.slice(0,3).map((f) => <button key={f.id} type="button" onClick={() => onNavigate('crm-tasks')} className="w-full rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/20 p-2.5 text-left"><strong className="block text-xs text-slate-900 dark:text-slate-100 truncate">{f.subject || f.remarks || 'Follow-up due today'}</strong><small className="text-[10px] text-amber-700 dark:text-amber-300">Due today · {f.dueAt ? new Date(f.dueAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : ''}</small></button>)}
                {soonCustomerDues.slice(0,3).map((i) => <button key={i.id} type="button" onClick={() => onNavigate('crm-invoices')} className="w-full rounded-xl border border-sky-200 dark:border-sky-900/50 p-2.5 text-left"><strong className="block text-xs text-slate-900 dark:text-slate-100 truncate">Invoice {i.invoiceNo} · {i.customerName}</strong><small className="text-[10px] text-slate-500">Payment due {i.dueDate} · {i.currency} {money(i.balance)}</small></button>)}
                {soonPurchaseDues.slice(0,3).map((p) => <button key={p.id} type="button" onClick={() => onNavigate('crm-purchases')} className="w-full rounded-xl border border-sky-200 dark:border-sky-900/50 p-2.5 text-left"><strong className="block text-xs text-slate-900 dark:text-slate-100 truncate">{p.vendor} · {p.purchaseNo}</strong><small className="text-[10px] text-slate-500">Vendor payment due {p.dueDate} · {p.currency} {money(p.amount)}</small></button>)}
                {nextMeetings.map((m) => <button key={m.id} type="button" onClick={() => onNavigate('crm-meetings')} className="w-full rounded-xl border border-violet-200 dark:border-violet-900/50 p-2.5 text-left"><strong className="block text-xs text-slate-900 dark:text-slate-100 truncate">{m.title}</strong><small className="text-[10px] text-slate-500">Meeting · {new Date(m.startAt).toLocaleString()}</small></button>)}
                {upcomingTasks.slice(0,4).map((f) => <button key={f.id} type="button" onClick={() => onNavigate('crm-tasks')} className="w-full rounded-xl border border-slate-200 dark:border-slate-800 p-2.5 text-left"><strong className="block text-xs text-slate-900 dark:text-slate-100 truncate">{f.subject || f.remarks || 'Follow-up'}</strong><small className="text-[10px] text-slate-500">Follow-up · {f.dueAt ? new Date(f.dueAt).toLocaleString() : 'Date not set'}</small></button>)}
                {deadlineCount === 0 && <p className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 p-4 text-xs text-slate-500">No deadlines in the next seven days. Time to get ahead.</p>}
              </div>
            </Card>
            {unscheduledFollowups.length > 0 && <Card title="Follow-ups without a deadline" icon={<Timer className="w-4 h-4 text-amber-600"/>} right={<span className="text-[10px] font-bold text-amber-600">{unscheduledFollowups.length} need scheduling</span>}><p className="mb-2 text-xs text-slate-500">Open follow-ups without due dates can quietly get missed. Add a date so they appear in the deadline radar.</p><button type="button" onClick={() => onNavigate('crm-tasks')} className="inline-flex items-center gap-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white px-3 py-2 text-xs font-bold">Schedule follow-ups <ArrowRight className="w-3.5 h-3.5"/></button></Card>}
            <Card title="Business pulse" icon={<TrendingUp className="w-4 h-4 text-emerald-600"/>}>
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => onNavigate('crm-invoices')} className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3 text-left"><FileText className="w-4 h-4 text-blue-600"/><strong className="block mt-2 text-xl text-slate-900 dark:text-slate-100">{customerDues.length}</strong><span className="text-[10px] text-slate-500">Unpaid customer invoices</span></button>
                <button type="button" onClick={() => onNavigate('crm-purchases')} className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3 text-left"><Wallet className="w-4 h-4 text-amber-600"/><strong className="block mt-2 text-xl text-slate-900 dark:text-slate-100">{purchaseDues.length + sortedPay.length}</strong><span className="text-[10px] text-slate-500">Vendor / purchase dues</span></button>
                <button type="button" onClick={() => onNavigate('crm-meetings')} className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3 text-left"><CalendarDays className="w-4 h-4 text-violet-600"/><strong className="block mt-2 text-xl text-slate-900 dark:text-slate-100">{nextMeetings.length}</strong><span className="text-[10px] text-slate-500">Meetings next 7 days</span></button>
                <button type="button" onClick={() => onNavigate('crm-tasks')} className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3 text-left"><PackageCheck className="w-4 h-4 text-indigo-600"/><strong className="block mt-2 text-xl text-slate-900 dark:text-slate-100">{openFollowups.length}</strong><span className="text-[10px] text-slate-500">Open follow-ups</span></button>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};
