import React, { useEffect, useMemo, useState } from 'react';
import { AckBadge, AfterCreateInfo, AfterCreatePrompt, guessPhone } from './AfterCreate';
import { canEditFinancialRecord } from '../lib/financePermissions.js';
import { Plus, Trash2, Eye, Pencil, ShoppingBag, X, Check, Plane, Building2, Stamp, Bus, ShieldCheck, Package, CreditCard, Search, Columns3, FolderPlus } from 'lucide-react';
import { Employee } from '../types';
import { Modal } from '../components/common/Modal';
import {
  CompanyProfile,
  CrmPurchase,
  CrmPurchaseItem,
  PurchaseCategory,
  PurchaseCustomCategory,
  PurchaseCustomField,
  crmCall,
} from './crmApi';
import { CrmState } from './useCrm';
import { CreatedStamp, ErrorNote, Field, Pill, StatBar, btnDanger, btnGhost, btnPrimary, cardCls, inputCls } from './ui';
import { ExportPanel } from './ExportPanel';
import { EditHistory } from './EditHistory';
import { purchaseCells, purchaseColumns, purchaseSearch, purchaseSummary } from './exportConfigs';

import { allCurrencies, currencyLabel, fmtAmount } from './currencies';

interface Props {
  crm: CrmState;
  employees: Employee[];
  currentUser: Employee;
}

type PaidByMethodType =
  | 'unpaid'
  | 'faiq_card'
  | 'ali_card'
  | 'third_party'
  | 'other'
  | 'card'
  | 'cash'
  | 'bank_transfer';

interface FormItem {
  id: string;
  category: PurchaseCategory;
  vendorName: string;
  quantity: string;
  unitPayable: string;
  payable: string;
  receivable: string;
  currency: string;
  paymentDueDate: string;
  paidByMethod: PaidByMethodType;
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
  // Other / Custom Category description
  description: string;
  // Live custom fields
  customValues: Record<string, string>;
}

interface PurchaseFormState {
  id?: string;
  purchaseNo?: string;
  /** the invoice this purchase is for (required for a new purchase) */
  invoiceId: string;
  invoiceText: string;
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

const BUILTIN_CATEGORIES = ['ticket', 'hotel', 'visa', 'tour', 'insurance', 'other'] as const;

const CATEGORY_META: Record<
  string,
  { label: string; badgeTone: 'blue' | 'violet' | 'green' | 'amber' | 'slate'; Icon: React.FC<{ className?: string }> }
> = {
  ticket: { label: 'Ticket Purchase', badgeTone: 'blue', Icon: Plane },
  hotel: { label: 'Hotel Purchase', badgeTone: 'violet', Icon: Building2 },
  visa: { label: 'Visa Purchase', badgeTone: 'green', Icon: Stamp },
  tour: { label: 'Tours & Transfers', badgeTone: 'amber', Icon: Bus },
  insurance: { label: 'Insurance', badgeTone: 'slate', Icon: ShieldCheck },
  other: { label: 'Other Service', badgeTone: 'slate', Icon: Package },
};

function getCategoryMeta(
  cat: PurchaseCategory,
  customCategories: PurchaseCustomCategory[],
  fallbackLabel?: string
): { label: string; badgeTone: 'blue' | 'violet' | 'green' | 'amber' | 'slate'; Icon: React.FC<{ className?: string }>; isCustom: boolean } {
  if (CATEGORY_META[cat]) {
    return { ...CATEGORY_META[cat], isCustom: false };
  }
  const found = customCategories.find((c) => c.id === cat);
  return {
    label: found?.label || fallbackLabel || cat || 'Custom Category',
    badgeTone: 'blue',
    Icon: Package,
    isCustom: true,
  };
}

function normalizePaidByMethod(
  it: Pick<CrmPurchaseItem, 'paidByMethod' | 'cardOption'>
): PaidByMethodType {
  const m = it.paidByMethod || 'unpaid';
  if (m === 'card') {
    if (it.cardOption === 'ali_card') return 'ali_card';
    if (it.cardOption === 'third_party') return 'third_party';
    if (it.cardOption === 'other') return 'other';
    return 'faiq_card';
  }
  return m;
}

const blankItem = (category: PurchaseCategory, currency = 'PKR'): FormItem => ({
  id: uid(),
  category,
  vendorName: '',
  quantity: '1',
  unitPayable: '',
  payable: '',
  receivable: '',
  currency,
  paymentDueDate: '',
  paidByMethod: 'unpaid',
  cardOption: '',
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
  invoiceId: '',
  invoiceText: '',
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
    invoiceId: p.invoiceId || '',
    invoiceText: p.invoiceNo || '',
    customerName: p.customerName,
    careOf: p.careOf || '',
    crmId: p.crmId || '',
    purchaseDate: p.purchaseDate || today(),
    currency: p.currency || 'PKR',
    notes: p.notes || '',
    items: (p.items || []).length
      ? p.items.map((it) => {
          const qty = it.quantity !== null && it.quantity !== undefined && Number(it.quantity) > 0 ? Number(it.quantity) : 1;
          const totalPayable = it.payable !== null && it.payable !== undefined ? Number(it.payable) : 0;
          const unitPay =
            it.unitPayable !== null && it.unitPayable !== undefined
              ? Number(it.unitPayable)
              : qty > 0
                ? totalPayable / qty
                : totalPayable;
          const normMethod = normalizePaidByMethod(it);
          return {
            id: it.id || uid(),
            category: it.category || 'ticket',
            vendorName: it.vendorName || '',
            quantity: String(qty),
            unitPayable: totalPayable || unitPay ? String(unitPay) : '',
            payable: it.payable !== null && it.payable !== undefined ? String(it.payable) : '',
            receivable: it.receivable !== null && it.receivable !== undefined ? String(it.receivable) : '',
            currency: it.currency || p.currency || 'PKR',
            paymentDueDate: it.paymentDueDate || '',
            paidByMethod: normMethod,
            cardOption:
              normMethod === 'faiq_card' || normMethod === 'ali_card' || normMethod === 'third_party' || normMethod === 'other'
                ? normMethod
                : it.cardOption || '',
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
          };
        })
      : [blankItem('ticket', p.currency || 'PKR')],
  };
}

export function formatPaidByLabel(
  it: Pick<CrmPurchaseItem, 'paidByMethod' | 'cardOption' | 'cardBank' | 'paidBySpecify'>
): string {
  const method = normalizePaidByMethod(it);
  if (!method || method === 'unpaid') return 'Unpaid (Credit / Due)';
  if (method === 'faiq_card') return `Option A: Paid by Faiq Card${it.cardBank ? ` (${it.cardBank})` : ''}`;
  if (method === 'ali_card') return `Option B: Paid by Ali's Card${it.cardBank ? ` (${it.cardBank})` : ''}`;
  if (method === 'third_party') return `Option C: Third Party${it.paidBySpecify ? ` (${it.paidBySpecify})` : ''}`;
  if (method === 'other') return `Option D: Others${it.paidBySpecify ? ` (${it.paidBySpecify})` : ''}`;
  if (method === 'cash') return 'Paid by Cash';
  if (method === 'bank_transfer') return `Bank Transfer${it.cardBank ? ` (${it.cardBank})` : ''}`;
  return 'Unpaid';
}

const niceDate = (iso?: string | null) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

const getCustomFieldValue = (it: Pick<CrmPurchaseItem, 'customValues'>, cf: PurchaseCustomField): string => {
  if (!it.customValues) return '';
  return it.customValues[cf.id] ?? it.customValues[cf.label] ?? '';
};

export const PurchasesView: React.FC<Props & { portalEnabled?: boolean }> = ({ crm, employees, currentUser, portalEnabled = false }) => {
  const [after, setAfter] = useState<AfterCreateInfo | null>(null);
  const purchaseAfter = (x: CrmPurchase): AfterCreateInfo => ({
    kind: 'purchase', id: x.id, title: `Purchase ${x.purchaseNo}`, customerName: x.customerName,
    phone: guessPhone(crm.data, x.customerName, x.crmId), trackingId: x.crmId,
    summary: `${x.currency} ${fmtAmount(x.totalReceivable || x.totalPayable)}`,
  });
  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'ceo';
  const isStaff = isAdmin || currentUser.role === 'accounts';
  const seesAll = isStaff || currentUser.role === 'ceo';

  const purchases = crm.data.purchases || [];
  const customFields = crm.data.purchaseCustomFields || [];
  const customCategories = crm.data.purchaseCustomCategories || [];
  const customers = crm.data.customers || [];
  const empName = useMemo(() => new Map(employees.map((e) => [e.id, e.name])), [employees]);
  // Invoices a purchase can be made for: customer invoices (not cancelled) that this person can see.
  const invoiceChoices = useMemo(() => (crm.data.invoices || []).filter((i) => (i.kind || 'customer') === 'customer' && i.status !== 'cancelled'), [crm.data.invoices]);
  // Only the invoice number, customer name and who made it (each employee only gets their own or tagged invoices).
  const invoiceLabel = (i: { invoiceNo: string; customerName: string; createdBy: string }) => `${i.invoiceNo} · ${i.customerName} · by ${empName.get(i.createdBy) || 'Former employee'}`;
  const currencies = useMemo(() => allCurrencies(), []);

  const allCategoryEntries = useMemo(() => {
    const builtins = BUILTIN_CATEGORIES.map((id) => ({
      id: id as PurchaseCategory,
      label: CATEGORY_META[id].label,
      Icon: CATEGORY_META[id].Icon,
      isCustom: false,
    }));
    const customs = customCategories.map((c) => ({
      id: c.id as PurchaseCategory,
      label: c.label,
      Icon: Package,
      isCustom: true,
    }));
    return [...builtins, ...customs];
  }, [customCategories]);

  const [form, setForm] = useState<PurchaseFormState | null>(null);
  const [viewing, setViewing] = useState<CrmPurchase | null>(null);
  const [postingId, setPostingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'unpaid' | 'paid' | 'partial'>('all');
  const [postingFilter, setPostingFilter] = useState<'all' | 'not-posted' | 'posted'>('all');
  const [catFilter, setCatFilter] = useState<'all' | PurchaseCategory>('all');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Live Custom Column & Category Manager (Admin & Accounts)
  const [newColLabel, setNewColLabel] = useState('');
  const [newColCategory, setNewColCategory] = useState<PurchaseCategory | 'all'>('all');
  const [newCatLabel, setNewCatLabel] = useState('');
  const [showInlineColAdder, setShowInlineColAdder] = useState(false);
  const [showInlineCatAdder, setShowInlineCatAdder] = useState(false);
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
      if (postingFilter === 'posted' && !p.posted) return false;
      if (postingFilter === 'not-posted' && p.posted) return false;
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
  }, [purchases, filter, postingFilter, catFilter, query, empName]);

  const handleAddCustomColumn = async (e?: React.FormEvent, overrideCategory?: PurchaseCategory | 'all') => {
    if (e) e.preventDefault();
    const trimmed = newColLabel.trim();
    const targetCat = overrideCategory ?? newColCategory;
    if (!trimmed || colBusy) return;
    setColBusy(true);
    setColError('');
    setColNotice('');
    try {
      await crmCall('purchase_field_add', { label: trimmed, category: targetCat });
      setNewColLabel('');
      await crm.refresh();
      const targetName =
        targetCat === 'all' ? 'all purchase categories' : getCategoryMeta(targetCat, customCategories).label;
      setColNotice(`Added column "${trimmed}" live to ${targetName}.`);
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
      setColNotice(`Removed custom column "${field.label}".`);
      window.setTimeout(() => setColNotice(''), 3000);
    } catch (err: any) {
      setColError(err?.message || 'Could not remove custom column.');
    } finally {
      setColBusy(false);
    }
  };

  const handleAddCustomCategory = async (e?: React.FormEvent, addToFormImmediately = false) => {
    if (e) e.preventDefault();
    const trimmed = newCatLabel.trim();
    if (!trimmed || colBusy) return;
    setColBusy(true);
    setColError('');
    setColNotice('');
    try {
      const res = await crmCall<{ purchaseCustomCategories: PurchaseCustomCategory[] }>('purchase_category_add', {
        label: trimmed,
      });
      setNewCatLabel('');
      await crm.refresh();
      const added = (res.purchaseCustomCategories || []).find(
        (c) => c.label.toLowerCase() === trimmed.toLowerCase()
      );
      if (addToFormImmediately && added && form) {
        addItem(added.id);
      }
      setColNotice(`Added new category "${trimmed}" live.`);
      window.setTimeout(() => setColNotice(''), 3500);
    } catch (err: any) {
      setColError(err?.message || 'Could not add custom category.');
    } finally {
      setColBusy(false);
    }
  };

  const handleRemoveCustomCategory = async (cat: { id: string; label: string }) => {
    if (!window.confirm(`Remove custom category "${cat.label}"?`)) return;
    setColBusy(true);
    setColError('');
    try {
      await crmCall('purchase_category_remove', { categoryId: cat.id });
      await crm.refresh();
      if (catFilter === cat.id) setCatFilter('all');
      if (newColCategory === cat.id) setNewColCategory('all');
      setColNotice(`Removed custom category "${cat.label}".`);
      window.setTimeout(() => setColNotice(''), 3000);
    } catch (err: any) {
      setColError(err?.message || 'Could not remove custom category.');
    } finally {
      setColBusy(false);
    }
  };

  const patchForm = (p: Partial<PurchaseFormState>) => {
    setForm((cur) => (cur ? { ...cur, ...p } : cur));
    setError('');
  };

  // Invoice picker: a plain click list (works in every browser, the phone app and the Windows app).
  const [invoicePickerOpen, setInvoicePickerOpen] = useState(false);
  const normText = (t: string) => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const findInvoice = (text: string) => {
    const q = normText(text);
    if (!q) return null;
    return invoiceChoices.find((i) => normText(invoiceLabel(i)) === q || normText(i.invoiceNo) === q) || null;
  };
  const pickInvoice = (hit: (typeof invoiceChoices)[number]) => {
    setForm((cur) => cur ? {
      ...cur,
      invoiceText: invoiceLabel(hit),
      invoiceId: hit.id,
      customerName: hit.customerName,
      crmId: hit.crmId || hit.queryCode || cur.crmId,
      currency: hit.currency || cur.currency,
    } : cur);
    setError('');
  };
  const invoiceMatches = useMemo(() => {
    const q = normText(form?.invoiceText || '');
    const list = q ? invoiceChoices.filter((i) => normText(invoiceLabel(i)).includes(q)) : invoiceChoices;
    return list.slice(0, 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form?.invoiceText, invoiceChoices, empName]);

  const patchItem = (idx: number, p: Partial<FormItem>) => {
    setForm((cur) => {
      if (!cur) return cur;
      const items = cur.items.map((it, i) => {
        if (i !== idx) return it;
        const next = { ...it, ...p };
        // Auto-calculate total payable when quantity or unitPayable changes
        if ('quantity' in p || 'unitPayable' in p) {
          const q = Math.max(1, Number(next.quantity) || 1);
          const u = Number(next.unitPayable);
          if (next.unitPayable !== '' && Number.isFinite(u)) {
            next.payable = String(Math.round(q * u * 100) / 100);
          } else if (next.unitPayable === '') {
            next.payable = '';
          }
        } else if ('payable' in p) {
          const q = Math.max(1, Number(next.quantity) || 1);
          const tot = Number(next.payable);
          if (next.payable !== '' && Number.isFinite(tot)) {
            next.unitPayable = String(Math.round((tot / q) * 100) / 100);
          } else {
            next.unitPayable = '';
          }
        }
        return next;
      });
      return { ...cur, items };
    });
    setError('');
  };

  const patchItemCustom = (idx: number, key: string, val: string) => {
    setForm((cur) => {
      if (!cur) return cur;
      const items = cur.items.map((it, i) =>
        i === idx ? { ...it, customValues: { ...(it.customValues || {}), [key]: val } } : it
      );
      return { ...cur, items };
    });
  };

  const addItem = (category: PurchaseCategory) => {
    setForm((cur) =>
      cur ? { ...cur, items: [...cur.items, blankItem(category, cur.currency || 'PKR')] } : cur
    );
  };

  const removeItem = (idx: number) => {
    setForm((cur) => {
      if (!cur) return cur;
      const next = cur.items.filter((_, i) => i !== idx);
      return { ...cur, items: next.length ? next : [blankItem('ticket', cur.currency || 'PKR')] };
    });
  };

  const formTotals = useMemo(() => {
    if (!form) return { payables: [] as [string, number][], receivables: [] as [string, number][] };
    const payMap = new Map<string, number>();
    const recMap = new Map<string, number>();
    form.items.forEach((it) => {
      const cur = it.currency || form.currency || 'PKR';
      const p = Number(it.payable) || 0;
      const r = Number(it.receivable) || 0;
      payMap.set(cur, (payMap.get(cur) || 0) + p);
      if (it.receivable.trim() !== '') {
        recMap.set(cur, (recMap.get(cur) || 0) + r);
      }
    });
    return { payables: [...payMap.entries()], receivables: [...recMap.entries()] };
  }, [form]);

  // Convert current form state into a live CrmPurchase object for the Live Preview panel
  const livePreviewPurchase = useMemo<CrmPurchase | null>(() => {
    if (!form) return null;
    const mappedItems: CrmPurchaseItem[] = form.items.map((it) => {
      const qty = Math.max(1, Number(it.quantity) || 1);
      const unitPay = Number(it.unitPayable) || 0;
      const pay = it.payable !== '' ? Number(it.payable) || 0 : Math.round(qty * unitPay * 100) / 100;
      const rec = it.receivable.trim() !== '' ? Number(it.receivable) || 0 : null;
      const cardOpt: 'faiq_card' | 'ali_card' | 'third_party' | 'other' | '' =
        it.paidByMethod === 'faiq_card' ||
        it.paidByMethod === 'ali_card' ||
        it.paidByMethod === 'third_party' ||
        it.paidByMethod === 'other'
          ? it.paidByMethod
          : '';
      const meta = getCategoryMeta(it.category, customCategories);
      return {
        id: it.id,
        category: it.category,
        categoryLabel: meta.label,
        vendorName: it.vendorName.trim() || '—',
        quantity: qty,
        unitPayable: unitPay,
        payable: pay,
        receivable: rec,
        currency: it.currency || form.currency || 'PKR',
        paymentDueDate: it.paymentDueDate || null,
        paidByMethod: it.paidByMethod,
        cardOption: cardOpt,
        cardBank: it.cardBank.trim() || undefined,
        paidBySpecify: it.paidBySpecify.trim() || undefined,
        ticketNumber: it.ticketNumber.trim() || undefined,
        hotelName: it.hotelName.trim() || undefined,
        rooms: it.rooms.trim() || undefined,
        checkInDate: it.checkInDate || null,
        checkOutDate: it.checkOutDate || null,
        countries: it.countries.trim() || undefined,
        visaType: it.visaType.trim() || undefined,
        tourDescription: it.tourDescription.trim() || undefined,
        tourDate: it.tourDate || null,
        persons: it.persons.trim() !== '' ? Number(it.persons) || null : null,
        insuranceType: it.insuranceType.trim() || undefined,
        insuranceDays: it.insuranceDays.trim() !== '' ? Number(it.insuranceDays) || null : null,
        description: it.description.trim() || undefined,
        customValues: it.customValues || {},
      };
    });
    const totalPayable = mappedItems.reduce((s, it) => s + (Number(it.payable) || 0), 0);
    const totalReceivable = mappedItems.reduce((s, it) => s + (Number(it.receivable) || 0), 0);
    const paidCount = mappedItems.filter((it) => it.paidByMethod && it.paidByMethod !== 'unpaid').length;
    const status: 'unpaid' | 'paid' | 'partial' =
      paidCount === 0 ? 'unpaid' : paidCount === mappedItems.length ? 'paid' : 'partial';
    return {
      id: form.id || 'preview',
      purchaseNo: form.purchaseNo || 'PUR-(auto)',
      customerName: form.customerName.trim() || '—',
      careOf: form.careOf.trim(),
      crmId: form.crmId.trim(),
      purchaseDate: form.purchaseDate || today(),
      currency: form.currency || 'PKR',
      items: mappedItems,
      totalPayable,
      totalReceivable,
      status,
      notes: form.notes.trim(),
      createdBy: currentUser.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }, [form, currentUser.id, customCategories]);

  const submitForm = async () => {
    if (!form) return;
    // If the invoice was typed in full instead of clicked, link it now.
    const typedHit = !form.invoiceId ? findInvoice(form.invoiceText) : null;
    const linkedInvoiceId = form.invoiceId || typedHit?.id || '';
    if (!form.id && !linkedInvoiceId) {
      setError('Choose the invoice this purchase is for (search by invoice no., customer or creator name). Create the invoice first if it does not exist yet.');
      return;
    }
    if (!form.customerName.trim()) {
      setError('Customer Name is required.');
      return;
    }
    const validItems = form.items.filter((it) => it.vendorName.trim() || Number(it.payable) > 0 || Number(it.unitPayable) > 0);
    if (!validItems.length) {
      setError('Please enter Vendor / Issued From and Payable amount for at least one product.');
      return;
    }
    for (let i = 0; i < validItems.length; i++) {
      const it = validItems[i];
      if (!it.vendorName.trim()) {
        setError(`Item #${i + 1} (${getCategoryMeta(it.category, customCategories).label}): Vendor / Issued From is required.`);
        return;
      }
    }

    setBusy(true);
    setError('');
    try {
      const matchingCustomer = customers.find(
        (c) => c.customerName.trim().toLowerCase() === form.customerName.trim().toLowerCase()
      );
      const payload = {
        id: form.id,
        invoiceId: linkedInvoiceId || null,
        customerId: matchingCustomer?.id || null,
        customerName: form.customerName.trim(),
        careOf: form.careOf.trim() || null,
        crmId: form.crmId.trim() || null,
        purchaseDate: form.purchaseDate || today(),
        currency: form.currency || 'PKR',
        notes: form.notes.trim() || null,
        items: validItems.map((it) => {
          const qty = Math.max(1, Number(it.quantity) || 1);
          const unitPay = Number(it.unitPayable) || 0;
          const totalPay = it.payable !== '' ? Number(it.payable) || 0 : Math.round(qty * unitPay * 100) / 100;
          const meta = getCategoryMeta(it.category, customCategories);
          return {
            id: it.id,
            category: it.category,
            categoryLabel: meta.isCustom ? meta.label : undefined,
            vendorName: it.vendorName.trim(),
            quantity: qty,
            unitPayable: unitPay || totalPay / qty,
            payable: totalPay,
            receivable: it.receivable.trim() !== '' ? Number(it.receivable) || 0 : null,
            currency: it.currency || form.currency || 'PKR',
            paymentDueDate: it.paymentDueDate || null,
            paidByMethod: it.paidByMethod,
            cardOption:
              it.paidByMethod === 'faiq_card' ||
              it.paidByMethod === 'ali_card' ||
              it.paidByMethod === 'third_party' ||
              it.paidByMethod === 'other'
                ? it.paidByMethod
                : null,
            cardBank:
              it.paidByMethod === 'faiq_card' ||
              it.paidByMethod === 'ali_card' ||
              it.paidByMethod === 'bank_transfer'
                ? it.cardBank.trim() || null
                : null,
            paidBySpecify:
              it.paidByMethod === 'third_party' || it.paidByMethod === 'other'
                ? it.paidBySpecify.trim() || null
                : null,
            ticketNumber: it.ticketNumber.trim() || null,
            hotelName: it.hotelName.trim() || null,
            rooms: it.rooms.trim() || null,
            checkInDate: it.checkInDate || null,
            checkOutDate: it.checkOutDate || null,
            countries: it.countries.trim() || null,
            visaType: it.visaType.trim() || null,
            tourDescription: it.tourDescription.trim() || null,
            tourDate: it.tourDate || null,
            persons: it.persons.trim() !== '' ? Number(it.persons) || null : null,
            insuranceType: it.insuranceType.trim() || null,
            insuranceDays: it.insuranceDays.trim() !== '' ? Number(it.insuranceDays) || null : null,
            description: it.description.trim() || null,
            customValues: it.customValues || {},
          };
        }),
      };

      const saved = await crmCall<{ purchase: CrmPurchase }>('purchase_save', payload);
      await crm.refresh();
      const wasNew = !form?.id;
      setForm(null);
      const savedPurchase = saved.purchase || (saved as unknown as CrmPurchase);
      if (wasNew && savedPurchase?.id) setAfter(purchaseAfter(savedPurchase)); else setViewing(savedPurchase);
    } catch (e: any) {
      setError(e?.message || 'Could not save vendor purchase.');
    } finally {
      setBusy(false);
    }
  };

  const removePurchase = async (p: CrmPurchase) => {
    if (!window.confirm(`Delete vendor purchase ${p.purchaseNo} for ${p.customerName}?`)) return;
    try {
      await crmCall('purchase_delete', { id: p.id });
      await crm.refresh();
      if (viewing?.id === p.id) setViewing(null);
    } catch (e: any) {
      window.alert(e?.message || 'Could not delete purchase.');
    }
  };

  const changePurchaseStatus = async (p: CrmPurchase, status: 'unpaid' | 'partial' | 'paid') => {
    try {
      const res = await crmCall<{ purchase: CrmPurchase }>('purchase_status', { id: p.id, status });
      await crm.refresh();
      if (viewing?.id === p.id) setViewing(res.purchase);
    } catch (e: any) {
      window.alert(e?.message || 'Could not update purchase payment status.');
    }
  };

  const changePurchasePosting = async (p: CrmPurchase) => {
    if (postingId) return;
    setPostingId(p.id);
    try {
      const res = await crmCall<{ purchase: CrmPurchase }>('purchase_posted', { id: p.id, posted: !p.posted });
      await crm.refresh();
      setViewing((current) => current?.id === p.id ? res.purchase : current);
    } catch (e: any) {
      window.alert(e?.message || 'Could not update purchase posting status.');
    } finally { setPostingId(null); }
  };

  return (
    <div className="space-y-4">
      <AfterCreatePrompt info={after} companyName={crm.data.company.name} portalEnabled={portalEnabled} ack={after ? crm.data.acks?.[after.id] : undefined} onClose={() => setAfter(null)} onSent={() => void crm.refresh()} />
      {/* Header Card */}
      <div className={`${cardCls} p-4 flex flex-wrap items-center justify-between gap-3`}>
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
            <ShoppingBag className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Purchases — Vendor Entries</h2>
            <p className="text-xs text-slate-500">
              Record multi-product vendor purchases (Ticket, Hotel, Visa, Tours & Transfers, Insurance, or custom categories) with Customer, C/O, Query Code / CRM ID, and payment method.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportPanel
            title="Purchases" rows={crm.data.purchases} columns={purchaseColumns()} toCells={(p) => purchaseCells(p, (id) => empName.get(id) || 'Former employee')}
            getCreatedAt={(p) => p.createdAt} getCreatorId={(p) => p.createdBy} searchFields={purchaseSearch} searchHint="Purchase no., CRM ID or customer"
            employees={employees} currentUser={currentUser} companyName={crm.data.company.name} summaryOf={purchaseSummary} landscape
          />
          <button
            type="button"
            onClick={() => {
              setForm(blankForm());
              setError('');
            }}
            className={btnPrimary}
          >
            <Plus className="w-4 h-4" /> +Add Vendor
          </button>
        </div>
      </div>

      {/* Live Custom Column & Category Bar for Admin / Accounts */}
      {isStaff && (
        <div className={`${cardCls} p-4 border-blue-200 bg-gradient-to-r from-blue-50/70 via-white to-indigo-50/50 space-y-3`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-blue-600 text-white">
                <Columns3 className="w-4 h-4" />
              </span>
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  Live Vendor Purchase Category & Column Manager (Admin & Accounts)
                </h3>
                <p className="text-[11px] text-slate-500">
                  Add or remove custom product categories and custom columns right here — changes update in the database immediately and appear live in all forms.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-100/80 px-2.5 py-0.5 rounded-full">
                {customCategories.length} custom {customCategories.length === 1 ? 'category' : 'categories'}
              </span>
              <span className="text-[11px] font-semibold text-blue-700 bg-blue-100/80 px-2.5 py-0.5 rounded-full">
                {customFields.length} custom {customFields.length === 1 ? 'column' : 'columns'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {/* Add New Custom Category Form */}
            <form onSubmit={(e) => handleAddCustomCategory(e, false)} className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-white/90 p-2.5">
              <span className="text-[11px] font-bold text-emerald-800 inline-flex items-center gap-1">
                <FolderPlus className="w-3.5 h-3.5 text-emerald-600" /> New Category:
              </span>
              <input
                type="text"
                className={`${inputCls} flex-1 min-w-[180px] bg-white`}
                placeholder="e.g. Transport, Umrah Package, Train, Car Rental..."
                value={newCatLabel}
                onChange={(e) => setNewCatLabel(e.target.value)}
                disabled={colBusy}
              />
              <button
                type="submit"
                disabled={colBusy || !newCatLabel.trim()}
                className={btnPrimary}
              >
                <Plus className="w-4 h-4" /> {colBusy ? 'Adding...' : '+ Add Category'}
              </button>
            </form>

            {/* Add New Custom Column Form */}
            <form onSubmit={(e) => handleAddCustomColumn(e)} className="flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-white/90 p-2.5">
              <select
                className={`${inputCls} !w-auto min-w-[155px] bg-white`}
                value={newColCategory}
                onChange={(e) => setNewColCategory(e.target.value as PurchaseCategory | 'all')}
                disabled={colBusy}
              >
                <option value="all">All Categories</option>
                {allCategoryEntries.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label} Only
                  </option>
                ))}
              </select>
              <input
                type="text"
                className={`${inputCls} flex-1 min-w-[180px] bg-white`}
                placeholder="New column name (e.g. PNR, ROE, Supplier Inv #)..."
                value={newColLabel}
                onChange={(e) => setNewColLabel(e.target.value)}
                disabled={colBusy}
              />
              <button
                type="submit"
                disabled={colBusy || !newColLabel.trim()}
                className={btnPrimary}
              >
                <Plus className="w-4 h-4" /> {colBusy ? 'Adding...' : '+ Add Column'}
              </button>
            </form>
          </div>

          {colNotice && <div className="text-xs font-semibold text-emerald-700">{colNotice}</div>}
          {colError && <div className="text-xs font-semibold text-rose-600">{colError}</div>}

          {(customCategories.length > 0 || customFields.length > 0) && (
            <div className="pt-2 border-t border-slate-200/70 flex flex-wrap items-center gap-2">
              {customCategories.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 mr-3">
                  <span className="text-[11px] font-semibold text-emerald-700">Custom categories:</span>
                  {customCategories.map((cat) => (
                    <span
                      key={cat.id}
                      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border bg-emerald-50/70 text-emerald-900 border-emerald-200 shadow-2xs"
                    >
                      <span className="font-semibold">{cat.label}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveCustomCategory(cat)}
                        disabled={colBusy}
                        className="text-emerald-700 hover:text-rose-600 transition-colors cursor-pointer"
                        title={`Remove "${cat.label}" category`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {customFields.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-indigo-700">Active live columns:</span>
                  {customFields.map((cf) => (
                    <span
                      key={cf.id}
                      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border bg-white text-slate-700 border-slate-200 shadow-2xs"
                    >
                      <span className="font-semibold">{cf.label}</span>
                      <span className="text-[10px] uppercase px-1.5 py-0.2 rounded bg-slate-100 text-slate-600">
                        {cf.category === 'all' ? 'All' : getCategoryMeta(cf.category, customCategories).label}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveCustomColumn(cf)}
                        disabled={colBusy}
                        className="text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                        title={`Remove "${cf.label}" column`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Summary StatBars */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="space-y-2">
          <StatBar
            title={seesAll ? 'All Vendor Purchases (Payables Status)' : 'Your Vendor Purchases'}
            segments={[
              { label: 'Unpaid / On Credit', count: counts.unpaid, tone: 'amber' },
              { label: 'Partially Paid', count: counts.partial, tone: 'blue' },
              { label: 'Paid', count: counts.paid, tone: 'green' },
            ]}
          />
          <div className={`${cardCls} px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs`}>
            <span className="font-semibold text-slate-600">Total Vendor Payables:</span>
            <div className="flex flex-wrap gap-3">
              {totalsByCurrency.payables.length ? (
                totalsByCurrency.payables.map(([cur, amt]) => (
                  <span key={cur} className="font-mono font-bold text-amber-700">
                    {cur} {fmtAmount(amt)}
                  </span>
                ))
              ) : (
                <span className="font-mono font-bold text-slate-400">PKR 0</span>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className={`${cardCls} p-4`}>
            <div className="text-xs font-bold text-slate-800 mb-2">Category Breakdown</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {allCategoryEntries.map((cat) => {
                const count = purchases.reduce(
                  (acc, p) => acc + (p.items || []).filter((it) => it.category === cat.id).length,
                  0
                );
                const Icon = cat.Icon;
                return (
                  <div
                    key={cat.id}
                    className="flex items-center justify-between px-3 py-2 rounded-xl border border-slate-200/80 bg-slate-50/60 text-xs"
                  >
                    <span className="inline-flex items-center gap-1.5 font-medium text-slate-700 truncate">
                      <Icon className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                      <span className="truncate">{cat.label}</span>
                    </span>
                    <span className="font-mono font-bold text-slate-900 ml-1">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className={`${cardCls} px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs`}>
            <span className="font-semibold text-slate-600">Total Optional Receivables Linked:</span>
            <div className="flex flex-wrap gap-3">
              {totalsByCurrency.receivables.length ? (
                totalsByCurrency.receivables.map(([cur, amt]) => (
                  <span key={cur} className="font-mono font-bold text-blue-700">
                    {cur} {fmtAmount(amt)}
                  </span>
                ))
              ) : (
                <span className="font-mono font-bold text-slate-400">PKR 0</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Filters & Search */}
      <div className={`${cardCls} p-3 flex flex-wrap items-center justify-between gap-2`}>
        <div className="flex flex-wrap items-center gap-1.5">
          {(['all', 'unpaid', 'partial', 'paid'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className={`px-3 py-1 rounded-full text-xs font-medium capitalize ${
                filter === k
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              {k}
            </button>
          ))}
          <span className="mx-1 text-slate-300">|</span>
          {(['all', 'not-posted', 'posted'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setPostingFilter(k)} className={`px-3 py-1 rounded-full text-xs font-medium ${postingFilter === k ? k === 'posted' ? 'bg-emerald-600 text-white' : 'bg-blue-600 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'}`}>
              {k === 'all' ? 'All posting states' : k === 'posted' ? 'Posted' : 'Not posted'}
            </button>
          ))}
          <span className="mx-1 text-slate-300">|</span>
          <select
            className={`${inputCls} !w-auto !py-1 text-xs`}
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value as 'all' | PurchaseCategory)}
          >
            <option value="all">All Categories</option>
            {allCategoryEntries.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div className="relative w-full sm:w-80">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            className={`${inputCls} !pl-8`}
            placeholder="Search vendor, ticket #, hotel, customer, C/O, CRM ID..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Purchases List */}
      <div className="space-y-2.5">
        {shown.map((p) => {
          const items = p.items || [];
          return (
            <div key={p.id} data-posted={p.posted === true} className={`${cardCls} p-4 ${p.posted ? 'border-emerald-200 !bg-emerald-50/80 dark:border-emerald-900 dark:!bg-emerald-950/25' : ''}`}>
              <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-100">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-md border border-blue-200">
                      {p.purchaseNo}
                    </span>
                    {p.crmId && (
                      <span className="font-mono text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-200">
                        Query / CRM ID: {p.crmId}
                      </span>
                    )}
                    <span className="font-bold text-slate-900 text-sm">Customer: {p.customerName}</span>
                    {p.careOf && <Pill tone="slate">C/O: {p.careOf}</Pill>}
                    <Pill tone={p.status === 'paid' ? 'green' : p.status === 'partial' ? 'blue' : 'amber'}>
                      {p.status === 'paid' ? 'Paid' : p.status === 'partial' ? 'Partially Paid' : 'Unpaid / Credit'}
                    </Pill>
                    <Pill tone={p.posted ? 'green' : 'slate'}>{p.posted ? '✓ Posted' : 'Not posted'}</Pill>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Purchase Date: <b>{niceDate(p.purchaseDate)}</b> · {items.length}{' '}
                    {items.length === 1 ? 'product entry' : 'product entries'} · <CreatedStamp at={p.createdAt} by={empName.get(p.createdBy) || 'Employee'} />
                    {p.invoiceNo && <> · Invoice <b className="font-mono text-blue-700">{p.invoiceNo}</b></>}
                  </div>
                  <div className="mt-1"><EditHistory log={p.editLog} nameOf={(id) => empName.get(id) || 'Former employee'} /></div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {isStaff && <button type="button" className={btnGhost} disabled={postingId !== null} onClick={() => void changePurchasePosting(p)}>{postingId === p.id ? 'Saving…' : p.posted ? 'Unpost' : 'Mark as posted'}</button>}
                  {isStaff && (
                    <select
                      aria-label={`Payment status for ${p.purchaseNo}`}
                      className={`${inputCls} !w-auto !py-1 !px-2.5 !text-xs font-semibold`}
                      value={p.status}
                      onChange={(e) =>
                        void changePurchaseStatus(p, e.target.value as 'unpaid' | 'partial' | 'paid')
                      }
                    >
                      <option value="unpaid">Payment: Unpaid / Credit</option>
                      <option value="partial">Payment: Partially Paid</option>
                      <option value="paid">Payment: Paid</option>
                    </select>
                  )}
                  <button type="button" onClick={() => setViewing(p)} className={btnGhost}>
                    <Eye className="w-3.5 h-3.5" /> View
                  </button>
                  <button type="button" onClick={() => setAfter(purchaseAfter(p))} className={btnGhost} data-card-whatsapp>WhatsApp / Accounts</button>
                  <AckBadge kind="purchase" id={p.id} crm={crm} canRequest={false} />
                  {canEditFinancialRecord(currentUser.role, currentUser.id, p.createdBy, 'purchase') && <button
                    type="button"
                    onClick={() => {
                      setForm(toForm(p));
                      setError('');
                    }}
                    className={btnGhost}
                  >
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </button>}
                  {isAdmin && (
                    <button type="button" onClick={() => removePurchase(p)} className={btnDanger}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Split 50/50 Product & Vendor Breakdown inside each Purchase Card */}
              <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
                {items.map((it, idx) => {
                  const meta = getCategoryMeta(it.category || 'ticket', customCategories, it.categoryLabel);
                  const Icon = meta.Icon;
                  const cur = it.currency || p.currency || 'PKR';
                  const qty = it.quantity && Number(it.quantity) > 0 ? Number(it.quantity) : 1;
                  const unitPay =
                    it.unitPayable !== null && it.unitPayable !== undefined
                      ? Number(it.unitPayable)
                      : qty > 0
                        ? (Number(it.payable) || 0) / qty
                        : Number(it.payable) || 0;
                  return (
                    <div
                      key={it.id || idx}
                      className="rounded-xl border border-slate-200/90 bg-slate-50/60 p-3 flex flex-col justify-between gap-2"
                    >
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900">
                            <Icon className="w-3.5 h-3.5 text-blue-600" />
                            #{idx + 1} · {meta.label}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100/80 text-amber-900 border border-amber-200">
                            Vendor: {it.vendorName}
                          </span>
                        </div>

                        {/* Category specific details */}
                        <div className="text-xs text-slate-700 space-y-0.5">
                          {it.category === 'ticket' && (
                            <div>
                              Ticket Number: <b className="font-mono">{it.ticketNumber || '—'}</b>
                            </div>
                          )}
                          {it.category === 'hotel' && (
                            <div>
                              Hotel: <b>{it.hotelName || '—'}</b>
                              {it.rooms ? ` · Rooms: ${it.rooms}` : ''}
                              {it.checkInDate ? ` · Check-In: ${niceDate(it.checkInDate)}` : ''}
                              {it.checkOutDate ? ` · Check-Out: ${niceDate(it.checkOutDate)}` : ''}
                            </div>
                          )}
                          {it.category === 'visa' && (
                            <div>
                              Countries: <b>{it.countries || '—'}</b> · Visa Type: <b>{it.visaType || '—'}</b>
                            </div>
                          )}
                          {it.category === 'tour' && (
                            <div>
                              Tour: <b>{it.tourDescription || '—'}</b>
                              {it.tourDate ? ` · Date: ${niceDate(it.tourDate)}` : ''}
                              {it.persons !== null && it.persons !== undefined ? ` · Persons: ${it.persons}` : ''}
                            </div>
                          )}
                          {it.category === 'insurance' && (
                            <div>
                              Insurance Type: <b>{it.insuranceType || '—'}</b>
                              {it.insuranceDays !== null && it.insuranceDays !== undefined
                                ? ` · Days: ${it.insuranceDays}`
                                : ''}
                            </div>
                          )}
                          {(it.category === 'other' || meta.isCustom) && it.description && (
                            <div>
                              Details: <b>{it.description}</b>
                            </div>
                          )}

                          {/* Custom Live Columns */}
                          {customFields.map((cf) => {
                            const val = getCustomFieldValue(it, cf);
                            if (!val) return null;
                            return (
                              <div key={cf.id} className="text-[11px] text-slate-600">
                                {cf.label}: <b className="text-slate-800">{val}</b>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="pt-2 border-t border-slate-200/70 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="space-y-0.5">
                          <div className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600">
                            <CreditCard className="w-3 h-3 text-slate-400" />
                            <span>{formatPaidByLabel(it)}</span>
                          </div>
                          {it.paymentDueDate && (
                            <div className="text-[11px] text-rose-600 font-medium">
                              Due: {niceDate(it.paymentDueDate)}
                            </div>
                          )}
                        </div>
                        <div className="text-right font-mono">
                          <div className="text-[11px] text-slate-500">
                            {cur} {fmtAmount(unitPay)} × {qty} {qty === 1 ? 'unit' : 'units'}
                          </div>
                          <div className="font-bold text-amber-800">
                            Payable: {cur} {fmtAmount(it.payable || 0)}
                          </div>
                          {it.receivable !== null && it.receivable !== undefined && (
                            <div className="text-[11px] text-blue-700 font-semibold">
                              Receivable: {cur} {fmtAmount(it.receivable)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {!shown.length && (
          <div className={`${cardCls} p-8 text-center text-xs text-slate-400`}>
            No vendor purchases recorded yet. Click <b>+Add Vendor</b> to add your first Ticket, Hotel, Visa, Tour, or Insurance purchase.
          </div>
        )}
      </div>

      {/* +Add Vendor / Edit Purchase Modal with Side-by-Side Live Preview */}
      <Modal
        isOpen={Boolean(form)}
        title={form?.id ? `Edit Vendor Purchase ${form.purchaseNo || ''}` : 'New Vendor Purchase (+Add Vendor)'}
        subtitle="Fill in Customer, C/O, and Query Code / CRM ID, then add one or multiple vendor product purchases below."
        onClose={() => setForm(null)}
        maxWidth="full"
      >
        {form && (
          <div className="flex flex-col xl:flex-row gap-5 items-start">
            {/* LEFT COLUMN: Entry Form */}
            <div className="flex-1 w-full space-y-4 min-w-0">
              <ErrorNote message={error} />

              {/* A purchase is always made for an invoice that already exists */}
              <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4" data-purchase-invoice>
                <Field label={form.id && !form.invoiceId ? 'Invoice (link this older purchase to its invoice)' : 'Invoice *'}>
                  <input
                    className={`${inputCls} bg-white`}
                    value={form.invoiceText}
                    autoComplete="off"
                    onFocus={() => setInvoicePickerOpen(true)}
                    onBlur={() => window.setTimeout(() => setInvoicePickerOpen(false), 200)}
                    onChange={(e) => {
                      const text = e.target.value;
                      setInvoicePickerOpen(true);
                      const hit = findInvoice(text);
                      if (!hit) { patchForm({ invoiceText: text, invoiceId: '' }); return; }
                      pickInvoice(hit);
                    }}
                    placeholder="Search invoice no., customer or creator name…"
                  />
                  {invoicePickerOpen && !form.invoiceId && invoiceMatches.length > 0 && (
                    <div className="mt-1 max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg divide-y divide-slate-100">
                      {invoiceMatches.map((i) => (
                        <button
                          key={i.id}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => { pickInvoice(i); setInvoicePickerOpen(false); }}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 active:bg-blue-100"
                        >
                          <b className="font-mono">{i.invoiceNo}</b> · {i.customerName} <span className="text-slate-500">· by {empName.get(i.createdBy) || 'Former employee'}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </Field>
                <p className="mt-1 text-[11px] text-slate-600">
                  {form.invoiceId
                    ? <>✓ Linked to invoice <b>{invoiceChoices.find((i) => i.id === form.invoiceId)?.invoiceNo || form.invoiceText}</b>. Customer was filled from it.</>
                    : invoiceChoices.length ? 'Pick the invoice from the list. Purchases can only be made for invoices that already exist.' : 'No invoices yet. Create the invoice first in the Invoices section, then add its purchase here.'}
                </p>
              </div>

              {/* Top Required Context: 1. Customer, 2. C/O, 3. Query Code / CRM ID */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <Field label="1. Customer *">
                    <input
                      list="purchase-customers-list"
                      className={`${inputCls} bg-white`}
                      value={form.customerName}
                      onChange={(e) => patchForm({ customerName: e.target.value })}
                      placeholder="Type or select customer name..."
                    />
                    <datalist id="purchase-customers-list">
                      {customers.map((c) => (
                        <option key={c.id} value={c.customerName}>
                          {c.customerNumber ? `${c.customerName} (${c.customerNumber})` : c.customerName}
                        </option>
                      ))}
                    </datalist>
                  </Field>

                  <Field label="2. C/O (Care Of / Reference)">
                    <input
                      className={`${inputCls} bg-white`}
                      value={form.careOf}
                      onChange={(e) => patchForm({ careOf: e.target.value })}
                      placeholder="e.g. Asad Ali / Direct"
                    />
                  </Field>

                  <Field label="3. Query Code / CRM ID">
                    <input
                      className={`${inputCls} bg-white font-mono`}
                      value={form.crmId}
                      onChange={(e) => patchForm({ crmId: e.target.value })}
                      placeholder="e.g. 17562336"
                    />
                  </Field>

                  <Field label="Default Currency">
                    <select
                      className={`${inputCls} bg-white`}
                      value={form.currency}
                      onChange={(e) => patchForm({ currency: e.target.value })}
                    >
                      {currencies.map((c) => (
                        <option key={c.code} value={c.code}>
                          {currencyLabel(c)}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </div>

              {/* Add Multiple Products Bar + Admin "+ Add New Category" & "+ Add Live Column" buttons */}
              <div className="rounded-xl border border-blue-200/80 bg-blue-50/40 p-3 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-slate-700 mr-1">Add Product / Vendor Entry:</span>
                    {allCategoryEntries.map((cat) => {
                      const Icon = cat.Icon;
                      return (
                        <div key={cat.id} className="inline-flex items-center">
                          <button
                            type="button"
                            onClick={() => addItem(cat.id)}
                            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 border bg-white text-blue-700 hover:bg-blue-600 hover:text-white transition-colors shadow-2xs cursor-pointer ${
                              cat.isCustom && isStaff
                                ? 'rounded-l-lg border-emerald-300 text-emerald-800 hover:bg-emerald-600'
                                : 'rounded-lg border-blue-200'
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5" /> + {cat.label}
                          </button>
                          {cat.isCustom && isStaff && (
                            <button
                              type="button"
                              onClick={() => handleRemoveCustomCategory({ id: cat.id, label: cat.label })}
                              disabled={colBusy}
                              className="inline-flex items-center justify-center px-1.5 py-1.5 text-xs font-bold rounded-r-lg border border-l-0 border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-rose-600 hover:text-white hover:border-rose-600 transition-colors cursor-pointer"
                              title={`Remove custom category "${cat.label}"`}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {isStaff && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setShowInlineCatAdder((v) => !v)}
                        className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors shadow-2xs cursor-pointer ${
                          showInlineCatAdder
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-600 hover:text-white'
                        }`}
                      >
                        <FolderPlus className="w-3.5 h-3.5" /> + Add New Category
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowInlineColAdder((v) => !v)}
                        className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors shadow-2xs cursor-pointer ${
                          showInlineColAdder
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-600 hover:text-white'
                        }`}
                      >
                        <Columns3 className="w-3.5 h-3.5" /> + Add Live Column
                      </button>
                    </div>
                  )}
                </div>

                {/* Inline Live Category Adder inside the New Vendor Purchase Modal */}
                {isStaff && (
                  <div
                    className={`rounded-xl border border-dashed border-emerald-300 bg-white/95 p-2.5 space-y-2 ${
                      showInlineCatAdder ? 'ring-2 ring-emerald-500/20' : ''
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-bold text-emerald-900 inline-flex items-center gap-1">
                        <FolderPlus className="w-3.5 h-3.5 text-emerald-600" /> Live Add Category:
                      </span>
                      <input
                        className={`${inputCls} !py-1 text-xs flex-1 min-w-[220px] bg-white`}
                        placeholder="Type new product category name (e.g. Transport, Umrah Package, Car Rental)..."
                        value={newCatLabel}
                        onChange={(e) => setNewCatLabel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void handleAddCustomCategory(undefined, true);
                          }
                        }}
                        disabled={colBusy}
                      />
                      <button
                        type="button"
                        disabled={colBusy || !newCatLabel.trim()}
                        onClick={() => handleAddCustomCategory(undefined, true)}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-all disabled:opacity-50 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" /> {colBusy ? 'Adding...' : '+ Add Category Live'}
                      </button>
                    </div>

                    {customCategories.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-100">
                        <span className="text-[10px] font-semibold text-slate-400">Custom categories (click × to remove):</span>
                        {customCategories.map((cat) => (
                          <span
                            key={cat.id}
                            className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200"
                          >
                            <span className="font-semibold">{cat.label}</span>
                            <button
                              type="button"
                              onClick={() => handleRemoveCustomCategory(cat)}
                              disabled={colBusy}
                              className="text-emerald-600 hover:text-rose-600 cursor-pointer"
                              title={`Remove category "${cat.label}"`}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Inline Live Column Adder & Remover inside the New Vendor Purchase Modal */}
                {isStaff && (
                  <div
                    className={`rounded-xl border border-dashed border-indigo-300 bg-white/95 p-2.5 space-y-2 ${
                      showInlineColAdder ? 'ring-2 ring-indigo-500/20' : ''
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-bold text-indigo-900 inline-flex items-center gap-1">
                        <Columns3 className="w-3.5 h-3.5 text-indigo-600" /> Live Add Column:
                      </span>
                      <select
                        className={`${inputCls} !w-auto !py-1 text-xs bg-white`}
                        value={newColCategory}
                        onChange={(e) => setNewColCategory(e.target.value as PurchaseCategory | 'all')}
                        disabled={colBusy}
                      >
                        <option value="all">All Categories</option>
                        {allCategoryEntries.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                      <input
                        className={`${inputCls} !py-1 text-xs flex-1 min-w-[200px] bg-white`}
                        placeholder="Type new column name to add live right now (updates preview as you type)..."
                        value={newColLabel}
                        onChange={(e) => setNewColLabel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void handleAddCustomColumn();
                          }
                        }}
                        disabled={colBusy}
                      />
                      <button
                        type="button"
                        disabled={colBusy || !newColLabel.trim()}
                        onClick={() => handleAddCustomColumn()}
                        className={`${btnPrimary} !py-1 !px-3 text-xs`}
                      >
                        <Plus className="w-3.5 h-3.5" /> {colBusy ? 'Adding...' : '+ Add Field Live'}
                      </button>
                    </div>

                    {customFields.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-100">
                        <span className="text-[10px] font-semibold text-slate-400">Active columns (click × to remove):</span>
                        {customFields.map((cf) => (
                          <span
                            key={cf.id}
                            className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-900 border border-indigo-200"
                          >
                            <span className="font-semibold">{cf.label}</span>
                            <span className="text-[9px] uppercase px-1 rounded bg-white text-slate-600">
                              {cf.category === 'all' ? 'All' : getCategoryMeta(cf.category, customCategories).label}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleRemoveCustomColumn(cf)}
                              disabled={colBusy}
                              className="text-indigo-500 hover:text-rose-600 cursor-pointer"
                              title={`Remove column "${cf.label}"`}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {colNotice && <div className="text-xs font-semibold text-emerald-700">{colNotice}</div>}
                {colError && <div className="text-xs font-semibold text-rose-600">{colError}</div>}
              </div>

              {/* Product Entry Blocks */}
              <div className="space-y-4">
                {form.items.map((it, idx) => {
                  const meta = getCategoryMeta(it.category, customCategories);
                  const Icon = meta.Icon;
                  const applicableCustomFields = customFields.filter(
                    (cf) => cf.category === 'all' || cf.category === it.category
                  );

                  return (
                    <div
                      key={it.id}
                      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold">
                            {idx + 1}
                          </span>
                          <Icon className="w-4 h-4 text-blue-600" />
                          <span className="text-sm font-bold text-slate-900">{meta.label}</span>
                          <select
                            className={`${inputCls} !w-auto !py-1 text-xs font-semibold`}
                            value={it.category}
                            onChange={(e) => patchItem(idx, { category: e.target.value as PurchaseCategory })}
                          >
                            {allCategoryEntries.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="flex items-center gap-2">
                          {isStaff && (
                            <button
                              type="button"
                              onClick={() => {
                                setNewColCategory(it.category);
                                setShowInlineColAdder(true);
                              }}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg border border-indigo-200 cursor-pointer"
                              title={`Add a live custom column to ${meta.label}`}
                            >
                              <Columns3 className="w-3 h-3" /> + Add Column
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => removeItem(idx)}
                            className="inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-700 font-medium px-2 py-1 rounded-lg hover:bg-rose-50 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Remove
                          </button>
                        </div>
                      </div>

                      {/* Category-Specific Fields */}
                      {it.category === 'ticket' && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                          <Field label="Ticket Number *">
                            <input
                              className={`${inputCls} font-mono`}
                              value={it.ticketNumber}
                              onChange={(e) => patchItem(idx, { ticketNumber: e.target.value })}
                              placeholder="e.g. 214-4829104921"
                            />
                          </Field>
                          <Field label="Issued From / Vendor *">
                            <input
                              className={inputCls}
                              value={it.vendorName}
                              onChange={(e) => patchItem(idx, { vendorName: e.target.value })}
                              placeholder="e.g. MEEZAB AIR / Travelport"
                            />
                          </Field>
                          <Field label="Currency">
                            <select
                              className={inputCls}
                              value={it.currency}
                              onChange={(e) => patchItem(idx, { currency: e.target.value })}
                            >
                              {currencies.map((c) => (
                                <option key={c.code} value={c.code}>
                                  {currencyLabel(c)}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Payment Due Date">
                            <input
                              type="date"
                              className={inputCls}
                              value={it.paymentDueDate}
                              onChange={(e) => patchItem(idx, { paymentDueDate: e.target.value })}
                            />
                          </Field>
                        </div>
                      )}

                      {it.category === 'hotel' && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                          <Field label="Hotel Name *">
                            <input
                              className={inputCls}
                              value={it.hotelName}
                              onChange={(e) => patchItem(idx, { hotelName: e.target.value })}
                              placeholder="e.g. Pullman Zamzam"
                            />
                          </Field>
                          <Field label="Rooms">
                            <input
                              className={inputCls}
                              value={it.rooms}
                              onChange={(e) => patchItem(idx, { rooms: e.target.value })}
                              placeholder="e.g. 2 Double / 1 Quad"
                            />
                          </Field>
                          <Field label="Check In Date">
                            <input
                              type="date"
                              className={inputCls}
                              value={it.checkInDate}
                              onChange={(e) => patchItem(idx, { checkInDate: e.target.value })}
                            />
                          </Field>
                          <Field label="Check Out Date">
                            <input
                              type="date"
                              className={inputCls}
                              value={it.checkOutDate}
                              onChange={(e) => patchItem(idx, { checkOutDate: e.target.value })}
                            />
                          </Field>
                          <Field label="Vendor / Issued By *">
                            <input
                              className={inputCls}
                              value={it.vendorName}
                              onChange={(e) => patchItem(idx, { vendorName: e.target.value })}
                              placeholder="Vendor name"
                            />
                          </Field>
                          <Field label="Currency">
                            <select
                              className={inputCls}
                              value={it.currency}
                              onChange={(e) => patchItem(idx, { currency: e.target.value })}
                            >
                              {currencies.map((c) => (
                                <option key={c.code} value={c.code}>
                                  {currencyLabel(c)}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Payment Due Date">
                            <input
                              type="date"
                              className={inputCls}
                              value={it.paymentDueDate}
                              onChange={(e) => patchItem(idx, { paymentDueDate: e.target.value })}
                            />
                          </Field>
                        </div>
                      )}

                      {it.category === 'visa' && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                          <Field label="Countries *">
                            <input
                              className={inputCls}
                              value={it.countries}
                              onChange={(e) => patchItem(idx, { countries: e.target.value })}
                              placeholder="e.g. Saudi Arabia, UAE, UK"
                            />
                          </Field>
                          <Field label="Visa Type *">
                            <input
                              className={inputCls}
                              value={it.visaType}
                              onChange={(e) => patchItem(idx, { visaType: e.target.value })}
                              placeholder="e.g. Umrah Visa / 30 Days Tourist"
                            />
                          </Field>
                          <Field label="Vendor *">
                            <input
                              className={inputCls}
                              value={it.vendorName}
                              onChange={(e) => patchItem(idx, { vendorName: e.target.value })}
                              placeholder="Vendor name"
                            />
                          </Field>
                          <Field label="Currency">
                            <select
                              className={inputCls}
                              value={it.currency}
                              onChange={(e) => patchItem(idx, { currency: e.target.value })}
                            >
                              {currencies.map((c) => (
                                <option key={c.code} value={c.code}>
                                  {currencyLabel(c)}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Payment Due Date">
                            <input
                              type="date"
                              className={inputCls}
                              value={it.paymentDueDate}
                              onChange={(e) => patchItem(idx, { paymentDueDate: e.target.value })}
                            />
                          </Field>
                        </div>
                      )}

                      {it.category === 'tour' && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                          <Field label="Description of Tour *">
                            <input
                              className={inputCls}
                              value={it.tourDescription}
                              onChange={(e) => patchItem(idx, { tourDescription: e.target.value })}
                              placeholder="e.g. Baku City Tour + Airport Transfers"
                            />
                          </Field>
                          <Field label="Date">
                            <input
                              type="date"
                              className={inputCls}
                              value={it.tourDate}
                              onChange={(e) => patchItem(idx, { tourDate: e.target.value })}
                            />
                          </Field>
                          <Field label="Number of Persons">
                            <input
                              type="number"
                              min="1"
                              className={inputCls}
                              value={it.persons}
                              onChange={(e) => patchItem(idx, { persons: e.target.value })}
                              placeholder="e.g. 4"
                            />
                          </Field>
                          <Field label="Vendor / Issued From *">
                            <input
                              className={inputCls}
                              value={it.vendorName}
                              onChange={(e) => patchItem(idx, { vendorName: e.target.value })}
                              placeholder="Vendor name"
                            />
                          </Field>
                          <Field label="Currency">
                            <select
                              className={inputCls}
                              value={it.currency}
                              onChange={(e) => patchItem(idx, { currency: e.target.value })}
                            >
                              {currencies.map((c) => (
                                <option key={c.code} value={c.code}>
                                  {currencyLabel(c)}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Payment Due Date">
                            <input
                              type="date"
                              className={inputCls}
                              value={it.paymentDueDate}
                              onChange={(e) => patchItem(idx, { paymentDueDate: e.target.value })}
                            />
                          </Field>
                        </div>
                      )}

                      {it.category === 'insurance' && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                          <Field label="Insurance Type *">
                            <input
                              className={inputCls}
                              value={it.insuranceType}
                              onChange={(e) => patchItem(idx, { insuranceType: e.target.value })}
                              placeholder="e.g. Schengen Travel Insurance / Gold"
                            />
                          </Field>
                          <Field label="Days">
                            <input
                              type="number"
                              min="1"
                              className={inputCls}
                              value={it.insuranceDays}
                              onChange={(e) => patchItem(idx, { insuranceDays: e.target.value })}
                              placeholder="e.g. 15"
                            />
                          </Field>
                          <Field label="Vendor / Issued From *">
                            <input
                              className={inputCls}
                              value={it.vendorName}
                              onChange={(e) => patchItem(idx, { vendorName: e.target.value })}
                              placeholder="Vendor name"
                            />
                          </Field>
                          <Field label="Currency">
                            <select
                              className={inputCls}
                              value={it.currency}
                              onChange={(e) => patchItem(idx, { currency: e.target.value })}
                            >
                              {currencies.map((c) => (
                                <option key={c.code} value={c.code}>
                                  {currencyLabel(c)}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Payment Due Date">
                            <input
                              type="date"
                              className={inputCls}
                              value={it.paymentDueDate}
                              onChange={(e) => patchItem(idx, { paymentDueDate: e.target.value })}
                            />
                          </Field>
                        </div>
                      )}

                      {(it.category === 'other' || meta.isCustom) && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                          <Field label={`${meta.label} Description`}>
                            <input
                              className={inputCls}
                              value={it.description}
                              onChange={(e) => patchItem(idx, { description: e.target.value })}
                              placeholder={`Describe ${meta.label.toLowerCase()}...`}
                            />
                          </Field>
                          <Field label="Vendor / Issued From *">
                            <input
                              className={inputCls}
                              value={it.vendorName}
                              onChange={(e) => patchItem(idx, { vendorName: e.target.value })}
                              placeholder="Vendor name"
                            />
                          </Field>
                          <Field label="Currency">
                            <select
                              className={inputCls}
                              value={it.currency}
                              onChange={(e) => patchItem(idx, { currency: e.target.value })}
                            >
                              {currencies.map((c) => (
                                <option key={c.code} value={c.code}>
                                  {currencyLabel(c)}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Payment Due Date">
                            <input
                              type="date"
                              className={inputCls}
                              value={it.paymentDueDate}
                              onChange={(e) => patchItem(idx, { paymentDueDate: e.target.value })}
                            />
                          </Field>
                        </div>
                      )}

                      {/* Quantity, Unit Payable, Total Payable & Optional Receivable Row */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
                        <Field label={`Unit Payable (${it.currency}) *`}>
                          <input
                            type="number"
                            step="any"
                            className={`${inputCls} font-mono`}
                            value={it.unitPayable}
                            onChange={(e) => patchItem(idx, { unitPayable: e.target.value })}
                            placeholder="0.00"
                          />
                        </Field>
                        <Field label="Quantity / Units">
                          <input
                            type="number"
                            min="1"
                            step="1"
                            className={`${inputCls} font-mono`}
                            value={it.quantity}
                            onChange={(e) => patchItem(idx, { quantity: e.target.value })}
                            placeholder="1"
                          />
                        </Field>
                        <Field label={`Total Payable (${it.currency}) *`}>
                          <input
                            type="number"
                            step="any"
                            className={`${inputCls} font-mono font-bold bg-amber-50/40`}
                            value={it.payable}
                            onChange={(e) => patchItem(idx, { payable: e.target.value })}
                            placeholder="0.00"
                          />
                        </Field>
                        <Field label={`Receivable (${it.currency}) (optional)`}>
                          <input
                            type="number"
                            step="any"
                            className={`${inputCls} font-mono`}
                            value={it.receivable}
                            onChange={(e) => patchItem(idx, { receivable: e.target.value })}
                            placeholder="Optional"
                          />
                        </Field>
                      </div>

                      {/* Paid By Section — Present in EVERY Category with Separate Faiq Card & Ali Card Options */}
                      <div className="rounded-xl border border-slate-200/90 bg-slate-50/80 p-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          <Field label="Paid By (Payment Method)">
                            <select
                              className={`${inputCls} bg-white font-semibold`}
                              value={it.paidByMethod}
                              onChange={(e) =>
                                patchItem(idx, {
                                  paidByMethod: e.target.value as PaidByMethodType,
                                })
                              }
                            >
                              <option value="unpaid">Unpaid / On Credit (Payable Due)</option>
                              <option value="faiq_card">Option A: Paid by Faiq Card (Which Bank)</option>
                              <option value="ali_card">Option B: Paid by Ali's Card</option>
                              <option value="third_party">Option C: Third Party</option>
                              <option value="other">Option D: Others (Specify)</option>
                              <option value="bank_transfer">Paid by Bank Transfer</option>
                              <option value="cash">Paid by Cash</option>
                            </select>
                          </Field>

                          {(it.paidByMethod === 'faiq_card' ||
                            it.paidByMethod === 'ali_card' ||
                            it.paidByMethod === 'bank_transfer') && (
                            <Field label="Which Bank (Optional)">
                              <input
                                className={`${inputCls} bg-white`}
                                value={it.cardBank}
                                onChange={(e) => patchItem(idx, { cardBank: e.target.value })}
                                placeholder="e.g. Meezan Bank / HBL / Alfalah (Optional)"
                              />
                            </Field>
                          )}

                          {(it.paidByMethod === 'third_party' || it.paidByMethod === 'other') && (
                            <Field
                              label={
                                it.paidByMethod === 'third_party'
                                  ? 'Specify Third Party Name / Details'
                                  : 'Specify Payment Details'
                              }
                            >
                              <input
                                className={`${inputCls} bg-white`}
                                value={it.paidBySpecify}
                                onChange={(e) => patchItem(idx, { paidBySpecify: e.target.value })}
                                placeholder="Enter name / details..."
                              />
                            </Field>
                          )}
                        </div>
                      </div>

                      {/* Live Custom Columns for this Category — WITH DIRECT REMOVE BUTTON ON EACH COLUMN */}
                      {applicableCustomFields.length > 0 && (
                        <div className="pt-2 border-t border-dashed border-slate-200">
                          <div className="text-[11px] font-bold uppercase tracking-wider text-blue-700 mb-2 flex items-center gap-1.5">
                            <Columns3 className="w-3.5 h-3.5" /> Custom Live Columns
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {applicableCustomFields.map((cf) => (
                              <div key={cf.id} className="block">
                                <div className="flex items-center justify-between gap-2 mb-1">
                                  <span className="text-[11px] font-semibold text-slate-600">{cf.label}</span>
                                  {isStaff && (
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveCustomColumn(cf)}
                                      disabled={colBusy}
                                      className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 px-1.5 py-0.5 rounded border border-rose-200 transition-colors cursor-pointer"
                                      title={`Remove "${cf.label}" column`}
                                    >
                                      <X className="w-3 h-3" /> Remove
                                    </button>
                                  )}
                                </div>
                                <input
                                  className={inputCls}
                                  value={it.customValues?.[cf.id] ?? it.customValues?.[cf.label] ?? ''}
                                  onChange={(e) => patchItemCustom(idx, cf.id, e.target.value)}
                                  placeholder={`Enter ${cf.label}...`}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Notes & Live Summary Footer */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pt-2">
                <Field label="Purchase Notes / Remarks (Optional)">
                  <textarea
                    rows={2}
                    className={inputCls}
                    value={form.notes}
                    onChange={(e) => patchForm({ notes: e.target.value })}
                    placeholder="Any additional vendor payment instructions or office remarks..."
                  />
                </Field>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex flex-col justify-center space-y-1.5 text-xs">
                  <div className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
                    Live Purchase Totals
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-slate-600">Total Payable to Vendors:</span>
                    <div className="flex flex-wrap gap-2">
                      {formTotals.payables.map(([cur, amt]) => (
                        <span key={cur} className="font-mono font-bold text-amber-800 text-sm">
                          {cur} {fmtAmount(amt)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-slate-600">Total Receivable from Customer (optional):</span>
                    <div className="flex flex-wrap gap-2">
                      {formTotals.receivables.length ? (
                        formTotals.receivables.map(([cur, amt]) => (
                          <span key={cur} className="font-mono font-bold text-blue-700 text-sm">
                            {cur} {fmtAmount(amt)}
                          </span>
                        ))
                      ) : (
                        <span className="font-mono text-slate-400">—</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button type="button" onClick={() => setForm(null)} className={btnGhost}>
                  Cancel
                </button>
                <button type="button" disabled={busy} onClick={submitForm} className={btnPrimary}>
                  <Check className="w-4 h-4" /> {busy ? 'Saving...' : 'Save Vendor Purchase'}
                </button>
              </div>
            </div>

            {/* RIGHT COLUMN: Sticky Live Preview (Just like General +New Invoice Modal) */}
            {livePreviewPurchase && (
              <div className="w-full xl:w-[540px] shrink-0 xl:sticky xl:top-0">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 flex items-center justify-between">
                  <span>LIVE PREVIEW — UPDATES AS YOU TYPE</span>
                  {newColLabel.trim() && (
                    <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200">
                      Previewing new column: "{newColLabel.trim()}"
                    </span>
                  )}
                </div>
                <PurchasePreview
                  purchase={livePreviewPurchase}
                  company={crm.data.company}
                  customFields={customFields}
                  customCategories={customCategories}
                  draftColumnLabel={newColLabel.trim()}
                  draftColumnCategory={newColCategory}
                  preparedBy={currentUser.name}
                />
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* View Detail Modal */}
      <Modal
        isOpen={Boolean(viewing)}
        title={viewing ? `Vendor Purchase ${viewing.purchaseNo}` : ''}
        subtitle={
          viewing
            ? `Customer: ${viewing.customerName}${viewing.careOf ? ` · C/O: ${viewing.careOf}` : ''}${
                viewing.crmId ? ` · Query Code / CRM ID: ${viewing.crmId}` : ''
              }`
            : ''
        }
        onClose={() => setViewing(null)}
        maxWidth="4xl"
      >
        {viewing && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={viewing.status === 'paid' ? 'green' : viewing.status === 'partial' ? 'blue' : 'amber'}>
                  {viewing.status === 'paid' ? 'Paid' : viewing.status === 'partial' ? 'Partially Paid' : 'Unpaid / Credit'}
                </Pill>
                <Pill tone={viewing.posted ? 'green' : 'slate'}>{viewing.posted ? '✓ Posted' : 'Not posted'}</Pill>
                {viewing.posted && viewing.postedBy && <span className="text-xs text-slate-500">Posted by {empName.get(viewing.postedBy) || 'Accounts'} · {niceDate(viewing.postedAt)}</span>}
                <span className="text-xs text-slate-500">
                  Date: <b>{niceDate(viewing.purchaseDate)}</b> · Created by{' '}
                  <b>{empName.get(viewing.createdBy) || 'Employee'}</b>
                </span>
              </div>
              <div className="flex items-center gap-2">
                {isStaff && <button type="button" className={btnGhost} disabled={postingId !== null} onClick={() => void changePurchasePosting(viewing)}>{postingId === viewing.id ? 'Saving…' : viewing.posted ? 'Unpost' : 'Mark as posted'}</button>}
                <button
                  type="button"
                  onClick={() => {
                    const target = viewing;
                    setViewing(null);
                    setForm(toForm(target));
                  }}
                  className={btnGhost}
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit Purchase
                </button>
              </div>
            </div>

            <PurchasePreview
              purchase={viewing}
              company={crm.data.company}
              customFields={customFields}
              customCategories={customCategories}
              preparedBy={empName.get(viewing.createdBy) || currentUser.name}
            />
          </div>
        )}
      </Modal>
    </div>
  );
};

const PurchasePreview: React.FC<{
  purchase: CrmPurchase;
  company: CompanyProfile;
  customFields: PurchaseCustomField[];
  customCategories: PurchaseCustomCategory[];
  draftColumnLabel?: string;
  draftColumnCategory?: PurchaseCategory | 'all';
  preparedBy?: string;
}> = ({
  purchase,
  company,
  customFields,
  customCategories,
  draftColumnLabel,
  draftColumnCategory = 'all',
  preparedBy,
}) => {
  const items = purchase.items || [];
  const totalsByCur = useMemo(() => {
    const payMap = new Map<string, number>();
    const recMap = new Map<string, number>();
    items.forEach((it) => {
      const c = it.currency || purchase.currency || 'PKR';
      payMap.set(c, (payMap.get(c) || 0) + (Number(it.payable) || 0));
      if (it.receivable !== null && it.receivable !== undefined) {
        recMap.set(c, (recMap.get(c) || 0) + (Number(it.receivable) || 0));
      }
    });
    return { payables: [...payMap.entries()], receivables: [...recMap.entries()] };
  }, [items, purchase.currency]);

  const meta: [string, string][] = [
    ['Purchase No', purchase.purchaseNo],
    ['Purchase Date', niceDate(purchase.purchaseDate)],
  ];
  if (purchase.careOf) meta.push(['C/O', purchase.careOf]);
  if (purchase.crmId) meta.push(['Query / CRM ID', purchase.crmId]);
  if (company.ntn) meta.push(['NTN#', company.ntn]);

  return (
    <div className="bg-white text-slate-900 rounded-lg border border-slate-300 p-5 text-[12px] leading-snug">
      <img src="/bahaar-logo.png" alt={company.name || 'Bahaar Journeys'} className="w-[88%] max-w-[440px] h-auto" />
      <div className="flex justify-between gap-4 mt-2">
        <div className="min-w-0">
          <p className="text-[9px] font-bold text-slate-500 tracking-wider">CUSTOMER</p>
          <p className="font-bold text-sm break-words">{purchase.customerName || '—'}</p>
          {purchase.careOf && <p className="text-xs text-slate-700">C/O: <b>{purchase.careOf}</b></p>}
          {purchase.crmId && <p className="text-xs font-mono text-indigo-700">Query Code / CRM ID: <b>{purchase.crmId}</b></p>}
        </div>
        <table className="text-[11px] border border-slate-700 self-start shrink-0">
          <tbody>
            {meta.map(([k, v]) => (
              <tr key={k}>
                <td className="border border-slate-700 px-2 py-0.5">{k}</td>
                <td className="border border-slate-700 px-2 py-0.5 font-bold text-center min-w-[110px]">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4 className="text-center font-serif font-bold text-xl my-3">VENDOR PURCHASE</h4>

      <div className="overflow-x-auto">
        <table className="w-full border border-slate-700 border-collapse min-w-[420px]">
          <thead>
            <tr className="text-[10px]">
              <th className="border border-slate-700 px-1.5 py-1 text-center w-8">SN</th>
              <th className="border border-slate-700 px-2 py-1 text-left">DESCRIPTION & VENDOR DETAILS</th>
              <th className="border border-slate-700 px-1.5 py-1 text-center w-24">UNIT PRICE</th>
              <th className="border border-slate-700 px-1.5 py-1 text-center w-14">UNITS</th>
              <th className="border border-slate-700 px-2 py-1 text-right w-28">PAYABLE</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => {
              const metaCat = getCategoryMeta(it.category, customCategories, it.categoryLabel);
              const cur = it.currency || purchase.currency || 'PKR';
              const qty = it.quantity && Number(it.quantity) > 0 ? Number(it.quantity) : 1;
              const unitPay =
                it.unitPayable !== null && it.unitPayable !== undefined
                  ? Number(it.unitPayable)
                  : qty > 0
                    ? (Number(it.payable) || 0) / qty
                    : Number(it.payable) || 0;
              const itemCustomFields = customFields.filter(
                (cf) => cf.category === 'all' || cf.category === it.category
              );
              const showDraftCol =
                Boolean(draftColumnLabel) &&
                (draftColumnCategory === 'all' || draftColumnCategory === it.category);

              return (
                <tr key={it.id || i} className="align-top border-t border-slate-300">
                  <td className="border-x border-slate-700 px-1.5 py-1.5 text-center font-bold">{i + 1}</td>
                  <td className="border-x border-slate-700 px-2 py-1.5 space-y-0.5">
                    <div className="font-bold text-slate-900">
                      {metaCat.label} — <span className="text-amber-800">Vendor: {it.vendorName || '—'}</span>
                    </div>
                    {it.category === 'ticket' && it.ticketNumber && (
                      <div className="text-slate-700">Ticket #: <b className="font-mono">{it.ticketNumber}</b></div>
                    )}
                    {it.category === 'hotel' && (
                      <div className="text-slate-700">
                        Hotel: <b>{it.hotelName || '—'}</b>
                        {it.rooms ? ` · Rooms: ${it.rooms}` : ''}
                        {it.checkInDate ? ` · Check-In: ${niceDate(it.checkInDate)}` : ''}
                        {it.checkOutDate ? ` · Check-Out: ${niceDate(it.checkOutDate)}` : ''}
                      </div>
                    )}
                    {it.category === 'visa' && (
                      <div className="text-slate-700">
                        Countries: <b>{it.countries || '—'}</b> · Visa Type: <b>{it.visaType || '—'}</b>
                      </div>
                    )}
                    {it.category === 'tour' && (
                      <div className="text-slate-700">
                        Tour: <b>{it.tourDescription || '—'}</b>
                        {it.tourDate ? ` · Date: ${niceDate(it.tourDate)}` : ''}
                        {it.persons ? ` · Persons: ${it.persons}` : ''}
                      </div>
                    )}
                    {it.category === 'insurance' && (
                      <div className="text-slate-700">
                        Type: <b>{it.insuranceType || '—'}</b>
                        {it.insuranceDays ? ` · Days: ${it.insuranceDays}` : ''}
                      </div>
                    )}
                    {(it.category === 'other' || metaCat.isCustom) && it.description && (
                      <div className="text-slate-700">Details: <b>{it.description}</b></div>
                    )}
                    <div className="text-[10px] text-slate-600">
                      Paid By: <b className="text-slate-900">{formatPaidByLabel(it)}</b>
                      {it.paymentDueDate ? ` · Due: ${niceDate(it.paymentDueDate)}` : ''}
                      {it.receivable !== null && it.receivable !== undefined
                        ? ` · Receivable: ${cur} ${fmtAmount(it.receivable)}`
                        : ''}
                    </div>

                    {/* Active Custom Columns in Live Preview */}
                    {itemCustomFields.map((cf) => {
                      const val = getCustomFieldValue(it, cf);
                      return (
                        <div key={cf.id} className="text-[10px] text-indigo-800">
                          {cf.label}: <b>{val || '—'}</b>
                        </div>
                      );
                    })}

                    {/* Live Preview of Draft Column Being Typed */}
                    {showDraftCol && (
                      <div className="text-[10px] text-indigo-700 font-semibold bg-indigo-50 px-1.5 py-0.5 rounded inline-block border border-indigo-200">
                        + {draftColumnLabel}: —
                      </div>
                    )}
                  </td>
                  <td className="border-x border-slate-700 px-1.5 py-1.5 text-center font-mono">
                    {cur} {fmtAmount(unitPay)}
                  </td>
                  <td className="border-x border-slate-700 px-1.5 py-1.5 text-center font-mono">
                    {fmtAmount(qty)}
                  </td>
                  <td className="border-x border-slate-700 px-2 py-1.5 text-right font-mono font-bold">
                    {cur} {fmtAmount(it.payable || 0)}
                  </td>
                </tr>
              );
            })}
            <tr className="border-t border-slate-700 font-bold">
              <td className="border-x border-slate-700" />
              <td className="border-x border-slate-700" />
              <td className="border-slate-700" />
              <td className="text-center py-1.5">Total Payable</td>
              <td className="border border-slate-700 text-right px-2 font-mono">
                {totalsByCur.payables.length
                  ? totalsByCur.payables.map(([c, amt]) => (
                      <div key={c}>
                        {c} {fmtAmount(amt)}
                      </div>
                    ))
                  : '0'}
              </td>
            </tr>
            {totalsByCur.receivables.length > 0 && (
              <tr className="border-t border-slate-700 font-bold text-blue-800">
                <td className="border-x border-slate-700" />
                <td className="border-x border-slate-700" />
                <td className="border-slate-700" />
                <td className="text-center py-1.5">Receivable</td>
                <td className="border border-slate-700 text-right px-2 font-mono">
                  {totalsByCur.receivables.map(([c, amt]) => (
                    <div key={c}>
                      {c} {fmtAmount(amt)}
                    </div>
                  ))}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {purchase.notes && (
        <div className="mt-2">
          <p className="text-[9px] font-bold text-slate-500">NOTES</p>
          <p className="whitespace-pre-wrap text-slate-600">{purchase.notes}</p>
        </div>
      )}

      <div className="mt-3 flex justify-between items-end">
        <div>
          <p className="text-[10px] text-slate-500">Internal vendor purchase record</p>
          {preparedBy && <p className="text-[9px] text-slate-400">Prepared by {preparedBy}</p>}
        </div>
        <p className="text-[9px] text-slate-500 border-t border-slate-500 pt-0.5 px-6">Authorised signature</p>
      </div>
    </div>
  );
};
