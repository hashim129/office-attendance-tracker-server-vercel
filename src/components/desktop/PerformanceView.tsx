import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronDown, Download, BellRing } from 'lucide-react';
import type { Employee } from '../../types';
import { crmCall } from '../../crm/crmApi';
import { btnGhost, btnPrimary, cardCls, inputCls } from '../../crm/ui';
import { downloadReportPdf } from '../../lib/reportPdf';

/**
 * Staff performance card (Admin / CEO): one card per person for a month with attendance, sales, profit,
 * target, follow-ups and (for the Media Team) posts. Sortable, tap a card to see every number, PDF download.
 */
type Person = {
  id: string; name: string; role: string;
  daysPresent: number; lateDays: number; avgHours: number; leaveDays: number;
  sales: number; invoices: number; profit: number; profitInvoices: number;
  target: number; targetPct: number | null;
  followupsDone: number; followupsOverdue: number; avgFollowupHours: number | null;
  media: boolean; postsDone: number | null; postsPlanned: number | null;
};
type Data = { month: string; currency: string; people: Person[]; missingRates: string[]; workingDays: number; workingDaysSoFar: number };

type SortKey = 'name' | 'daysPresent' | 'lateDays' | 'avgHours' | 'leaveDays' | 'sales' | 'profit' | 'targetPct' | 'followupsDone' | 'followupsOverdue' | 'avgFollowupHours' | 'postsDone';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name' }, { key: 'daysPresent', label: 'Days present' }, { key: 'lateDays', label: 'Late days' },
  { key: 'avgHours', label: 'Average hours' }, { key: 'leaveDays', label: 'Leave days' }, { key: 'sales', label: 'Sales' },
  { key: 'profit', label: 'Profit' }, { key: 'targetPct', label: 'Target reached' }, { key: 'followupsDone', label: 'Follow-ups done' },
  { key: 'followupsOverdue', label: 'Follow-ups overdue' }, { key: 'avgFollowupHours', label: 'Time to finish a follow-up' }, { key: 'postsDone', label: 'Posts done' },
];

const thisMonth = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 7);
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const n0 = (n: number) => Math.round(n).toLocaleString('en-US');
const hrs = (h: number | null) => (h === null ? '—' : h >= 48 ? `${Math.round(h / 24)} days` : `${Math.round(h * 10) / 10} h`);
const pct = (a: number, b: number) => (b > 0 ? Math.max(0, Math.min(100, (a / b) * 100)) : 0);

const Bar: React.FC<{ value: number; tone?: string; label: string; right: string }> = ({ value, tone = 'bg-blue-500', label, right }) => (
  <div>
    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">
      <span>{label}</span><span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{right}</span>
    </div>
    <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
      <div className={`h-full rounded-full ${tone} transition-all duration-500`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  </div>
);

const Stat: React.FC<{ label: string; value: React.ReactNode; warn?: boolean }> = ({ label, value, warn }) => (
  <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 px-2.5 py-2">
    <p className="text-[10px] text-slate-500 dark:text-slate-400">{label}</p>
    <p className={`text-sm font-bold tabular-nums ${warn ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-slate-100'}`}>{value}</p>
  </div>
);

export const PerformanceView: React.FC<{ currentUser: Employee; companyName?: string }> = ({ currentUser, companyName }) => {
  const [month, setMonth] = useState(thisMonth());
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [sort, setSort] = useState<SortKey>('sales');
  const [desc, setDesc] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [pdfBusy, setPdfBusy] = useState(false);
  const allowed = currentUser.role === 'admin' || currentUser.role === 'ceo';

  useEffect(() => {
    if (!allowed) return;
    let live = true;
    setLoading(true);
    crmCall<Data>('staff_performance', { month })
      .then((r) => { if (live) { setD(r); setErr(''); } })
      .catch((e) => { if (live) setErr(e?.message || 'Could not load the performance cards.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [month, allowed]);

  const people = useMemo(() => {
    const list = [...(d?.people || [])];
    const val = (p: Person): number | string => {
      if (sort === 'name') return p.name.toLowerCase();
      const v = p[sort];
      return v === null || v === undefined ? -Infinity : Number(v);
    };
    list.sort((a, b) => {
      const x = val(a); const y = val(b);
      const c = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y) : (x as number) - (y as number);
      return desc ? -c : c;
    });
    return list;
  }, [d, sort, desc]);

  const chooseSort = (k: SortKey) => {
    if (k === sort) setDesc((v) => !v);
    else { setSort(k); setDesc(k !== 'name'); }
  };

  const pdf = async () => {
    if (!d) return;
    setPdfBusy(true);
    try {
      const cur = d.currency;
      await downloadReportPdf({
        title: `Staff performance · ${monthName(d.month)}`,
        subtitle: `Sales and profit in ${cur}. Profit only counts invoices with payables locked against them. ${d.workingDays} working days in the month.`,
        companyName, generatedBy: currentUser.name, landscape: true,
        columns: [
          { key: 'name', label: 'Employee', width: 2.6 },
          { key: 'present', label: 'Present', width: 1.1, align: 'right' },
          { key: 'late', label: 'Late', width: 0.9, align: 'right' },
          { key: 'hours', label: 'Avg hours', width: 1.2, align: 'right' },
          { key: 'leave', label: 'Leave', width: 0.9, align: 'right' },
          { key: 'sales', label: `Sales (${cur})`, width: 1.8, align: 'right' },
          { key: 'profit', label: `Profit (${cur})`, width: 1.8, align: 'right' },
          { key: 'target', label: 'Target', width: 1.8, align: 'right' },
          { key: 'fup', label: 'Follow-ups done / overdue', width: 1.9, align: 'right' },
          { key: 'fupTime', label: 'Time to finish', width: 1.3, align: 'right' },
          { key: 'posts', label: 'Posts done / planned', width: 1.6, align: 'right' },
        ],
        rows: people.map((p) => ({
          name: p.name, present: String(p.daysPresent), late: String(p.lateDays), hours: p.avgHours ? `${p.avgHours} h` : '—', leave: String(p.leaveDays),
          sales: n0(p.sales), profit: p.profitInvoices ? n0(p.profit) : '—', target: p.target ? `${n0(p.target)} (${p.targetPct ?? 0}%)` : '—',
          fup: `${p.followupsDone} / ${p.followupsOverdue}`, fupTime: hrs(p.avgFollowupHours), posts: p.postsPlanned === null ? '—' : `${p.postsDone ?? 0} / ${p.postsPlanned}`,
        })),
      }, `staff-performance-${d.month}`);
      void crmCall('audit_note', { what: 'exported a PDF', detail: `Staff performance ${d.month}` }).catch(() => null);
    } catch (e) {
      setErr((e as Error)?.message || 'Could not make the PDF.');
    } finally {
      setPdfBusy(false);
    }
  };

  if (!allowed) {
    return <div className={`${cardCls} p-6 text-sm text-slate-600 dark:text-slate-300`}>Performance cards are for Admin and the CEO.</div>;
  }

  return (
    <div className="space-y-4" data-performance-view>
      <div className={`${cardCls} p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between`}>
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Staff performance</h2>
          <p className="text-xs text-slate-500">Attendance, sales, follow-ups and posts for each person in the month. Tap a card to see all the numbers.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input type="month" aria-label="Month" className={`${inputCls} w-40 min-h-10`} value={month} max={thisMonth()} onChange={(e) => setMonth(e.target.value || thisMonth())} />
          <button className={`${btnPrimary} min-h-10`} onClick={() => void pdf()} disabled={!d || pdfBusy || !people.length}>
            <Download className="w-3.5 h-3.5" /> {pdfBusy ? 'Making PDF…' : 'Download PDF'}
          </button>
        </div>
      </div>

      <div className={`${cardCls} p-3 flex flex-wrap items-center gap-2`}>
        <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400" htmlFor="perf-sort">Sort by</label>
        <select id="perf-sort" className={`${inputCls} w-auto min-h-10`} value={sort} onChange={(e) => chooseSort(e.target.value as SortKey)}>
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <button type="button" className={`${btnGhost} min-h-10`} onClick={() => setDesc((v) => !v)} aria-label={desc ? 'Highest first' : 'Lowest first'}>
          {desc ? <ArrowDownWideNarrow className="w-3.5 h-3.5" /> : <ArrowUpNarrowWide className="w-3.5 h-3.5" />}
          {sort === 'name' ? (desc ? 'Z to A' : 'A to Z') : desc ? 'Highest first' : 'Lowest first'}
        </button>
        {d && <span className="text-[11px] text-slate-500 ml-auto">{d.workingDaysSoFar} of {d.workingDays} working days so far · amounts in {d.currency}</span>}
      </div>

      {err && <p className="text-xs text-red-600" role="alert">{err}</p>}

      {loading && !d && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className={`${cardCls} h-40 animate-pulse bg-slate-100 dark:bg-slate-800/60`} />)}
        </div>
      )}

      {d && !people.length && (
        <div className={`${cardCls} p-6 text-center text-sm text-slate-500`}>No active staff to show for {monthName(d.month)}.</div>
      )}

      {d && people.length > 0 && (
        <div className={`grid gap-3 sm:grid-cols-2 xl:grid-cols-3 ${loading ? 'opacity-60' : ''}`}>
          {people.map((p) => {
            const isOpen = Boolean(open[p.id]);
            const base = Math.max(d.workingDaysSoFar, p.daysPresent, 1);
            const fTotal = p.followupsDone + p.followupsOverdue;
            return (
              <div key={p.id} className={`${cardCls} p-3`} data-perf-card={p.id}>
                <button type="button" className="w-full text-left cursor-pointer" onClick={() => setOpen((o) => ({ ...o, [p.id]: !o[p.id] }))} aria-expanded={isOpen}>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{p.name}</p>
                      <p className="text-[11px] text-slate-500 capitalize">{p.role}{p.media ? ' · Media Team' : ''}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">{d.currency} {n0(p.sales)}</p>
                      <p className="text-[10px] text-slate-500">sales</p>
                    </div>
                    <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </div>
                  <div className="space-y-1.5">
                    <Bar label="Days present" right={`${p.daysPresent}${p.lateDays ? ` · ${p.lateDays} late` : ''}`} value={pct(p.daysPresent, base)} tone={p.lateDays > 2 ? 'bg-amber-500' : 'bg-emerald-500'} />
                    {p.target > 0 && <Bar label="Target reached" right={`${p.targetPct ?? 0}%`} value={p.targetPct ?? 0} tone={(p.targetPct ?? 0) >= 100 ? 'bg-emerald-500' : 'bg-blue-500'} />}
                    <Bar label="Follow-ups done" right={`${p.followupsDone}${p.followupsOverdue ? ` · ${p.followupsOverdue} overdue` : ''}`} value={pct(p.followupsDone, fTotal)} tone={p.followupsOverdue > p.followupsDone ? 'bg-red-500' : 'bg-violet-500'} />
                    {p.postsPlanned !== null && <Bar label="Posts done" right={`${p.postsDone ?? 0} of ${p.postsPlanned}`} value={pct(p.postsDone ?? 0, p.postsPlanned)} tone="bg-pink-500" />}
                  </div>
                </button>
                {isOpen && (
                  <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                    <Stat label="Days present" value={p.daysPresent} />
                    <Stat label="Late days" value={p.lateDays} warn={p.lateDays > 2} />
                    <Stat label="Average hours a day" value={p.avgHours ? `${p.avgHours} h` : '—'} />
                    <Stat label="Leave days" value={p.leaveDays} />
                    <Stat label={`Sales (${p.invoices} invoice${p.invoices === 1 ? '' : 's'})`} value={`${d.currency} ${n0(p.sales)}`} />
                    <Stat label={`Profit (${p.profitInvoices} with payables)`} value={p.profitInvoices ? `${d.currency} ${n0(p.profit)}` : '—'} warn={p.profit < 0} />
                    <Stat label="Monthly target" value={p.target ? `${d.currency} ${n0(p.target)}` : 'Not set'} />
                    <Stat label="Still to reach" value={p.target ? `${d.currency} ${n0(Math.max(0, p.target - p.sales))}` : '—'} />
                    <Stat label="Follow-ups done" value={p.followupsDone} />
                    <Stat label="Follow-ups overdue" value={p.followupsOverdue} warn={p.followupsOverdue > 0} />
                    <Stat label="Time to finish a follow-up" value={hrs(p.avgFollowupHours)} />
                    {p.postsPlanned !== null && <Stat label="Posts done / planned" value={`${p.postsDone ?? 0} / ${p.postsPlanned}`} />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {d && d.missingRates.length > 0 && <p className="text-[11px] text-amber-700 dark:text-amber-300">No exchange rate yet for {d.missingRates.join(', ')}, so those invoices are not counted in sales.</p>}
      {d && <p className="text-[11px] text-slate-500">Overdue = follow-ups due this month that are still open after their time, or were finished late. Profit only counts invoices with payables locked against them.</p>}
    </div>
  );
};

/** Small on / off switch for the daily sales-target reminder (for the profile page). Hidden when the person has no target. */
export function TargetNudgeSwitch({ currentUser }: { currentUser: Employee }) {
  const [state, setState] = useState<{ off: boolean; target: number; currency: string; sales: number; remaining: number; daysLeft: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    crmCall<{ off: boolean; target: number; currency: string; sales: number; remaining: number; daysLeft: number }>('staff_nudge_get')
      .then((r) => { if (live) setState(r); })
      .catch(() => { if (live) setState(null); });
    return () => { live = false; };
  }, [currentUser.id]);
  if (!state || !state.target) return null;
  const toggle = async () => {
    setBusy(true); setErr('');
    try {
      const r = await crmCall<{ off: boolean }>('staff_nudge_set', { off: !state.off });
      setState({ ...state, off: r.off });
    } catch (e) {
      setErr((e as Error)?.message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  };
  const on = !state.off;
  return (
    <div className={`${cardCls} p-3 flex items-center gap-3`} data-target-nudge>
      <BellRing className="w-4 h-4 text-blue-500 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">Daily target reminder</p>
        <p className="text-[11px] text-slate-500">
          Each working morning: how much is left of your {state.currency} {n0(state.target)} target.
          {state.remaining > 0 ? ` ${state.currency} ${n0(state.remaining)} to go this month.` : ' You have reached it this month.'}
        </p>
        {err && <p className="text-[11px] text-red-600">{err}</p>}
      </div>
      <button
        type="button" role="switch" aria-checked={on} aria-label="Daily target reminder" disabled={busy} onClick={() => void toggle()}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors cursor-pointer disabled:opacity-50 ${on ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'}`}
      >
        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  );
}

export default PerformanceView;
