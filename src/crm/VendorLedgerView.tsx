import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Building2, FileDown, Search } from 'lucide-react';
import type { Employee } from '../types';
import { crmCall } from './crmApi';
import { btnGhost, btnPrimary, cardCls, ErrorNote, inputCls, Pill } from './ui';
import { fmtAmount } from './currencies';
import { downloadReportPdf, fmtDayText, safeFileName } from '../lib/reportPdf';

/** What we owe each vendor: vendor bills plus vendor items on purchases, grouped by vendor name. Admin, CEO and Accounts. */
type Cur = { currency: string; booked: number; paid: number; owed: number };
type Entry = { date: string; kind: 'booked' | 'paid'; source: 'bill' | 'purchase'; ref: string; refId: string; text: string; currency: string; amount: number; balance: number; dueDate?: string | null };
type Vendor = { key: string; name: string; otherNames: string[]; currencies: Cur[]; owedPkr: number; entries: Entry[]; lastDate: string | null };
type Data = { vendors: Vendor[]; totals: Cur[]; today: string };

const tap = 'min-h-10 sm:min-h-0';
const money = (cur: string, n: number) => `${cur} ${fmtAmount(Number(n) || 0)}`;

async function statementPdf(v: Vendor, by: string) {
  const currencies = v.currencies.map((c) => c.currency);
  await downloadReportPdf({
    title: `Vendor statement · ${v.name}`,
    subtitle: `All bills and purchase items booked with ${v.name}${v.otherNames.length ? ` (also written as ${v.otherNames.join(', ')})` : ''}, and what has been paid.`,
    companyName: 'Bahaar Journeys', generatedBy: by, landscape: false, columns: [], rows: [],
    summary: v.currencies.flatMap((c) => [[`Booked ${c.currency}`, fmtAmount(c.booked)], [`Paid ${c.currency}`, fmtAmount(c.paid)], [`Still owed ${c.currency}`, fmtAmount(c.owed)]] as [string, string][]),
    sections: currencies.map((cur) => {
      const list = v.entries.filter((e) => e.currency === cur);
      const c = v.currencies.find((x) => x.currency === cur)!;
      return {
        heading: currencies.length > 1 ? `${cur} entries` : undefined,
        columns: [{ key: 'd', label: 'Date', width: 1.4 }, { key: 'r', label: 'Ref', width: 1.3 }, { key: 't', label: 'Details', width: 4 }, { key: 'b', label: `Booked (${cur})`, width: 1.5, align: 'right' as const }, { key: 'p', label: `Paid (${cur})`, width: 1.5, align: 'right' as const }, { key: 'o', label: 'Balance', width: 1.5, align: 'right' as const }],
        rows: list.map((e) => ({ d: fmtDayText(e.date), r: e.ref, t: e.text, b: e.kind === 'booked' ? fmtAmount(e.amount) : '', p: e.kind === 'paid' ? fmtAmount(e.amount) : '', o: fmtAmount(e.balance) })),
        totals: { d: 'Total', r: '', t: '', b: fmtAmount(c.booked), p: fmtAmount(c.paid), o: fmtAmount(c.owed) },
      };
    }),
  }, `vendor-statement-${safeFileName(v.name)}`);
}

export const VendorLedgerView: React.FC<{ currentUser: Employee }> = ({ currentUser }) => {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const allowed = ['admin', 'ceo', 'accounts'].includes(currentUser.role);

  useEffect(() => {
    if (!allowed) return;
    crmCall<Data>('books_vendor_ledger').then((r) => { setD(r); setErr(''); }).catch((e) => setErr(e?.message || 'Could not load the vendor ledger.'));
  }, [allowed]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/\s+/g, '');
    return (d?.vendors || []).filter((v) => !s || v.key.includes(s) || v.otherNames.some((n) => n.toLowerCase().replace(/\s+/g, '').includes(s)));
  }, [d, q]);
  const vendor = open ? d?.vendors.find((v) => v.key === open) || null : null;

  if (!allowed) return <div className={`${cardCls} p-6 text-sm text-slate-600 dark:text-slate-300`}>The vendor ledger is for Admin, the CEO and Accounts.</div>;

  if (vendor) {
    return (
      <div className="space-y-4" data-vendor-detail>
        <div className={`${cardCls} p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}>
          <div className="flex items-start gap-2 min-w-0">
            <button className={`${btnGhost} ${tap}`} onClick={() => setOpen(null)} aria-label="Back to vendors"><ArrowLeft className="w-4 h-4" /></button>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 break-words">{vendor.name}</h2>
              {vendor.otherNames.length > 0 && <p className="text-[11px] text-slate-500 break-words">Also written as {vendor.otherNames.join(', ')}</p>}
            </div>
          </div>
          <button className={`${btnPrimary} ${tap}`} onClick={() => void statementPdf(vendor, currentUser.name).catch((e) => setErr(e?.message || 'Could not make the PDF.'))} data-vendor-pdf><FileDown className="w-4 h-4" /> Download statement (PDF)</button>
        </div>
        <ErrorNote message={err} />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {vendor.currencies.map((c) => (
            <div key={c.currency} className={`${cardCls} p-3 space-y-1 text-xs`}>
              <p className="font-semibold text-slate-700 dark:text-slate-200">{c.currency}</p>
              <div className="flex justify-between"><span className="text-slate-500">Booked</span><span className="tabular-nums">{fmtAmount(c.booked)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Paid</span><span className="tabular-nums">{fmtAmount(c.paid)}</span></div>
              <div className="flex justify-between font-bold"><span>Still owed</span><span className={`tabular-nums ${c.owed > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{fmtAmount(c.owed)}</span></div>
            </div>
          ))}
        </div>
        <div className={cardCls}>
          <div className="hidden md:grid grid-cols-[7rem_7rem_1fr_8rem_8rem_8rem] gap-2 px-4 py-2 text-[11px] font-semibold text-slate-500 border-b border-slate-100 dark:border-slate-800">
            <span>Date</span><span>Ref</span><span>Details</span><span className="text-right">Booked</span><span className="text-right">Paid</span><span className="text-right">Balance</span>
          </div>
          {vendor.entries.length === 0 && <p className="p-4 text-xs text-slate-500">No entries.</p>}
          {vendor.entries.map((e, i) => (
            <div key={i} className="px-4 py-2.5 border-b last:border-b-0 border-slate-50 dark:border-slate-800/60 text-xs md:grid md:grid-cols-[7rem_7rem_1fr_8rem_8rem_8rem] md:gap-2 md:items-center">
              <div className="flex justify-between md:block"><span className="text-slate-600 dark:text-slate-300">{fmtDayText(e.date) || '—'}</span><span className="md:hidden"><Pill tone={e.kind === 'paid' ? 'green' : 'amber'}>{e.kind === 'paid' ? 'Paid' : 'Booked'}</Pill></span></div>
              <span className="block font-medium text-slate-700 dark:text-slate-200">{e.ref}</span>
              <span className="block text-slate-600 dark:text-slate-300 break-words">{e.text}{e.kind === 'booked' && e.dueDate ? <span className="text-slate-400"> · due {fmtDayText(e.dueDate)}</span> : null}</span>
              <span className="hidden md:block text-right tabular-nums">{e.kind === 'booked' ? money(e.currency, e.amount) : ''}</span>
              <span className="hidden md:block text-right tabular-nums text-emerald-700 dark:text-emerald-400">{e.kind === 'paid' ? money(e.currency, e.amount) : ''}</span>
              <span className="hidden md:block text-right tabular-nums font-semibold">{money(e.currency, e.balance)}</span>
              <div className="md:hidden mt-1 flex justify-between tabular-nums"><span className={e.kind === 'paid' ? 'text-emerald-700 dark:text-emerald-400' : ''}>{e.kind === 'paid' ? '- ' : '+ '}{money(e.currency, e.amount)}</span><span className="text-slate-500">Balance {money(e.currency, e.balance)}</span></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-vendor-ledger>
      <div className={`${cardCls} p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}>
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Vendor ledger</h2>
          <p className="text-xs text-slate-500">Vendor bills and purchase items for each vendor: what was booked, what is paid and what we still owe.</p>
        </div>
        <div className="relative sm:w-64">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={`${inputCls} pl-8 ${tap}`} placeholder="Search vendor" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <ErrorNote message={err} />
      {d && d.totals.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {d.totals.map((t) => (
            <div key={t.currency} className={`${cardCls} p-3`}>
              <p className="text-[11px] text-slate-500">Still owed to vendors ({t.currency})</p>
              <p className="text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">{money(t.currency, t.owed)}</p>
              <p className="text-[11px] text-slate-500">of {fmtAmount(t.booked)} booked</p>
            </div>
          ))}
        </div>
      )}
      {!d && !err && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className={`${cardCls} h-24 animate-pulse`} />)}</div>}
      {d && shown.length === 0 && (
        <div className={`${cardCls} p-8 text-center`}>
          <Building2 className="w-8 h-8 mx-auto text-slate-300" />
          <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-200">{d.vendors.length ? 'No vendor matches your search.' : 'No vendor bills or purchases yet.'}</p>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {shown.map((v) => {
          const owes = v.currencies.filter((c) => c.owed > 0);
          return (
            <button key={v.key} onClick={() => setOpen(v.key)} className={`${cardCls} p-4 text-left hover:border-blue-300 dark:hover:border-blue-800 transition-colors`} data-vendor-card={v.key}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 break-words">{v.name}</p>
                {owes.length ? <Pill tone="red">Owed</Pill> : <Pill tone="green">Settled</Pill>}
              </div>
              <div className="mt-2 space-y-0.5">
                {v.currencies.map((c) => (
                  <div key={c.currency} className="flex justify-between text-xs">
                    <span className="text-slate-500">{c.currency} · paid {fmtAmount(c.paid)} of {fmtAmount(c.booked)}</span>
                    <span className={`tabular-nums font-semibold ${c.owed > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-400'}`}>{fmtAmount(c.owed)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-400">{v.entries.length} entr{v.entries.length === 1 ? 'y' : 'ies'}{v.lastDate ? ` · last ${fmtDayText(v.lastDate)}` : ''}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default VendorLedgerView;
