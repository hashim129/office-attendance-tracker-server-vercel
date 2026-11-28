import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Banknote, FileDown, Landmark, Wallet } from 'lucide-react';
import type { Employee } from '../types';
import { crmCall } from './crmApi';
import { btnPrimary, cardCls, ErrorNote, Field, inputCls } from './ui';
import { fmtAmount } from './currencies';
import { downloadReportPdf, fmtDayText } from '../lib/reportPdf';

/** Cash & bank book: money in (receipts) and money out (vendor payments) day by day, with a running balance per currency. */
type Account = 'all' | 'cash' | 'bank';
type PerCur = Record<string, number>;
type Move = { date: string; dir: 'in' | 'out'; account: 'cash' | 'bank' | 'other'; currency: string; amount: number; ref: string; refId: string; source: 'receipt' | 'bill' | 'purchase'; text: string };
type Day = { date: string; in: PerCur; out: PerCur; balance: PerCur; entries: Move[] };
type Data = { from: string; to: string; account: Account; opening: PerCur; days: Day[]; totals: { in: PerCur; out: PerCur; closing: PerCur }; currencies: string[]; otherCount: number };

const tap = 'min-h-10 sm:min-h-0';
const pkToday = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
const ACCOUNTS: { id: Account; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'cash', label: 'Cash' }, { id: 'bank', label: 'Bank' }];
const ACC_LABEL: Record<string, string> = { cash: 'Cash', bank: 'Bank', other: 'Card / other' };
const v = (o: PerCur, c: string) => Number(o?.[c]) || 0;
const perCurText = (o: PerCur, list: string[]) => list.filter((c) => v(o, c)).map((c) => `${c} ${fmtAmount(v(o, c))}`).join(' · ') || '0';

export const CashBookView: React.FC<{ currentUser: Employee }> = ({ currentUser }) => {
  const [from, setFrom] = useState(`${pkToday().slice(0, 7)}-01`);
  const [to, setTo] = useState(pkToday());
  const [account, setAccount] = useState<Account>('all');
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const allowed = ['admin', 'ceo', 'accounts'].includes(currentUser.role);

  useEffect(() => {
    if (!allowed || !from || !to) return;
    let live = true;
    setLoading(true);
    crmCall<Data>('books_cashbook', { from, to, account })
      .then((r) => { if (live) { setD(r); setErr(''); } })
      .catch((e) => { if (live) setErr(e?.message || 'Could not load the cash book.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [from, to, account, allowed]);

  if (!allowed) return <div className={`${cardCls} p-6 text-sm text-slate-600 dark:text-slate-300`}>The cash & bank book is for Admin, the CEO and Accounts.</div>;

  const curs = d?.currencies.length ? d.currencies : ['PKR'];
  const pdf = async () => {
    if (!d) return;
    const rows: Record<string, string>[] = [];
    for (const day of d.days) {
      for (const e of day.entries) rows.push({ d: fmtDayText(day.date), a: ACC_LABEL[e.account] || e.account, t: e.text, i: e.dir === 'in' ? `${e.currency} ${fmtAmount(e.amount)}` : '', o: e.dir === 'out' ? `${e.currency} ${fmtAmount(e.amount)}` : '', b: '' });
      rows.push({ d: '', a: '', t: `End of ${fmtDayText(day.date)}`, i: '', o: '', b: perCurText(day.balance, curs) });
    }
    await downloadReportPdf({
      title: `Cash & bank book · ${ACCOUNTS.find((x) => x.id === d.account)?.label}`,
      subtitle: `${fmtDayText(d.from)} to ${fmtDayText(d.to)}. Money in = receipts. Money out = payments on vendor bills and paid purchase items.`,
      companyName: 'Bahaar Journeys', generatedBy: currentUser.name, landscape: true,
      summary: [['Opening balance', perCurText(d.opening, curs)], ['Money in', perCurText(d.totals.in, curs)], ['Money out', perCurText(d.totals.out, curs)], ['Closing balance', perCurText(d.totals.closing, curs)]],
      columns: [{ key: 'd', label: 'Date', width: 1.3 }, { key: 'a', label: 'Account', width: 1.1 }, { key: 't', label: 'Details', width: 4.5 }, { key: 'i', label: 'In', width: 1.7, align: 'right' }, { key: 'o', label: 'Out', width: 1.7, align: 'right' }, { key: 'b', label: 'Balance', width: 2.2, align: 'right' }],
      rows,
      totals: { d: 'Total', a: '', t: '', i: perCurText(d.totals.in, curs), o: perCurText(d.totals.out, curs), b: perCurText(d.totals.closing, curs) },
    }, `cash-book-${d.account}-${d.from}-to-${d.to}`);
  };

  return (
    <div className="space-y-4" data-cashbook>
      <div className={`${cardCls} p-4 space-y-3`}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Cash & bank book</h2>
            <p className="text-xs text-slate-500">Money in from receipts and money out to vendors, day by day.</p>
          </div>
          <button className={`${btnPrimary} ${tap}`} onClick={() => void pdf().catch((e) => setErr(e?.message || 'Could not make the PDF.'))} disabled={!d} data-cashbook-pdf><FileDown className="w-4 h-4" /> Download PDF</button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-[10rem_10rem_auto] gap-2 sm:items-end">
          <Field label="From"><input type="date" className={`${inputCls} ${tap}`} value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input type="date" className={`${inputCls} ${tap}`} value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
          <div className="col-span-2 sm:col-span-1 flex gap-1.5" role="tablist">
            {ACCOUNTS.map((a) => (
              <button key={a.id} onClick={() => setAccount(a.id)} className={`${tap} flex-1 sm:flex-none px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${account === a.id ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`} data-cashbook-account={a.id}>{a.label}</button>
            ))}
          </div>
        </div>
      </div>

      <ErrorNote message={err} />
      {!d && !err && <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className={`${cardCls} h-20 animate-pulse`} />)}</div>}

      {d && (
        <div className={`space-y-4 ${loading ? 'opacity-60' : ''}`}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {([['Opening balance', d.opening, Wallet, ''], ['Money in', d.totals.in, ArrowDown, 'text-emerald-700 dark:text-emerald-400'], ['Money out', d.totals.out, ArrowUp, 'text-red-600 dark:text-red-400'], ['Closing balance', d.totals.closing, Banknote, '']] as const).map(([label, o, Icon, tone]) => (
              <div key={label} className={`${cardCls} p-3`}>
                <p className="text-[11px] text-slate-500 flex items-center gap-1"><Icon className="w-3.5 h-3.5" /> {label}</p>
                {curs.map((c) => <p key={c} className={`text-sm sm:text-base font-bold tabular-nums ${tone || 'text-slate-900 dark:text-slate-100'}`}>{c} {fmtAmount(v(o, c))}</p>)}
              </div>
            ))}
          </div>
          {d.otherCount > 0 && <p className="text-[11px] text-slate-500">{d.otherCount} payment{d.otherCount === 1 ? '' : 's'} in this period went by card, a third party or without a method noted. They show under “All” only.</p>}

          {d.days.length === 0 && (
            <div className={`${cardCls} p-8 text-center`}>
              <Landmark className="w-8 h-8 mx-auto text-slate-300" />
              <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-200">No money in or out between {fmtDayText(d.from)} and {fmtDayText(d.to)}.</p>
            </div>
          )}

          {d.days.map((day) => (
            <div key={day.date} className={cardCls} data-cashbook-day={day.date}>
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between px-4 py-2.5 border-b border-slate-100 dark:border-slate-800">
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">{fmtDayText(day.date)}</p>
                <p className="text-[11px] text-slate-500 tabular-nums">
                  <span className="text-emerald-700 dark:text-emerald-400">In {perCurText(day.in, curs)}</span> · <span className="text-red-600 dark:text-red-400">Out {perCurText(day.out, curs)}</span> · Balance <b className="text-slate-700 dark:text-slate-200">{perCurText(day.balance, curs)}</b>
                </p>
              </div>
              {day.entries.map((e, i) => (
                <div key={i} className="px-4 py-2 border-b last:border-b-0 border-slate-50 dark:border-slate-800/60 flex items-start justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <p className="text-slate-700 dark:text-slate-200 break-words">{e.text}</p>
                    <p className="text-[11px] text-slate-400">{ACC_LABEL[e.account] || e.account}</p>
                  </div>
                  <span className={`shrink-0 tabular-nums font-semibold ${e.dir === 'in' ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{e.dir === 'in' ? '+' : '-'} {e.currency} {fmtAmount(e.amount)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CashBookView;
