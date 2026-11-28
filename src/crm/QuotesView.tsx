import React, { useEffect, useMemo, useState } from 'react';
import { CircleCheck, FileDown, FileText, MessageCircle, Pencil, Plus, Search, Send, Trash2, X, CircleX } from 'lucide-react';
import type { Employee } from '../types';
import { crmCall } from './crmApi';
import { btnDanger, btnGhost, btnPrimary, cardCls, ErrorNote, Field, inputCls, Pill } from './ui';
import { allCurrencies, fmtAmount } from './currencies';
import { downloadReportPdf, fmtDatePk, fmtDayText, safeFileName } from '../lib/reportPdf';

/** Quotations: price offers made before an invoice. Draft -> sent -> approved / declined -> converted (an invoice was made). */
export type QuoteStatus = 'draft' | 'sent' | 'approved' | 'declined' | 'converted';
export interface QuoteLine { description: string; units: number; unitPrice: number; amount: number }
export interface Quote {
  id: string; quoteNo: string; customerName: string; customerPhone: string; customerId: string | null; currency: string;
  lines: QuoteLine[]; subtotal: number; discount: number; total: number; notes: string; validUntil: string | null; travelDate: string | null;
  status: QuoteStatus; statusReason?: string; createdBy: string; createdByName?: string; createdAt: string; updatedAt?: string | null;
  invoiceId?: string | null; invoiceNo?: string | null;
}
export interface QuoteInvoicePrefill {
  quoteId: string; customerName: string; customerPhone: string; currency: string;
  lines: { description: string; units: number; unitPrice: number }[]; discount: number; notes: string; travelDate: string | null;
}
type Summary = { currency: string; approvedOpen: number; count: number };
type ListData = { quotes: Quote[]; seeAll: boolean; approvedOpen: Summary[]; today: string };
type Pick = { id: string; name: string; phone: string };
type LineDraft = { description: string; units: string; unitPrice: string };
type Draft = { id?: string; customerId: string; customerName: string; customerPhone: string; currency: string; lines: LineDraft[]; discount: string; notes: string; validUntil: string; travelDate: string };

const COMPANY = 'Bahaar Journeys';
const STATUS_LABEL: Record<QuoteStatus, string> = { draft: 'Draft', sent: 'Sent', approved: 'Approved', declined: 'Declined', converted: 'Invoiced' };
const STATUS_TONE: Record<QuoteStatus, 'slate' | 'blue' | 'green' | 'red' | 'violet'> = { draft: 'slate', sent: 'blue', approved: 'green', declined: 'red', converted: 'violet' };
const FILTERS: ('all' | QuoteStatus)[] = ['all', 'draft', 'sent', 'approved', 'declined', 'converted'];
const pkToday = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
const plusDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const tap = 'min-h-10 sm:min-h-0';
const money = (cur: string, n: number) => `${cur} ${fmtAmount(Number(n) || 0)}`;
const emptyLine = (): LineDraft => ({ description: '', units: '1', unitPrice: '' });
const blankDraft = (): Draft => ({ customerId: '', customerName: '', customerPhone: '', currency: 'PKR', lines: [emptyLine()], discount: '', notes: '', validUntil: plusDays(pkToday(), 7), travelDate: '' });

/** 0300-1234567 -> 923001234567 (Pakistan numbers written with a leading 0). */
export const waDigits = (phone: string): string => {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0') && d.length === 11) d = `92${d.slice(1)}`;
  return d;
};

export const quoteMessage = (q: Quote): string => {
  const lines = q.lines.map((l, i) => `${i + 1}. ${l.description}: ${fmtAmount(l.units)} x ${money(q.currency, l.unitPrice)} = ${money(q.currency, l.amount)}`);
  return [
    `Assalam o Alaikum ${q.customerName},`,
    '',
    `Here is your quotation ${q.quoteNo} from ${COMPANY}.`,
    '',
    ...lines,
    ...(q.discount > 0 ? [`Discount: ${money(q.currency, q.discount)}`] : []),
    `*Total: ${money(q.currency, q.total)}*`,
    ...(q.travelDate ? [`Travel date: ${fmtDayText(q.travelDate)}`] : []),
    ...(q.validUntil ? [`Valid until: ${fmtDayText(q.validUntil)}`] : []),
    ...(q.notes ? ['', q.notes] : []),
    '',
    'Please let us know if you would like to go ahead or change anything.',
    '',
    'Thank you,',
    COMPANY,
  ].join('\n');
};

async function quotePdf(q: Quote, by: string) {
  const subtitle = [`For ${q.customerName}${q.customerPhone ? ` (${q.customerPhone})` : ''}`, q.travelDate ? `Travel date ${fmtDayText(q.travelDate)}` : '', q.validUntil ? `Valid until ${fmtDayText(q.validUntil)}` : ''].filter(Boolean).join(' · ');
  const summary: [string, string][] = [['Quotation', q.quoteNo], ['Date', fmtDatePk(q.createdAt)], ...(q.validUntil ? [['Valid until', fmtDayText(q.validUntil)] as [string, string]] : []), ['Total', money(q.currency, q.total)]];
  await downloadReportPdf({
    title: `Quotation ${q.quoteNo}`, subtitle, companyName: COMPANY, generatedBy: by, summary, landscape: false, columns: [], rows: [],
    sections: [
      {
        columns: [{ key: 'n', label: '#', width: 0.5 }, { key: 'd', label: 'Description', width: 5 }, { key: 'u', label: 'Units', width: 1, align: 'right' }, { key: 'p', label: `Unit price (${q.currency})`, width: 2, align: 'right' }, { key: 'a', label: `Amount (${q.currency})`, width: 2, align: 'right' }],
        rows: [
          ...q.lines.map((l, i) => ({ n: String(i + 1), d: l.description, u: fmtAmount(l.units), p: fmtAmount(l.unitPrice), a: fmtAmount(l.amount) })),
          ...(q.discount > 0 ? [{ n: '', d: 'Subtotal', u: '', p: '', a: fmtAmount(q.subtotal) }, { n: '', d: 'Discount', u: '', p: '', a: `- ${fmtAmount(q.discount)}` }] : []),
        ],
        totals: { n: '', d: 'Total', u: '', p: '', a: money(q.currency, q.total) },
      },
      ...(q.notes ? [{ heading: 'Notes', columns: [{ key: 't', label: 'Details', width: 1 }], rows: [{ t: q.notes }] }] : []),
      { heading: 'Thank you', columns: [{ key: 't', label: COMPANY, width: 1 }], rows: [{ t: 'Prices and seats are confirmed once the booking is made. Please contact us to go ahead or to change anything in this quotation.' }] },
    ],
  }, `quotation-${safeFileName(q.quoteNo)}-${safeFileName(q.customerName)}`);
}

export const QuotesView: React.FC<{ currentUser: Employee; onMakeInvoice: (prefill: QuoteInvoicePrefill) => void }> = ({ currentUser, onMakeInvoice }) => {
  const [data, setData] = useState<ListData | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<'all' | QuoteStatus>('all');
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formErr, setFormErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [customers, setCustomers] = useState<Pick[] | null>(null);
  const [statusAsk, setStatusAsk] = useState<{ quote: Quote; status: 'approved' | 'declined'; reason: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Quote | null>(null);
  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'ceo';

  const load = () => crmCall<ListData>('books_quote_list').then((r) => { setData(r); setErr(''); }).catch((e) => setErr(e?.message || 'Could not load the quotations.'));
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (draft && customers === null) crmCall<{ customers: Pick[] }>('books_quote_customers').then((r) => setCustomers(r.customers)).catch(() => setCustomers([]));
  }, [draft, customers]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: data?.quotes.length || 0 };
    for (const x of data?.quotes || []) c[x.status] = (c[x.status] || 0) + 1;
    return c;
  }, [data]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.quotes || []).filter((x) => (filter === 'all' || x.status === filter) && (!s || `${x.quoteNo} ${x.customerName} ${x.customerPhone} ${x.createdByName || ''}`.toLowerCase().includes(s)));
  }, [data, filter, q]);

  const replace = (next: Quote) => setData((d) => (d ? { ...d, quotes: d.quotes.some((x) => x.id === next.id) ? d.quotes.map((x) => (x.id === next.id ? next : x)) : [next, ...d.quotes] } : d));
  const afterChange = (next: Quote) => { replace(next); void load(); };

  const openNew = () => { setFormErr(''); setDraft(blankDraft()); };
  const openEdit = (x: Quote) => {
    setFormErr('');
    setDraft({ id: x.id, customerId: x.customerId || '', customerName: x.customerName, customerPhone: x.customerPhone, currency: x.currency, lines: x.lines.map((l) => ({ description: l.description, units: String(l.units), unitPrice: String(l.unitPrice) })), discount: x.discount ? String(x.discount) : '', notes: x.notes, validUntil: x.validUntil || '', travelDate: x.travelDate || '' });
  };
  const draftTotals = useMemo(() => {
    if (!draft) return { subtotal: 0, total: 0 };
    const subtotal = draft.lines.reduce((a, l) => a + (Number(l.units === '' ? 1 : l.units) || 0) * (Number(l.unitPrice) || 0), 0);
    return { subtotal, total: subtotal - (Number(draft.discount) || 0) };
  }, [draft]);
  const save = async () => {
    if (!draft) return;
    setBusy(true); setFormErr('');
    try {
      const r = await crmCall<{ quote: Quote }>('books_quote_save', { quote: { ...draft, customerId: draft.customerId || null, lines: draft.lines.filter((l) => l.description.trim() || l.unitPrice !== '') } });
      afterChange(r.quote); setDraft(null);
    } catch (e: any) { setFormErr(e?.message || 'Could not save the quotation.'); }
    setBusy(false);
  };
  const setStatus = async (x: Quote, status: 'sent' | 'approved' | 'declined', reason = '') => {
    try { const r = await crmCall<{ quote: Quote }>('books_quote_status', { id: x.id, status, reason }); afterChange(r.quote); setStatusAsk(null); }
    catch (e: any) { setErr(e?.message || 'Could not change the status.'); }
  };
  const remove = async (x: Quote) => {
    try { await crmCall('books_quote_delete', { id: x.id }); setConfirmDelete(null); void load(); }
    catch (e: any) { setErr(e?.message || 'Could not delete the quotation.'); setConfirmDelete(null); }
  };
  const sendWhatsApp = (x: Quote) => {
    const digits = waDigits(x.customerPhone);
    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(quoteMessage(x))}`, '_blank', 'noopener');
    if (x.status === 'draft') void setStatus(x, 'sent');
  };
  const makeInvoice = (x: Quote) => onMakeInvoice({
    quoteId: x.id, customerName: x.customerName, customerPhone: x.customerPhone, currency: x.currency,
    lines: x.lines.map((l) => ({ description: l.description, units: l.units, unitPrice: l.unitPrice })), discount: x.discount, notes: x.notes, travelDate: x.travelDate,
  });
  const pdf = (x: Quote) => quotePdf(x, currentUser.name).catch((e) => setErr(e?.message || 'Could not make the PDF.'));

  const setLine = (i: number, patch: Partial<LineDraft>) => setDraft((d) => (d ? { ...d, lines: d.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) } : d));
  const today = data?.today || pkToday();

  return (
    <div className="space-y-4" data-quotes-view>
      <div className={`${cardCls} p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}>
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Quotations</h2>
          <p className="text-xs text-slate-500">Make a price offer, send it on WhatsApp or as a PDF, and turn it into an invoice once the customer agrees.</p>
        </div>
        <button className={`${btnPrimary} ${tap}`} onClick={openNew} data-quote-new><Plus className="w-4 h-4" /> New quotation</button>
      </div>

      {data && data.approvedOpen.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" data-quote-totals>
          {data.approvedOpen.map((s) => (
            <div key={s.currency} className={`${cardCls} p-3`}>
              <p className="text-[11px] text-slate-500">Approved, not invoiced yet ({s.count})</p>
              <p className="text-base font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{money(s.currency, s.approvedOpen)}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`${tap} px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${filter === f ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`} data-quote-filter={f}>
              {f === 'all' ? 'All' : STATUS_LABEL[f]} <span className="opacity-70">{counts[f] || 0}</span>
            </button>
          ))}
        </div>
        <div className="relative sm:w-64">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={`${inputCls} pl-8 ${tap}`} placeholder="Search number or customer" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <ErrorNote message={err} />

      {!data && !err && (
        <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className={`${cardCls} h-24 animate-pulse`} />)}</div>
      )}

      {data && shown.length === 0 && (
        <div className={`${cardCls} p-8 text-center`}>
          <FileText className="w-8 h-8 mx-auto text-slate-300" />
          <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-200">{data.quotes.length ? 'No quotations match this filter.' : 'No quotations yet.'}</p>
          {!data.quotes.length && <p className="text-xs text-slate-500 mt-1">Make your first one with “New quotation”.</p>}
        </div>
      )}

      <div className="space-y-2">
        {shown.map((x) => {
          const expired = x.validUntil && x.validUntil < today && (x.status === 'draft' || x.status === 'sent');
          const mine = x.createdBy === currentUser.id;
          return (
            <div key={x.id} className={`${cardCls} p-3 sm:p-4`} data-quote-row={x.quoteNo}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{x.quoteNo}</span>
                    <Pill tone={STATUS_TONE[x.status]}>{STATUS_LABEL[x.status]}</Pill>
                    {expired && <Pill tone="amber">Validity ended</Pill>}
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-200 mt-0.5 break-words">{x.customerName}{x.customerPhone && <span className="text-slate-400"> · {x.customerPhone}</span>}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {x.lines.length} line{x.lines.length === 1 ? '' : 's'}
                    {x.travelDate ? ` · travel ${fmtDayText(x.travelDate)}` : ''}
                    {x.validUntil ? ` · valid until ${fmtDayText(x.validUntil)}` : ''}
                    {data?.seeAll && !mine && x.createdByName ? ` · by ${x.createdByName}` : ''}
                  </p>
                  {x.status === 'converted' && x.invoiceNo && <p className="text-[11px] text-violet-700 dark:text-violet-300 mt-0.5">Invoice {x.invoiceNo}</p>}
                  {x.statusReason && (x.status === 'declined' || x.status === 'approved') && <p className="text-[11px] text-slate-500 mt-0.5 italic break-words">“{x.statusReason}”</p>}
                </div>
                <p className="text-base font-bold tabular-nums text-slate-900 dark:text-slate-100 sm:text-right shrink-0">{money(x.currency, x.total)}</p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                {x.status === 'approved' && <button className={`${btnPrimary} ${tap} col-span-2`} onClick={() => makeInvoice(x)} data-quote-invoice><FileText className="w-4 h-4" /> Turn into invoice</button>}
                <button className={`${btnGhost} ${tap}`} onClick={() => sendWhatsApp(x)} data-quote-wa><MessageCircle className="w-4 h-4" /> Send on WhatsApp</button>
                <button className={`${btnGhost} ${tap}`} onClick={() => void pdf(x)} data-quote-pdf><FileDown className="w-4 h-4" /> Download PDF</button>
                {x.status !== 'converted' && <button className={`${btnGhost} ${tap}`} onClick={() => openEdit(x)}><Pencil className="w-4 h-4" /> Edit</button>}
                {x.status === 'draft' && <button className={`${btnGhost} ${tap}`} onClick={() => void setStatus(x, 'sent')}><Send className="w-4 h-4" /> Mark sent</button>}
                {(x.status === 'draft' || x.status === 'sent' || x.status === 'declined') && <button className={`${btnGhost} ${tap}`} onClick={() => setStatusAsk({ quote: x, status: 'approved', reason: '' })}><CircleCheck className="w-4 h-4" /> Approved</button>}
                {(x.status === 'draft' || x.status === 'sent' || x.status === 'approved') && <button className={`${btnGhost} ${tap}`} onClick={() => setStatusAsk({ quote: x, status: 'declined', reason: '' })}><CircleX className="w-4 h-4" /> Declined</button>}
                {x.status !== 'converted' && (mine || isAdmin) && <button className={`${btnDanger} ${tap}`} onClick={() => setConfirmDelete(x)}><Trash2 className="w-4 h-4" /> Delete</button>}
              </div>
            </div>
          );
        })}
      </div>

      {draft && (
        <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-slate-900/50 sm:p-3" role="dialog" aria-modal="true" data-app-modal>
          <div className="w-full sm:max-w-2xl rounded-t-2xl sm:rounded-xl bg-white dark:bg-slate-900 max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{draft.id ? 'Edit quotation' : 'New quotation'}</h3>
              <button className={`${btnGhost} ${tap}`} onClick={() => setDraft(null)} aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-3">
              {customers && customers.length > 0 && (
                <Field label="Existing customer (optional)" hint="Picking one fills in the name and phone.">
                  <select className={`${inputCls} ${tap}`} value={draft.customerId} onChange={(e) => {
                    const c = customers.find((x) => x.id === e.target.value);
                    setDraft({ ...draft, customerId: e.target.value, ...(c ? { customerName: c.name, customerPhone: c.phone || draft.customerPhone } : {}) });
                  }}>
                    <option value="">Not in the customer list</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ''}</option>)}
                  </select>
                </Field>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Customer name"><input className={`${inputCls} ${tap}`} value={draft.customerName} onChange={(e) => setDraft({ ...draft, customerName: e.target.value })} /></Field>
                <Field label="Phone (for WhatsApp)"><input className={`${inputCls} ${tap}`} inputMode="tel" placeholder="0300 1234567" value={draft.customerPhone} onChange={(e) => setDraft({ ...draft, customerPhone: e.target.value })} /></Field>
                <Field label="Currency">
                  <select className={`${inputCls} ${tap}`} value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value })}>
                    {allCurrencies().map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
                  </select>
                </Field>
                <Field label="Travel date (optional)"><input type="date" className={`${inputCls} ${tap}`} value={draft.travelDate} onChange={(e) => setDraft({ ...draft, travelDate: e.target.value })} /></Field>
              </div>

              <div>
                <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">What is included</p>
                <div className="space-y-2">
                  {draft.lines.map((l, i) => (
                    <div key={i} className="rounded-lg border border-slate-200 dark:border-slate-800 p-2 grid grid-cols-6 gap-2 items-end">
                      <div className="col-span-6 sm:col-span-3">
                        <input className={`${inputCls} ${tap}`} placeholder="e.g. Dubai 4 nights with breakfast" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} aria-label={`Line ${i + 1} description`} />
                      </div>
                      <div className="col-span-2 sm:col-span-1">
                        <input className={`${inputCls} ${tap}`} inputMode="decimal" placeholder="Units" value={l.units} onChange={(e) => setLine(i, { units: e.target.value })} aria-label="Units" />
                      </div>
                      <div className="col-span-3 sm:col-span-1">
                        <input className={`${inputCls} ${tap}`} inputMode="decimal" placeholder="Unit price" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} aria-label="Unit price" />
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <button className={`${btnGhost} ${tap}`} disabled={draft.lines.length === 1} onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, j) => j !== i) })} aria-label="Remove line"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  ))}
                </div>
                <button className={`${btnGhost} ${tap} mt-2`} onClick={() => setDraft({ ...draft, lines: [...draft.lines, emptyLine()] })}><Plus className="w-4 h-4" /> Add line</button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Discount (optional)"><input className={`${inputCls} ${tap}`} inputMode="decimal" value={draft.discount} onChange={(e) => setDraft({ ...draft, discount: e.target.value })} /></Field>
                <Field label="Valid until"><input type="date" className={`${inputCls} ${tap}`} value={draft.validUntil} onChange={(e) => setDraft({ ...draft, validUntil: e.target.value })} /></Field>
              </div>
              <Field label="Notes for the customer (optional)"><textarea rows={3} className={inputCls} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="e.g. Hotel subject to availability, visa fee may change" /></Field>

              <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 p-3 text-xs flex flex-col gap-1">
                <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span className="tabular-nums">{money(draft.currency, draftTotals.subtotal)}</span></div>
                {Number(draft.discount) > 0 && <div className="flex justify-between"><span className="text-slate-500">Discount</span><span className="tabular-nums">- {money(draft.currency, Number(draft.discount))}</span></div>}
                <div className="flex justify-between font-bold text-sm"><span>Total</span><span className="tabular-nums">{money(draft.currency, draftTotals.total)}</span></div>
              </div>
              <ErrorNote message={formErr} />
            </div>
            <div className="sticky bottom-0 flex gap-2 justify-end px-4 py-3 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
              <button className={`${btnGhost} ${tap}`} onClick={() => setDraft(null)}>Cancel</button>
              <button className={`${btnPrimary} ${tap}`} disabled={busy} onClick={() => void save()} data-quote-save>{busy ? 'Saving…' : 'Save quotation'}</button>
            </div>
          </div>
        </div>
      )}

      {statusAsk && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-900/50 p-3" role="dialog" aria-modal="true" data-app-modal>
          <div className="w-full max-w-sm rounded-xl bg-white dark:bg-slate-900 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{statusAsk.status === 'approved' ? `Customer approved ${statusAsk.quote.quoteNo}` : `Customer declined ${statusAsk.quote.quoteNo}`}</h3>
            <Field label={statusAsk.status === 'approved' ? 'Note (optional)' : 'Reason (optional)'}>
              <input className={`${inputCls} ${tap}`} value={statusAsk.reason} onChange={(e) => setStatusAsk({ ...statusAsk, reason: e.target.value })} placeholder={statusAsk.status === 'declined' ? 'e.g. Found a cheaper option' : 'e.g. Confirmed on call'} />
            </Field>
            <div className="flex gap-2 justify-end">
              <button className={`${btnGhost} ${tap}`} onClick={() => setStatusAsk(null)}>Cancel</button>
              <button className={`${statusAsk.status === 'approved' ? btnPrimary : btnDanger} ${tap}`} onClick={() => void setStatus(statusAsk.quote, statusAsk.status, statusAsk.reason)}>Save</button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-900/50 p-3" role="dialog" aria-modal="true" data-app-modal>
          <div className="w-full max-w-sm rounded-xl bg-white dark:bg-slate-900 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Delete {confirmDelete.quoteNo}?</h3>
            <p className="text-xs text-slate-500">The quotation for {confirmDelete.customerName} will be removed. Its number is not used again.</p>
            <div className="flex gap-2 justify-end">
              <button className={`${btnGhost} ${tap}`} onClick={() => setConfirmDelete(null)}>Keep it</button>
              <button className={`${btnDanger} ${tap}`} onClick={() => void remove(confirmDelete)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QuotesView;
