import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Eye, Pencil, ShoppingBag, X, Check, Plane, Building2, Stamp, Bus, ShieldCheck, Package, CreditCard, Search, Columns3 } from 'lucide-react';
import { Employee } from '../types';
import { Modal } from '../components/common/Modal';
import { CrmPurchase, CrmPurchaseItem, PurchaseCategory, PurchaseCustomField, crmCall } from './crmApi';
import { CrmState } from './useCrm';
import { ErrorNote, Field, Pill, StatBar, btnDanger, btnGhost, btnPrimary, cardCls, inputCls } from './ui';
import { allCurrencies, currencyLabel, fmtAmount } from './currencies';

interface Props {
  crm: CrmState;
  employees: Employee[];
  currentUser: Employee;
}

interface FormItem {
  id: string;
  category: PurchaseCategory;
  vendorName: string;
  payable: string;
  receivable: string;
  currency: string;
  paymentDueDate: string;
  paidByMethod: 'unpaid' | 'card' | 'cash' | 'bank_transfer' | 'other';
  cardOption: 'faiq_card' | 'ali_card' | 'third_party' | 'other' | '';
  cardBank: string;
  paidBySpecify: string;
  // Ticket
  ticketNumber: string;
  // Hotel
  hotelName: string;
  rooms: string;
  checkInDate: string;
  checkOutDate: string;
  // Visa
  countries: string;
  visaType: string;
  // Tours & Transfers
  tourDescription: string;
  tourDate: string;
  persons: string;
  // Insurance
  insuranceType: string;
  insuranceDays: string;
  // Other
  description: string;
  // Live custom fields
  customValues: Record<string, string>;
}

interface PurchaseFormState {
  id?: string;
  purchaseNo?: string;
  customerName: string;
  careOf: string;
  crmId: string;
  purchaseDate: string;
  currency: string;
  items: FormItem[];
  notes: string;
}

const today = () => new Date().toLocaleDateString('en-CA');
const uid = () => `pi_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;

const CATEGORY_META: Record<PurchaseCategory, { label: string; badgeTone: 'blue' | 'violet' | 'green' | 'amber' | 'slate'; Icon: React.FC<{ className?: string }> }> = {
  ticket: { label: 'Ticket Purchase', badgeTone: 'blue', Icon: Plane },
  hotel: { label: 'Hotel Purchase', badgeTone: 'violet', Icon: Building2 },
  visa: { label: 'Visa Purchase', badgeTone: 'green', Icon: Stamp },
  tour: { label: 'Tours & Transfers', badgeTone: 'amber', Icon: Bus },
  insurance: { label: 'Insurance', badgeTone: 'slate', Icon: ShieldCheck },
  other: { label: 'Other Service', badgeTone: 'slate', Icon: Package },
};

const blankItem = (category: PurchaseCategory, currency = 'PKR'): FormItem => ({
  id: uid(),
  category,
  vendorName: '',
  payable: '',
  receivable: '',
  currency,
  paymentDueDate: '',
  paidByMethod: 'unpaid',
  cardOption: 'faiq_card',
  cardBank: '',
  paidBySpecify: '',
  ticketNumber: '',
  hotelName: '',
  rooms: '',
  checkInDate: '',
  checkOutDate: '',
  countries: '',
  visaType: '',
  tourDescription: '',
  tourDate: '',
  persons: '',
  insuranceType: '',
  insuranceDays: '',
  description: '',
  customValues: {},
});

const blankForm = (): PurchaseFormState => ({
  customerName: '',
  careOf: '',
  crmId: '',
  purchaseDate: today(),
  currency: 'PKR',
  items: [blankItem('ticket', 'PKR')],
  notes: '',
});

function toForm(p: CrmPurchase): PurchaseFormState {
  return {
    id: p.id,
    purchaseNo: p.purchaseNo,
    customerName: p.customerName,
    careOf: p.careOf || '',
    crmId: p.crmId || '',
    purchaseDate: p.purchaseDate || today(),
    currency: p.currency || 'PKR',
    notes: p.notes || '',
    items: (p.items || []).length
      ? p.items.map((it) => ({
          id: it.id || uid(),
          category: it.category || 'ticket',
          vendorName: it.vendorName || '',
          payable: it.payable !== null && it.payable !== undefined ? String(it.payable) : '',
          receivable: it.receivable !== null && it.receivable !== undefined ? String(it.receivable) : '',
          currency: it.currency || p.currency || 'PKR',
          paymentDueDate: it.paymentDueDate || '',
          paidByMethod: it.paidByMethod || 'unpaid',
          cardOption: it.cardOption || 'faiq_card',
          cardBank: it.cardBank || '',
          paidBySpecify: it.paidBySpecify || '',
          ticketNumber: it.ticketNumber || '',
          hotelName: it.hotelName || '',
          rooms: it.rooms || '',
          checkInDate: it.checkInDate || '',
          checkOutDate: it.checkOutDate || '',
          countries: it.countries || '',
          visaType: it.visaType || '',
          tourDescription: it.tourDescription || '',
          tourDate: it.tourDate || '',
          persons: it.persons !== null && it.persons !== undefined ? String(it.persons) : '',
          insuranceType: it.insuranceType || '',
          insuranceDays: it.insuranceDays !== null && it.insuranceDays !== undefined ? String(it.insuranceDays) : '',
          description: it.description || '',
          customValues: { ...(it.customValues || {}) },
        }))
      : [blankItem('ticket', p.currency || 'PKR')],
  };
}

export function formatPaidByLabel(it: Pick<CrmPurchaseItem, 'paidByMethod' | 'cardOption' | 'cardBank' | 'paidBySpecify'>): string {
  if (!it.paidByMethod || it.paidByMethod === 'unpaid') return 'Unpaid (Credit / Due)';
  if (it.paidByMethod === 'cash') return 'Paid by Cash';
  if (it.paidByMethod === 'bank_transfer') return `Bank Transfer${it.cardBank ? ` (${it.cardBank})` : ''}`;
  if (it.paidByMethod === 'other') return `Paid by: ${it.paidBySpecify || 'Other'}`;
  if (it.paidByMethod === 'card') {
    if (it.cardOption === 'faiq_card') return `Paid by Faiq Card${it.cardBank ? ` (${it.cardBank})` : ''}`;
    if (it.cardOption === 'ali_card') return `Paid by Ali's Card${it.cardBank ? ` (${it.cardBank})` : ''}`;
    if (it.cardOption === 'third_party') return `Paid by Third Party Card${it.paidBySpecify ? ` (${it.paidBySpecify})` : ''}`;
    if (it.cardOption === 'other') return `Paid by Card — ${it.paidBySpecify || 'Other'}`;
    return 'Paid by Card';
  }
  return 'Unpaid';
}

const niceDate = (iso?: string | null) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

export const PurchasesView: React.FC<Props> = ({ crm, employees, currentUser }) => {
  const isAdmin = currentUser.role === 'admin';
  const isStaff = isAdmin || currentUser.role === 'accounts';
  const seesAll = isStaff || currentUser.role === 'ceo';

  const purchases = crm.data.purchases || [];
  const customFields = crm.data.purchaseCustomFields || [];
  const customers = crm.data.customers || [];
  const empName = useMemo(() => new Map(employees.map((e) => [e.id, e.name])), [employees]);
  const currencies = useMemo(() => allCurrencies(), []);

  const [form, setForm] = useState<PurchaseFormState | null>(null);
  const [viewing, setViewing] = useState<CrmPurchase | null>(null);
  const [filter, setFilter] = useState<'all' | 'unpaid' | 'paid' | 'partial'>('all');
  const [catFilter, setCatFilter] = useState<'all' | PurchaseCategory>('all');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Live Custom Column Manager (Admin & Accounts)
  const [newColLabel, setNewColLabel] = useState('');
  const [newColCategory, setNewColCategory] = useState<PurchaseCategory | 'all'>('all');
  const [colBusy, setColBusy] = useState(false);
  const [colNotice, setColNotice] = useState('');
  const [colError, setColError] = useState('');

  useEffect(() => {
    void crm.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => ({
    unpaid: purchases.filter((p) => p.status === 'unpaid').length,
    partial: purchases.filter((p) => p.status === 'partial').length,
    paid: purchases.filter((p) => p.status === 'paid').length,
  }), [purchases]);

  const totalsByCurrency = useMemo(() => {
    const payMap = new Map<string, number>();
    const recMap = new Map<string, number>();
    purchases.forEach((p) => {
      (p.items || []).forEach((it) => {
        const cur = it.currency || p.currency || 'PKR';
        payMap.set(cur, (payMap.get(cur) || 0) + (Number(it.payable) || 0));
        if (it.receivable !== null && it.receivable !== undefined) {
          recMap.set(cur, (recMap.get(cur) || 0) + (Number(it.receivable) || 0));
        }
      });
    });
    return { payables: [...payMap.entries()], receivables: [...recMap.entries()] };
  }, [purchases]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return purchases.filter((p) => {
      if (filter !== 'all' && p.status !== filter) return false;
      if (catFilter !== 'all' && !(p.items || []).some((it) => it.category === catFilter)) return false;
      if (!q) return true;
      const itemText = (p.items || [])
        .flatMap((it) => [
          it.vendorName,
          it.ticketNumber || '',
          it.hotelName || '',
          it.countries || '',
          it.visaType || '',
          it.tourDescription || '',
          it.insuranceType || '',
          it.description || '',
          formatPaidByLabel(it),
          ...Object.values(it.customValues || {}),
        ])
        .join(' ');
      const hay = [
        p.purchaseNo,
        p.customerName,
        p.careOf || '',
        p.crmId || '',
        empName.get(p.createdBy) || '',
        p.notes || '',
        itemText,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [purchases, filter, catFilter, query, empName]);

  const handleAddCustomColumn = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = newColLabel.trim();
    if (!trimmed || colBusy) return;
    setColBusy(true);
    setColError('');
    setColNotice('');
    try {
      await crmCall('purchase_field_add', { label: trimmed, category: newColCategory });
      setNewColLabel('');
      await crm.refresh();
      setColNotice(`Added column "${trimmed}" live to ${newColCategory === 'all' ? 'all purchase categories' : CATEGORY_META[newColCategory].label}.`);
      window.setTimeout(() => setColNotice(''), 3500);
    } catch (err: any) {
      setColError(err?.message || 'Could not add custom column.');
    } finally {
      setColBusy(false);
    }
  };

  const handleRemoveCustomColumn = async (field: PurchaseCustomField) => {
    if (!window.confirm(`Remove custom column "${field.label}"?`)) return;
    setColBusy(true);
    setColError('');
    try {
      await crmCall('purchase_field_remove', { fieldId: field.id });
      await crm.refresh();
    } catch (err: any) {
      setColError(err?.message || 'Could not remove custom column.');
    } finally {
      setColBusy(false);
    }
  };

  const patchForm = (p: Partial<PurchaseFormState>) => {
    setForm((cur) => (cur ? { ...cur, ...p } : cur));
    setError('');
  };

  const patchItem = (idx: number, p: Partial<FormItem>) => {
    setForm((cur) => {
      if (!cur) return cur;
      return {
        ...cur,
        items: cur.items.map((it, i) => (i === idx ? { ...it, ...p } : it)),
      };
    });
    setError('');
  };

  const patchItemCustom = (idx: number, label: string, val: string) => {
    setForm((cur) => {
      if (!cur) return cur;
      return {
        ...cur,
        items: cur.items.map((it, i) =>
          i === idx ? { ...it, customValues: { ...it.customValues, [label]: val } } : it
        ),
      };
    });
  };

  const addCategoryItem = (cat: PurchaseCategory) => {
    if (!form) return;
    patchForm({ items: [...form.items, blankItem(cat, form.currency)] });
  };

  const removeItem = (idx: number) => {
    if (!form || form.items.length <= 1) return;
    patchForm({ items: form.items.filter((_, i) => i !== idx) });
  };

  const savePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || busy) return;
    setBusy(true);
    setError('');
    try {
      await crmCall('purchase_save', { purchase: form });
      await crm.refresh();
      setForm(null);
    } catch (err: any) {
      setError(err?.message || 'Could not save the vendor purchase.');
    } finally {
      setBusy(false);
    }
  };

  const updateStatus = async (id: string, status: 'unpaid' | 'paid' | 'partial') => {
    try {
      await crmCall('purchase_status', { id, status });
      await crm.refresh();
    } catch (err: any) {
      setError(err?.message || 'Could not update status.');
    }
  };

  const deletePurchase = async (p: CrmPurchase) => {
    if (!window.confirm(`Delete vendor purchase ${p.purchaseNo} permanently?`)) return;
    try {
      await crmCall('purchase_delete', { id: p.id });
      if (viewing?.id === p.id) setViewing(null);
      await crm.refresh();
    } catch (err: any) {
      setError(err?.message || 'Could not delete purchase.');
    }
  };

  const formTotals = useMemo(() => {
    if (!form) return { payable: 0, receivable: 0 };
    let payable = 0;
    let receivable = 0;
    form.items.forEach((it) => {
      const p = Number(it.payable);
      const r = Number(it.receivable);
      if (Number.isFinite(p) && p > 0) payable += p;
      if (it.receivable.trim() !== '' && Number.isFinite(r) && r > 0) receivable += r;
    });
    return { payable: Math.round(payable * 100) / 100, receivable: Math.round(receivable * 100) / 100 };
  }, [form]);

  const fieldsForCategory = (cat: PurchaseCategory) =>
    customFields.filter((f) => f.category === 'all' || f.category === cat);

  return (
    <div className="space-y-4">
      {/* Top Header */}
      <div className={`${cardCls} p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3`}>
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2">
            <ShoppingBag className="w-4 h-4 text-blue-600" />
            <span>Purchases · Vendor Bookings &amp; Payables</span>
          </h2>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Record vendor purchases for Tickets, Hotels, Visas, Tours &amp; Transfers, and Insurance with required vendor details, payable/receivable amounts, and Paid By tracking.
          </p>
        </div>
        <button className={btnPrimary} onClick={() => { setForm(blankForm()); setError(''); }}>
          <Plus className="w-4 h-4" /> + Add Vendor Purchase
        </button>
      </div>

      {/* Live Custom Column Manager Bar (Admin & Accounts) */}
      {isStaff && (
        <div className={`${cardCls} p-4 space-y-3 border-blue-200 dark:border-blue-900/60`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 inline-flex items-center gap-1.5">
                <Columns3 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>Live Custom Entry Columns (Admin &amp; Accounts)</span>
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Add any new entry field/column to all purchase categories or a specific category — it updates live in the database for all employees.
              </p>
            </div>
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live · {customFields.length} custom {customFields.length === 1 ? 'column' : 'columns'}
            </span>
          </div>

          <form onSubmit={handleAddCustomColumn} className="grid grid-cols-1 sm:grid-cols-12 gap-2">
            <div className="sm:col-span-4">
              <select
                className={inputCls}
                value={newColCategory}
                onChange={(e) => setNewColCategory(e.target.value as PurchaseCategory | 'all')}
                disabled={colBusy}
                aria-label="Category for new column"
              >
                <option value="all">All Categories (Every Purchase Item)</option>
                <option value="ticket">Ticket Purchase Only</option>
                <option value="hotel">Hotel Purchase Only</option>
                <option value="visa">Visa Purchase Only</option>
                <option value="tour">Tours &amp; Transfers Only</option>
                <option value="insurance">Insurance Only</option>
                <option value="other">Other Service Only</option>
              </select>
            </div>
            <div className="sm:col-span-5">
              <input
                className={inputCls}
                value={newColLabel}
                onChange={(e) => setNewColLabel(e.target.value)}
                placeholder="Type new column name (e.g. PNR Code, Airline, Passport No, Room Board)…"
                maxLength={80}
                disabled={colBusy}
              />
            </div>
            <div className="sm:col-span-3">
              <button type="submit" className={`${btnPrimary} w-full`} disabled={colBusy || !newColLabel.trim()}>
                <Plus className="w-3.5 h-3.5" />
                <span>{colBusy ? 'Adding…' : 'Add column live'}</span>
              </button>
            </div>
          </form>

          {colNotice && (
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <Check className="w-3.5 h-3.5" /> {colNotice}
            </p>
          )}
          <ErrorNote message={colError} />

          {customFields.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {customFields.map((f) => (
                <span
                  key={f.id}
                  className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700"
                >
                  <span className="text-[10px] uppercase font-bold text-blue-600 dark:text-blue-400">
                    [{f.category === 'all' ? 'All' : CATEGORY_META[f.category]?.label || f.category}]
                  </span>
                  <span>{f.label}</span>
                  <button
                    type="button"
                    disabled={colBusy}
                    onClick={() => void handleRemoveCustomColumn(f)}
                    className="p-0.5 rounded-full text-slate-400 hover:text-red-600 cursor-pointer"
                    title={`Remove ${f.label}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Status Bar + Payable / Receivable Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <StatBar
          title={`${seesAll ? 'All' : 'Your'} Vendor Purchases`}
          segments={[
            { label: 'Unpaid', count: counts.unpaid, tone: 'amber' },
            { label: 'Partial', count: counts.partial, tone: 'violet' },
            { label: 'Paid', count: counts.paid, tone: 'green' },
          ]}
        />
        <div className={`${cardCls} p-4 flex flex-col justify-between gap-2 text-xs`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-slate-600 dark:text-slate-300">Total Vendor Payables:</span>
            <div className="flex flex-wrap gap-3">
              {totalsByCurrency.payables.length > 0 ? (
                totalsByCurrency.payables.map(([c, v]) => (
                  <span key={c} className="font-mono font-bold text-amber-600 dark:text-amber-400">{c} {fmtAmount(v)}</span>
                ))
              ) : (
                <span className="font-mono text-slate-400">PKR 0</span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <span className="font-semibold text-slate-600 dark:text-slate-300">Total Customer Receivables (Optional):</span>
            <div className="flex flex-wrap gap-3">
              {totalsByCurrency.receivables.length > 0 ? (
                totalsByCurrency.receivables.map(([c, v]) => (
                  <span key={c} className="font-mono font-bold text-blue-600 dark:text-blue-400">{c} {fmtAmount(v)}</span>
                ))
              ) : (
                <span className="font-mono text-slate-400">PKR 0</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Filters & Search */}
      <div className={`${cardCls} p-4 flex flex-col lg:flex-row gap-3 lg:items-center justify-between`}>
        <div className="flex flex-wrap items-center gap-1.5">
          {([['all', 'All'], ['unpaid', 'Unpaid'], ['partial', 'Partial'], ['paid', 'Paid']] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border cursor-pointer ${
                filter === id ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
          <span className="mx-1 text-slate-300 dark:text-slate-700">|</span>
          {(['all', 'ticket', 'hotel', 'visa', 'tour', 'insurance'] as const).map((cat) => (
            <button
              key={cat}
              onClick={() => setCatFilter(cat)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border cursor-pointer ${
                catFilter === cat ? 'bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 border-slate-800' : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              {cat === 'all' ? 'All Products' : CATEGORY_META[cat].label}
            </button>
          ))}
        </div>
        <div className="relative w-full lg:max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            className={`${inputCls} pl-8`}
            placeholder="Search customer, C/O, CRM ID, vendor, ticket…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {error && !form && <ErrorNote message={error} />}

      {/* Purchases List */}
      {shown.length === 0 ? (
        <div className={`${cardCls} p-8 text-center text-xs text-slate-500`}>
          {purchases.length === 0
            ? 'No vendor purchases recorded yet. Click “+ Add Vendor Purchase” to add your first Ticket, Hotel, Visa, Tour, or Insurance purchase.'
            : 'No vendor purchases match your current filter.'}
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map((p) => {
            const canEdit = isStaff || p.createdBy === currentUser.id;
            const statusTone = p.status === 'paid' ? 'green' : p.status === 'partial' ? 'violet' : 'amber';
            const statusLabel = p.status === 'paid' ? 'Paid' : p.status === 'partial' ? 'Partially Paid' : 'Unpaid';

            return (
              <div key={p.id} className={`${cardCls} p-4 space-y-3`}>
                {/* Card Header: Purchase No -> CRM ID / Query Code -> Customer Name -> C/O */}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                        {p.purchaseNo}
                      </span>
                      <Pill tone="blue">CRM / Query: {p.crmId || '—'}</Pill>
                      <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{p.customerName}</span>
                      {p.careOf && <Pill tone="slate">C/O: {p.careOf}</Pill>}
                      <Pill tone={statusTone}>{statusLabel}</Pill>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Date: {niceDate(p.purchaseDate)} · Recorded by <b className="text-slate-700 dark:text-slate-200">{empName.get(p.createdBy) || 'Staff'}</b> · {(p.items || []).length} product {(p.items || []).length === 1 ? 'item' : 'items'}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 shrink-0">
                    <div className="px-3 py-1.5 rounded-lg bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-xs">
                      <span className="text-slate-500 mr-1.5">Total Payable:</span>
                      <b className="font-mono text-amber-700 dark:text-amber-300">{p.currency} {fmtAmount(p.totalPayable)}</b>
                    </div>
                    {p.totalReceivable > 0 && (
                      <div className="px-3 py-1.5 rounded-lg bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 text-xs">
                        <span className="text-slate-500 mr-1.5">Total Receivable:</span>
                        <b className="font-mono text-blue-700 dark:text-blue-300">{p.currency} {fmtAmount(p.totalReceivable)}</b>
                      </div>
                    )}
                  </div>
                </div>

                {/* Product Items Breakdown Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {(p.items || []).map((it, idx) => {
                    const meta = CATEGORY_META[it.category] || CATEGORY_META.other;
                    const Icon = meta.Icon;
                    return (
                      <div key={it.id || idx} className="p-3 rounded-xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80 text-xs space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 font-bold text-slate-900 dark:text-slate-100">
                            <Icon className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                            <span>{meta.label}</span>
                          </span>
                          <Pill tone={it.paidByMethod === 'unpaid' ? 'amber' : 'green'}>
                            <CreditCard className="w-2.5 h-2.5 mr-1" />
                            {formatPaidByLabel(it)}
                          </Pill>
                        </div>

                        <div className="text-[11px] text-slate-700 dark:text-slate-200 space-y-0.5">
                          <p>
                            <span className="text-slate-500">Vendor / Issued By:</span>{' '}
                            <b className="text-amber-700 dark:text-amber-300">{it.vendorName}</b>
                          </p>
                          {it.category === 'ticket' && it.ticketNumber && (
                            <p><span className="text-slate-500">Ticket Number:</span> <b className="font-mono">{it.ticketNumber}</b></p>
                          )}
                          {it.category === 'hotel' && (
                            <p>
                              <span className="text-slate-500">Hotel:</span> <b>{it.hotelName}</b>
                              {it.rooms ? ` · Rooms: ${it.rooms}` : ''}
                              {it.checkInDate ? ` · Check-in: ${niceDate(it.checkInDate)}` : ''}
                              {it.checkOutDate ? ` → Check-out: ${niceDate(it.checkOutDate)}` : ''}
                            </p>
                          )}
                          {it.category === 'visa' && (
                            <p>
                              <span className="text-slate-500">Countries:</span> <b>{it.countries}</b>
                              {it.visaType ? ` · Visa Type: ${it.visaType}` : ''}
                            </p>
                          )}
                          {it.category === 'tour' && (
                            <p>
                              <span className="text-slate-500">Tour:</span> <b>{it.tourDescription}</b>
                              {it.tourDate ? ` · Date: ${niceDate(it.tourDate)}` : ''}
                              {it.persons ? ` · Persons: ${it.persons}` : ''}
                            </p>
                          )}
                          {it.category === 'insurance' && (
                            <p>
                              <span className="text-slate-500">Insurance Type:</span> <b>{it.insuranceType}</b>
                              {it.insuranceDays ? ` · Days: ${it.insuranceDays}` : ''}
                            </p>
                          )}
                          {it.category === 'other' && it.description && (
                            <p><span className="text-slate-500">Description:</span> <b>{it.description}</b></p>
                          )}
                          {it.paymentDueDate && (
                            <p><span className="text-slate-500">Payment Due Date:</span> <b>{niceDate(it.paymentDueDate)}</b></p>
                          )}
                          {it.customValues && Object.entries(it.customValues).map(([k, v]) => (
                            <p key={k}><span className="text-slate-500">{k}:</span> <b>{v}</b></p>
                          ))}
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-200/70 dark:border-slate-700/70 text-[11px]">
                          <span>
                            Payable: <b className="font-mono text-amber-700 dark:text-amber-300">{it.currency || p.currency} {fmtAmount(it.payable)}</b>
                          </span>
                          {it.receivable !== null && it.receivable !== undefined && (
                            <span>
                              Receivable: <b className="font-mono text-blue-700 dark:text-blue-300">{it.currency || p.currency} {fmtAmount(it.receivable)}</b>
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Action Bar */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <button className={btnGhost} onClick={() => setViewing(p)}><Eye className="w-3.5 h-3.5" /> View Details</button>
                  {canEdit && <button className={btnGhost} onClick={() => { setForm(toForm(p)); setError(''); }}><Pencil className="w-3.5 h-3.5" /> Edit</button>}
                  {isStaff && p.status !== 'paid' && <button className={btnGhost} onClick={() => void updateStatus(p.id, 'paid')}>Mark Paid</button>}
                  {isStaff && p.status === 'paid' && <button className={btnGhost} onClick={() => void updateStatus(p.id, 'unpaid')}>Mark Unpaid</button>}
                  {isAdmin && <button className={btnDanger} onClick={() => void deletePurchase(p)}><Trash2 className="w-3.5 h-3.5" /></button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ---------- Detailed View Modal ---------- */}
      <Modal
        isOpen={Boolean(viewing)}
        onClose={() => setViewing(null)}
        title={viewing ? `Vendor Purchase ${viewing.purchaseNo}` : 'Vendor Purchase'}
        subtitle={viewing ? `Customer: ${viewing.customerName}${viewing.careOf ? ` · C/O: ${viewing.careOf}` : ''}${viewing.crmId ? ` · CRM/Query: ${viewing.crmId}` : ''}` : undefined}
        maxWidth="4xl"
      >
        {viewing && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
              <div>
                <span className="text-[10px] text-slate-400 block uppercase font-bold">Customer</span>
                <span className="font-bold text-slate-900 dark:text-slate-100">{viewing.customerName}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block uppercase font-bold">C/O</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">{viewing.careOf || '—'}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block uppercase font-bold">Query Code / CRM ID</span>
                <span className="font-mono font-bold text-blue-700 dark:text-blue-300">{viewing.crmId || '—'}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block uppercase font-bold">Total Payable / Receivable</span>
                <span className="font-mono font-bold text-amber-700 dark:text-amber-300">{viewing.currency} {fmtAmount(viewing.totalPayable)}</span>
                {viewing.totalReceivable > 0 && (
                  <span className="block font-mono text-blue-700 dark:text-blue-300">Rec: {viewing.currency} {fmtAmount(viewing.totalReceivable)}</span>
                )}
              </div>
            </div>

            <div className="space-y-2.5">
              {(viewing.items || []).map((it, idx) => {
                const meta = CATEGORY_META[it.category] || CATEGORY_META.other;
                return (
                  <div key={it.id || idx} className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                        #{idx + 1} · {meta.label} — <span className="text-amber-700 dark:text-amber-300">{it.vendorName}</span>
                      </span>
                      <Pill tone={it.paidByMethod === 'unpaid' ? 'amber' : 'green'}>{formatPaidByLabel(it)}</Pill>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-slate-700 dark:text-slate-300">
                      {it.ticketNumber && <div><span className="text-slate-400">Ticket Number:</span> <b className="font-mono">{it.ticketNumber}</b></div>}
                      {it.hotelName && <div><span className="text-slate-400">Hotel Name:</span> <b>{it.hotelName}</b></div>}
                      {it.rooms && <div><span className="text-slate-400">Rooms:</span> <b>{it.rooms}</b></div>}
                      {it.checkInDate && <div><span className="text-slate-400">Check In:</span> <b>{niceDate(it.checkInDate)}</b></div>}
                      {it.checkOutDate && <div><span className="text-slate-400">Check Out:</span> <b>{niceDate(it.checkOutDate)}</b></div>}
                      {it.countries && <div><span className="text-slate-400">Countries:</span> <b>{it.countries}</b></div>}
                      {it.visaType && <div><span className="text-slate-400">Visa Type:</span> <b>{it.visaType}</b></div>}
                      {it.tourDescription && <div className="sm:col-span-2"><span className="text-slate-400">Tour Description:</span> <b>{it.tourDescription}</b></div>}
                      {it.tourDate && <div><span className="text-slate-400">Tour Date:</span> <b>{niceDate(it.tourDate)}</b></div>}
                      {it.persons !== null && it.persons !== undefined && <div><span className="text-slate-400">Persons:</span> <b>{it.persons}</b></div>}
                      {it.insuranceType && <div><span className="text-slate-400">Insurance Type:</span> <b>{it.insuranceType}</b></div>}
                      {it.insuranceDays !== null && it.insuranceDays !== undefined && <div><span className="text-slate-400">Days:</span> <b>{it.insuranceDays}</b></div>}
                      {it.description && <div className="sm:col-span-2"><span className="text-slate-400">Description:</span> <b>{it.description}</b></div>}
                      {it.paymentDueDate && <div><span className="text-slate-400">Payment Due Date:</span> <b>{niceDate(it.paymentDueDate)}</b></div>}
                      <div><span className="text-slate-400">Payable:</span> <b className="font-mono text-amber-700 dark:text-amber-300">{it.currency} {fmtAmount(it.payable)}</b></div>
                      {it.receivable !== null && it.receivable !== undefined && (
                        <div><span className="text-slate-400">Receivable:</span> <b className="font-mono text-blue-700 dark:text-blue-300">{it.currency} {fmtAmount(it.receivable)}</b></div>
                      )}
                      {it.customValues && Object.entries(it.customValues).map(([k, v]) => (
                        <div key={k}><span className="text-slate-400">{k}:</span> <b>{v}</b></div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {viewing.notes && (
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Notes</span>
                <p className="whitespace-pre-wrap break-words">{viewing.notes}</p>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ---------- Add / Edit Vendor Purchase Modal ---------- */}
      <Modal
        isOpen={Boolean(form)}
        onClose={() => setForm(null)}
        title={form?.id ? `Edit Vendor Purchase ${form.purchaseNo || ''}` : 'New Vendor Purchase (+Add Vendor)'}
        subtitle="Fill in Customer, C/O, and Query Code / CRM ID, then add one or multiple vendor product purchases below."
        maxWidth="5xl"
      >
        {form && (
          <form onSubmit={savePurchase} className="space-y-5">
            {/* 1. Primary Customer, C/O & Query Code / CRM ID Header */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
              <div className="md:col-span-2">
                <Field label="1. Customer *">
                  <input
                    className={inputCls}
                    list="crm-purchase-customers"
                    value={form.customerName}
                    onChange={(e) => patchForm({ customerName: e.target.value })}
                    placeholder="Type or select customer name…"
                    maxLength={160}
                    required
                  />
                  <datalist id="crm-purchase-customers">
                    {customers.map((c) => (
                      <option key={c.id} value={c.customerName}>{c.companyName}</option>
                    ))}
                  </datalist>
                </Field>
              </div>
              <div>
                <Field label="2. C/O (Care Of / Reference)">
                  <input
                    className={inputCls}
                    value={form.careOf}
                    onChange={(e) => patchForm({ careOf: e.target.value })}
                    placeholder="e.g. Asad Ali / Direct"
                    maxLength={160}
                  />
                </Field>
              </div>
              <div>
                <Field label="3. Query Code / CRM ID">
                  <input
                    className={inputCls}
                    value={form.crmId}
                    onChange={(e) => patchForm({ crmId: e.target.value })}
                    placeholder="e.g. 17562336"
                    maxLength={80}
                  />
                </Field>
              </div>
              <div>
                <Field label="Default Currency">
                  <select
                    className={inputCls}
                    value={form.currency}
                    onChange={(e) => {
                      const nextCur = e.target.value;
                      patchForm({
                        currency: nextCur,
                        items: form.items.map((it) => (it.currency === form.currency ? { ...it, currency: nextCur } : it)),
                      });
                    }}
                  >
                    {currencies.map((c) => <option key={c.code} value={c.code}>{currencyLabel(c)}</option>)}
                  </select>
                </Field>
              </div>
            </div>

            {/* 2. Add Multiple Product Buttons (+ Ticket, + Hotel, + Visa, + Tours & Transfers, + Insurance) */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/60">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-bold text-blue-900 dark:text-blue-200 mr-1">Add Product / Vendor Entry:</span>
                {(['ticket', 'hotel', 'visa', 'tour', 'insurance', 'other'] as const).map((cat) => {
                  const meta = CATEGORY_META[cat];
                  const Icon = meta.Icon;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => addCategoryItem(cat)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800 hover:bg-blue-600 hover:text-white transition-all cursor-pointer shadow-2xs"
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>+ {meta.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Live Admin Quick-Add Custom Column inside the Modal */}
            {isStaff && (
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-dashed border-slate-300 dark:border-slate-700 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 shrink-0 inline-flex items-center gap-1">
                  <Columns3 className="w-3.5 h-3.5 text-blue-600" /> Live Add Column:
                </span>
                <select
                  className={`${inputCls} sm:!w-44`}
                  value={newColCategory}
                  onChange={(e) => setNewColCategory(e.target.value as PurchaseCategory | 'all')}
                >
                  <option value="all">All Categories</option>
                  <option value="ticket">Ticket Purchase</option>
                  <option value="hotel">Hotel Purchase</option>
                  <option value="visa">Visa Purchase</option>
                  <option value="tour">Tours &amp; Transfers</option>
                  <option value="insurance">Insurance</option>
                  <option value="other">Other</option>
                </select>
                <input
                  className={`${inputCls} flex-1`}
                  value={newColLabel}
                  onChange={(e) => setNewColLabel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleAddCustomColumn(); } }}
                  placeholder="Type new column name to add live right now…"
                  maxLength={80}
                />
                <button
                  type="button"
                  onClick={() => void handleAddCustomColumn()}
                  disabled={colBusy || !newColLabel.trim()}
                  className={btnGhost}
                >
                  <Plus className="w-3.5 h-3.5" /> Add Field Live
                </button>
              </div>
            )}

            {/* 3. Product Item Forms */}
            <div className="space-y-4">
              {form.items.map((it, idx) => {
                const meta = CATEGORY_META[it.category];
                const Icon = meta.Icon;
                const extraFields = fieldsForCategory(it.category);

                return (
                  <div key={it.id} className="p-4 rounded-xl border-2 border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3 shadow-2xs">
                    {/* Item Header */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold">
                          {idx + 1}
                        </span>
                        <Icon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        <span className="text-xs font-bold text-slate-900 dark:text-slate-100">{meta.label}</span>
                        <select
                          className={`${inputCls} !w-auto !py-1 text-[11px] font-semibold`}
                          value={it.category}
                          onChange={(e) => patchItem(idx, { category: e.target.value as PurchaseCategory })}
                          aria-label="Change product category"
                        >
                          <option value="ticket">Ticket Purchase</option>
                          <option value="hotel">Hotel Purchase</option>
                          <option value="visa">Visa Purchase</option>
                          <option value="tour">Tours &amp; Transfers</option>
                          <option value="insurance">Insurance</option>
                          <option value="other">Other Service</option>
                        </select>
                      </div>
                      {form.items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeItem(idx)}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Remove
                        </button>
                      )}
                    </div>

                    {/* Category-Specific Fields */}
                    {it.category === 'ticket' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
                        <Field label="Ticket Number *">
                          <input className={inputCls} value={it.ticketNumber} onChange={(e) => patchItem(idx, { ticketNumber: e.target.value })} placeholder="e.g. 214-4829104921" required />
                        </Field>
                        <Field label="Issued From / Vendor *">
                          <input className={inputCls} value={it.vendorName} onChange={(e) => patchItem(idx, { vendorName: e.target.value })} placeholder="e.g. MEEZAB AIR" required />
                        </Field>
                        <Field label={`Payable Price (${it.currency}) *`}>
                          <input className={inputCls} type="number" inputMode="decimal" step="0.01" min="0" value={it.payable} onChange={(e) => patchItem(idx, { payable: e.target.value })} placeholder="0.00" required />
                        </Field>
                        <Field label={`Receivable (${it.currency}) (optional)`}>
                          <input className={inputCls} type="number" inputMode="decimal" step="0.01" min="0" value={it.receivable} onChange={(e) => patchItem(idx, { receivable: e.target.value })} placeholder="Optional" />
                        </Field>
                        <Field label="Payment Due Date">
                          <input className={inputCls} type="date" value={it.paymentDueDate} onChange={(e) => patchItem(idx, { paymentDueDate: e.target.value })} />
                        </Field>
                      </div>
                    )}

                    {it.category === 'hotel' && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                          <Field label="Hotel Name *">
                            <input className={inputCls} value={it.hotelName} onChange={(e) => patchItem(idx, { hotelName: e.target.value })} placeholder="e.g. Pullman Zamzam" required />
                          </Field>
                          <Field label="Rooms">
                            <input className={inputCls} value={it.rooms} onChange={(e) => patchItem(idx, { rooms: e.target.value })} placeholder="e.g. 2 Double / 1 Quad" />
                          </Field>
                          <Field label="Check In Date">
                            <input className={inputCls} type="date" value={it.checkInDate} onChange={(e) => patchItem(idx, { checkInDate: e.target.value })} />
                          </Field>
                          <Field label="Check Out Date">
                            <input className={inputCls} type="date" value={it.checkOutDate} onChange={(e) => patchItem(idx, { checkOutDate: e.target.value })} />
                          </Field>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                          <Field label="Vendor / Issued By *">
                            <input className={inputCls} value={it.vendorName} onChange={(e) => patchItem(idx, { vendorName: e.target.value })} placeholder="Vendor name" required />
                          </Field>
                          <Field label={`Payable (${it.currency}) *`}>
                            <input className={inputCls} type="number" inputMode="decimal" step="0.01" min="0" value={it.payable} onChange={(e) => patchItem(idx, { payable: e.target.value })} placeholder="0.00" required />
                          </Field>
                          <Field label={`Receivable (${it.currency}) (optional)`}>
                            <input className={inputCls} type="number" inputMode="decimal" step="0.01" min="0" value={it.receivable} onChange={(e) => patchItem(idx, { receivable: e.target.value })} placeholder="Optional" />
                          </Field>
                          <Field label="Payment Due Date">
                            <input className={inputCls} type="date" value={it.paymentDueDate} onChange={(e) => patchItem(idx, { paymentDueDate: e.target.value })} />
                          </Field>
                        </div>
                      </div>
                    )}

                    {it.category === 'visa' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-3">
                        <Field label="Countries *">
                          <input className={inputCls} value={it.countries} onChange={(e) => patchItem(idx, { countries: e.target.value })} placeholder="e.g. Turkey, UAE" required />
                        </Field>
                        <Field label="Visa Type *">
                          <input className={inputCls} value={it.visaType} onChange={(e) => patchItem(idx, { visaType: e.target.value })} placeholder="e.g. Tourist / E-Visa / Sticker" required />
                        </Field>
                        <Field label="Vendor *">
                          <input className={inputCls} value={it.vendorName} onChange={(e) => patchItem(idx, { vendorName: e.target.value })} placeholder="Vendor name" required />
                        </Field>
                        <Field label={`Payable (${it.currency}) *`}>
                          <input className={inputCls} type="number" inputMode="decimal" step="0.01" min="0" value={it.payable} onChange={(e) => patchItem(idx, { payable: e.target.value })} placeholder="0.00" required />
                        </Field>
                        <Field label={`Receivable (${it.currency}) (opt.)`}>
                          <input className={inputCls} type="number" inputMode="decimal" step="0.01" min="0" value={it.receivable} onChange={(e) => patchItem(idx, { receivable: e.target.value })} placeholder="Optional" />
                        </Field>
                        <Field label="Payment Due Date">
                          <input className={inputCls} type="date" value={it.paymentDueDate} onChange={(e) => patchItem(idx, { paymentDueDate: e.target.value })} />
                        </Field>
                      </div>
                    )}

                    {it.category === 'tour' && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                          <div className="md:col-span-2">
                            <Field label="Description of Tour / Transfer *">
                              <input className={inputCls} value={it.tourDescription} onChange={(e) => patchItem(idx, { tourDescription: e.target.value })} placeholder="e.g. Airport Transfer + Full Day Baku City Tour" required />
                            </Field>
                          </div>
                          <Field label="Date">
                            <input className={inputCls} type="date" value={it.tourDate} onChange={(e) => patchItem(idx, { tourDate: e.target.value })} />
                          </Field>
                          <Field label="Number of Persons">
                            <input className={inputCls} type="number" min="1" value={it.persons} onChange={(e) => patchItem(idx, { persons: e.target.value })} placeholder="e.g. 4" />
                          </Field>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                          <Field label="Vendor / Issued By *">
                            <input className={inputCls} value={it.vendorName} onChange={(e) => patchItem(idx, { vendorName: e.target.value })} placeholder="Vendor name" required />
                          </Field>
                          <Field label={`Payable (${it.currency}) *`}>
                            <input className={inputCls} type="number" inputMode="decimal" step="0.01" min="0" value={it.payable} onChange={(e) => patchItem(idx, { payable: e.target.value })} placeholder="0.00" required />
                          </Field>
                          <Field label={`Receivable (${it.currency}) (optional)`}>
                            <input className={inputCls} type="number" inputMode="decimal" step="0.01" min="0" value={it.receivable} onChange={(e) => patchItem(idx, { receivable: e.target.value })} placeholder="Optional" />
                          </Field>
                          <Field label="Payment Due Date">
                            <input className={inputCls} type="date" value={it.paymentDueDate} onChange={(e) => patchItem(idx, { paymentDueDate: e.target.value })} />
                          </Field>
                        </div>
                      </div>
                    )}

                    {it.category === 'insurance' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-3">
                        <Field label="Insurance Type *">
                          <input className={inputCls} value={it.insuranceType} onChange={(e) => patchItem(idx, { insuranceType: e.target.value })} placeholder="e.g. Schengen / Worldwide" required />
                        </Field>
                        <Field label="Days">
                          <input className={inputCls} type="number" min="1" value={it.insuranceDays} onChange={(e) => patchItem(idx, { insuranceDays: e.target.value })} placeholder="e.g. 15" />
                        </Field>
                        <Field label="Vendor / Issued By *">
                          <input className={inputCls} value={it.vendorName} onChange={(e) => patchItem(idx, { vendorName: e.target.value })} placeholder="Vendor name" required />
                        </Field>
                        <Field label={`Payable (${it.currency}) *`}>
                          <input className={inputCls} type="number" inputMode="decimal" step="0.01" min="0" value={it.payable} onChange={(e) => patchItem(idx, { payable: e.target.value })} placeholder="0.00" required />
                        </Field>
                        <Field label={`Receivable (${it.currency}) (opt.)`}>
                          <input className={inputCls} type="number" inputMode="decimal" step="0.01" min="0" value={it.receivable} onChange={(e) => patchItem(idx, { receivable: e.target.value })} placeholder="Optional" />
                        </Field>
                        <Field label="Payment Due Date">
                          <input className={inputCls} type="date" value={it.paymentDueDate} onChange={(e) => patchItem(idx, { paymentDueDate: e.target.value })} />
                        </Field>
                      </div>
                    )}

                    {it.category === 'other' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
                        <Field label="Service Description *">
                          <input className={inputCls} value={it.description} onChange={(e) => patchItem(idx, { description: e.target.value })} placeholder="Describe service…" required />
                        </Field>
                        <Field label="Vendor / Issued By *">
                          <input className={inputCls} value={it.vendorName} onChange={(e) => patchItem(idx, { vendorName: e.target.value })} placeholder="Vendor name" required />
                        </Field>
                        <Field label={`Payable (${it.currency}) *`}>
                          <input className={inputCls} type="number" inputMode="decimal" step="0.01" min="0" value={it.payable} onChange={(e) => patchItem(idx, { payable: e.target.value })} placeholder="0.00" required />
                        </Field>
                        <Field label={`Receivable (${it.currency}) (optional)`}>
                          <input className={inputCls} type="number" inputMode="decimal" step="0.01" min="0" value={it.receivable} onChange={(e) => patchItem(idx, { receivable: e.target.value })} placeholder="Optional" />
                        </Field>
                        <Field label="Payment Due Date">
                          <input className={inputCls} type="date" value={it.paymentDueDate} onChange={(e) => patchItem(idx, { paymentDueDate: e.target.value })} />
                        </Field>
                      </div>
                    )}

                    {/* Dynamic Live Admin-Added Columns for this Category */}
                    {extraFields.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-dashed border-slate-200 dark:border-slate-800">
                        {extraFields.map((ef) => (
                          <Field key={ef.id} label={ef.label}>
                            <input
                              className={inputCls}
                              value={it.customValues[ef.label] || ''}
                              onChange={(e) => patchItemCustom(idx, ef.label, e.target.value)}
                              placeholder={`Enter ${ef.label}…`}
                            />
                          </Field>
                        ))}
                      </div>
                    )}

                    {/* Paid By Section (Included in Every Category) */}
                    <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 space-y-2.5">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                        <Field label="Paid By (Payment Method)">
                          <select
                            className={inputCls}
                            value={it.paidByMethod}
                            onChange={(e) => patchItem(idx, { paidByMethod: e.target.value as FormItem['paidByMethod'] })}
                          >
                            <option value="unpaid">Unpaid / On Credit (Payable Due)</option>
                            <option value="card">Paid by Card (Faiq / Ali / Third Party / Others)</option>
                            <option value="bank_transfer">Paid by Bank Transfer</option>
                            <option value="cash">Paid by Cash</option>
                            <option value="other">Others (Specify)</option>
                          </select>
                        </Field>

                        {it.paidByMethod === 'card' && (
                          <Field label="Card Option (A / B / C / D)">
                            <select
                              className={inputCls}
                              value={it.cardOption}
                              onChange={(e) => patchItem(idx, { cardOption: e.target.value as FormItem['cardOption'] })}
                            >
                              <option value="faiq_card">Option A: Paid by Faiq Card</option>
                              <option value="ali_card">Option B: Paid by Ali&apos;s Card</option>
                              <option value="third_party">Option C: Third Party</option>
                              <option value="other">Option D: Others (Specify)</option>
                            </select>
                          </Field>
                        )}

                        {it.paidByMethod === 'card' && (it.cardOption === 'faiq_card' || it.cardOption === 'ali_card') && (
                          <Field label="Which Bank (optional)">
                            <input
                              className={inputCls}
                              value={it.cardBank}
                              onChange={(e) => patchItem(idx, { cardBank: e.target.value })}
                              placeholder="e.g. Meezan Bank / HBL / Alfalah (optional)"
                            />
                          </Field>
                        )}

                        {it.paidByMethod === 'card' && (it.cardOption === 'third_party' || it.cardOption === 'other') && (
                          <Field label={it.cardOption === 'third_party' ? 'Third Party Name / Details (optional)' : 'Specify Card / Payer *'}>
                            <input
                              className={inputCls}
                              value={it.paidBySpecify}
                              onChange={(e) => patchItem(idx, { paidBySpecify: e.target.value })}
                              placeholder="Specify cardholder or third party…"
                            />
                          </Field>
                        )}

                        {it.paidByMethod === 'bank_transfer' && (
                          <Field label="Which Bank / Account (optional)">
                            <input
                              className={inputCls}
                              value={it.cardBank}
                              onChange={(e) => patchItem(idx, { cardBank: e.target.value })}
                              placeholder="e.g. Meezan Bank / HBL"
                            />
                          </Field>
                        )}

                        {it.paidByMethod === 'other' && (
                          <Field label="Specify Paid By">
                            <input
                              className={inputCls}
                              value={it.paidBySpecify}
                              onChange={(e) => patchItem(idx, { paidBySpecify: e.target.value })}
                              placeholder="Specify how this was paid…"
                            />
                          </Field>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Notes & Live Summary Footer */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              <Field label="Purchase Notes / Remarks (optional)">
                <textarea
                  className={`${inputCls} min-h-[70px]`}
                  value={form.notes}
                  onChange={(e) => patchForm({ notes: e.target.value })}
                  placeholder="Any additional vendor payment instructions or booking remarks…"
                  maxLength={2000}
                />
              </Field>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 space-y-1.5 text-xs">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Live Purchase Totals</p>
                <div className="flex justify-between">
                  <span>Total Payable to Vendors:</span>
                  <b className="font-mono text-amber-700 dark:text-amber-300">{form.currency} {fmtAmount(formTotals.payable)}</b>
                </div>
                <div className="flex justify-between">
                  <span>Total Receivable from Customer (optional):</span>
                  <b className="font-mono text-blue-700 dark:text-blue-300">{form.currency} {fmtAmount(formTotals.receivable)}</b>
                </div>
                {formTotals.receivable > 0 && (
                  <div className="flex justify-between pt-1.5 border-t border-slate-200 dark:border-slate-700">
                    <span className="font-semibold">Estimated Margin / Profit:</span>
                    <b className="font-mono text-emerald-600 dark:text-emerald-400">
                      {form.currency} {fmtAmount(Math.round((formTotals.receivable - formTotals.payable) * 100) / 100)}
                    </b>
                  </div>
                )}
              </div>
            </div>

            {error && <ErrorNote message={error} />}

            <div className="flex justify-end gap-2">
              <button type="button" className={btnGhost} onClick={() => setForm(null)}>Cancel</button>
              <button type="submit" className={btnPrimary} disabled={busy}>
                {busy ? 'Saving…' : form.id ? 'Save Changes' : 'Save Vendor Purchase'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};
