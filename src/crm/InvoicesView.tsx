import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, FileDown, Share2, Eye, Pencil, Building2, FileText, X, Lock } from 'lucide-react';
import { Employee } from '../types';
import { Modal } from '../components/common/Modal';
import { CompanyProfile, CrmInvoice, InvoiceSection, crmCall } from './crmApi';
import { CrmState } from './useCrm';
import { ErrorNote, Field, Pill, StatBar, btnDanger, btnGhost, btnPrimary, cardCls, inputCls } from './ui';
import { allCurrencies, currencyLabel, fmtAmount } from './currencies';

interface Props {
  crm: CrmState;
  employees: Employee[];
  currentUser: Employee;
}

interface FormLine { description: string; unitPrice: string; units: string; currency: string; rate: string; taxable: boolean; note: boolean; key: string; locked: boolean }
interface FormSection { title: string; key: string; locked: boolean; lines: FormLine[] }
interface FormState {
  id?: string;
  kind: 'customer' | 'vendor';
  invoiceNo?: string;
  crmId: string; queryCode: string;
  customerName: string; customerPhone: string; customerAddress: string; customerNtn: string; reference: string;
  invoiceDate: string; dueDate: string; currency: string;
  sections: FormSection[];
  taxLabel: string; taxRate: string; discount: string; advancePaid: string; notes: string;
}

const today = () => new Date().toLocaleDateString('en-CA'); // yyyy-mm-dd in the person's own time zone
const isServiceTitle = (t: string) => /service/i.test(t);
const uid = () => `k${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
const blankLine = (currency: string, taxable = false): FormLine => ({ description: '', unitPrice: '', units: '1', currency, rate: '', taxable, note: false, key: uid(), locked: false });
const newSection = (title: string, currency: string): FormSection => ({ title, key: uid(), locked: false, lines: [blankLine(currency, isServiceTitle(title))] });
const blankForm = (kind: 'customer' | 'vendor' = 'customer'): FormState => ({
  kind, crmId: '', queryCode: '', customerName: '', customerPhone: '', customerAddress: '', customerNtn: '', reference: '', invoiceDate: today(), dueDate: '', currency: 'PKR',
  sections: [{ title: '', key: uid(), locked: false, lines: [blankLine('PKR')] }], taxLabel: 'Tax', taxRate: kind === 'vendor' ? '' : '6', discount: '', advancePaid: '', notes: '',
});
const PRESETS = ['Package', 'Visa Charges', 'Air Tickets', 'Hotel', 'Transfers', 'Insurance', 'Service Charges'];
const num = (v: string) => (v.trim() === '' ? NaN : Number(v));

function compute(f: FormState) {
  let subtotal = 0;
  let taxable = 0;
  const amounts = f.sections.map((s) => s.lines.map((l) => {
    if (l.note || l.unitPrice.trim() === '') return null;
    const price = num(l.unitPrice);
    const units = l.units.trim() === '' ? 1 : num(l.units);
    const rate = l.currency === f.currency ? 1 : num(l.rate);
    if (![price, units, rate].every(Number.isFinite)) return null;
    const amount = Math.round(price * units * rate * 100) / 100;
    subtotal += amount;
    if (l.taxable) taxable += amount;
    return amount;
  }));
  const taxRate = Number.isFinite(num(f.taxRate)) ? num(f.taxRate) : 0;
  const tax = Math.round(taxable * taxRate) / 100;
  const discount = Number.isFinite(num(f.discount)) ? num(f.discount) : 0;
  const advance = Number.isFinite(num(f.advancePaid)) ? num(f.advancePaid) : 0;
  const total = Math.round((subtotal + tax - discount) * 100) / 100;
  return { amounts, subtotal: Math.round(subtotal * 100) / 100, tax, total, balance: Math.max(0, Math.round((total - advance) * 100) / 100) };
}

function toForm(inv: CrmInvoice): FormState {
  return {
    id: inv.id, kind: inv.kind || 'customer', invoiceNo: inv.invoiceNo, crmId: inv.crmId || '', queryCode: inv.queryCode || '', customerName: inv.customerName, customerPhone: inv.customerPhone, customerAddress: inv.customerAddress, customerNtn: inv.customerNtn,
    reference: inv.reference, invoiceDate: inv.invoiceDate, dueDate: inv.dueDate || '', currency: inv.currency,
    sections: inv.sections.map((s) => ({
      title: s.title, key: s.key || uid(), locked: Boolean(s.locked),
      lines: s.lines.map((l) => ({ key: l.key || uid(), locked: Boolean(l.locked),
        description: l.description, unitPrice: l.note ? '' : String(l.unitPrice ?? ''), units: l.note ? '1' : String(l.units ?? 1), currency: l.currency || inv.currency,
        rate: l.currency && l.currency !== inv.currency ? String(l.rate ?? '') : '', taxable: Boolean(l.taxable), note: Boolean(l.note),
      })),
    })),
    taxLabel: inv.taxLabel, taxRate: inv.taxRate ? String(inv.taxRate) : '', discount: inv.discount ? String(inv.discount) : '', advancePaid: inv.advancePaid ? String(inv.advancePaid) : '', notes: inv.notes,
  };
}

const statusTone = (s: CrmInvoice['status']) => (s === 'paid' ? 'green' : s === 'cancelled' ? 'slate' : 'amber') as 'green' | 'slate' | 'amber';
const niceDate = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

/** On-screen copy of the invoice (the PDF follows the same layout as your sample invoice). */
const InvoicePreview: React.FC<{ inv: CrmInvoice; company: CompanyProfile; by: string }> = ({ inv, company, by }) => {
  const vendor = inv.kind === 'vendor';
  const meta: [string, string][] = [[vendor ? 'Bill No' : 'Invoice No', inv.invoiceNo], [vendor ? 'Bill Date' : 'Invoice Date', niceDate(inv.invoiceDate)]];
  if (inv.dueDate) meta.push(['Due Date', niceDate(inv.dueDate)]);
  if (!vendor && company.ntn) meta.push(['NTN#', company.ntn]);
  if (inv.reference) meta.push(['Reference', inv.reference]);
  if (inv.crmId) meta.push(['CRM ID', inv.crmId]);
  if (vendor && inv.queryCode) meta.push(['Query Code', inv.queryCode]);
  const payTo = company.payTo || company.name;
  const cell = 'border-x border-slate-700';
  return (
    <div className="bg-white text-slate-900 rounded-lg border border-slate-300 p-5 text-[12px] leading-snug">
      <img src="/bahaar-logo.png" alt={company.name} className="w-[88%] max-w-[440px] h-auto" />
      <div className="flex justify-between gap-4 mt-2">
        <div className="min-w-0">
          <p className="text-[9px] font-bold text-slate-500 tracking-wider">{vendor ? 'VENDOR' : 'BILL TO'}</p>
          <p className="font-bold text-sm break-words">{inv.customerName || '—'}</p>
          {inv.customerPhone && <p>Phone: {inv.customerPhone}</p>}
          {inv.customerAddress && <p>{inv.customerAddress}</p>}
          {inv.customerNtn && <p>NTN: {inv.customerNtn}</p>}
        </div>
        <table className="text-[11px] border border-slate-700 self-start shrink-0">
          <tbody>
            {meta.map(([k, v]) => (
              <tr key={k}><td className="border border-slate-700 px-2 py-0.5">{k}</td><td className="border border-slate-700 px-2 py-0.5 font-bold text-center min-w-[110px]">{v}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4 className="text-center font-serif font-bold text-xl my-3">{vendor ? 'VENDOR PAYABLE' : 'INVOICE'}</h4>
      <div className="overflow-x-auto">
        <table className="w-full border border-slate-700 border-collapse min-w-[420px]">
          <thead>
            <tr className="text-[10px]">
              {['SN', 'DESCRIPTION', vendor ? 'COST' : 'UNIT PRICE', 'UNITS', `AMOUNT ${inv.currency}`].map((h) => <th key={h} className="border border-slate-700 px-1.5 py-1">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {inv.sections.map((sec: InvoiceSection, si) => (
              <React.Fragment key={si}>
                {sec.title && <tr className="bg-slate-300 font-bold"><td className={`${cell} text-center py-1`}>{inv.sections.slice(0, si + 1).filter((x) => x.title).length}</td><td colSpan={4} className="px-1.5 py-1">{sec.title}</td></tr>}
                {sec.lines.map((l, li) => (
                  <tr key={li}>
                    <td className={`${cell} py-1.5`} />
                    <td className={`px-1.5 py-1.5 ${l.note ? 'font-bold' : ''}`}>{l.description}</td>
                    <td className={`${cell} text-center`}>{l.note ? '' : (<>{l.currency} {fmtAmount(l.unitPrice || 0)}{l.currency !== inv.currency && l.rate ? <span className="block text-[9px] text-slate-500">1 {l.currency} = {fmtAmount(l.rate)} {inv.currency}</span> : null}</>)}</td>
                    <td className={`${cell} text-center`}>{l.note ? '' : fmtAmount(l.units ?? 1)}</td>
                    <td className={`${cell} text-right px-1.5`}>{l.note ? '' : fmtAmount(l.amount || 0)}</td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
            {inv.taxAmount > 0 && <tr className="font-bold"><td className={`${cell} py-1.5`} /><td className="px-1.5 py-1.5">{(inv.taxLabel || 'Tax').toUpperCase()}</td><td className={cell} /><td className={cell} /><td className={`${cell} text-right px-1.5 font-normal`}>{fmtAmount(inv.taxAmount)}</td></tr>}
            {inv.discount > 0 && <tr className="font-bold"><td className={`${cell} py-1.5`} /><td className="px-1.5 py-1.5">DISCOUNT</td><td className={cell} /><td className={cell} /><td className={`${cell} text-right px-1.5 font-normal`}>-{fmtAmount(inv.discount)}</td></tr>}
            <tr className="border-t border-slate-700 font-bold"><td className={cell} /><td className={cell} /><td className="border-slate-700" /><td className="text-center py-1.5">Total</td><td className="border border-slate-700 text-right px-1.5">{fmtAmount(inv.total)}</td></tr>
            {inv.advancePaid > 0 && <tr className="border-t border-slate-700 font-bold"><td className={cell} /><td className={cell} /><td /><td className="text-center py-1.5">{vendor ? 'Paid' : 'Advance'}</td><td className="border border-slate-700 text-right px-1.5">-{fmtAmount(inv.advancePaid)}</td></tr>}
            <tr className="border-t border-slate-700">
              <td className={cell} />
              <td colSpan={3} className={`${cell} px-1.5 py-4 align-bottom text-[11px]`}>
                {vendor
                  ? <>TOTAL PAYABLE TO {inv.customerName.toUpperCase()}: <b>{inv.currency} {fmtAmount(inv.balance)}/-</b></>
                  : (payTo && inv.status !== 'paid' ? <>KINDLY MAKE CHEQUE OF <b>{inv.currency} {fmtAmount(inv.balance)}/-</b> IN FAVOR OF {payTo.toUpperCase()}{company.bankDetails && <span className="block whitespace-pre-wrap mt-1">{company.bankDetails}</span>}</> : null)}
              </td>
              <td className="border-r border-slate-700" />
            </tr>
            <tr className="border-t border-slate-700 font-bold"><td className={cell} /><td className={cell} /><td /><td className="text-center py-1.5">Balance</td><td className="border border-slate-700 text-center px-1.5 font-semibold">{fmtAmount(inv.balance)}</td></tr>
          </tbody>
        </table>
      </div>
      {(inv.notes || (!vendor && company.terms)) && <div className="mt-2"><p className="text-[9px] font-bold text-slate-500">NOTES</p><p className="whitespace-pre-wrap text-slate-600">{[inv.notes, vendor ? '' : company.terms].filter(Boolean).join('\n')}</p></div>}
      <div className="mt-3 flex justify-between items-end">
        <div><p className={vendor ? 'text-[10px] text-slate-500' : 'text-sm'}>{vendor ? 'Internal payable record — not for customers' : company.footer || 'Thanking you'}</p>{by && <p className="text-[9px] text-slate-400">Prepared by {by}</p>}</div>
        <p className="text-[9px] text-slate-500 border-t border-slate-500 pt-0.5 px-6">Authorised signature</p>
      </div>
      {!vendor && <p className="mt-2 text-center text-[9px] text-slate-400">{[company.address, company.phone, company.email, company.website].filter(Boolean).join('  |  ')}</p>}
    </div>
  );
};

export const InvoicesView: React.FC<Props> = ({ crm, employees, currentUser }) => {
  const isStaff = currentUser.role === 'admin' || currentUser.role === 'accounts';
  const isAdmin = currentUser.role === 'admin';
  const seesAll = isStaff || currentUser.role === 'ceo';
  const { invoices: allInvoices, company } = crm.data;
  const [side, setSide] = useState<'customer' | 'vendor'>('customer');
  const invoices = useMemo(() => allInvoices.filter((i) => (i.kind || 'customer') === side), [allInvoices, side]);
  const vendorSide = side === 'vendor';
  const empName = useMemo(() => new Map(employees.map((e) => [e.id, e.name])), [employees]);
  const currencies = useMemo(() => allCurrencies(), []);

  const [form, setForm] = useState<FormState | null>(null);
  const [view, setView] = useState<CrmInvoice | null>(null);
  const [companyForm, setCompanyForm] = useState<CompanyProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState<'all' | 'unpaid' | 'paid' | 'cancelled'>('all');
  const [query, setQuery] = useState('');
  const [canShare, setCanShare] = useState(false);

  useEffect(() => { void crm.refresh(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      setCanShare(Boolean(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.pdf', { type: 'application/pdf' })] })));
    } catch {
      setCanShare(false);
    }
  }, []);
  const hasNew = crm.data.unread.some((u) => u.category === 'invoice');
  useEffect(() => {
    if (!hasNew) return;
    const t = window.setTimeout(() => { void crm.markRead('invoice'); }, 4000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasNew]);
  // keep the open preview in step with refreshed data
  useEffect(() => { if (view) setView(allInvoices.find((i) => i.id === view.id) || null); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allInvoices]);

  const counts = useMemo(() => ({
    unpaid: invoices.filter((i) => i.status === 'unpaid').length,
    paid: invoices.filter((i) => i.status === 'paid').length,
    cancelled: invoices.filter((i) => i.status === 'cancelled').length,
  }), [invoices]);
  const outstanding = useMemo(() => {
    const m = new Map<string, number>();
    invoices.filter((i) => i.status === 'unpaid').forEach((i) => m.set(i.currency, (m.get(i.currency) || 0) + i.balance));
    return [...m.entries()];
  }, [invoices]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return invoices.filter((i) => (filter === 'all' || i.status === filter) && (!q || [i.invoiceNo, i.customerName, i.reference, i.crmId || '', i.queryCode || '', i.customerPhone, empName.get(i.createdBy) || ''].some((v) => v.toLowerCase().includes(q))));
  }, [invoices, filter, query, empName]);

  const canEdit = (i: CrmInvoice) => isStaff || (i.createdBy === currentUser.id && i.status === 'unpaid');
  const calc = form ? compute(form) : null;
  const draft: CrmInvoice | null = form && calc ? {
    id: form.id || 'draft', kind: form.kind, crmId: form.crmId, queryCode: form.queryCode,
    invoiceNo: form.invoiceNo || (form.kind === 'vendor' ? 'PAY-(auto)' : 'INV-(auto)'), createdBy: currentUser.id,
    customerName: form.customerName, customerPhone: form.customerPhone, customerAddress: form.customerAddress, customerNtn: form.customerNtn,
    reference: form.reference, invoiceDate: form.invoiceDate, dueDate: form.dueDate || null, currency: form.currency,
    sections: form.sections.map((s, si) => ({
      title: s.title,
      lines: s.lines.map((l, li) => (l.note
        ? { description: l.description, note: true }
        : { description: l.description, unitPrice: Number(l.unitPrice) || 0, units: l.units.trim() === '' ? 1 : Number(l.units) || 0, currency: l.currency, rate: l.currency === form.currency ? 1 : Number(l.rate) || 0, amount: calc.amounts[si][li] ?? 0, taxable: l.taxable }
      )).filter((l) => l.description.trim() || (l.amount ?? 0) > 0),
    })).filter((sec) => sec.title.trim() || sec.lines.length),
    taxLabel: form.taxLabel, taxRate: Number(form.taxRate) || 0, discount: Number(form.discount) || 0, advancePaid: Number(form.advancePaid) || 0,
    subtotal: calc.subtotal, taxAmount: calc.tax, total: calc.total, balance: calc.balance, notes: form.notes, status: 'unpaid', createdAt: '', updatedAt: '',
  } : null;

  const patch = (p: Partial<FormState>) => { setForm((f) => (f ? { ...f, ...p } : f)); setError(''); setNotice(''); };
  const setSection = (si: number, p: Partial<FormSection>) => patch({ sections: form!.sections.map((s, i) => (i === si ? { ...s, ...p } : s)) });
  const setLine = (si: number, li: number, p: Partial<FormLine>) => setSection(si, { lines: form!.sections[si].lines.map((l, i) => (i === li ? { ...l, ...p } : l)) });
  const changeInvoiceCurrency = (code: string) => {
    // lines that were in the old invoice currency follow it
    patch({ currency: code, sections: form!.sections.map((s) => ({ ...s, lines: s.lines.map((l) => (l.currency === form!.currency ? { ...l, currency: code, rate: '' } : l)) })) });
  };

  const buildPayload = (lockIdx: number | null) => ({
    ...form,
    sections: form!.sections.map((s, si) => {
      const lockThis = si === lockIdx;
      return {
        title: s.title, key: s.key, locked: s.locked || lockThis,
        lines: s.lines.filter((l) => l.description.trim() || l.unitPrice.trim()).map((l) => (l.note
          ? { description: l.description, key: l.key, locked: l.locked || lockThis }
          : { description: l.description, unitPrice: l.unitPrice, units: l.units, currency: l.currency, rate: l.rate, taxable: l.taxable, key: l.key, locked: l.locked || lockThis })),
      };
    }),
  });

  const persist = async (lockIdx: number | null, close: boolean) => {
    if (!form || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await crmCall<{ invoice: CrmInvoice }>('invoice_save', { invoice: buildPayload(lockIdx) });
      await crm.refresh();
      if (close) {
        setForm(null);
        setView(r.invoice);
      } else {
        setForm(toForm(r.invoice));
        setNotice(`Saved and locked. ${r.invoice.invoiceNo} is stored; locked lines can no longer be edited, but you can keep adding new lines.`);
      }
    } catch (err: any) {
      setError(err?.message || 'Could not save the invoice.');
    } finally {
      setBusy(false);
    }
  };
  const save = async (e: React.FormEvent) => { e.preventDefault(); await persist(null, true); };

  const act = async (action: string, payload: Record<string, unknown>) => {
    setError('');
    try {
      await crmCall(action, payload);
      await crm.refresh();
    } catch (err: any) {
      setError(err?.message || 'That did not work. Please try again.');
    }
  };

  const by = (i: CrmInvoice) => empName.get(i.createdBy) || '';
  const pdf = async (i: CrmInvoice) => {
    setError('');
    try {
      const { downloadInvoicePdf } = await import('./invoicePdf'); // loaded only when needed
      await downloadInvoicePdf(i, company, by(i));
    } catch (err: any) {
      setError(err?.message || 'Could not create the PDF.');
    }
  };
  const share = async (i: CrmInvoice) => {
    try {
      const { invoicePdfFile } = await import('./invoicePdf');
      const file = await invoicePdfFile(i, company, by(i));
      await navigator.share({ files: [file], title: `Invoice ${i.invoiceNo}`, text: `Invoice ${i.invoiceNo} — ${company.name}` });
    } catch (err: any) {
      if (err?.name !== 'AbortError') setError('Could not share. Download the PDF and send it instead.');
    }
  };

  const saveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyForm) return;
    setBusy(true);
    try {
      await crmCall('company_save', { company: companyForm });
      await crm.refresh();
      setCompanyForm(null);
    } catch (err: any) {
      setError(err?.message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const filters: ['all' | 'unpaid' | 'paid' | 'cancelled', string][] = [['all', 'All'], ['unpaid', 'Unpaid'], ['paid', 'Paid'], ['cancelled', 'Cancelled']];

  return (
    <div className="space-y-4">
      <div className={`${cardCls} p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3`}>
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2"><FileText className="w-4 h-4 text-blue-600" /> Invoices</h2>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{vendorSide ? 'Vendor side: what we owe vendors for tickets, hotels and other services. Digital only — never printed on a customer invoice.' : 'Create an invoice, download it as a PDF and send it to the customer.'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isStaff && <button className={btnGhost} onClick={() => { setCompanyForm({ ...company }); setError(''); }}><Building2 className="w-3.5 h-3.5" /> Company details</button>}
          <button className={btnPrimary} onClick={() => { setForm(blankForm(side)); setError(''); setNotice(''); }}><Plus className="w-3.5 h-3.5" /> {vendorSide ? 'New vendor payable' : 'New invoice'}</button>
        </div>
      </div>

      <div className="flex gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/60 w-fit" role="tablist" aria-label="Invoice side">
        {([['customer', 'Customer invoices'], ['vendor', 'Vendor payables']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={side === id} onClick={() => { setSide(id); setFilter('all'); setQuery(''); }}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${side === id ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 shadow-sm' : 'text-slate-600 dark:text-slate-400'}`}>{label}</button>
        ))}
      </div>

      <StatBar
        title={`${seesAll ? 'All' : 'Your'} ${vendorSide ? 'vendor payables' : 'invoices'}`}
        segments={[
          { label: 'Unpaid', count: counts.unpaid, tone: 'amber' },
          { label: 'Paid', count: counts.paid, tone: 'green' },
          { label: 'Cancelled', count: counts.cancelled, tone: 'slate' },
        ]}
      />
      {outstanding.length > 0 && (
        <div className={`${cardCls} p-3 flex flex-wrap gap-x-6 gap-y-1 text-xs`}>
          <span className="font-semibold text-slate-600 dark:text-slate-300">{vendorSide ? 'Still to be paid to vendors:' : 'Still to be received:'}</span>
          {outstanding.map(([c, v]) => <span key={c} className="font-mono font-bold text-blue-600 dark:text-blue-400">{c} {fmtAmount(v)}</span>)}
        </div>
      )}

      <div className={`${cardCls} p-4 flex flex-col md:flex-row gap-2 md:items-center justify-between`}>
        <div className="flex flex-wrap gap-1.5">
          {filters.map(([id, label]) => (
            <button key={id} onClick={() => setFilter(id)} className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border cursor-pointer ${filter === id ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>{label}</button>
          ))}
        </div>
        <input className={`${inputCls} md:max-w-xs`} placeholder={vendorSide ? 'Search bill no., vendor, query code, CRM ID…' : 'Search invoice no., customer, reference, CRM ID…'} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {error && !form && !companyForm && <ErrorNote message={error} />}

      {shown.length === 0 ? (
        <div className={`${cardCls} p-8 text-center text-xs text-slate-500`}>{invoices.length === 0 ? (vendorSide ? 'No vendor payables yet. Press “New vendor payable” to add the first one.' : 'No invoices yet. Press “New invoice” to create the first one.') : 'No invoices match this filter.'}</div>
      ) : (
        <div className="space-y-3">
          {shown.map((i) => (
            <div key={i.id} className={`${cardCls} p-4`}>
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-blue-700 dark:text-blue-300">{i.invoiceNo}</span>
                    <Pill tone={statusTone(i.status)}>{i.status === 'paid' ? 'Paid' : i.status === 'cancelled' ? 'Cancelled' : 'Unpaid'}</Pill>
                    {i.reference && <Pill tone="slate">Ref {i.reference}</Pill>}
                    {i.crmId && <Pill tone="blue">CRM {i.crmId}</Pill>}
                    {i.queryCode && <Pill tone="slate">Query {i.queryCode}</Pill>}
                  </div>
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100 break-words">{i.customerName}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{niceDate(i.invoiceDate)}{i.dueDate ? ` · due ${niceDate(i.dueDate)}` : ''} · created by <b className="text-slate-700 dark:text-slate-200">{by(i) || 'Former employee'}</b></p>
                </div>
                <div className="lg:text-right shrink-0">
                  <p className="text-[11px] text-slate-500">{vendorSide ? 'Total payment' : 'Total'} <b className="font-mono text-slate-900 dark:text-slate-100">{i.currency} {fmtAmount(i.total)}</b></p>
                  <p className="text-[11px] text-slate-500">Balance <b className={`font-mono ${i.balance > 0 && i.status === 'unpaid' ? 'text-amber-600' : 'text-emerald-600'}`}>{i.currency} {fmtAmount(i.balance)}</b></p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-3">
                <button className={btnGhost} onClick={() => setView(i)}><Eye className="w-3.5 h-3.5" /> View</button>
                <button className={btnPrimary} onClick={() => void pdf(i)}><FileDown className="w-3.5 h-3.5" /> Download PDF</button>
                {canShare && <button className={btnGhost} onClick={() => void share(i)}><Share2 className="w-3.5 h-3.5" /> Share</button>}
                {canEdit(i) && <button className={btnGhost} onClick={() => { setForm(toForm(i)); setError(''); }}><Pencil className="w-3.5 h-3.5" /> Edit</button>}
                {isStaff && i.status !== 'paid' && <button className={btnGhost} onClick={() => void act('invoice_status', { id: i.id, status: 'paid' })}>Mark paid</button>}
                {isStaff && i.status === 'paid' && <button className={btnGhost} onClick={() => void act('invoice_status', { id: i.id, status: 'unpaid' })}>Mark unpaid</button>}
                {(isStaff || i.createdBy === currentUser.id) && i.status === 'unpaid' && <button className={btnGhost} onClick={() => { if (window.confirm(`Cancel invoice ${i.invoiceNo}?`)) void act('invoice_status', { id: i.id, status: 'cancelled' }); }}>Cancel invoice</button>}
                {isStaff && i.status === 'cancelled' && <button className={btnGhost} onClick={() => void act('invoice_status', { id: i.id, status: 'unpaid' })}>Reopen</button>}
                {isAdmin && <button className={btnDanger} aria-label="Delete invoice" onClick={() => { if (window.confirm(`Delete invoice ${i.invoiceNo} permanently?`)) void act('invoice_delete', { id: i.id }); }}><Trash2 className="w-3.5 h-3.5" /></button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---------- preview */}
      <Modal isOpen={Boolean(view)} onClose={() => setView(null)} title={view ? `${view.kind === 'vendor' ? 'Vendor payable' : 'Invoice'} ${view.invoiceNo}` : ''} subtitle={view?.kind === 'vendor' ? 'Digital copy for our records — not for the customer' : 'Preview — the PDF has the same layout'} maxWidth="4xl">
        {view && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <button className={btnPrimary} onClick={() => void pdf(view)}><FileDown className="w-3.5 h-3.5" /> Download PDF</button>
              {canShare && <button className={btnGhost} onClick={() => void share(view)}><Share2 className="w-3.5 h-3.5" /> Share</button>}
              {canEdit(view) && <button className={btnGhost} onClick={() => { setForm(toForm(view)); setView(null); }}><Pencil className="w-3.5 h-3.5" /> Edit</button>}
            </div>
            {error && <ErrorNote message={error} />}
            <InvoicePreview inv={view} company={company} by={by(view)} />
          </div>
        )}
      </Modal>

      {/* ---------- form */}
      <Modal isOpen={Boolean(form)} onClose={() => setForm(null)} title={`${form?.id ? 'Edit' : 'New'} ${form?.kind === 'vendor' ? 'vendor payable' : 'invoice'}`} subtitle="The invoice number is created automatically" maxWidth="full">
        {form && calc && draft && (
          <div className="flex flex-col xl:flex-row gap-5 xl:items-start">
          <form onSubmit={save} className="space-y-5 min-w-0 xl:flex-1">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label={form.kind === 'vendor' ? 'Vendor name *' : 'Customer name *'}><input className={inputCls} value={form.customerName} onChange={(e) => patch({ customerName: e.target.value })} maxLength={160} required /></Field>
              <Field label="Phone"><input className={inputCls} value={form.customerPhone} onChange={(e) => patch({ customerPhone: e.target.value })} maxLength={60} /></Field>
              {form.kind === 'vendor'
                ? <Field label="Query code (optional)"><input className={inputCls} value={form.queryCode} onChange={(e) => patch({ queryCode: e.target.value })} maxLength={80} /></Field>
                : <Field label="Reference / Query code"><input className={inputCls} value={form.reference} onChange={(e) => patch({ reference: e.target.value })} maxLength={120} /></Field>}
              <Field label={form.kind === 'vendor' ? 'Vendor address' : 'Customer address'}><input className={inputCls} value={form.customerAddress} onChange={(e) => patch({ customerAddress: e.target.value })} maxLength={400} /></Field>
              <Field label={form.kind === 'vendor' ? 'Vendor NTN (optional)' : 'Customer NTN (optional)'}><input className={inputCls} value={form.customerNtn} onChange={(e) => patch({ customerNtn: e.target.value })} maxLength={60} /></Field>
              <Field label="Invoice currency *">
                <select className={inputCls} value={form.currency} onChange={(e) => changeInvoiceCurrency(e.target.value)}>
                  {currencies.map((c) => <option key={c.code} value={c.code}>{currencyLabel(c)}</option>)}
                </select>
              </Field>
              <Field label="CRM ID (optional)"><input className={inputCls} value={form.crmId} onChange={(e) => patch({ crmId: e.target.value })} maxLength={60} placeholder="Shown under the reference on the PDF" /></Field>
              <Field label={form.kind === 'vendor' ? 'Bill date *' : 'Invoice date *'}><input className={inputCls} type="date" value={form.invoiceDate} onChange={(e) => patch({ invoiceDate: e.target.value })} required /></Field>
              <Field label="Due date (optional)"><input className={inputCls} type="date" value={form.dueDate} onChange={(e) => patch({ dueDate: e.target.value })} /></Field>
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 mr-1">Add section:</span>
                {PRESETS.map((p) => (
                  <button key={p} type="button" className="px-2 py-1 rounded-full text-[11px] font-semibold border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    onClick={() => patch({ sections: [...form.sections, newSection(p, form.currency)] })}>+ {p}</button>
                ))}
                <button type="button" className="px-2 py-1 rounded-full text-[11px] font-semibold border border-blue-300 text-blue-700 dark:text-blue-300 cursor-pointer" onClick={() => patch({ sections: [...form.sections, newSection('', form.currency)] })}>+ Other</button>
              </div>

              {form.sections.map((s, si) => (
                <div key={si} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2 bg-slate-50/60 dark:bg-slate-900/40">
                  <div className="flex items-center gap-2">
                    <input className={`${inputCls} font-semibold`} placeholder={`Section heading, e.g. "07 OCT - 11 OCT BAKU FAMILY TOUR"`} value={s.title} onChange={(e) => setSection(si, { title: e.target.value, lines: s.lines.map((l) => (l.note || l.unitPrice.trim() !== '' ? l : { ...l, taxable: isServiceTitle(e.target.value) })) })} maxLength={160} disabled={s.locked} />
                    {(s.locked || s.lines.some((l) => l.locked)) && <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-400"><Lock className="w-3 h-3" /> Locked</span>}
                    {!s.locked && !s.lines.some((l) => l.locked) && <button type="button" aria-label="Remove section" className={btnDanger} onClick={() => patch({ sections: form.sections.filter((_, i) => i !== si) })}><Trash2 className="w-3.5 h-3.5" /></button>}
                  </div>
                  <div className="hidden md:grid grid-cols-12 gap-2 text-[10px] font-semibold text-slate-500 px-1">
                    <span className="col-span-4">Description</span><span className="col-span-2">Unit price</span><span className="col-span-1">Units</span><span className="col-span-2">Currency</span><span className="col-span-1">Tax?</span><span className="col-span-2 text-right">Amount ({form.currency})</span>
                  </div>
                  {s.lines.map((l, li) => {
                    const amount = calc.amounts[si][li];
                    const foreign = !l.note && l.currency !== form.currency;
                    return (
                      <div key={li} className="space-y-1">
                        <div className="grid grid-cols-2 md:grid-cols-12 gap-2 items-center">
                          <input className={`${inputCls} col-span-2 ${l.note ? 'md:col-span-11 font-semibold' : 'md:col-span-4'}`} placeholder={l.note ? 'Text line, e.g. LAHORE-BAKU-LAHORE' : 'Description'} value={l.description} onChange={(e) => setLine(si, li, { description: e.target.value })} maxLength={300} disabled={l.locked} />
                          {!l.note && (
                            <>
                              <input className={`${inputCls} md:col-span-2`} type="number" inputMode="decimal" step="0.01" min="0" placeholder="Unit price" value={l.unitPrice} onChange={(e) => setLine(si, li, { unitPrice: e.target.value })} disabled={l.locked} />
                              <input className={`${inputCls} md:col-span-1`} type="number" inputMode="decimal" step="any" min="0" placeholder="Units" value={l.units} onChange={(e) => setLine(si, li, { units: e.target.value })} disabled={l.locked} />
                              <select className={`${inputCls} md:col-span-2`} value={l.currency} onChange={(e) => setLine(si, li, { currency: e.target.value, rate: '' })} title="Currency of this price" disabled={l.locked}>
                                {currencies.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
                              </select>
                              <label className="md:col-span-1 inline-flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300"><input type="checkbox" checked={l.taxable} onChange={(e) => setLine(si, li, { taxable: e.target.checked })} disabled={l.locked} /> Tax</label>
                              <div className="md:col-span-2 text-right text-xs font-mono tabular-nums font-semibold text-slate-800 dark:text-slate-100">{amount === null ? '—' : fmtAmount(amount)}</div>
                            </>
                          )}
                          {l.locked ? <Lock className="w-3.5 h-3.5 justify-self-end text-emerald-600 md:col-span-1" aria-label="Locked line" /> : <button type="button" aria-label="Remove line" className="justify-self-end text-slate-400 hover:text-red-600 cursor-pointer md:col-span-1" onClick={() => setSection(si, { lines: s.lines.filter((_, i) => i !== li) })}><X className="w-4 h-4" /></button>}
                        </div>
                        {foreign && (
                          <div className="flex items-center gap-2 pl-1 text-[11px] text-slate-600 dark:text-slate-300">
                            <span>Exchange rate: 1 {l.currency} =</span>
                            <input className={`${inputCls} w-32`} type="number" inputMode="decimal" step="any" min="0" placeholder="rate" value={l.rate} onChange={(e) => setLine(si, li, { rate: e.target.value })} required={l.unitPrice.trim() !== ''} disabled={l.locked} />
                            <span>{form.currency}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div className="flex gap-2">
                    <button type="button" className={btnGhost} onClick={() => setSection(si, { lines: [...s.lines, blankLine(form.currency, isServiceTitle(s.title))] })}><Plus className="w-3.5 h-3.5" /> Add line</button>
                    <button type="button" className={btnGhost} onClick={() => setSection(si, { lines: [...s.lines, { ...blankLine(form.currency), note: true }] })}>+ Text line</button>
                    {s.lines.some((l) => !l.locked && (l.description.trim() || l.unitPrice.trim())) && (
                      <button type="button" disabled={busy} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-1.5 cursor-pointer disabled:opacity-60 ml-auto" title="Saves the invoice and locks the lines above so they cannot be edited again"
                        onClick={() => void persist(si, false)}><Lock className="w-3.5 h-3.5" /> Save &amp; lock</button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Tax name"><input className={inputCls} value={form.taxLabel} onChange={(e) => patch({ taxLabel: e.target.value })} maxLength={40} placeholder="Tax" /></Field>
                <Field label="Tax % (on lines ticked Tax — Service Charges are ticked automatically)"><input className={inputCls} type="number" inputMode="decimal" step="any" min="0" max="100" value={form.taxRate} onChange={(e) => patch({ taxRate: e.target.value })} /></Field>
                <Field label={`Discount (${form.currency})`}><input className={inputCls} type="number" inputMode="decimal" step="0.01" min="0" value={form.discount} onChange={(e) => patch({ discount: e.target.value })} /></Field>
                <Field label={`Advance received (${form.currency})`}><input className={inputCls} type="number" inputMode="decimal" step="0.01" min="0" value={form.advancePaid} onChange={(e) => patch({ advancePaid: e.target.value })} /></Field>
                <div className="col-span-2"><Field label="Notes (optional)"><textarea className={inputCls} rows={2} value={form.notes} onChange={(e) => patch({ notes: e.target.value })} maxLength={1500} /></Field></div>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-1.5 text-xs self-start">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Live totals</p>
                <div className="flex justify-between"><span>Subtotal</span><b className="font-mono">{form.currency} {fmtAmount(calc.subtotal)}</b></div>
                {calc.tax === 0 && num(form.taxRate) > 0 && <p className="text-[10px] text-amber-600">No tax yet — tick “Tax” on the lines that are taxable (e.g. Service Charges).</p>}
                {calc.tax > 0 && <div className="flex justify-between"><span>{form.taxLabel || 'Tax'} ({form.taxRate}%)</span><b className="font-mono">{fmtAmount(calc.tax)}</b></div>}
                {num(form.discount) > 0 && <div className="flex justify-between"><span>Discount</span><b className="font-mono">-{fmtAmount(num(form.discount))}</b></div>}
                <div className="flex justify-between border-t border-slate-200 dark:border-slate-700 pt-1.5"><span className="font-semibold">Total</span><b className="font-mono">{form.currency} {fmtAmount(calc.total)}</b></div>
                {num(form.advancePaid) > 0 && <div className="flex justify-between"><span>Advance received</span><b className="font-mono">-{fmtAmount(num(form.advancePaid))}</b></div>}
                <div className="flex justify-between text-sm"><span className="font-semibold">Balance due</span><b className="font-mono text-blue-600 dark:text-blue-400">{form.currency} {fmtAmount(calc.balance)}</b></div>
              </div>
            </div>

            {notice && <p className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold">{notice}</p>}
            {error && <ErrorNote message={error} />}
            <div className="flex justify-end gap-2">
              <button type="button" className={btnGhost} onClick={() => setForm(null)}>Cancel</button>
              <button type="submit" className={btnPrimary} disabled={busy}>{busy ? 'Saving…' : form.id ? 'Save changes' : 'Create invoice'}</button>
            </div>
          </form>
          <div className="xl:sticky xl:top-0 min-w-0 xl:w-[540px] xl:shrink-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Live preview — updates as you type</p>
            <InvoicePreview inv={draft} company={company} by={empName.get(currentUser.id) || currentUser.name || ''} />
          </div>
          </div>
        )}
      </Modal>

      {/* ---------- company details */}
      <Modal isOpen={Boolean(companyForm)} onClose={() => setCompanyForm(null)} title="Company details" subtitle="Printed on every invoice" maxWidth="2xl">
        {companyForm && (
          <form onSubmit={saveCompany} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Company name *"><input className={inputCls} value={companyForm.name} onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })} required maxLength={160} /></Field>
              <Field label="NTN"><input className={inputCls} value={companyForm.ntn} onChange={(e) => setCompanyForm({ ...companyForm, ntn: e.target.value })} maxLength={60} /></Field>
              <Field label="Cheque in favour of"><input className={inputCls} value={companyForm.payTo} onChange={(e) => setCompanyForm({ ...companyForm, payTo: e.target.value })} maxLength={160} /></Field>
              <Field label="Phone"><input className={inputCls} value={companyForm.phone} onChange={(e) => setCompanyForm({ ...companyForm, phone: e.target.value })} maxLength={80} /></Field>
              <Field label="Email"><input className={inputCls} value={companyForm.email} onChange={(e) => setCompanyForm({ ...companyForm, email: e.target.value })} maxLength={120} /></Field>
              <Field label="Website"><input className={inputCls} value={companyForm.website} onChange={(e) => setCompanyForm({ ...companyForm, website: e.target.value })} maxLength={120} /></Field>
            </div>
            <Field label="Address"><input className={inputCls} value={companyForm.address} onChange={(e) => setCompanyForm({ ...companyForm, address: e.target.value })} maxLength={400} /></Field>
            <Field label="Bank details (optional)" hint="Shown under the cheque line, e.g. bank, account title, IBAN."><textarea className={inputCls} rows={3} value={companyForm.bankDetails} onChange={(e) => setCompanyForm({ ...companyForm, bankDetails: e.target.value })} maxLength={600} /></Field>
            <Field label="Terms (optional)"><textarea className={inputCls} rows={2} value={companyForm.terms} onChange={(e) => setCompanyForm({ ...companyForm, terms: e.target.value })} maxLength={1200} /></Field>
            <Field label="Closing line"><input className={inputCls} value={companyForm.footer} onChange={(e) => setCompanyForm({ ...companyForm, footer: e.target.value })} maxLength={200} /></Field>
            {error && <ErrorNote message={error} />}
            <div className="flex justify-end gap-2">
              <button type="button" className={btnGhost} onClick={() => setCompanyForm(null)}>Cancel</button>
              <button type="submit" className={btnPrimary} disabled={busy}>Save</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};
