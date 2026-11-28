import React, { useEffect, useMemo, useState } from 'react';
import { AlarmClock, ExternalLink, MessageCircle, Search } from 'lucide-react';
import type { Employee } from '../types';
import { crmCall } from './crmApi';
import { btnGhost, btnPrimary, cardCls, ErrorNote, inputCls, Pill } from './ui';
import { fmtAmount } from './currencies';
import { fmtDayText } from '../lib/reportPdf';
import { waDigits } from './QuotesView';

/** Customer invoices whose due date (or travel date) has passed with a balance still to be received. */
type Row = { id: string; invoiceNo: string; customerName: string; customerPhone: string; currency: string; total: number; balance: number; dueDate: string; dueFrom: 'due' | 'travel'; daysOverdue: number; createdBy: string | null; createdByName: string; saleBy: string | null; saleByName: string };
type Data = { today: string; seeAll: boolean; invoices: Row[]; totals: { currency: string; balance: number; count: number }[] };

const tap = 'min-h-10 sm:min-h-0';
const money = (cur: string, n: number) => `${cur} ${fmtAmount(Number(n) || 0)}`;

export const reminderMessage = (r: Row): string => [
  `Assalam o Alaikum ${r.customerName},`,
  '',
  `This is a gentle reminder from Bahaar Journeys about invoice ${r.invoiceNo}.`,
  `A balance of ${money(r.currency, r.balance)} is still to be received${r.dueFrom === 'due' ? ` (due on ${fmtDayText(r.dueDate)})` : ''}.`,
  '',
  'If you have already sent it, please share the transfer details so we can mark it received.',
  '',
  'Thank you,',
  'Bahaar Journeys',
].join('\n');

export const OverdueView: React.FC<{ currentUser: Employee; onOpenInvoice: (invoiceId: string) => void }> = ({ currentUser, onOpenInvoice }) => {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    crmCall<Data>('books_overdue').then((r) => { setD(r); setErr(''); }).catch((e) => setErr(e?.message || 'Could not load overdue invoices.'));
  }, [currentUser.id]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (d?.invoices || []).filter((r) => !s || `${r.invoiceNo} ${r.customerName} ${r.customerPhone} ${r.createdByName} ${r.saleByName}`.toLowerCase().includes(s));
  }, [d, q]);

  const remind = (r: Row) => window.open(`https://wa.me/${waDigits(r.customerPhone)}?text=${encodeURIComponent(reminderMessage(r))}`, '_blank', 'noopener');
  const tone = (days: number) => (days > 30 ? 'red' : days > 7 ? 'amber' : 'slate') as 'red' | 'amber' | 'slate';

  return (
    <div className="space-y-4" data-overdue-view>
      <div className={`${cardCls} p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}>
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Overdue invoices</h2>
          <p className="text-xs text-slate-500">Customer invoices past their due date (or travel date when no due date is set) with a balance still to be received. Oldest first.</p>
        </div>
        <div className="relative sm:w-64">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={`${inputCls} pl-8 ${tap}`} placeholder="Search invoice or customer" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <ErrorNote message={err} />

      {d && d.totals.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {d.totals.map((t) => (
            <div key={t.currency} className={`${cardCls} p-3`}>
              <p className="text-[11px] text-slate-500">Still to be received · {t.count} invoice{t.count === 1 ? '' : 's'}</p>
              <p className="text-base font-bold tabular-nums text-red-600 dark:text-red-400">{money(t.currency, t.balance)}</p>
            </div>
          ))}
        </div>
      )}

      {!d && !err && <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className={`${cardCls} h-24 animate-pulse`} />)}</div>}

      {d && shown.length === 0 && (
        <div className={`${cardCls} p-8 text-center`}>
          <AlarmClock className="w-8 h-8 mx-auto text-slate-300" />
          <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-200">{d.invoices.length ? 'No overdue invoice matches your search.' : 'Nothing overdue. Every past-due invoice has been received.'}</p>
        </div>
      )}

      <div className="space-y-2">
        {shown.map((r) => (
          <div key={r.id} className={`${cardCls} p-3 sm:p-4`} data-overdue-row={r.invoiceNo}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{r.invoiceNo}</span>
                  <Pill tone={tone(r.daysOverdue)}>{r.daysOverdue} day{r.daysOverdue === 1 ? '' : 's'} overdue</Pill>
                </div>
                <p className="text-sm text-slate-700 dark:text-slate-200 mt-0.5 break-words">{r.customerName}{r.customerPhone && <span className="text-slate-400"> · {r.customerPhone}</span>}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {r.dueFrom === 'due' ? 'Due' : 'Travelled'} {fmtDayText(r.dueDate)} · invoice total {money(r.currency, r.total)}
                  {d?.seeAll && (r.saleByName || r.createdByName) ? ` · ${r.saleByName ? `sale by ${r.saleByName}` : `by ${r.createdByName}`}` : ''}
                </p>
              </div>
              <div className="sm:text-right shrink-0">
                <p className="text-[11px] text-slate-500">Balance to be received</p>
                <p className="text-base font-bold tabular-nums text-red-600 dark:text-red-400">{money(r.currency, r.balance)}</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
              <button className={`${btnGhost} ${tap}`} onClick={() => remind(r)} data-overdue-wa><MessageCircle className="w-4 h-4" /> Send reminder on WhatsApp</button>
              <button className={`${btnPrimary} ${tap}`} onClick={() => onOpenInvoice(r.id)} data-overdue-open><ExternalLink className="w-4 h-4" /> Open invoice</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default OverdueView;
