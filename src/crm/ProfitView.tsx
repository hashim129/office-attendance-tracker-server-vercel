import React, { useEffect, useState } from 'react';
import type { Employee } from '../types';
import { crmCall } from './crmApi';
import { btnGhost, btnPrimary, cardCls, inputCls } from './ui';
import { downloadReportPdf } from '../lib/reportPdf';

/** Profit & commission per employee for a month, in PKR, with a monthly profit-and-loss PDF. */
type Row = { id: string; name: string; count: number; sales: number; cost: number; profit: number; receivedProfit: number; receivable: number; commissionPct: number; commission: number };
type Data = { month: string; people: Row[]; totals: Omit<Row, 'id' | 'name' | 'commissionPct'>; rates: { date: string | null; USD: number | null; AED: number | null; SAR: number | null }; missingRates: string[]; canEdit: boolean; staff: { id: string; name: string; commissionPct: number }[] };
const pkr = (n: number) => `PKR ${Math.round(n).toLocaleString()}`;
const thisMonth = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 7);
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export const ProfitView: React.FC<{ currentUser: Employee; companyName: string }> = ({ currentUser, companyName }) => {
  const [month, setMonth] = useState(thisMonth());
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState<Record<string, string> | null>(null);
  const load = (m = month) => crmCall<Data>('profit_report', { month: m }).then((r) => { setD(r); setErr(''); }).catch((e) => setErr(e?.message || 'Could not load.'));
  useEffect(() => { void load(month); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [month]);
  const pdf = async () => {
    if (!d) return;
    const cols = [{ key: 'name', label: 'Employee', width: 3 }, { key: 'count', label: 'Invoices', width: 1.2, align: 'right' as const }, { key: 'sales', label: 'Sales', width: 2, align: 'right' as const }, { key: 'cost', label: 'Cost', width: 2, align: 'right' as const }, { key: 'profit', label: 'Profit', width: 2, align: 'right' as const }, { key: 'received', label: 'Profit received', width: 2, align: 'right' as const }, { key: 'commission', label: 'Commission', width: 2, align: 'right' as const }];
    const f = (n: number) => Math.round(n).toLocaleString();
    await downloadReportPdf({
      title: `Profit & Loss · ${monthName(d.month)}`, subtitle: 'All amounts in PKR (other currencies at the day’s rate)', companyName, generatedBy: currentUser.name, landscape: true,
      summary: [['Sales', pkr(d.totals.sales)], ['Cost of sales (vendors)', pkr(d.totals.cost)], ['Gross profit', pkr(d.totals.profit)], ['Profit received', pkr(d.totals.receivedProfit)], ['Still to receive', pkr(d.totals.receivable)], ['Commission due', pkr(d.totals.commission)]],
      columns: cols,
      rows: d.people.map((p) => ({ name: p.name, count: String(p.count), sales: f(p.sales), cost: f(p.cost), profit: f(p.profit), received: f(p.receivedProfit), commission: p.commissionPct ? `${f(p.commission)} (${p.commissionPct}%)` : '—' })),
      totals: { name: 'Total', count: String(d.totals.count), sales: f(d.totals.sales), cost: f(d.totals.cost), profit: f(d.totals.profit), received: f(d.totals.receivedProfit), commission: f(d.totals.commission) },
    }, `profit-and-loss-${d.month}`);
    void crmCall('audit_note', { what: 'exported a PDF', detail: `Profit & Loss ${d.month}` }).catch(() => null);
  };
  return (
    <div className="space-y-4" data-profit-view>
      <div className={`${cardCls} p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}>
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Profit & commission</h2>
          <p className="text-xs text-slate-500">From every invoice’s sale. Commission is paid on profit that has been received.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input type="month" className={`${inputCls} w-40`} value={month} max={thisMonth()} onChange={(e) => setMonth(e.target.value || thisMonth())} />
          {d?.canEdit && <button className={btnGhost} onClick={() => setEdit(Object.fromEntries(d.staff.map((s) => [s.id, s.commissionPct ? String(s.commissionPct) : ''])))}>Commission rates</button>}
          <button className={btnPrimary} onClick={() => void pdf()} disabled={!d} data-pl-pdf>Profit & Loss PDF</button>
        </div>
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}
      {d && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[['Sales', d.totals.sales], ['Cost', d.totals.cost], ['Gross profit', d.totals.profit], ['Profit received', d.totals.receivedProfit], ['Commission due', d.totals.commission]].map(([l, v]) => (
              <div key={l as string} className={`${cardCls} p-3`}><p className="text-[11px] text-slate-500">{l}</p><p className={`text-base font-bold tabular-nums ${l === 'Gross profit' && (v as number) < 0 ? 'text-red-600' : 'text-slate-900 dark:text-slate-100'}`}>{pkr(v as number)}</p></div>
            ))}
          </div>
          <div className={`${cardCls} overflow-x-auto`}>
            <table className="w-full text-xs" data-profit-table>
              <thead><tr className="text-left text-slate-500 border-b border-slate-100 dark:border-slate-800"><th className="p-3 font-medium">Employee</th><th className="p-3 font-medium text-right">Invoices</th><th className="p-3 font-medium text-right">Sales</th><th className="p-3 font-medium text-right">Cost</th><th className="p-3 font-medium text-right">Profit</th><th className="p-3 font-medium text-right">Received</th><th className="p-3 font-medium text-right">Commission</th></tr></thead>
              <tbody>
                {d.people.map((p) => (
                  <tr key={p.id} className="border-b border-slate-50 dark:border-slate-800/60">
                    <td className="p-3 font-medium text-slate-800 dark:text-slate-200">{p.name}</td>
                    <td className="p-3 text-right tabular-nums">{p.count}</td>
                    <td className="p-3 text-right tabular-nums">{Math.round(p.sales).toLocaleString()}</td>
                    <td className="p-3 text-right tabular-nums">{Math.round(p.cost).toLocaleString()}</td>
                    <td className={`p-3 text-right tabular-nums font-semibold ${p.profit < 0 ? 'text-red-600' : 'text-emerald-700 dark:text-emerald-400'}`}>{Math.round(p.profit).toLocaleString()}</td>
                    <td className="p-3 text-right tabular-nums">{Math.round(p.receivedProfit).toLocaleString()}</td>
                    <td className="p-3 text-right tabular-nums">{p.commissionPct ? <>{Math.round(p.commission).toLocaleString()} <span className="text-slate-400">({p.commissionPct}%)</span></> : <span className="text-slate-400">—</span>}</td>
                  </tr>
                ))}
                {d.people.length === 0 && <tr><td colSpan={7} className="p-4 text-slate-500">No sales in {monthName(d.month)}.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-500">Rates on {d.rates.date || '—'}: 1 USD = PKR {d.rates.USD ?? '—'} · 1 AED = PKR {d.rates.AED ?? '—'} · 1 SAR = PKR {d.rates.SAR ?? '—'}.{d.missingRates.length ? ` No rate for ${d.missingRates.join(', ')}, so those sales are not counted.` : ''}</p>
        </>
      )}
      {edit && d && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/50 p-3" role="dialog" aria-modal="true" data-app-modal>
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-900 p-4 max-h-[85vh] overflow-y-auto">
            <p className="text-sm font-semibold">Commission rates</p>
            <p className="text-xs text-slate-500 mb-3">% of received profit, per employee. Leave empty for none.</p>
            {d.staff.map((s) => (
              <label key={s.id} className="flex items-center justify-between gap-3 py-1.5 text-xs border-b border-slate-100 dark:border-slate-800">
                <span>{s.name}</span>
                <span className="inline-flex items-center gap-1"><input className={`${inputCls} w-20 text-right`} inputMode="decimal" value={edit[s.id] || ''} onChange={(e) => setEdit({ ...edit, [s.id]: e.target.value })} />%</span>
              </label>
            ))}
            <div className="mt-3 flex justify-end gap-2">
              <button className={btnGhost} onClick={() => setEdit(null)}>Cancel</button>
              <button className={btnPrimary} onClick={() => void crmCall('commission_save', { people: edit }).then(() => { setEdit(null); void load(); }).catch((e) => setErr(e?.message || 'Could not save.'))}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default ProfitView;
