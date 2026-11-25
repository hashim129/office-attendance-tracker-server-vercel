import React, { useMemo } from 'react';
import { Lock, Plus, Receipt, Trash2 } from 'lucide-react';
import { CrmReceipt } from './crmApi';
import { fmtAmount } from './currencies';
import { dayPk } from '../lib/reportPdf';
import { btnGhost, inputCls } from './ui';

/**
 * "Payments received" part of the invoice form.
 * Every payment the customer makes (cash or bank, on different days) is one row, and the printed invoice lists them
 * under the Total ("1st payment 30-09-26 -100,000 ... Balance 0"). Receipts already made for the same customer can be
 * attached with one tap; their amount is then counted as a payment automatically.
 */
export interface LedgerPayment {
  id: string;
  date: string;
  amount: string;
  note: string;
  method: 'cash' | 'bank' | '';
  receiptId: string | null;
  receiptNo: string | null;
  byName: string;
  at: string;
}

interface Props {
  payments: LedgerPayment[];
  onChange: (next: LedgerPayment[]) => void;
  currency: string;
  total: number;
  /** Accounts, Administrator and CEO may correct or remove payments that are already saved */
  canChangeSaved: boolean;
  receipts: CrmReceipt[];
  /** "CRM ID / Query Code" and customer name typed on the invoice, used to find the matching receipts */
  crmQuery: string;
  customerName: string;
  invoiceId?: string;
  today: string;
}

const ordinal = (n: number) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] || 'th'}`;
const nice = (ymd: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || ''); return m ? `${m[3]}-${m[2]}-${m[1].slice(2)}` : ''; };
const clock = (iso: string) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Karachi', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : '');
const same = (a: string, b: string) => Boolean(a.trim()) && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Receipts that could be attached to this invoice: same customer (CRM ID or name), same currency, not used anywhere else. */
export function matchingReceipts(receipts: CrmReceipt[], o: { crmQuery: string; customerName: string; currency: string; invoiceId?: string; attachedIds: string[] }): CrmReceipt[] {
  return receipts.filter((r) => {
    if (o.attachedIds.includes(r.id)) return false;
    if (r.linkedInvoiceId && r.linkedInvoiceId !== o.invoiceId) return false;
    if (r.currency.toUpperCase() !== o.currency.toUpperCase()) return false;
    return same(r.queryCode || '', o.crmQuery) || same(r.clientName || '', o.customerName);
  });
}

export const PaymentsLedger: React.FC<Props> = ({ payments, onChange, currency, total, canChangeSaved, receipts, crmQuery, customerName, invoiceId, today }) => {
  const attachedIds = useMemo(() => payments.map((p) => p.receiptId).filter(Boolean) as string[], [payments]);
  const offers = useMemo(
    () => matchingReceipts(receipts, { crmQuery, customerName, currency, invoiceId, attachedIds }),
    [receipts, crmQuery, customerName, currency, invoiceId, attachedIds],
  );
  const paid = Math.round(payments.reduce((a, p) => a + (Number(p.amount) > 0 ? Number(p.amount) : 0), 0) * 100) / 100;
  const over = paid - total > 0.009;

  const set = (i: number, p: Partial<LedgerPayment>) => onChange(payments.map((x, xi) => (xi === i ? { ...x, ...p } : x)));
  const add = () => onChange([...payments, { id: '', date: today, amount: '', note: '', method: '', receiptId: null, receiptNo: null, byName: '', at: '' }]);
  const attach = (r: CrmReceipt) => onChange([...payments, { id: '', date: dayPk(r.createdAt) || today, amount: String(r.amountReceived), note: '', method: r.method, receiptId: r.id, receiptNo: r.receiptNo, byName: '', at: '' }]);

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2.5" data-payments-ledger>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-slate-800 dark:text-slate-100">Payments received</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Add each payment when the money comes in. They print under the Total, one line each.</p>
        </div>
        <button type="button" className={btnGhost} onClick={add} data-add-payment><Plus className="w-3.5 h-3.5" /> Add payment</button>
      </div>

      {payments.length === 0 && <p className="text-[11px] text-slate-500 dark:text-slate-400">No payment received yet.</p>}

      <div className="space-y-2">
        {payments.map((p, i) => {
          const saved = Boolean(p.id);
          const fromReceipt = Boolean(p.receiptId);
          const locked = (saved && !canChangeSaved) || fromReceipt;
          return (
            <div key={p.id || `new-${i}`} className="grid grid-cols-2 sm:grid-cols-[5rem_8.5rem_8rem_6.5rem_1fr_auto] gap-2 items-end rounded-lg bg-slate-50 dark:bg-slate-800/50 p-2" data-payment-row>
              <p className="col-span-2 sm:col-span-1 text-[11px] font-bold text-slate-600 dark:text-slate-300 self-center">{ordinal(i + 1)} payment</p>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Date
                <input type="date" className={`${inputCls} mt-0.5`} value={p.date} disabled={locked} max={today} onChange={(e) => set(i, { date: e.target.value })} data-payment-date />
              </label>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Amount ({currency})
                <input type="number" inputMode="decimal" step="0.01" min="0" className={`${inputCls} mt-0.5`} value={p.amount} disabled={locked} onChange={(e) => set(i, { amount: e.target.value })} data-payment-amount />
              </label>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Paid by
                <select className={`${inputCls} mt-0.5 normal-case font-normal`} value={p.method} disabled={locked} onChange={(e) => set(i, { method: e.target.value as LedgerPayment['method'] })}>
                  <option value="">Not stated</option>
                  <option value="cash">Cash</option>
                  <option value="bank">Bank</option>
                </select>
              </label>
              <label className="col-span-2 sm:col-span-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Note (optional)
                <input className={`${inputCls} mt-0.5 normal-case tracking-normal font-normal`} value={p.note} maxLength={200} disabled={locked} onChange={(e) => set(i, { note: e.target.value })} placeholder="e.g. cheque no." />
              </label>
              <div className="col-span-2 sm:col-span-1 flex items-center justify-end gap-2">
                {locked && <span title="Saved payments are locked. Accounts or an administrator can correct them." className="text-slate-400"><Lock className="w-3.5 h-3.5" /></span>}
                {(!saved || canChangeSaved) && (
                  <button type="button" className="p-2 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer" aria-label={`Remove ${ordinal(i + 1)} payment`} onClick={() => onChange(payments.filter((_, xi) => xi !== i))} data-remove-payment>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {(p.byName || p.receiptNo) && (
                <p className="col-span-2 sm:col-span-6 text-[10px] text-slate-500 dark:text-slate-400">
                  {p.receiptNo ? `From receipt ${p.receiptNo}. ` : ''}{p.byName ? `Recorded by ${p.byName}${p.at ? `, ${clock(p.at)}` : ''}.` : ''}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {offers.length > 0 && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/20 p-2.5 space-y-1.5" data-receipt-offers>
          <p className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5"><Receipt className="w-3.5 h-3.5" /> Receipts already made for this customer</p>
          {offers.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-slate-700 dark:text-slate-200"><b>{r.receiptNo}</b> · {nice(dayPk(r.createdAt))} · {r.method === 'bank' ? 'Bank' : 'Cash'} · <b className="font-mono">{r.currency} {fmtAmount(r.amountReceived)}</b></span>
              <button type="button" className={btnGhost} onClick={() => attach(r)} data-attach-receipt={r.id}>Add to invoice</button>
            </div>
          ))}
          <p className="text-[10px] text-slate-500 dark:text-slate-400">Adding a receipt counts its amount as a payment, so the balance goes down by itself.</p>
        </div>
      )}

      <div className="flex flex-wrap justify-between gap-2 text-xs">
        <span>Received so far: <b className="font-mono">{currency} {fmtAmount(paid)}</b></span>
        <span>Still to receive: <b className="font-mono">{currency} {fmtAmount(Math.max(0, total - paid))}</b></span>
      </div>
      {over && <p role="alert" className="text-xs text-red-600">The payments are more than the invoice total ({currency} {fmtAmount(total)}). Please check the amounts.</p>}
    </div>
  );
};

/**
 * Small form on an invoice card: record one more payment (or attach a receipt) without opening the whole invoice.
 */
export const QuickPayment: React.FC<{
  currency: string;
  balance: number;
  receipts: CrmReceipt[];
  crmQuery: string;
  customerName: string;
  invoiceId: string;
  attachedIds: string[];
  today: string;
  onSubmit: (payment: { date: string; amount?: number; method: string; note: string; receiptId?: string }) => Promise<void>;
  onClose: () => void;
}> = ({ currency, balance, receipts, crmQuery, customerName, invoiceId, attachedIds, today, onSubmit, onClose }) => {
  const [date, setDate] = React.useState(today);
  const [amount, setAmount] = React.useState('');
  const [method, setMethod] = React.useState('');
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const offers = useMemo(() => matchingReceipts(receipts, { crmQuery, customerName, currency, invoiceId, attachedIds }), [receipts, crmQuery, customerName, currency, invoiceId, attachedIds]);
  const run = async (p: Parameters<typeof onSubmit>[0]) => { setBusy(true); try { await onSubmit(p); } finally { setBusy(false); } };
  const value = Number(amount);
  return (
    <div className="rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20 p-3 space-y-2" data-quick-payment>
      <p className="text-xs font-bold text-slate-800 dark:text-slate-100">Add a payment <span className="font-normal text-slate-500">(still to receive: {currency} {fmtAmount(balance)})</span></p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Date<input type="date" className={`${inputCls} mt-0.5`} value={date} max={today} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Amount ({currency})<input type="number" inputMode="decimal" step="0.01" min="0" className={`${inputCls} mt-0.5`} value={amount} onChange={(e) => setAmount(e.target.value)} data-quick-amount /></label>
        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Paid by
          <select className={`${inputCls} mt-0.5 normal-case font-normal`} value={method} onChange={(e) => setMethod(e.target.value)}><option value="">Not stated</option><option value="cash">Cash</option><option value="bank">Bank</option></select>
        </label>
        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Note<input className={`${inputCls} mt-0.5 normal-case tracking-normal font-normal`} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      {offers.length > 0 && (
        <div className="space-y-1" data-receipt-offers>
          <p className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300">Or use a receipt already made for this customer</p>
          {offers.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span><b>{r.receiptNo}</b> · {nice(dayPk(r.createdAt))} · <b className="font-mono">{r.currency} {fmtAmount(r.amountReceived)}</b></span>
              <button type="button" disabled={busy} className={btnGhost} onClick={() => void run({ date, method: r.method, note: '', receiptId: r.id })} data-attach-receipt={r.id}>Add this receipt</button>
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnGhost} onClick={onClose}>Close</button>
        <button type="button" disabled={busy || !(value > 0)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer" onClick={() => void run({ date, amount: value, method, note })} data-quick-save>Save payment</button>
      </div>
    </div>
  );
};

/** The payments already received on an invoice, shown on its card like the printed invoice. Accounts / Admin can remove one (with a reason). */
export const PaymentHistory: React.FC<{
  payments: { id: string; date: string; amount: number; note: string; method: string; receiptNo: string | null; byName: string; at: string }[];
  currency: string;
  balance: number;
  canRemove: boolean;
  onRemove: (paymentId: string) => void;
}> = ({ payments, currency, balance, canRemove, onRemove }) => {
  if (!payments.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-2.5 text-xs space-y-1" data-payment-history>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Payments received</p>
      {payments.map((p, i) => (
        <div key={p.id} className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-slate-700 dark:text-slate-200">
            <b>{p.id === 'pay-legacy' ? 'Advance' : `${ordinal(i + 1)} payment`}</b> {nice(p.date)}
            <span className="text-slate-500 dark:text-slate-400">{p.method ? ` · ${p.method === 'bank' ? 'Bank' : 'Cash'}` : ''}{p.receiptNo ? ` · Receipt ${p.receiptNo}` : ''}{p.note ? ` · ${p.note}` : ''}{p.byName ? ` · by ${p.byName}${p.at ? `, ${clock(p.at)}` : ''}` : ''}</span>
          </span>
          <span className="flex items-center gap-2">
            <b className="font-mono">-{fmtAmount(p.amount)}</b>
            {canRemove && <button type="button" className="text-[11px] font-semibold text-red-600 hover:underline cursor-pointer" onClick={() => onRemove(p.id)} data-remove-saved-payment>Remove</button>}
          </span>
        </div>
      ))}
      <div className="flex justify-between border-t border-slate-200 dark:border-slate-700 pt-1 font-bold"><span>Balance</span><span className="font-mono">{currency} {fmtAmount(balance)}</span></div>
    </div>
  );
};
