import React, { useEffect, useMemo, useState } from 'react';
import { AckBadge, AfterCreateInfo, AfterCreatePrompt, guessPhone } from './AfterCreate';
import { Plus, Trash2, Check, X, Receipt, Pencil } from 'lucide-react';
import { Employee } from '../types';
import { Modal } from '../components/common/Modal';
import { CrmSale, SaleType, crmCall } from './crmApi';
import { CrmState } from './useCrm';
import { ErrorNote, Field, Pill, StatBar, btnDanger, btnGhost, btnPrimary, cardCls, fmtDateTime, inputCls } from './ui';
import { ExportPanel } from './ExportPanel';
import { saleCells, saleColumns, saleSearch, saleSummary } from './exportConfigs';


interface Props {
  crm: CrmState;
  employees: Employee[];
  currentUser: Employee;
}

const TYPE_ORDER: SaleType[] = ['visa', 'ticket', 'hotel', 'transfers', 'insurance', 'others'];
const TYPE_LABEL: Record<SaleType, string> = { visa: 'Visa', ticket: 'Ticket', hotel: 'Hotel', transfers: 'Transfers', insurance: 'Insurance', others: 'Others' };
const money = (n: number, cur: string) => `${cur} ${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const typeText = (s: CrmSale) => (s.saleType === 'others' && s.otherType ? s.otherType : TYPE_LABEL[s.saleType]);

interface CurrencyStats {
  currency: string;
  receivable: number; // sale amount of every created coupon (pending + approved + paid), declined ones excluded
  payable: number; // cost amount of every created coupon, declined ones excluded
  receivableOpen: number; // the part of receivable not marked Paid yet
  payableOpen: number; // the part of payable not marked Paid yet
  expectedProfit: number; // sale - cost of every created coupon
  realisedProfit: number; // sale - cost of coupons marked Paid
  pendingValue: number; // sale value waiting for review
  pendingCount: number;
  totalSales: number;
  totalCost: number;
}

function buildStats(sales: CrmSale[]): CurrencyStats[] {
  const map = new Map<string, CurrencyStats>();
  for (const s of sales) {
    const c = map.get(s.currency) || { currency: s.currency, receivable: 0, payable: 0, receivableOpen: 0, payableOpen: 0, expectedProfit: 0, realisedProfit: 0, pendingValue: 0, pendingCount: 0, totalSales: 0, totalCost: 0 };
    if (s.status === 'pending') { c.pendingValue += s.saleAmount; c.pendingCount++; }
    if (s.status !== 'declined') {
      // Every created coupon counts straight away, as soon as it is generated.
      c.totalSales += s.saleAmount;
      c.totalCost += s.costAmount;
      c.receivable += s.saleAmount;
      c.payable += s.costAmount;
      c.expectedProfit += s.saleAmount - s.costAmount;
      if (s.status === 'approved' && s.paymentStatus === 'paid') c.realisedProfit += s.saleAmount - s.costAmount;
      else { c.receivableOpen += s.saleAmount; c.payableOpen += s.costAmount; }
    }
    map.set(s.currency, c);
  }
  return [...map.values()].sort((a, b) => b.totalSales + b.pendingValue - (a.totalSales + a.pendingValue));
}

/** Two bars per group (sale + cost). Plain SVG: always live from the latest data. */
const BarChart: React.FC<{ groups: { label: string; sale: number; cost: number }[]; currency: string }> = ({ groups, currency }) => {
  const max = Math.max(1, ...groups.flatMap((g) => [g.sale, g.cost]));
  const W = 520, H = 170, padL = 6, padB = 28, padT = 10;
  const slot = (W - padL) / Math.max(1, groups.length);
  const bw = Math.min(22, slot / 2.6);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`Sale and cost in ${currency}`}>
        <line x1={padL} x2={W} y1={H - padB} y2={H - padB} className="stroke-slate-300 dark:stroke-slate-700" />
        {groups.map((g, i) => {
          const cx = padL + slot * i + slot / 2;
          return (
            <g key={g.label}>
              <rect x={cx - bw - 1} y={y(g.sale)} width={bw} height={Math.max(0, H - padB - y(g.sale))} rx={2} className="fill-blue-500"><title>{`${g.label} · Sale ${money(g.sale, currency)}`}</title></rect>
              <rect x={cx + 1} y={y(g.cost)} width={bw} height={Math.max(0, H - padB - y(g.cost))} rx={2} className="fill-amber-500"><title>{`${g.label} · Cost ${money(g.cost, currency)}`}</title></rect>
              <text x={cx} y={H - 12} textAnchor="middle" className="fill-slate-500 dark:fill-slate-400" fontSize="9">{g.label}</text>
            </g>
          );
        })}
      </svg>
      <div className="flex items-center gap-4 text-[10px] text-slate-500 dark:text-slate-400 mt-1">
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500" /> Sale</span>
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500" /> Cost</span>
        <span>Highest bar: {money(max, currency)}</span>
      </div>
    </div>
  );
};

const emptyForm = { saleType: '' as '' | SaleType, otherType: '', customerName: '', vendorName: '', packageDetails: '', paxName: '', currency: '', costAmount: '', saleAmount: '', queryCode: '', psfProfit: '' };

export const SalesView: React.FC<Props & { portalEnabled?: boolean }> = ({ crm, employees, currentUser, portalEnabled = false }) => {
  const [after, setAfter] = useState<AfterCreateInfo | null>(null);
  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'ceo'; // the CEO has every administrator right here
  const canReview = isAdmin || currentUser.role === 'accounts';
  const seesAll = canReview || currentUser.role === 'ceo';
  const { sales, currencies, unread } = crm.data;
  const empName = useMemo(() => new Map(employees.map((e) => [e.id, e.name])), [employees]);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  /** The saved coupon being edited (Admin / Accounts); null while generating a new one */
  const [editing, setEditing] = useState<CrmSale | null>(null);
  const closeForm = () => { setFormOpen(false); if (editing) { setEditing(null); setForm(emptyForm); } };
  const startEdit = (s: CrmSale) => {
    setEditing(s);
    setForm({ saleType: s.saleType, otherType: s.otherType || '', customerName: s.customerName, vendorName: s.vendorName, packageDetails: s.packageDetails, paxName: s.paxName, currency: s.currency, costAmount: String(s.costAmount), saleAmount: String(s.saleAmount), queryCode: s.queryCode, psfProfit: String(s.psfProfit) });
    setError('');
    setFormOpen(true);
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'declined' | 'unpaid' | 'paid'>('all');
  const [query, setQuery] = useState('');
  const [chartCur, setChartCur] = useState('');
  const [deciding, setDeciding] = useState<{ s: CrmSale; status: 'approved' | 'declined' } | null>(null);
  const [remarks, setRemarks] = useState('');

  useEffect(() => { void crm.refresh(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasNew = unread.some((u) => u.category === 'sale');
  const newIds = useMemo(() => new Set(unread.filter((u) => u.category === 'sale').map((u) => u.refId)), [unread]);
  useEffect(() => {
    if (!hasNew) return;
    const t = window.setTimeout(() => { void crm.markRead('sale'); }, 4000);
    return () => window.clearTimeout(t);
  }, [hasNew, crm]);

  const stats = useMemo(() => buildStats(sales), [sales]);
  const activeCur = chartCur && stats.some((s) => s.currency === chartCur) ? chartCur : stats[0]?.currency || '';

  const chartGroups = useMemo(() => {
    const rows = sales.filter((s) => s.currency === activeCur && s.status !== 'declined');
    const byType = TYPE_ORDER.map((t) => ({
      label: TYPE_LABEL[t],
      sale: rows.filter((s) => s.saleType === t).reduce((a, s) => a + s.saleAmount, 0),
      cost: rows.filter((s) => s.saleType === t).reduce((a, s) => a + s.costAmount, 0),
    }));
    const days: { label: string; sale: number; cost: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const key = d.toDateString();
      const day = rows.filter((s) => new Date(s.createdAt).toDateString() === key);
      days.push({ label: `${d.getDate()}/${d.getMonth() + 1}`, sale: day.reduce((a, s) => a + s.saleAmount, 0), cost: day.reduce((a, s) => a + s.costAmount, 0) });
    }
    return { byType, days };
  }, [sales, activeCur]);

  const counts = useMemo(() => ({
    pending: sales.filter((s) => s.status === 'pending').length,
    approved: sales.filter((s) => s.status === 'approved').length,
    declined: sales.filter((s) => s.status === 'declined').length,
    paid: sales.filter((s) => s.status === 'approved' && s.paymentStatus === 'paid').length,
    unpaid: sales.filter((s) => s.status !== 'declined' && !(s.status === 'approved' && s.paymentStatus === 'paid')).length,
  }), [sales]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sales.filter((s) => {
      if (filter === 'pending' || filter === 'approved' || filter === 'declined') { if (s.status !== filter) return false; }
      if (filter === 'paid' && !(s.status === 'approved' && s.paymentStatus === 'paid')) return false;
      if (filter === 'unpaid' && !(s.status === 'approved' && s.paymentStatus === 'unpaid')) return false;
      if (!q) return true;
      return [s.couponNo, s.customerName, s.vendorName, s.paxName, s.queryCode, s.packageDetails, empName.get(s.createdBy) || ''].some((v) => v.toLowerCase().includes(q));
    });
  }, [sales, filter, query, empName]);

  const set = (k: keyof typeof emptyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => { setForm((f) => ({ ...f, [k]: e.target.value })); setError(''); };
  const profitPreview = form.costAmount !== '' && form.saleAmount !== '' && Number.isFinite(Number(form.costAmount)) && Number.isFinite(Number(form.saleAmount))
    ? Number(form.saleAmount) - Number(form.costAmount) : null;

  const saleAfter = (x: CrmSale): AfterCreateInfo => ({
    kind: 'sale', id: x.id, title: `Sales coupon ${x.couponNo}`, customerName: x.customerName,
    phone: guessPhone(crm.data, x.customerName, x.queryCode), trackingId: x.queryCode,
    summary: `${x.packageDetails ? `${x.packageDetails.slice(0, 60)} · ` : ''}${x.currency} ${Number(x.saleAmount).toLocaleString()}`,
  });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.saleType) { setError('Choose a sale type first.'); return; }
    setBusy(true);
    setError('');
    try {
      const r = await crmCall<{ sale: CrmSale }>('sale_save', { sale: editing ? { ...form, id: editing.id } : form });
      await crm.refresh();
      if (r?.sale && !editing) setAfter(saleAfter(r.sale));
      setFormOpen(false);
      setEditing(null);
      setForm(emptyForm);
    } catch (err: any) {
      setError(err?.message || 'Could not save the coupon.');
    } finally {
      setBusy(false);
    }
  };

  const act = async (action: string, payload: Record<string, unknown>) => {
    setError('');
    try {
      await crmCall(action, payload);
      await crm.refresh();
    } catch (err: any) {
      setError(err?.message || 'That did not work. Please try again.');
    }
  };

  const decide = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deciding) return;
    setBusy(true);
    await act('sale_decide', { id: deciding.s.id, status: deciding.status, remarks });
    setBusy(false);
    setDeciding(null);
    setRemarks('');
  };

  const filters: [typeof filter, string][] = [['all', 'All'], ['pending', `Pending (${counts.pending})`], ['approved', 'Approved'], ['unpaid', 'Not paid'], ['paid', 'Paid'], ['declined', 'Declined']];

  return (
    <div className="space-y-4">
      <AfterCreatePrompt info={after} companyName={crm.data.company.name} portalEnabled={portalEnabled} ack={after ? crm.data.acks?.[after.id] : undefined} onClose={() => setAfter(null)} onSent={() => void crm.refresh()} />
      <div className={`${cardCls} p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3`}>
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2"><Receipt className="w-4 h-4 text-blue-600" /> Sales</h2>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {seesAll ? 'Every sales coupon from every employee. Accounts reviews and marks them.' : 'Generate a coupon for each sale. Accounts will review it and mark it paid or not paid.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportPanel
            title="Sales" rows={crm.data.sales} columns={saleColumns()} toCells={(s) => saleCells(s, (id) => empName.get(id) || 'Former employee', (crm.data.saleTypes || {}) as Record<string, string>)}
            getCreatedAt={(s) => s.createdAt} getCreatorId={(s) => s.createdBy} searchFields={saleSearch} searchHint="Coupon no., query code, customer or vendor"
            employees={employees} currentUser={currentUser} companyName={crm.data.company.name} summaryOf={saleSummary} landscape
          />
          <button className={btnPrimary} onClick={() => { setForm(emptyForm); setError(''); setFormOpen(true); }}><Plus className="w-3.5 h-3.5" /> Generate Sales Coupon</button>
        </div>
      </div>

      <StatBar
        title={seesAll ? 'All coupons: paid, not paid and rejected' : 'Your coupons: paid, not paid and rejected'}
        segments={[
          { label: 'Paid', count: counts.paid, tone: 'green' },
          { label: `Not paid (${counts.pending} awaiting review)`, count: counts.unpaid, tone: 'amber' },
          { label: 'Rejected', count: counts.declined, tone: 'red' },
        ]}
      />

      {seesAll && (
        <>
          {stats.length === 0 ? (
            <div className={`${cardCls} p-6 text-center text-xs text-slate-500`}>No sales coupons yet. Live totals and charts will appear here as soon as the first coupon is generated.</div>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {stats.map((c) => (
                  <div key={c.currency} className={`${cardCls} p-4`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-slate-900 dark:text-slate-100">{c.currency}</span>
                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Receivables</p>
                        <p className="text-base font-bold font-mono tabular-nums text-blue-600 dark:text-blue-400">{money(c.receivable, c.currency)}</p>
                        <p className="text-[10px] text-slate-400">all created coupons · not yet paid: {money(c.receivableOpen, c.currency)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Payables</p>
                        <p className="text-base font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">{money(c.payable, c.currency)}</p>
                        <p className="text-[10px] text-slate-400">all created coupons · not yet paid: {money(c.payableOpen, c.currency)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Expected profit</p>
                        <p className="text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">{money(c.expectedProfit, c.currency)}</p>
                        <p className="text-[10px] text-slate-400">sale − cost, all created coupons</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Profit earned</p>
                        <p className="text-sm font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">{money(c.realisedProfit, c.currency)}</p>
                        <p className="text-[10px] text-slate-400">coupons marked paid</p>
                      </div>
                    </div>
                    {c.pendingCount > 0 && <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-2">{c.pendingCount} coupon{c.pendingCount > 1 ? 's' : ''} waiting for review · {money(c.pendingValue, c.currency)}</p>}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-400 px-1">Profit = sale amount − cost amount. Receivables and payables count every coupon as soon as it is created (declined ones are left out). Each currency is kept separate (no conversion).</p>

              <div className={`${cardCls} p-4 space-y-4`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">Live sales charts</h3>
                  <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Currency">
                    {stats.map((c) => (
                      <button key={c.currency} role="tab" aria-selected={activeCur === c.currency} onClick={() => setChartCur(c.currency)}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border cursor-pointer ${activeCur === c.currency ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>{c.currency}</button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                  <div><p className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">By sale type ({activeCur}, pending + approved)</p><BarChart groups={chartGroups.byType} currency={activeCur} /></div>
                  <div><p className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Last 14 days ({activeCur})</p><BarChart groups={chartGroups.days} currency={activeCur} /></div>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px]">
                  <Pill tone="amber">Pending {counts.pending}</Pill><Pill tone="green">Approved {counts.approved}</Pill><Pill tone="red">Declined {counts.declined}</Pill>
                </div>
              </div>
            </>
          )}
        </>
      )}

      <div className={`${cardCls} p-4 space-y-3`}>
        <div className="flex flex-col md:flex-row gap-2 md:items-center justify-between">
          <div className="flex flex-wrap gap-1.5">
            {filters.map(([id, label]) => (
              <button key={id} onClick={() => setFilter(id)} className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border cursor-pointer ${filter === id ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>{label}</button>
            ))}
          </div>
          <input className={`${inputCls} md:max-w-xs`} placeholder="Search coupon no., customer, PAX, vendor…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {error && !formOpen && !deciding && <ErrorNote message={error} />}
      </div>

      {shown.length === 0 ? (
        <div className={`${cardCls} p-8 text-center text-xs text-slate-500`}>{sales.length === 0 ? 'No coupons yet. Press “Generate Sales Coupon” to add the first one.' : 'No coupons match this filter.'}</div>
      ) : (
        <div className="space-y-2">
          <div className="hidden lg:grid lg:grid-cols-[1fr_1.5fr_1.2fr_1.3fr_0.8fr_auto] gap-3 px-4 text-[10px] uppercase tracking-wider font-bold text-slate-500">
            <span>Query Code</span><span>Customer Name</span><span>Vendor Name</span><span>Rcvables / Payables</span><span>Type</span><span className="w-44 text-right">Status</span>
          </div>
          {shown.map((s) => {
            const mineCoupon = s.createdBy === currentUser.id;
            const counted = s.status !== 'declined';
            const L = 'lg:hidden block text-[9px] uppercase tracking-wider font-bold text-slate-400 mb-0.5';
            return (
              <div key={s.id} className={`${cardCls} px-4 py-3`}>
                <div className="grid grid-cols-2 lg:grid-cols-[1fr_1.5fr_1.2fr_1.3fr_0.8fr_auto] gap-x-3 gap-y-2 lg:items-start">
                  <div className="min-w-0">
                    <span className={L}>Query Code</span>
                    <p className="font-mono text-sm font-extrabold text-blue-700 dark:text-blue-300 break-all">{s.queryCode}</p>
                    <p className="font-mono text-[10px] text-slate-400">{s.couponNo}{newIds.has(s.id) ? ' · NEW' : ''}</p>
                  </div>
                  <div className="min-w-0">
                    <span className={L}>Customer Name</span>
                    <p className="text-sm font-bold text-slate-900 dark:text-slate-100 break-words">{s.customerName}</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">by <b className="text-slate-700 dark:text-slate-200">{empName.get(s.createdBy) || 'Former employee'}</b>{mineCoupon ? ' (you)' : ''} · {fmtDateTime(s.createdAt)}</p>
                  </div>
                  <div className="min-w-0">
                    <span className={L}>Vendor Name</span>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 break-words">{s.vendorName}</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 break-words">PAX: {s.paxName}</p>
                  </div>
                  <div className="min-w-0">
                    <span className={L}>Rcvables / Payables</span>
                    {counted ? (
                      <>
                        <p className="text-xs text-slate-500">Rcv <b className="font-mono text-emerald-700 dark:text-emerald-400">{money(s.saleAmount, s.currency)}</b></p>
                        <p className="text-xs text-slate-500">Pay <b className="font-mono text-amber-700 dark:text-amber-400">{money(s.costAmount, s.currency)}</b></p>
                      </>
                    ) : (
                      <p className="text-xs text-slate-400">Not counted (declined)</p>
                    )}
                  </div>
                  <div className="min-w-0">
                    <span className={L}>Type</span>
                    <Pill tone="slate">{typeText(s)}</Pill>
                  </div>
                  <div className="col-span-2 lg:col-span-1 lg:w-44 lg:text-right space-y-1.5">
                    <div className="flex flex-wrap lg:justify-end gap-1">
                      <Pill tone={s.status === 'approved' ? 'green' : s.status === 'declined' ? 'red' : 'amber'}>{s.status === 'approved' ? 'Approved' : s.status === 'declined' ? 'Declined' : 'Waiting for review'}</Pill>
                      {s.status === 'approved' && <Pill tone={s.paymentStatus === 'paid' ? 'green' : 'red'}>{s.paymentStatus === 'paid' ? 'Paid' : 'Not paid'}</Pill>}
                    </div>
                    <div className="flex flex-wrap lg:justify-end gap-1.5">
                      {canReview && (
                        <select
                          aria-label={`Review status for coupon ${s.couponNo}`}
                          className={`${inputCls} !w-auto !py-1 !px-2 !text-[11px] font-semibold`}
                          value={s.status}
                          onChange={(e) => {
                            const nextStatus = e.target.value as CrmSale['status'];
                            if (nextStatus === s.status) return;
                            void act('sale_decide', { id: s.id, status: nextStatus, remarks: s.reviewRemarks || '' });
                          }}
                        >
                          <option value="pending">Review: Pending</option>
                          <option value="approved">Review: Approved</option>
                          <option value="declined">Review: Declined</option>
                        </select>
                      )}
                      {canReview && s.status === 'approved' && (
                        <select
                          aria-label={`Payment status for coupon ${s.couponNo}`}
                          className={`${inputCls} !w-auto !py-1 !px-2 !text-[11px] font-semibold`}
                          value={s.paymentStatus}
                          onChange={(e) =>
                            void act('sale_payment', {
                              id: s.id,
                              paymentStatus: e.target.value as CrmSale['paymentStatus'],
                            })
                          }
                        >
                          <option value="unpaid">Payment: Not Paid</option>
                          <option value="paid">Payment: Paid</option>
                        </select>
                      )}
                      {canReview && s.status === 'pending' && (
                        <>
                          <button className={btnPrimary} onClick={() => { setDeciding({ s, status: 'approved' }); setRemarks(''); setError(''); }}><Check className="w-3.5 h-3.5" /> Approve</button>
                          <button className={btnDanger} onClick={() => { setDeciding({ s, status: 'declined' }); setRemarks(''); setError(''); }}><X className="w-3.5 h-3.5" /> Decline</button>
                        </>
                      )}
                      {canReview && s.status === 'approved' && (
                        <button className={s.paymentStatus === 'paid' ? btnGhost : btnPrimary} onClick={() => void act('sale_payment', { id: s.id, paymentStatus: s.paymentStatus === 'paid' ? 'unpaid' : 'paid' })}>
                          {s.paymentStatus === 'paid' ? 'Mark as not paid' : 'Mark as paid'}
                        </button>
                      )}
                      {canReview && s.status !== 'pending' && (
                        <button className={btnGhost} onClick={() => { setDeciding({ s, status: s.status === 'approved' ? 'declined' : 'approved' }); setRemarks(''); setError(''); }}>{s.status === 'approved' ? 'Decline instead' : 'Approve instead'}</button>
                      )}
                      {canReview && <button className={btnGhost} onClick={() => startEdit(s)} data-edit-sale><Pencil className="w-3.5 h-3.5" /> Edit</button>}
                      <button className={btnGhost} onClick={() => setAfter(saleAfter(s))} data-card-whatsapp>WhatsApp / Accounts</button>
                      <AckBadge kind="sale" id={s.id} crm={crm} canRequest={false} />
                      {(isAdmin || (mineCoupon && s.status === 'pending')) && (
                        <button className={btnDanger} aria-label="Delete coupon" onClick={() => { if (window.confirm(`Delete coupon ${s.couponNo}?`)) void act('sale_delete', { id: s.id }); }}><Trash2 className="w-3.5 h-3.5" /></button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 space-y-0.5">
                  <p className="whitespace-pre-wrap break-words">{s.packageDetails}</p>
                  <p className="text-[11px] text-slate-500">Sale <b className="font-mono">{money(s.saleAmount, s.currency)}</b> · Cost <b className="font-mono">{money(s.costAmount, s.currency)}</b> · PSF / Profit <b className="font-mono">{money(s.psfProfit, s.currency)}</b></p>
                  {s.reviewRemarks && <p className="border-l-2 border-slate-300 dark:border-slate-700 pl-2 text-slate-600 dark:text-slate-400">Accounts: {s.reviewRemarks}{s.reviewedBy ? ` — ${empName.get(s.reviewedBy) || ''}` : ''}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal isOpen={formOpen} onClose={closeForm} title={editing ? 'Edit Sales Coupon' : 'Generate Sales Coupon'} subtitle={editing ? `${editing.couponNo} · All fields are required` : 'All fields are required'} maxWidth="2xl">
        <form onSubmit={submit} className="space-y-4">
          <div>
            <span className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Sale type (choose one)</span>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Sale type">
              {TYPE_ORDER.map((t, i) => (
                <button key={t} type="button" role="radio" aria-checked={form.saleType === t} onClick={() => { setForm((f) => ({ ...f, saleType: t })); setError(''); }}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold border cursor-pointer text-left ${form.saleType === t ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                  {i + 1}. {TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          </div>

          {form.saleType && (
            <>
              {form.saleType === 'others' && (
                <Field label="Sale type (write it)"><input className={inputCls} value={form.otherType} onChange={set('otherType')} maxLength={80} placeholder="e.g. Umrah package" required /></Field>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="1. Customer name"><input className={inputCls} value={form.customerName} onChange={set('customerName')} maxLength={160} required /></Field>
                <Field label="2. Vendor name"><input className={inputCls} value={form.vendorName} onChange={set('vendorName')} maxLength={160} required /></Field>
                <Field label="4. PAX name"><input className={inputCls} value={form.paxName} onChange={set('paxName')} maxLength={400} placeholder="Passenger name(s)" required /></Field>
                <Field label="7. Query code"><input className={inputCls} value={form.queryCode} onChange={set('queryCode')} maxLength={80} required /></Field>
              </div>
              <Field label="3. Package details"><textarea className={inputCls} rows={3} value={form.packageDetails} onChange={set('packageDetails')} maxLength={2000} required /></Field>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <Field label="Currency">
                  <select className={inputCls} value={form.currency} onChange={set('currency')} required>
                    <option value="">Select currency…</option>
                    {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="5. Cost amount"><input className={inputCls} type="number" inputMode="decimal" step="0.01" min="0" value={form.costAmount} onChange={set('costAmount')} required /></Field>
                <Field label="6. Sale amount"><input className={inputCls} type="number" inputMode="decimal" step="0.01" min="0" value={form.saleAmount} onChange={set('saleAmount')} required /></Field>
                <Field label="8. PSF / Profit"><input className={inputCls} type="number" inputMode="decimal" step="0.01" value={form.psfProfit} onChange={set('psfProfit')} required /></Field>
              </div>
              {profitPreview !== null && form.currency && (
                <p className="text-[11px] text-slate-500">Sale − cost = <b className={profitPreview >= 0 ? 'text-emerald-600' : 'text-red-600'}>{money(profitPreview, form.currency)}</b></p>
              )}
            </>
          )}
          {error && <ErrorNote message={error} />}
          <div className="flex justify-end gap-2">
            <button type="button" className={btnGhost} onClick={closeForm}>Cancel</button>
            <button type="submit" className={btnPrimary} disabled={busy || !form.saleType}>{busy ? (editing ? 'Saving…' : 'Sending…') : editing ? 'Save changes' : 'Send to Accounts'}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={Boolean(deciding)} onClose={() => setDeciding(null)} title={deciding?.status === 'approved' ? 'Approve coupon' : 'Decline coupon'} subtitle={deciding?.s.couponNo} maxWidth="md">
        <form onSubmit={decide} className="space-y-4">
          <Field label="Remarks (optional)"><textarea className={inputCls} rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={1000} /></Field>
          {error && <ErrorNote message={error} />}
          <div className="flex justify-end gap-2">
            <button type="button" className={btnGhost} onClick={() => setDeciding(null)}>Cancel</button>
            <button type="submit" className={deciding?.status === 'approved' ? btnPrimary : btnDanger} disabled={busy}>{deciding?.status === 'approved' ? 'Approve' : 'Decline'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
