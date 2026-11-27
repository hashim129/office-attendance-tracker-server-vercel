import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, GitBranch, Receipt, ReceiptText, ShoppingBag } from 'lucide-react';
import { ActiveDesktopTab, Employee } from '../types';
import { CrmInvoice, CrmPurchase, CrmReceipt, CrmSale } from './crmApi';
import { CrmState } from './useCrm';
import { Pill, cardCls, inputCls } from './ui';
import { fmtAmount } from './currencies';

interface Props {
  crm: CrmState;
  employees: Employee[];
  onNavigate: (tab: ActiveDesktopTab, refId?: string) => void;
}

const norm = (v?: string | null) => String(v || '').trim().toLowerCase();

interface Branch { inv: CrmInvoice; purchases: CrmPurchase[]; receipts: CrmReceipt[]; sales: CrmSale[] }

/**
 * Payment Tree (Admin / CEO / Accounts): every customer invoice with what hangs off it.
 *  - purchases made for the invoice
 *  - receipts attached to the invoice as payments, or with the same CRM ID / query code
 *  - sales coupons with the same CRM ID / query code
 */
export const PaymentTreeView: React.FC<Props> = ({ crm, employees, onNavigate }) => {
  const { invoices, receipts, sales } = crm.data;
  const purchases = crm.data.purchases || [];
  const empName = useMemo(() => new Map(employees.map((e) => [e.id, e.name])), [employees]);
  const nameOf = (id: string) => empName.get(id) || 'Former employee';
  const [query, setQuery] = useState('');
  const [onlyLinked, setOnlyLinked] = useState(true);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => setOpen((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const branches = useMemo<Branch[]>(() => invoices
    .filter((i) => (i.kind || 'customer') === 'customer')
    .map((inv) => {
      const code = norm(inv.crmId || inv.queryCode);
      return {
        inv,
        purchases: purchases.filter((p) => p.invoiceId === inv.id),
        receipts: receipts.filter((r) => r.linkedInvoiceId === inv.id || (!r.linkedInvoiceId && code && norm(r.queryCode) === code)),
        sales: code ? sales.filter((s) => norm(s.queryCode) === code) : [],
      };
    }), [invoices, purchases, receipts, sales]);

  const unlinkedPurchases = purchases.filter((p) => !p.invoiceId).length;
  const q = norm(query);
  const shown = branches.filter((b) => {
    if (onlyLinked && !(b.purchases.length || b.receipts.length || b.sales.length)) return false;
    if (!q) return true;
    return [b.inv.invoiceNo, b.inv.customerName, b.inv.crmId, b.inv.queryCode, nameOf(b.inv.createdBy),
      ...b.purchases.map((p) => p.purchaseNo), ...b.receipts.map((r) => r.receiptNo), ...b.sales.map((s) => s.couponNo)].some((v) => norm(v).includes(q));
  });

  const row = (key: string, Icon: React.FC<{ className?: string }>, tone: string, label: React.ReactNode, right: React.ReactNode, go: () => void) => (
    <li key={key} className="relative pl-5">
      <span className="absolute left-0 top-0 h-1/2 w-4 border-l-2 border-b-2 border-slate-200 dark:border-slate-700 rounded-bl-md" />
      <button type="button" onClick={go} className="w-full flex flex-wrap items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer">
        <span className="inline-flex items-center gap-2 min-w-0"><Icon className={`w-3.5 h-3.5 shrink-0 ${tone}`} /> {label}</span>
        <span className="text-[11px] text-slate-600 dark:text-slate-300">{right}</span>
      </button>
    </li>
  );

  return (
    <div className="space-y-4">
      <div className={`${cardCls} p-4 space-y-3`}>
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2"><GitBranch className="w-4 h-4 text-blue-600" /> Payment Tree</h2>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Each invoice with its purchases, receipts and sales coupons. Purchases link by invoice; receipts by invoice payment or the same CRM ID; sales by the same CRM ID / query code. Tap any line to open it.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <input className={`${inputCls} sm:max-w-sm`} placeholder="Search invoice, customer, CRM ID, creator, PUR / receipt / coupon no…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer"><input type="checkbox" checked={onlyLinked} onChange={(e) => setOnlyLinked(e.target.checked)} /> Only invoices with links</label>
          <button type="button" className="text-[11px] font-semibold text-blue-600 cursor-pointer sm:ml-auto" onClick={() => setOpen(open.size ? new Set() : new Set(shown.map((b) => b.inv.id)))}>{open.size ? 'Fold all' : 'Open all'}</button>
        </div>
        <p className="text-[11px] text-slate-500">{shown.length} invoice{shown.length === 1 ? '' : 's'} shown{unlinkedPurchases ? ` · ${unlinkedPurchases} older purchase${unlinkedPurchases === 1 ? '' : 's'} not linked to an invoice yet` : ''}</p>
      </div>

      {shown.length === 0 ? (
        <div className={`${cardCls} p-8 text-center text-xs text-slate-500`}>{crm.loading ? 'Loading…' : 'Nothing to show yet. Links appear as soon as a purchase, receipt or sale is made for an invoice.'}</div>
      ) : shown.map(({ inv, purchases: ps, receipts: rs, sales: ss }) => {
        const isOpen = open.has(inv.id);
        const cur = inv.currency;
        const received = rs.filter((r) => r.currency === cur).reduce((a, r) => a + r.amountReceived, 0);
        const payable = ps.filter((p) => (p.currency || cur) === cur).reduce((a, p) => a + (p.totalPayable || 0), 0);
        return (
          <div key={inv.id} className={`${cardCls} p-3`} data-tree-invoice>
            <button type="button" onClick={() => toggle(inv.id)} className="w-full flex flex-wrap items-center justify-between gap-2 text-left cursor-pointer">
              <span className="inline-flex items-center gap-2 min-w-0">
                {isOpen ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                <FileText className="w-4 h-4 text-blue-600 shrink-0" />
                <b className="font-mono text-sm text-blue-700 dark:text-blue-300">{inv.invoiceNo}</b>
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{inv.customerName}</span>
                <span className="text-[11px] text-slate-500">by {nameOf(inv.createdBy)}</span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <Pill tone={inv.status === 'paid' ? 'green' : inv.status === 'cancelled' ? 'red' : 'amber'}>{inv.status === 'paid' ? 'Received' : inv.status === 'cancelled' ? 'Cancelled' : 'Not received'}</Pill>
                <span className="text-slate-600 dark:text-slate-300">Total <b className="font-mono">{cur} {fmtAmount(inv.total)}</b> · Balance <b className="font-mono">{fmtAmount(inv.balance)}</b></span>
                <Pill tone="slate">{ps.length} purchase{ps.length === 1 ? '' : 's'}</Pill>
                <Pill tone="slate">{rs.length} receipt{rs.length === 1 ? '' : 's'}</Pill>
                <Pill tone="slate">{ss.length} sale{ss.length === 1 ? '' : 's'}</Pill>
              </span>
            </button>
            {isOpen && (
              <div className="mt-2 ml-2 space-y-2">
                <p className="text-[11px] text-slate-600 dark:text-slate-300 pl-1">
                  Received by receipts <b className="font-mono text-emerald-700 dark:text-emerald-400">{cur} {fmtAmount(received)}</b> · Payable to vendors <b className="font-mono text-amber-700 dark:text-amber-400">{cur} {fmtAmount(payable)}</b>
                  {inv.crmId || inv.queryCode ? <> · CRM ID <b className="font-mono">{inv.crmId || inv.queryCode}</b></> : null}
                </p>
                <ul className="space-y-0.5 border-l-2 border-transparent">
                  {ps.map((p) => row(p.id, ShoppingBag, 'text-teal-600', <><b className="font-mono">{p.purchaseNo}</b> <span className="text-slate-500">purchase · by {nameOf(p.createdBy)}</span></>,
                    <>Payable <b className="font-mono">{p.currency} {fmtAmount(p.totalPayable)}</b> · {p.status === 'paid' ? 'Paid' : p.status === 'partial' ? 'Partly paid' : 'Unpaid'}{p.posted ? ' · Posted' : ''}</>, () => onNavigate('crm-purchases', p.id)))}
                  {rs.map((r) => row(r.id, ReceiptText, 'text-emerald-600', <><b className="font-mono">{r.receiptNo}</b> <span className="text-slate-500">receipt · by {nameOf(r.createdBy)}{r.linkedInvoiceId === inv.id ? ' · counted on invoice' : ' · same CRM ID'}</span></>,
                    <>Received <b className="font-mono">{r.currency} {fmtAmount(r.amountReceived)}</b> · {r.method === 'bank' ? 'Bank' : 'Cash'}</>, () => onNavigate('crm-receipts', r.id)))}
                  {ss.map((s) => row(s.id, Receipt, 'text-violet-600', <><b className="font-mono">{s.couponNo}</b> <span className="text-slate-500">sale · by {nameOf(s.createdBy)}</span></>,
                    <>Sale <b className="font-mono">{s.currency} {fmtAmount(s.saleAmount)}</b> · Cost <b className="font-mono">{fmtAmount(s.costAmount)}</b> · {s.status === 'approved' ? (s.paymentStatus === 'paid' ? 'Paid' : 'Approved') : s.status === 'declined' ? 'Declined' : 'Pending'}</>, () => onNavigate('crm-sales', s.id)))}
                  {!ps.length && !rs.length && !ss.length && <li className="pl-5 text-[11px] text-slate-400">No purchases, receipts or sales linked yet.</li>}
                </ul>
                <button type="button" className="ml-1 text-[11px] font-semibold text-blue-600 cursor-pointer" onClick={() => onNavigate('crm-invoices', inv.id)}>Open invoice →</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
