import { CustomerDocs } from './CustomerDocs';
import React, { useEffect, useState } from 'react';
import { Modal } from '../components/common/Modal';
import { crmCall } from './crmApi';
import type { CrmCustomer } from './crmApi';

/** Everything about one customer on one screen: invoices, receipts, follow-ups, calls and WhatsApps, newest first. */
type H = {
  invoices: { id: string; no: string; currency: string; total: number; balance: number; status: string; travelDate: string | null; by: string; at: string }[];
  receipts: { id: string; no: string; currency: string; amount: number; by: string; at: string }[];
  followups: { id: string; kind: string; subject: string; remarks: string; status: string; dueAt: string | null; by: string; at: string }[];
  contacts: { at: string; byName?: string; how: string }[];
};
const money = (c: string, n: number) => `${c} ${Math.round(n).toLocaleString()}`;
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export const CustomerHistory: React.FC<{ customer: CrmCustomer | null; onClose: () => void; names: Map<string, string> }> = ({ customer, onClose, names }) => {
  const [h, setH] = useState<H | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setH(null); setErr('');
    if (customer) crmCall<H>('customer_history', { id: customer.id }).then(setH).catch((e) => setErr(e?.message || 'Could not load the history.'));
  }, [customer?.id]);
  const items = h ? [
    ...h.invoices.map((i) => ({ at: i.at, tone: i.status === 'cancelled' ? 'text-red-600' : i.status === 'paid' ? 'text-emerald-600' : 'text-amber-600', title: `Invoice ${i.no} · ${money(i.currency, i.total)}`, sub: `${i.status === 'paid' ? 'Received' : i.status === 'cancelled' ? 'Cancelled' : `Balance ${money(i.currency, i.balance)}`}${i.travelDate ? ` · travel ${day(i.travelDate)}` : ''} · ${names.get(i.by) || 'Former employee'}` })),
    ...h.receipts.map((r) => ({ at: r.at, tone: 'text-emerald-600', title: `Receipt ${r.no} · ${money(r.currency, r.amount)} received`, sub: names.get(r.by) || 'Former employee' })),
    ...h.followups.map((f) => ({ at: f.at, tone: f.status === 'completed' ? 'text-emerald-600' : 'text-blue-600', title: `Follow-up: ${f.subject || f.remarks.slice(0, 60) || f.kind}`, sub: `${f.status.replace('_', ' ')}${f.dueAt ? ` · due ${day(f.dueAt)}` : ''} · ${names.get(f.by) || 'Former employee'}` })),
    ...h.contacts.map((c) => ({ at: c.at, tone: 'text-slate-600', title: c.how === 'whatsapp' ? 'WhatsApp message' : 'Phone call', sub: c.byName || '' })),
  ].sort((a, b) => b.at.localeCompare(a.at)) : [];
  const totals = h ? Object.entries(h.invoices.filter((i) => i.status !== 'cancelled').reduce<Record<string, { t: number; b: number }>>((m, i) => { const x = m[i.currency] || { t: 0, b: 0 }; x.t += i.total; x.b += i.status === 'paid' ? 0 : i.balance; m[i.currency] = x; return m; }, {})) : [];
  return (
    <Modal side isOpen={Boolean(customer)} onClose={onClose} title={customer ? `${customer.customerName} · history` : ''} subtitle={customer?.customerNumber || undefined} maxWidth="lg">
      <div data-customer-history>
        {customer && <div className="mb-4"><CustomerDocs customerId={customer.id} customerName={customer.customerName} /></div>}
        {err && <p className="text-xs text-red-600">{err}</p>}
        {!h && !err && <div className="space-y-2"><div className="skeleton h-10 rounded-lg" /><div className="skeleton h-10 rounded-lg" /></div>}
        {h && (
          <>
            <div className="grid grid-cols-3 gap-2 text-center mb-3">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-2"><p className="text-base font-bold">{h.invoices.length}</p><p className="text-[10.5px] text-slate-500">invoices</p></div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-2"><p className="text-base font-bold">{h.receipts.length}</p><p className="text-[10.5px] text-slate-500">receipts</p></div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-2"><p className="text-base font-bold">{h.contacts.length}</p><p className="text-[10.5px] text-slate-500">calls / WhatsApps</p></div>
            </div>
            {totals.map(([c, x]) => <p key={c} className="text-xs text-slate-600 dark:text-slate-300 mb-1">Total business: <b>{money(c, x.t)}</b>{x.b > 0 ? <> · still to receive <b className="text-amber-600">{money(c, x.b)}</b></> : ' · all received'}</p>)}
            <ol className="mt-2 space-y-2 max-h-[55vh] overflow-y-auto">
              {items.map((i, k) => (
                <li key={k} className="flex gap-3 text-xs">
                  <span className="w-20 shrink-0 text-slate-400">{day(i.at)}</span>
                  <div><p className={`font-semibold ${i.tone}`}>{i.title}</p>{i.sub && <p className="text-slate-500">{i.sub}</p>}</div>
                </li>
              ))}
              {items.length === 0 && <li className="text-xs text-slate-500">Nothing yet for this customer.</li>}
            </ol>
          </>
        )}
      </div>
    </Modal>
  );
};
export default CustomerHistory;
