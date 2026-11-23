import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, FileDown, Share2, Eye, Pencil, Building2, FileText, X, Lock, Info, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { Employee } from '../types';
import { Modal } from '../components/common/Modal';
import { CompanyProfile, CrmInvoice, InvoiceSection, VisaProgressStatus, crmCall, updateInvoiceVisaProgress } from './crmApi';
import { crmQueryOf, ntnShown } from './invoiceHelpers';
import { PortalInvoiceModal } from './PortalInvoiceModal';
// The PDF maker is large, so it is only loaded when someone actually downloads or shares an invoice.
const downloadInvoicePdf = async (...a: Parameters<typeof import('./invoicePdf').downloadInvoicePdf>) => (await import('./invoicePdf')).downloadInvoicePdf(...a);
const downloadVendorPayablesPdf = async (...a: Parameters<typeof import('./invoicePdf').downloadVendorPayablesPdf>) => (await import('./invoicePdf')).downloadVendorPayablesPdf(...a);
const invoicePdfFile = async (...a: Parameters<typeof import('./invoicePdf').invoicePdfFile>) => (await import('./invoicePdf')).invoicePdfFile(...a);
import { CrmState } from './useCrm';
import { ErrorNote, Field, Pill, StatBar, btnDanger, btnGhost, btnPrimary, cardCls, inputCls } from './ui';
import { allCurrencies, currencyLabel, fmtAmount } from './currencies';

interface Props {
  crm: CrmState;
  employees: Employee[];
  currentUser: Employee;
  customerPortalBetaEnabled?: boolean;
}

interface FormLine { description: string; unitPrice: string; units: string; currency: string; rate: string; taxable: boolean; note: boolean; key: string; locked: boolean }
interface FormSection { title: string; key: string; locked: boolean; lines: FormLine[] }
interface FormVendor { name: string; description: string; unitPrice: string; units: string; amount: string; currency: string; bank: string }
interface FormState {
  id?: string;
  kind: 'customer' | 'vendor';
  invoiceNo?: string;
  /** one box: "CRM ID / Query Code" */
  crmId: string;
  customerName: string; customerPhone: string; reference: string;
  ntn: string; showNtn: boolean;
  vendors: FormVendor[];
  invoiceDate: string; dueDate: string; currency: string;
  sections: FormSection[];
  taxLabel: string; taxRate: string; discount: string; advancePaid: string; notes: string;
  paymentApproved: boolean;
  paymentApprovedDate: string;
  paymentReceived: boolean;
  travelerNames: string;
  visaEnabled: boolean;
  visaStatus: VisaProgressStatus;
  visaInProgressDate: string;
  visaIssuedDate: string;
  hotelEnabled: boolean;
  hotelStatus: VisaProgressStatus;
  hotelName: string;
  hotelCheckInDate: string;
  hotelCheckOutDate: string;
  hotelInProgressDate: string;
  hotelIssuedDate: string;
  ticketEnabled: boolean;
  ticketStatus: VisaProgressStatus;
  ticketDetails: string;
  ticketInProgressDate: string;
  ticketIssuedDate: string;
  transferEnabled: boolean;
  transferStatus: VisaProgressStatus;
  transferDetails: string;
  transferInProgressDate: string;
  transferIssuedDate: string;
  insuranceEnabled: boolean;
  insuranceStatus: VisaProgressStatus;
  insuranceDetails: string;
  insuranceInProgressDate: string;
  insuranceIssuedDate: string;
  travelReadyEnabled: boolean;
  travelReadyDate: string;
}

const today = () => new Date().toLocaleDateString('en-CA'); // yyyy-mm-dd in the person's own time zone
const VISA_WORD_RE = /\b(visa|e-visa|evisa|umrah|ziyarat|hajj|schengen|embassy|sticker\s+visa|asan)\b/i;
const HOTEL_WORD_RE = /\b(hotel|resort|accommodation|stay|room|suite|nights?|check-?in|check-?out|bed\s*&\s*breakfast|half\s+board|full\s+board|package|family\s+tour|group\s+tour|holiday|honeymoon|umrah|ziyarat|hajj|makkah|madinah|baku|shahdag|gabala|dubai|abu\s+dhabi|doha|tashkent|samarkand|almaty|shymbulak|istanbul|cappadocia|antalya|kuala\s+lumpur|langkawi|bangkok|phuket|maldives|pullman|hilton|marriott|hyatt|sheraton|swissotel|fairmont|mov[eé]npick|rotana|intercontinental|radisson|holiday\s+inn|novotel|ibis|villa|palace|apartments?)\b/i;
const TICKET_WORD_RE = /\b(ticket|flight|airfare|airline|pnr|sector|return\s+ticket|one\s+way|pia|emirates|qatar\s+airways|saudia|flydubai|airblue|serene|etihad|turkish\s+airlines|azerbaijan\s+airlines|azal)\b/i;
const TRANSFER_WORD_RE = /\b(transfer|tour|excursion|coaster|transport|pickup|pick-up|drop-off|haramain|train|railway|safari|cruise|cable\s+car|sightseeing|ziyarat\s+tour|package|family\s+tour)\b/i;
const INSURANCE_WORD_RE = /\b(insurance|medical\s+cover|travel\s+care|policy|coverage)\b/i;

const VISA_STATUS_LABEL: Record<VisaProgressStatus, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  issued: 'Issued',
};
const HOTEL_STATUS_LABEL: Record<VisaProgressStatus, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  issued: 'Confirmed',
};
const visaTone = (s: VisaProgressStatus): 'slate' | 'amber' | 'green' => (s === 'issued' ? 'green' : s === 'in_progress' ? 'amber' : 'slate');
const hasVisaKeyword = (
  sections?: Array<{ title?: string; lines?: Array<{ description?: string }> }>,
  reference = '',
  notes = ''
): boolean =>
  VISA_WORD_RE.test(String(reference || '')) ||
  VISA_WORD_RE.test(String(notes || '')) ||
  (sections || []).some((sec) => VISA_WORD_RE.test(String(sec?.title || '')) || (sec?.lines || []).some((ln) => VISA_WORD_RE.test(String(ln?.description || ''))));
const hasHotelKeyword = (
  sections?: Array<{ title?: string; lines?: Array<{ description?: string }> }>,
  reference = '',
  notes = ''
): boolean =>
  HOTEL_WORD_RE.test(String(reference || '')) ||
  HOTEL_WORD_RE.test(String(notes || '')) ||
  (sections || []).some((sec) => HOTEL_WORD_RE.test(String(sec?.title || '')) || (sec?.lines || []).some((ln) => HOTEL_WORD_RE.test(String(ln?.description || ''))));
const hasTicketKeyword = (
  sections?: Array<{ title?: string; lines?: Array<{ description?: string }> }>,
  reference = '',
  notes = ''
): boolean =>
  TICKET_WORD_RE.test(String(reference || '')) ||
  TICKET_WORD_RE.test(String(notes || '')) ||
  (sections || []).some((sec) => TICKET_WORD_RE.test(String(sec?.title || '')) || (sec?.lines || []).some((ln) => TICKET_WORD_RE.test(String(ln?.description || ''))));
const hasTransferKeyword = (
  sections?: Array<{ title?: string; lines?: Array<{ description?: string }> }>,
  reference = '',
  notes = ''
): boolean =>
  TRANSFER_WORD_RE.test(String(reference || '')) ||
  TRANSFER_WORD_RE.test(String(notes || '')) ||
  (sections || []).some((sec) => TRANSFER_WORD_RE.test(String(sec?.title || '')) || (sec?.lines || []).some((ln) => TRANSFER_WORD_RE.test(String(ln?.description || ''))));
const hasInsuranceKeyword = (
  sections?: Array<{ title?: string; lines?: Array<{ description?: string }> }>,
  reference = '',
  notes = ''
): boolean =>
  INSURANCE_WORD_RE.test(String(reference || '')) ||
  INSURANCE_WORD_RE.test(String(notes || '')) ||
  (sections || []).some((sec) => INSURANCE_WORD_RE.test(String(sec?.title || '')) || (sec?.lines || []).some((ln) => INSURANCE_WORD_RE.test(String(ln?.description || ''))));

function extractSmartHotelName(
  sections?: Array<{ title?: string; lines?: Array<{ description?: string }> }>,
  reference = '',
  notes = ''
): string {
  for (const sec of sections || []) {
    const title = String(sec?.title || '').trim();
    for (const ln of sec?.lines || []) {
      const desc = String(ln?.description || '').trim();
      if (HOTEL_WORD_RE.test(desc)) return desc.slice(0, 140);
    }
    if (HOTEL_WORD_RE.test(title)) {
      const firstLine = String(sec?.lines?.[0]?.description || '').trim();
      return (firstLine || title).slice(0, 140);
    }
  }
  if (HOTEL_WORD_RE.test(String(reference || ''))) return String(reference).trim().slice(0, 140);
  if (HOTEL_WORD_RE.test(String(notes || ''))) return String(notes).trim().slice(0, 140);
  return '';
}

const isVisaInvoice = (inv: CrmInvoice): boolean =>
  (inv.kind || 'customer') !== 'vendor' && (Boolean(inv.visaProgress?.enabled) || hasVisaKeyword(inv.sections, inv.reference, inv.notes));
const isHotelInvoice = (inv: CrmInvoice): boolean =>
  (inv.kind || 'customer') !== 'vendor' && (Boolean(inv.visaProgress?.hotelEnabled) || hasHotelKeyword(inv.sections, inv.reference, inv.notes));
const isTicketInvoice = (inv: CrmInvoice): boolean =>
  (inv.kind || 'customer') !== 'vendor' && (Boolean(inv.visaProgress?.ticketEnabled) || hasTicketKeyword(inv.sections, inv.reference, inv.notes));
const isTransferInvoice = (inv: CrmInvoice): boolean =>
  (inv.kind || 'customer') !== 'vendor' && (Boolean(inv.visaProgress?.transferEnabled) || hasTransferKeyword(inv.sections, inv.reference, inv.notes));
const isInsuranceInvoice = (inv: CrmInvoice): boolean =>
  (inv.kind || 'customer') !== 'vendor' && (Boolean(inv.visaProgress?.insuranceEnabled) || hasInsuranceKeyword(inv.sections, inv.reference, inv.notes));
/** An invoice has vendor lines to pay (office record). */
const hasVendorLines = (i: CrmInvoice) => (i.kind || 'customer') === 'customer' && (i.vendors || []).some((v) => v.name || (v.amount ?? 0) > 0);
/** Paid on every side: the customer side, and the vendor side too when the invoice has vendors. */
const fullyPaid = (i: CrmInvoice) => i.status === 'paid' && (!hasVendorLines(i) || i.vendorStatus === 'paid');
const isServiceTitle = (t: string) => /service/i.test(t);
const uid = () => `k${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
const blankLine = (currency: string, taxable = false): FormLine => ({ description: '', unitPrice: '', units: '1', currency, rate: '', taxable, note: false, key: uid(), locked: false });
const newSection = (title: string, currency: string): FormSection => ({ title, key: uid(), locked: false, lines: [blankLine(currency, isServiceTitle(title))] });
const blankVendor = (currency: string): FormVendor => ({ name: '', description: '', unitPrice: '', units: '', amount: '', currency, bank: '' });
const blankForm = (kind: 'customer' | 'vendor' = 'customer', companyNtn = ''): FormState => ({
  kind, crmId: '', customerName: '', customerPhone: '', reference: '', ntn: companyNtn, showNtn: true, vendors: kind === 'customer' ? [blankVendor('PKR')] : [], invoiceDate: today(), dueDate: '', currency: 'PKR',
  sections: [{ title: '', key: uid(), locked: false, lines: [blankLine('PKR')] }], taxLabel: 'Tax', taxRate: kind === 'vendor' ? '' : '6', discount: '', advancePaid: '', notes: '',
  paymentApproved: false, paymentApprovedDate: '', paymentReceived: false, travelerNames: '',
  visaEnabled: false, visaStatus: 'not_started', visaInProgressDate: '', visaIssuedDate: '',
  hotelEnabled: false, hotelStatus: 'not_started', hotelName: '', hotelCheckInDate: '', hotelCheckOutDate: '', hotelInProgressDate: '', hotelIssuedDate: '',
  ticketEnabled: false, ticketStatus: 'not_started', ticketDetails: '', ticketInProgressDate: '', ticketIssuedDate: '',
  transferEnabled: false, transferStatus: 'not_started', transferDetails: '', transferInProgressDate: '', transferIssuedDate: '',
  insuranceEnabled: false, insuranceStatus: 'not_started', insuranceDetails: '', insuranceInProgressDate: '', insuranceIssuedDate: '',
  travelReadyEnabled: false, travelReadyDate: '',
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

function toForm(inv: CrmInvoice, companyNtn = ''): FormState {
  const kind = inv.kind || 'customer';
  return {
    id: inv.id, kind, invoiceNo: inv.invoiceNo, crmId: crmQueryOf(inv), customerName: inv.customerName, customerPhone: inv.customerPhone,
    ntn: inv.ntn === null || inv.ntn === undefined ? companyNtn : inv.ntn, showNtn: inv.showNtn !== false,
    vendors: kind === 'customer' ? ((inv.vendors || []).length ? inv.vendors.map((v) => ({
      name: v.name,
      description: v.description || '',
      unitPrice: v.unitPrice !== null && v.unitPrice !== undefined ? String(v.unitPrice) : '',
      units: v.units !== null && v.units !== undefined ? String(v.units) : '',
      amount: String(v.amount ?? ''),
      currency: v.currency || inv.currency,
      bank: v.bank || '',
    })) : [blankVendor(inv.currency)]) : [],
    reference: inv.reference, invoiceDate: inv.invoiceDate, dueDate: inv.dueDate || '', currency: inv.currency,
    sections: inv.sections.map((s) => ({
      title: s.title, key: s.key || uid(), locked: Boolean(s.locked),
      lines: s.lines.map((l) => ({ key: l.key || uid(), locked: Boolean(l.locked),
        description: l.description, unitPrice: l.note ? '' : String(l.unitPrice ?? ''), units: l.note ? '1' : String(l.units ?? 1), currency: l.currency || inv.currency,
        rate: l.currency && l.currency !== inv.currency ? String(l.rate ?? '') : '', taxable: Boolean(l.taxable), note: Boolean(l.note),
      })),
    })),
    taxLabel: inv.taxLabel, taxRate: inv.taxRate ? String(inv.taxRate) : '', discount: inv.discount ? String(inv.discount) : '', advancePaid: inv.advancePaid ? String(inv.advancePaid) : '', notes: inv.notes,
    paymentApproved: Boolean(inv.visaProgress?.paymentApproved) || inv.status === 'paid' || inv.advancePaid > 0,
    paymentApprovedDate: inv.visaProgress?.paymentApprovedDate || '',
    paymentReceived: Boolean(inv.paymentReceived),
    travelerNames: (inv.travelers || []).join('\n'),
    visaEnabled: Boolean(inv.visaProgress?.enabled) || hasVisaKeyword(inv.sections, inv.reference, inv.notes),
    visaStatus: inv.visaProgress?.status || 'not_started',
    visaInProgressDate: inv.visaProgress?.inProgressDate || '',
    visaIssuedDate: inv.visaProgress?.issuedDate || '',
    hotelEnabled: Boolean(inv.visaProgress?.hotelEnabled) || hasHotelKeyword(inv.sections, inv.reference, inv.notes),
    hotelStatus: inv.visaProgress?.hotelStatus || 'not_started',
    hotelName: inv.visaProgress?.hotelName || extractSmartHotelName(inv.sections, inv.reference, inv.notes),
    hotelCheckInDate: inv.visaProgress?.hotelCheckInDate || '',
    hotelCheckOutDate: inv.visaProgress?.hotelCheckOutDate || '',
    hotelInProgressDate: inv.visaProgress?.hotelInProgressDate || '',
    hotelIssuedDate: inv.visaProgress?.hotelIssuedDate || '',
    ticketEnabled: Boolean(inv.visaProgress?.ticketEnabled) || hasTicketKeyword(inv.sections, inv.reference, inv.notes),
    ticketStatus: inv.visaProgress?.ticketStatus || 'not_started',
    ticketDetails: inv.visaProgress?.ticketDetails || '',
    ticketInProgressDate: inv.visaProgress?.ticketInProgressDate || '',
    ticketIssuedDate: inv.visaProgress?.ticketIssuedDate || '',
    transferEnabled: Boolean(inv.visaProgress?.transferEnabled) || hasTransferKeyword(inv.sections, inv.reference, inv.notes),
    transferStatus: inv.visaProgress?.transferStatus || 'not_started',
    transferDetails: inv.visaProgress?.transferDetails || '',
    transferInProgressDate: inv.visaProgress?.transferInProgressDate || '',
    transferIssuedDate: inv.visaProgress?.transferIssuedDate || '',
    insuranceEnabled: Boolean(inv.visaProgress?.insuranceEnabled) || hasInsuranceKeyword(inv.sections, inv.reference, inv.notes),
    insuranceStatus: inv.visaProgress?.insuranceStatus || 'not_started',
    insuranceDetails: inv.visaProgress?.insuranceDetails || '',
    insuranceInProgressDate: inv.visaProgress?.insuranceInProgressDate || '',
    insuranceIssuedDate: inv.visaProgress?.insuranceIssuedDate || '',
    travelReadyEnabled: Boolean(inv.visaProgress?.travelReadyEnabled),
    travelReadyDate: inv.visaProgress?.travelReadyDate || '',
  };
}

const statusTone = (s: CrmInvoice['status']) => (s === 'paid' ? 'green' : s === 'cancelled' ? 'slate' : 'amber') as 'green' | 'slate' | 'amber';
const niceDate = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

/** On-screen copy of the invoice (the PDF follows the same layout as your sample invoice). */
const InvoicePreview: React.FC<{ inv: CrmInvoice; company: CompanyProfile; by: string }> = ({ inv, company, by }) => {
  const vendor = inv.kind === 'vendor';
  const meta: [string, string][] = [[vendor ? 'Bill No' : 'Invoice No', inv.invoiceNo], [vendor ? 'Bill Date' : 'Invoice Date', niceDate(inv.invoiceDate)]];
  if (inv.dueDate) meta.push(['Due Date', niceDate(inv.dueDate)]);
  const ntn = ntnShown(inv, company);
  if (ntn) meta.push(['NTN#', ntn]);
  if (inv.reference) meta.push(['Reference', inv.reference]);
  if (crmQueryOf(inv)) meta.push(['CRM ID / Query Code', crmQueryOf(inv)]);
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

export const InvoicesView: React.FC<Props> = ({ crm, employees, currentUser, customerPortalBetaEnabled = false }) => {
  const isStaff = currentUser.role === 'admin' || currentUser.role === 'accounts' || currentUser.role === 'ceo';
  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'ceo'; // the CEO has every administrator right here
  const seesAll = isStaff || currentUser.role === 'ceo';
  const { invoices: allInvoices, company } = crm.data;
  const [side, setSide] = useState<'customer' | 'vendor'>('customer');
  const invoices = useMemo(() => allInvoices.filter((i) => (i.kind || 'customer') === side), [allInvoices, side]);
  const vendorSide = side === 'vendor';
  const empName = useMemo(() => new Map(employees.map((e) => [e.id, e.name])), [employees]);
  const currencies = useMemo(() => allCurrencies(), []);

  const [form, setForm] = useState<FormState | null>(null);
  // Cards start folded so the page stays short; people open the ones they need.
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const toggleOpen = (id: string) => setOpenIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const [view, setView] = useState<CrmInvoice | null>(null);
  const [portalFor, setPortalFor] = useState<CrmInvoice | null>(null);
  const canPortalCtl = currentUser.role === 'admin' || currentUser.role === 'ceo' || Boolean(currentUser.customerPortalAccess);
  const [companyForm, setCompanyForm] = useState<CompanyProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState<'all' | 'unpaid' | 'paid' | 'cancelled'>('all');
  const [query, setQuery] = useState('');
  const [canShare, setCanShare] = useState(false);
  const [visaDrafts, setVisaDrafts] = useState<
    Record<
      string,
      {
        paymentApprovedDate: string;
        inProgressDate: string;
        issuedDate: string;
        hotelName: string;
        hotelCheckInDate: string;
        hotelCheckOutDate: string;
        hotelInProgressDate: string;
        hotelIssuedDate: string;
        ticketDetails: string;
        ticketInProgressDate: string;
        ticketIssuedDate: string;
        transferDetails: string;
        transferInProgressDate: string;
        transferIssuedDate: string;
        insuranceDetails: string;
        insuranceInProgressDate: string;
        insuranceIssuedDate: string;
        travelReadyDate: string;
      }
    >
  >({});
  const [visaBusyId, setVisaBusyId] = useState<string | null>(null);

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

  const customerInvoices = useMemo(() => allInvoices.filter((i) => (i.kind || 'customer') === 'customer'), [allInvoices]);
  const vendorInvoices = useMemo(() => allInvoices.filter((i) => i.kind === 'vendor'), [allInvoices]);

  const receivableCounts = useMemo(() => ({
    unpaid: customerInvoices.filter((i) => i.status === 'unpaid').length,
    paid: customerInvoices.filter((i) => i.status === 'paid').length,
    cancelled: customerInvoices.filter((i) => i.status === 'cancelled').length,
  }), [customerInvoices]);

  const payableCounts = useMemo(() => {
    const lines = (i: CrmInvoice) => (i.vendors || []).filter((v) => v.name || (v.amount ?? 0) > 0).length;
    const inlineUnpaid = customerInvoices.filter((i) => i.status !== 'cancelled' && i.vendorStatus !== 'paid').reduce((acc, i) => acc + lines(i), 0);
    const inlinePaid = customerInvoices.filter((i) => i.status !== 'cancelled' && i.vendorStatus === 'paid').reduce((acc, i) => acc + lines(i), 0);
    const inlineCancelled = customerInvoices.filter((i) => i.status === 'cancelled').reduce((acc, i) => acc + lines(i), 0);
    return {
      unpaid: vendorInvoices.filter((i) => i.status === 'unpaid').length + inlineUnpaid,
      paid: vendorInvoices.filter((i) => i.status === 'paid').length + inlinePaid,
      cancelled: vendorInvoices.filter((i) => i.status === 'cancelled').length + inlineCancelled,
    };
  }, [vendorInvoices, customerInvoices]);

  const receivablesOutstanding = useMemo(() => {
    const m = new Map<string, number>();
    customerInvoices.filter((i) => i.status === 'unpaid').forEach((i) => m.set(i.currency, (m.get(i.currency) || 0) + i.balance));
    return [...m.entries()];
  }, [customerInvoices]);

  const payablesOutstanding = useMemo(() => {
    const m = new Map<string, number>();
    vendorInvoices.filter((i) => i.status === 'unpaid').forEach((i) => m.set(i.currency, (m.get(i.currency) || 0) + i.balance));
    customerInvoices.filter((i) => i.status !== 'cancelled' && i.vendorStatus !== 'paid').forEach((i) => {
      (i.vendors || []).forEach((v) => {
        if ((v.amount ?? 0) > 0) {
          const cur = v.currency || i.currency;
          m.set(cur, (m.get(cur) || 0) + v.amount);
        }
      });
    });
    return [...m.entries()];
  }, [vendorInvoices, customerInvoices]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return invoices.filter((i) => (filter === 'all' ? !fullyPaid(i) : filter === 'paid' ? fullyPaid(i) : filter === 'unpaid' ? (i.status === 'unpaid' || (i.status === 'paid' && !fullyPaid(i))) : i.status === filter) && (!q || [i.invoiceNo, i.customerName, i.reference, i.crmId || '', i.queryCode || '', i.customerPhone, empName.get(i.createdBy) || '', ...(i.vendors || []).flatMap((v) => [v.name, v.description || ''])].some((v) => v.toLowerCase().includes(q))));
  }, [invoices, filter, query, empName]);

  const canEdit = (i: CrmInvoice) => isAdmin || (i.createdBy === currentUser.id && i.status === 'unpaid');
  const canUpdateVisa = (i: CrmInvoice) => (i.kind || 'customer') !== 'vendor' && (isStaff || i.createdBy === currentUser.id);
  const calc = form ? compute(form) : null;
  const draft: CrmInvoice | null = form && calc ? {
    id: form.id || 'draft', kind: form.kind, crmId: form.crmId, queryCode: '', vendors: [], ntn: form.ntn.trim(), showNtn: form.showNtn,
    invoiceNo: form.invoiceNo || (form.kind === 'vendor' ? 'PAY-(auto)' : 'INV-(auto)'), createdBy: currentUser.id,
    customerName: form.customerName, customerPhone: form.customerPhone, customerAddress: '', customerNtn: '',
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
  const setFormVisaStatus = (status: VisaProgressStatus) => {
    if (!form) return;
    patch({
      visaStatus: status,
      visaInProgressDate: status === 'not_started' ? '' : (status === 'in_progress' && !form.visaInProgressDate ? today() : form.visaInProgressDate),
      visaIssuedDate: status === 'issued' ? (form.visaIssuedDate || today()) : '',
    });
  };
  const setFormHotelStatus = (status: VisaProgressStatus) => {
    if (!form) return;
    patch({
      hotelStatus: status,
      hotelInProgressDate: status === 'not_started' ? '' : (status === 'in_progress' && !form.hotelInProgressDate ? today() : form.hotelInProgressDate),
      hotelIssuedDate: status === 'issued' ? (form.hotelIssuedDate || today()) : '',
    });
  };
  const setFormTicketStatus = (status: VisaProgressStatus) => {
    if (!form) return;
    patch({
      ticketStatus: status,
      ticketInProgressDate: status === 'not_started' ? '' : (status === 'in_progress' && !form.ticketInProgressDate ? today() : form.ticketInProgressDate),
      ticketIssuedDate: status === 'issued' ? (form.ticketIssuedDate || today()) : '',
    });
  };
  const setFormTransferStatus = (status: VisaProgressStatus) => {
    if (!form) return;
    patch({
      transferStatus: status,
      transferInProgressDate: status === 'not_started' ? '' : (status === 'in_progress' && !form.transferInProgressDate ? today() : form.transferInProgressDate),
      transferIssuedDate: status === 'issued' ? (form.transferIssuedDate || today()) : '',
    });
  };
  const setFormInsuranceStatus = (status: VisaProgressStatus) => {
    if (!form) return;
    patch({
      insuranceStatus: status,
      insuranceInProgressDate: status === 'not_started' ? '' : (status === 'in_progress' && !form.insuranceInProgressDate ? today() : form.insuranceInProgressDate),
      insuranceIssuedDate: status === 'issued' ? (form.insuranceIssuedDate || today()) : '',
    });
  };
  const saveCardVisa = async (
    inv: CrmInvoice,
    nextStatus: VisaProgressStatus,
    inProgressDate: string | null,
    issuedDate: string | null,
    extra?: {
      enabled?: boolean;
      paymentApproved?: boolean;
      paymentApprovedDate?: string | null;
      hotelEnabled?: boolean;
      hotelStatus?: VisaProgressStatus;
      hotelName?: string | null;
      hotelCheckInDate?: string | null;
      hotelCheckOutDate?: string | null;
      hotelInProgressDate?: string | null;
      hotelIssuedDate?: string | null;
      ticketEnabled?: boolean;
      ticketStatus?: VisaProgressStatus;
      ticketDetails?: string | null;
      ticketInProgressDate?: string | null;
      ticketIssuedDate?: string | null;
      transferEnabled?: boolean;
      transferStatus?: VisaProgressStatus;
      transferDetails?: string | null;
      transferInProgressDate?: string | null;
      transferIssuedDate?: string | null;
      insuranceEnabled?: boolean;
      insuranceStatus?: VisaProgressStatus;
      insuranceDetails?: string | null;
      insuranceInProgressDate?: string | null;
      insuranceIssuedDate?: string | null;
      travelReadyEnabled?: boolean;
      travelReadyDate?: string | null;
    }
  ) => {
    if (!customerPortalBetaEnabled || visaBusyId === inv.id) return;
    setVisaBusyId(inv.id);
    setError('');
    try {
      await updateInvoiceVisaProgress({
        id: inv.id,
        enabled: extra?.enabled !== undefined ? extra.enabled : isVisaInvoice(inv),
        status: nextStatus,
        inProgressDate,
        issuedDate,
        ...(extra?.paymentApproved !== undefined ? { paymentApproved: extra.paymentApproved } : {}),
        ...(extra?.paymentApprovedDate !== undefined ? { paymentApprovedDate: extra.paymentApprovedDate } : {}),
        ...(extra?.hotelEnabled !== undefined ? { hotelEnabled: extra.hotelEnabled } : {}),
        ...(extra?.hotelStatus !== undefined ? { hotelStatus: extra.hotelStatus } : {}),
        ...(extra?.hotelName !== undefined ? { hotelName: extra.hotelName } : {}),
        ...(extra?.hotelCheckInDate !== undefined ? { hotelCheckInDate: extra.hotelCheckInDate } : {}),
        ...(extra?.hotelCheckOutDate !== undefined ? { hotelCheckOutDate: extra.hotelCheckOutDate } : {}),
        ...(extra?.hotelInProgressDate !== undefined ? { hotelInProgressDate: extra.hotelInProgressDate } : {}),
        ...(extra?.hotelIssuedDate !== undefined ? { hotelIssuedDate: extra.hotelIssuedDate } : {}),
        ...(extra?.ticketEnabled !== undefined ? { ticketEnabled: extra.ticketEnabled } : {}),
        ...(extra?.ticketStatus !== undefined ? { ticketStatus: extra.ticketStatus } : {}),
        ...(extra?.ticketDetails !== undefined ? { ticketDetails: extra.ticketDetails } : {}),
        ...(extra?.ticketInProgressDate !== undefined ? { ticketInProgressDate: extra.ticketInProgressDate } : {}),
        ...(extra?.ticketIssuedDate !== undefined ? { ticketIssuedDate: extra.ticketIssuedDate } : {}),
        ...(extra?.transferEnabled !== undefined ? { transferEnabled: extra.transferEnabled } : {}),
        ...(extra?.transferStatus !== undefined ? { transferStatus: extra.transferStatus } : {}),
        ...(extra?.transferDetails !== undefined ? { transferDetails: extra.transferDetails } : {}),
        ...(extra?.transferInProgressDate !== undefined ? { transferInProgressDate: extra.transferInProgressDate } : {}),
        ...(extra?.transferIssuedDate !== undefined ? { transferIssuedDate: extra.transferIssuedDate } : {}),
        ...(extra?.insuranceEnabled !== undefined ? { insuranceEnabled: extra.insuranceEnabled } : {}),
        ...(extra?.insuranceStatus !== undefined ? { insuranceStatus: extra.insuranceStatus } : {}),
        ...(extra?.insuranceDetails !== undefined ? { insuranceDetails: extra.insuranceDetails } : {}),
        ...(extra?.insuranceInProgressDate !== undefined ? { insuranceInProgressDate: extra.insuranceInProgressDate } : {}),
        ...(extra?.insuranceIssuedDate !== undefined ? { insuranceIssuedDate: extra.insuranceIssuedDate } : {}),
        ...(extra?.travelReadyEnabled !== undefined ? { travelReadyEnabled: extra.travelReadyEnabled } : {}),
        ...(extra?.travelReadyDate !== undefined ? { travelReadyDate: extra.travelReadyDate } : {}),
      });
      setVisaDrafts((prev) => {
        const next = { ...prev };
        delete next[inv.id];
        return next;
      });
      await crm.refresh();
    } catch (err: any) {
      setError(err?.message || 'Could not update progress status.');
    } finally {
      setVisaBusyId(null);
    }
  };
  const setSection = (si: number, p: Partial<FormSection>) => patch({ sections: form!.sections.map((s, i) => (i === si ? { ...s, ...p } : s)) });
  const setLine = (si: number, li: number, p: Partial<FormLine>) => setSection(si, { lines: form!.sections[si].lines.map((l, i) => (i === li ? { ...l, ...p } : l)) });
  const changeInvoiceCurrency = (code: string) => {
    // lines that were in the old invoice currency follow it
    patch({ currency: code, vendors: form!.vendors.map((v) => (v.currency === form!.currency ? { ...v, currency: code } : v)), sections: form!.sections.map((s) => ({ ...s, lines: s.lines.map((l) => (l.currency === form!.currency ? { ...l, currency: code, rate: '' } : l)) })) });
  };

  const updateVendor = (vi: number, p: Partial<FormVendor>) => {
    if (!form) return;
    const nextVendors = form.vendors.map((v, i) => {
      if (i !== vi) return v;
      const updated = { ...v, ...p };
      if ('unitPrice' in p || 'units' in p) {
        const up = num(updated.unitPrice);
        const un = updated.units.trim() === '' ? 1 : num(updated.units);
        if (Number.isFinite(up) && Number.isFinite(un)) {
          updated.amount = String(Math.round(up * un * 100) / 100);
        }
      }
      return updated;
    });
    patch({ vendors: nextVendors });
  };

  const buildPayload = (lockIdx: number | null) => {
    const {
      paymentApproved,
      paymentApprovedDate,
      paymentReceived,
      travelerNames,
      visaEnabled,
      visaStatus,
      visaInProgressDate,
      visaIssuedDate,
      hotelEnabled,
      hotelStatus,
      hotelName,
      hotelCheckInDate,
      hotelCheckOutDate,
      hotelInProgressDate,
      hotelIssuedDate,
      ticketEnabled,
      ticketStatus,
      ticketDetails,
      ticketInProgressDate,
      ticketIssuedDate,
      transferEnabled,
      transferStatus,
      transferDetails,
      transferInProgressDate,
      transferIssuedDate,
      insuranceEnabled,
      insuranceStatus,
      insuranceDetails,
      insuranceInProgressDate,
      insuranceIssuedDate,
      travelReadyEnabled,
      travelReadyDate,
      ...rest
    } = form!;
    const visaActive = hasVisaKeyword(form!.sections, form!.reference, form!.notes) || visaEnabled;
    const hotelActive = hasHotelKeyword(form!.sections, form!.reference, form!.notes) || hotelEnabled;
    const ticketActive = hasTicketKeyword(form!.sections, form!.reference, form!.notes) || ticketEnabled;
    const transferActive = hasTransferKeyword(form!.sections, form!.reference, form!.notes) || transferEnabled;
    const insuranceActive = hasInsuranceKeyword(form!.sections, form!.reference, form!.notes) || insuranceEnabled;
    const anyTrackerActive =
      paymentApproved || visaActive || hotelActive || ticketActive || transferActive || insuranceActive || travelReadyEnabled;
    return {
      ...rest,
      paymentReceived: Boolean(paymentReceived),
      travelers: travelerNames.split(/\\r?\\n/).map((name) => name.trim()).filter(Boolean).slice(0, 100),
      vendors: (form!.vendors || []).filter((v) => v.name.trim() || v.description.trim() || v.unitPrice.trim() || v.units.trim() || v.amount.trim() || v.bank.trim()),
      sections: form!.sections.map((s, si) => {
        const lockThis = si === lockIdx;
        return {
          title: s.title, key: s.key, locked: s.locked || lockThis,
          lines: s.lines.filter((l) => l.description.trim() || l.unitPrice.trim()).map((l) => (l.note
            ? { description: l.description, key: l.key, locked: l.locked || lockThis }
            : { description: l.description, unitPrice: l.unitPrice, units: l.units, currency: l.currency, rate: l.rate, taxable: l.taxable, key: l.key, locked: l.locked || lockThis })),
        };
      }),
      ...(customerPortalBetaEnabled && form!.kind === 'customer'
        ? {
            visaProgress: anyTrackerActive
              ? {
                  enabled: visaActive,
                  status: visaActive ? visaStatus : ('not_started' as const),
                  inProgressDate: visaActive ? (visaInProgressDate.trim() || null) : null,
                  issuedDate: visaActive ? (visaIssuedDate.trim() || null) : null,
                  paymentApproved,
                  paymentApprovedDate: paymentApproved ? (paymentApprovedDate.trim() || today()) : null,
                  hotelEnabled: hotelActive,
                  hotelStatus: hotelActive ? hotelStatus : ('not_started' as const),
                  hotelName: hotelActive ? (hotelName.trim() || extractSmartHotelName(form!.sections, form!.reference, form!.notes) || null) : null,
                  hotelCheckInDate: hotelActive ? (hotelCheckInDate.trim() || null) : null,
                  hotelCheckOutDate: hotelActive ? (hotelCheckOutDate.trim() || null) : null,
                  hotelInProgressDate: hotelActive ? (hotelInProgressDate.trim() || null) : null,
                  hotelIssuedDate: hotelActive ? (hotelIssuedDate.trim() || null) : null,
                  ticketEnabled: ticketActive,
                  ticketStatus: ticketActive ? ticketStatus : ('not_started' as const),
                  ticketDetails: ticketActive ? (ticketDetails.trim() || null) : null,
                  ticketInProgressDate: ticketActive ? (ticketInProgressDate.trim() || null) : null,
                  ticketIssuedDate: ticketActive ? (ticketIssuedDate.trim() || null) : null,
                  transferEnabled: transferActive,
                  transferStatus: transferActive ? transferStatus : ('not_started' as const),
                  transferDetails: transferActive ? (transferDetails.trim() || null) : null,
                  transferInProgressDate: transferActive ? (transferInProgressDate.trim() || null) : null,
                  transferIssuedDate: transferActive ? (transferIssuedDate.trim() || null) : null,
                  insuranceEnabled: insuranceActive,
                  insuranceStatus: insuranceActive ? insuranceStatus : ('not_started' as const),
                  insuranceDetails: insuranceActive ? (insuranceDetails.trim() || null) : null,
                  insuranceInProgressDate: insuranceActive ? (insuranceInProgressDate.trim() || null) : null,
                  insuranceIssuedDate: insuranceActive ? (insuranceIssuedDate.trim() || null) : null,
                  travelReadyEnabled,
                  travelReadyDate: travelReadyEnabled ? (travelReadyDate.trim() || today()) : null,
                }
              : {
                  enabled: false,
                  status: 'not_started' as const,
                  inProgressDate: null,
                  issuedDate: null,
                  paymentApproved: false,
                  paymentApprovedDate: null,
                  hotelEnabled: false,
                  hotelStatus: 'not_started' as const,
                  hotelName: null,
                  hotelCheckInDate: null,
                  hotelCheckOutDate: null,
                  hotelInProgressDate: null,
                  hotelIssuedDate: null,
                  ticketEnabled: false,
                  ticketStatus: 'not_started' as const,
                  ticketDetails: null,
                  ticketInProgressDate: null,
                  ticketIssuedDate: null,
                  transferEnabled: false,
                  transferStatus: 'not_started' as const,
                  transferDetails: null,
                  transferInProgressDate: null,
                  transferIssuedDate: null,
                  insuranceEnabled: false,
                  insuranceStatus: 'not_started' as const,
                  insuranceDetails: null,
                  insuranceInProgressDate: null,
                  insuranceIssuedDate: null,
                  travelReadyEnabled: false,
                  travelReadyDate: null,
                },
          }
        : {}),
    };
  };

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
        setForm(toForm(r.invoice, company.ntn || ''));
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
      await downloadInvoicePdf(i, company, by(i));
    } catch (err: any) {
      setError(err?.message || 'Could not create the PDF.');
    }
  };
  const vendorPdf = async (i: CrmInvoice) => {
    setError('');
    try {
      await downloadVendorPayablesPdf(i, company, by(i));
    } catch (err: any) {
      setError(err?.message || 'Could not create the vendor PDF.');
    }
  };
  const share = async (i: CrmInvoice) => {
    try {
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

  const cancelWithRemarks = async (i: CrmInvoice) => {
    const remarks = (window.prompt(`Why is ${i.invoiceNo} being cancelled? Remarks are required.`) || '').trim();
    if (!remarks) { setError('Cancelling needs remarks, so nothing was cancelled.'); return; }
    await act('invoice_status', { id: i.id, status: 'cancelled', remarks });
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
          <button className={btnGhost} onClick={() => setOpenIds((prev) => (prev.size ? new Set() : new Set(shown.map((x) => x.id))))}><ChevronsUpDown className="w-3.5 h-3.5" /> {openIds.size ? 'Collapse all' : 'Expand all'}</button>
          {isStaff && <button className={btnGhost} onClick={() => { setCompanyForm({ ...company }); setError(''); }}><Building2 className="w-3.5 h-3.5" /> Company details</button>}
          <button className={btnPrimary} onClick={() => { setForm(blankForm(side, company.ntn || '')); setError(''); setNotice(''); }}><Plus className="w-3.5 h-3.5" /> {vendorSide ? 'New vendor payable' : 'New invoice'}</button>
        </div>
      </div>

      <div className="flex gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/60 w-fit" role="tablist" aria-label="Invoice side">
        {([['customer', 'Customer invoices'], ['vendor', 'Vendor payables']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={side === id} onClick={() => { setSide(id); setFilter('all'); setQuery(''); }}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${side === id ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 shadow-sm' : 'text-slate-600 dark:text-slate-400'}`}>{label}</button>
        ))}
      </div>

      {/* Divided 50/50 Invoice Bar: Left = Receivables, Right = Vendor Payables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div
          onClick={() => { if (side !== 'customer') { setSide('customer'); setFilter('all'); setQuery(''); } }}
          className={`space-y-2 rounded-xl p-1 transition-all cursor-pointer ${side === 'customer' ? 'ring-2 ring-blue-500/40' : 'opacity-90 hover:opacity-100'}`}
        >
          <StatBar
            title={`${seesAll ? 'All' : 'Your'} Customer Receivables`}
            segments={[
              { label: 'Unpaid', count: receivableCounts.unpaid, tone: 'amber' },
              { label: 'Paid', count: receivableCounts.paid, tone: 'green' },
              { label: 'Cancelled', count: receivableCounts.cancelled, tone: 'slate' },
            ]}
          />
          <div className={`${cardCls} p-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs`}>
            <span className="font-semibold text-slate-600 dark:text-slate-300">Still to be received (Receivables):</span>
            <div className="flex flex-wrap gap-3">
              {receivablesOutstanding.length > 0 ? (
                receivablesOutstanding.map(([c, v]) => <span key={c} className="font-mono font-bold text-blue-600 dark:text-blue-400">{c} {fmtAmount(v)}</span>)
              ) : (
                <span className="font-mono font-semibold text-slate-400">PKR 0</span>
              )}
            </div>
          </div>
        </div>

        <div
          onClick={() => { if (side !== 'vendor') { setSide('vendor'); setFilter('all'); setQuery(''); } }}
          className={`space-y-2 rounded-xl p-1 transition-all cursor-pointer ${side === 'vendor' ? 'ring-2 ring-amber-500/40' : 'opacity-90 hover:opacity-100'}`}
        >
          <StatBar
            title={`${seesAll ? 'All' : 'Your'} Vendor Payables`}
            segments={[
              { label: 'Unpaid', count: payableCounts.unpaid, tone: 'amber' },
              { label: 'Paid', count: payableCounts.paid, tone: 'green' },
              { label: 'Cancelled', count: payableCounts.cancelled, tone: 'slate' },
            ]}
          />
          <div className={`${cardCls} p-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs`}>
            <span className="font-semibold text-slate-600 dark:text-slate-300">Still to be paid (Vendor Payables):</span>
            <div className="flex flex-wrap gap-3">
              {payablesOutstanding.length > 0 ? (
                payablesOutstanding.map(([c, v]) => <span key={c} className="font-mono font-bold text-amber-600 dark:text-amber-400">{c} {fmtAmount(v)}</span>)
              ) : (
                <span className="font-mono font-semibold text-slate-400">PKR 0</span>
              )}
            </div>
          </div>
        </div>
      </div>

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
        <div className={`${cardCls} p-8 text-center text-xs text-slate-500`}>{invoices.length === 0 ? (vendorSide ? 'No vendor payables yet. Press “New vendor payable” to add the first one.' : 'No invoices yet. Press “New invoice” to create the first one.') : filter === 'all' && invoices.some((x) => fullyPaid(x)) ? 'No open invoices. Paid ones are in the Paid tab.' : 'No invoices match this filter.'}</div>
      ) : (
        <div className="space-y-3">
          {shown.map((i) => {
            const invVendors = i.vendors || [];
            const vendorTotalsByCur = new Map<string, number>();
            invVendors.forEach((v) => {
              if ((v.amount ?? 0) > 0) {
                const c = v.currency || i.currency;
                vendorTotalsByCur.set(c, (vendorTotalsByCur.get(c) || 0) + v.amount);
              }
            });
            const showVisa = customerPortalBetaEnabled && !vendorSide && isVisaInvoice(i);
            const showHotel = customerPortalBetaEnabled && !vendorSide && isHotelInvoice(i);
            const showTicket = customerPortalBetaEnabled && !vendorSide && isTicketInvoice(i);
            const showTransfer = customerPortalBetaEnabled && !vendorSide && isTransferInvoice(i);
            const showInsurance = customerPortalBetaEnabled && !vendorSide && isInsuranceInvoice(i);
            const vp = i.visaProgress;
            const vStatus: VisaProgressStatus = vp?.status || 'not_started';
            const hStatus: VisaProgressStatus = vp?.hotelStatus || 'not_started';
            const tStatus: VisaProgressStatus = vp?.ticketStatus || 'not_started';
            const trStatus: VisaProgressStatus = vp?.transferStatus || 'not_started';
            const insStatus: VisaProgressStatus = vp?.insuranceStatus || 'not_started';
            const savedPayApproved = Boolean(vp?.paymentApproved);
            const savedPayDate = vp?.paymentApprovedDate || '';
            const savedInProg = vp?.inProgressDate || '';
            const savedIssued = vp?.issuedDate || '';
            const smartHotelDefault = extractSmartHotelName(i.sections, i.reference, i.notes);
            const savedHotelName = vp?.hotelName || smartHotelDefault || '';
            const savedHotelCheckIn = vp?.hotelCheckInDate || '';
            const savedHotelCheckOut = vp?.hotelCheckOutDate || '';
            const savedHotelInProg = vp?.hotelInProgressDate || '';
            const savedHotelIssued = vp?.hotelIssuedDate || '';
            const savedTicketDetails = vp?.ticketDetails || '';
            const savedTicketInProg = vp?.ticketInProgressDate || '';
            const savedTicketIssued = vp?.ticketIssuedDate || '';
            const savedTransferDetails = vp?.transferDetails || '';
            const savedTransferInProg = vp?.transferInProgressDate || '';
            const savedTransferIssued = vp?.transferIssuedDate || '';
            const savedInsuranceDetails = vp?.insuranceDetails || '';
            const savedInsuranceInProg = vp?.insuranceInProgressDate || '';
            const savedInsuranceIssued = vp?.insuranceIssuedDate || '';
            const savedTravelReady = Boolean(vp?.travelReadyEnabled);
            const savedTravelReadyDate = vp?.travelReadyDate || '';

            const vDraft = visaDrafts[i.id] ?? {
              paymentApprovedDate: savedPayDate,
              inProgressDate: savedInProg,
              issuedDate: savedIssued,
              hotelName: savedHotelName,
              hotelCheckInDate: savedHotelCheckIn,
              hotelCheckOutDate: savedHotelCheckOut,
              hotelInProgressDate: savedHotelInProg,
              hotelIssuedDate: savedHotelIssued,
              ticketDetails: savedTicketDetails,
              ticketInProgressDate: savedTicketInProg,
              ticketIssuedDate: savedTicketIssued,
              transferDetails: savedTransferDetails,
              transferInProgressDate: savedTransferInProg,
              transferIssuedDate: savedTransferIssued,
              insuranceDetails: savedInsuranceDetails,
              insuranceInProgressDate: savedInsuranceInProg,
              insuranceIssuedDate: savedInsuranceIssued,
              travelReadyDate: savedTravelReadyDate,
            };
            const vDirty =
              vDraft.paymentApprovedDate !== savedPayDate ||
              vDraft.inProgressDate !== savedInProg ||
              vDraft.issuedDate !== savedIssued ||
              vDraft.hotelName !== savedHotelName ||
              vDraft.hotelCheckInDate !== savedHotelCheckIn ||
              vDraft.hotelCheckOutDate !== savedHotelCheckOut ||
              vDraft.hotelInProgressDate !== savedHotelInProg ||
              vDraft.hotelIssuedDate !== savedHotelIssued ||
              vDraft.ticketDetails !== savedTicketDetails ||
              vDraft.ticketInProgressDate !== savedTicketInProg ||
              vDraft.ticketIssuedDate !== savedTicketIssued ||
              vDraft.transferDetails !== savedTransferDetails ||
              vDraft.transferInProgressDate !== savedTransferInProg ||
              vDraft.transferIssuedDate !== savedTransferIssued ||
              vDraft.insuranceDetails !== savedInsuranceDetails ||
              vDraft.insuranceInProgressDate !== savedInsuranceInProg ||
              vDraft.insuranceIssuedDate !== savedInsuranceIssued ||
              vDraft.travelReadyDate !== savedTravelReadyDate;
            const isPaymentApproved = savedPayApproved || i.status === 'paid' || i.advancePaid > 0 || i.balance <= 0;

            const buildFullExtra = (overrides: Record<string, unknown> = {}) => ({
              enabled: showVisa,
              paymentApproved: savedPayApproved,
              paymentApprovedDate: vDraft.paymentApprovedDate.trim() || null,
              hotelEnabled: showHotel,
              hotelStatus: hStatus,
              hotelName: vDraft.hotelName.trim() || null,
              hotelCheckInDate: vDraft.hotelCheckInDate.trim() || null,
              hotelCheckOutDate: vDraft.hotelCheckOutDate.trim() || null,
              hotelInProgressDate: vDraft.hotelInProgressDate.trim() || null,
              hotelIssuedDate: vDraft.hotelIssuedDate.trim() || null,
              ticketEnabled: showTicket,
              ticketStatus: tStatus,
              ticketDetails: vDraft.ticketDetails.trim() || null,
              ticketInProgressDate: vDraft.ticketInProgressDate.trim() || null,
              ticketIssuedDate: vDraft.ticketIssuedDate.trim() || null,
              transferEnabled: showTransfer,
              transferStatus: trStatus,
              transferDetails: vDraft.transferDetails.trim() || null,
              transferInProgressDate: vDraft.transferInProgressDate.trim() || null,
              transferIssuedDate: vDraft.transferIssuedDate.trim() || null,
              insuranceEnabled: showInsurance,
              insuranceStatus: insStatus,
              insuranceDetails: vDraft.insuranceDetails.trim() || null,
              insuranceInProgressDate: vDraft.insuranceInProgressDate.trim() || null,
              insuranceIssuedDate: vDraft.insuranceIssuedDate.trim() || null,
              travelReadyEnabled: savedTravelReady,
              travelReadyDate: vDraft.travelReadyDate.trim() || null,
              ...overrides,
            });

            return (
              <div key={i.id} className={`${cardCls} p-4 inv-card ${openIds.has(i.id) ? '' : 'inv-collapsed'} ${fullyPaid(i) ? '!bg-emerald-100/80 !border-emerald-300 dark:!bg-emerald-950/40 dark:!border-emerald-800/70' : ''}`}>
                <div className={`grid grid-cols-1 ${!vendorSide ? 'lg:grid-cols-2' : ''} gap-4`}>
                  {/* LEFT HALF (50%): Customer Receivable Side */}
                  <div className={`min-w-0 flex flex-col justify-between space-y-3 ${i.status === 'paid' && !vendorSide ? 'rounded-lg p-2.5 -m-2.5 bg-emerald-100/90 dark:bg-emerald-950/50' : ''}`}>
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1.5">
                        <span className="block text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                          {vendorSide ? 'Vendor Payable Bill' : 'Customer Receivable'}
                        </span>
                        {/* Ordered: 1. Invoice No -> 2. CRM ID / Query Code -> 3. Customer Name */}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                            {i.invoiceNo}
                          </span>
                          <Pill tone="blue">CRM / Query: {crmQueryOf(i) || '—'}</Pill>
                          <span className="text-sm font-bold text-slate-900 dark:text-slate-100 break-words">{i.customerName}</span>
                          <Pill tone={statusTone(i.status)}>{i.status === 'paid' ? 'Paid' : i.status === 'cancelled' ? 'Cancelled' : 'Unpaid'}</Pill>
                          {showVisa && <Pill tone={visaTone(vStatus)}>Visa: {VISA_STATUS_LABEL[vStatus]}</Pill>}
                          {showHotel && <Pill tone={visaTone(hStatus)}>Hotel: {HOTEL_STATUS_LABEL[hStatus]}{savedHotelName ? ` (${savedHotelName.slice(0, 24)})` : ''}</Pill>}
                          {showTicket && <Pill tone={visaTone(tStatus)}>Ticket: {VISA_STATUS_LABEL[tStatus]}</Pill>}
                          {showTransfer && <Pill tone={visaTone(trStatus)}>Transfers: {HOTEL_STATUS_LABEL[trStatus]}</Pill>}
                          {showInsurance && <Pill tone={visaTone(insStatus)}>Insurance: {VISA_STATUS_LABEL[insStatus]}</Pill>}
                          {savedTravelReady && <Pill tone="green">✓ Travel Ready</Pill>}
                          {i.reference && <Pill tone="slate">Ref {i.reference}</Pill>}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {niceDate(i.invoiceDate)}{i.dueDate ? ` · due ${niceDate(i.dueDate)}` : ''} · created by <b className="text-slate-700 dark:text-slate-200">{by(i) || 'Former employee'}</b>
                        </p>
                      </div>
                      <div className={`sm:text-right shrink-0 rounded-lg px-2.5 py-1.5 border ${i.status === 'paid' ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/60' : 'bg-blue-50/50 dark:bg-blue-950/20 border-blue-100 dark:border-blue-900/50'}`}>
                        <p className="text-[11px] text-slate-500">{vendorSide ? 'Total payment' : 'Receivable Total'} <b className="font-mono text-slate-900 dark:text-slate-100">{i.currency} {fmtAmount(i.total)}</b></p>
                        <p className="text-[11px] text-slate-500">Balance <b className={`font-mono ${i.balance > 0 && i.status === 'unpaid' ? 'text-amber-600' : 'text-emerald-600'}`}>{i.currency} {fmtAmount(i.balance)}</b></p>
                      </div>
                    </div>

                    {customerPortalBetaEnabled && !vendorSide && (
                      <div className="rounded-lg border border-indigo-200/80 dark:border-indigo-900/60 bg-indigo-50/60 dark:bg-indigo-950/25 p-2.5 space-y-2.5">
                        {/* Top Header & Package Requirements Toggle Bar */}
                        <div className="space-y-1.5 pb-2 border-b border-indigo-200/60 dark:border-indigo-900/50">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-900 dark:text-indigo-200">
                              Customer Portal Process Steps &amp; Package Requirements
                            </span>
                            {canPortalCtl && (
                              <span className="inline-flex flex-wrap items-center gap-1.5">
                                {crm.data.portalInvoices?.[i.id]?.hideAmounts && <Pill tone="amber">Amounts hidden</Pill>}
                                {crm.data.portalInvoices?.[i.id]?.disabled && <Pill tone="red">Tracking off</Pill>}
                                {crm.data.portalInvoices?.[i.id]?.note && <Pill tone="blue">Message set</Pill>}
                                <button type="button" onClick={() => setPortalFor(i)} className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-indigo-300 dark:border-indigo-800 bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-950/50 cursor-pointer">
                                  Portal controls
                                </button>
                              </span>
                            )}
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                isPaymentApproved
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800'
                                  : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800'
                              }`}
                            >
                              {isPaymentApproved
                                ? '✓ Payment Approved — Active Steps Unlocked'
                                : '⏳ Awaiting Payment Approval (Sequential Gate)'}
                            </span>
                          </div>

                          {canUpdateVisa(i) && (
                            <div className="flex flex-wrap items-center gap-1 pt-0.5">
                              <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mr-1">
                                Catalogue Requirements (Toggle On/Off):
                              </span>
                              <button
                                type="button"
                                disabled={visaBusyId === i.id}
                                onClick={() => {
                                  const nextApproved = !savedPayApproved;
                                  void saveCardVisa(
                                    i,
                                    vStatus,
                                    vDraft.inProgressDate.trim() || null,
                                    vDraft.issuedDate.trim() || null,
                                    buildFullExtra({
                                      paymentApproved: nextApproved,
                                      paymentApprovedDate: nextApproved ? vDraft.paymentApprovedDate.trim() || today() : null,
                                    })
                                  );
                                }}
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors cursor-pointer ${
                                  isPaymentApproved
                                    ? 'bg-emerald-600 text-white border-emerald-600'
                                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-100'
                                }`}
                              >
                                {isPaymentApproved ? '✓ Payment Approved' : '+ Approve Payment'}
                              </button>
                              <button
                                type="button"
                                disabled={visaBusyId === i.id}
                                onClick={() =>
                                  void saveCardVisa(
                                    i,
                                    vStatus,
                                    vDraft.inProgressDate.trim() || null,
                                    vDraft.issuedDate.trim() || null,
                                    buildFullExtra({ enabled: !showVisa })
                                  )
                                }
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors cursor-pointer ${
                                  showVisa
                                    ? 'bg-indigo-600 text-white border-indigo-600'
                                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-100'
                                }`}
                              >
                                {showVisa ? '✓ Visa Progress' : '+ Visa Progress'}
                              </button>
                              <button
                                type="button"
                                disabled={visaBusyId === i.id}
                                onClick={() =>
                                  void saveCardVisa(
                                    i,
                                    vStatus,
                                    vDraft.inProgressDate.trim() || null,
                                    vDraft.issuedDate.trim() || null,
                                    buildFullExtra({
                                      hotelEnabled: !showHotel,
                                      hotelName: vDraft.hotelName.trim() || smartHotelDefault || null,
                                    })
                                  )
                                }
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors cursor-pointer ${
                                  showHotel
                                    ? 'bg-indigo-600 text-white border-indigo-600'
                                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-100'
                                }`}
                              >
                                {showHotel ? '✓ Hotel Booking' : '+ Hotel Booking'}
                              </button>
                              <button
                                type="button"
                                disabled={visaBusyId === i.id}
                                onClick={() =>
                                  void saveCardVisa(
                                    i,
                                    vStatus,
                                    vDraft.inProgressDate.trim() || null,
                                    vDraft.issuedDate.trim() || null,
                                    buildFullExtra({ ticketEnabled: !showTicket })
                                  )
                                }
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors cursor-pointer ${
                                  showTicket
                                    ? 'bg-indigo-600 text-white border-indigo-600'
                                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-100'
                                }`}
                              >
                                {showTicket ? '✓ Air Tickets' : '+ Air Tickets'}
                              </button>
                              <button
                                type="button"
                                disabled={visaBusyId === i.id}
                                onClick={() =>
                                  void saveCardVisa(
                                    i,
                                    vStatus,
                                    vDraft.inProgressDate.trim() || null,
                                    vDraft.issuedDate.trim() || null,
                                    buildFullExtra({ transferEnabled: !showTransfer })
                                  )
                                }
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors cursor-pointer ${
                                  showTransfer
                                    ? 'bg-indigo-600 text-white border-indigo-600'
                                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-100'
                                }`}
                              >
                                {showTransfer ? '✓ Tours & Transfers' : '+ Tours & Transfers'}
                              </button>
                              <button
                                type="button"
                                disabled={visaBusyId === i.id}
                                onClick={() =>
                                  void saveCardVisa(
                                    i,
                                    vStatus,
                                    vDraft.inProgressDate.trim() || null,
                                    vDraft.issuedDate.trim() || null,
                                    buildFullExtra({ insuranceEnabled: !showInsurance })
                                  )
                                }
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors cursor-pointer ${
                                  showInsurance
                                    ? 'bg-indigo-600 text-white border-indigo-600'
                                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-100'
                                }`}
                              >
                                {showInsurance ? '✓ Insurance' : '+ Insurance'}
                              </button>
                              <button
                                type="button"
                                disabled={visaBusyId === i.id}
                                onClick={() => {
                                  const nextReady = !savedTravelReady;
                                  void saveCardVisa(
                                    i,
                                    vStatus,
                                    vDraft.inProgressDate.trim() || null,
                                    vDraft.issuedDate.trim() || null,
                                    buildFullExtra({
                                      travelReadyEnabled: nextReady,
                                      travelReadyDate: nextReady ? vDraft.travelReadyDate.trim() || today() : null,
                                    })
                                  );
                                }}
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors cursor-pointer ${
                                  savedTravelReady
                                    ? 'bg-emerald-600 text-white border-emerald-600'
                                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-100'
                                }`}
                              >
                                {savedTravelReady ? '✓ Travel Ready' : '+ Travel Ready'}
                              </button>
                            </div>
                          )}
                        </div>

                        {canUpdateVisa(i) ? (
                          <>
                            {/* 1. Payment Progress Separate Toggle */}
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-[11px] font-bold text-indigo-900 dark:text-indigo-200">
                                1. Payment Progress
                              </span>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={visaBusyId === i.id}
                                  onClick={() =>
                                    void saveCardVisa(
                                      i,
                                      vStatus,
                                      vDraft.inProgressDate.trim() || null,
                                      vDraft.issuedDate.trim() || null,
                                      buildFullExtra({ paymentApproved: false, paymentApprovedDate: null })
                                    )
                                  }
                                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition-colors cursor-pointer ${
                                    !isPaymentApproved
                                      ? 'bg-slate-700 text-white border-slate-700'
                                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-100'
                                  }`}
                                >
                                  Awaiting Payment
                                </button>
                                <button
                                  type="button"
                                  disabled={visaBusyId === i.id}
                                  onClick={() =>
                                    void saveCardVisa(
                                      i,
                                      vStatus,
                                      vDraft.inProgressDate.trim() || null,
                                      vDraft.issuedDate.trim() || null,
                                      buildFullExtra({
                                        paymentApproved: true,
                                        paymentApprovedDate: vDraft.paymentApprovedDate.trim() || today(),
                                      })
                                    )
                                  }
                                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition-colors cursor-pointer ${
                                    isPaymentApproved
                                      ? 'bg-emerald-600 text-white border-emerald-600'
                                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-100'
                                  }`}
                                >
                                  ✓ Payment Approved
                                </button>
                                <input
                                  type="date"
                                  aria-label={`Payment Approved Date for ${i.invoiceNo}`}
                                  className={`${inputCls} !w-auto !py-0.5 !px-2 !text-[11px]`}
                                  value={vDraft.paymentApprovedDate}
                                  disabled={visaBusyId === i.id}
                                  onChange={(e) =>
                                    setVisaDrafts((prev) => ({
                                      ...prev,
                                      [i.id]: { ...vDraft, paymentApprovedDate: e.target.value },
                                    }))
                                  }
                                />
                              </div>
                            </div>

                            {/* 2. Visa Progress Separate Toggle */}
                            {showVisa && (
                              <div className="space-y-1.5 pt-2 border-t border-indigo-200/60 dark:border-indigo-900/50">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="text-[11px] font-bold text-indigo-900 dark:text-indigo-200">
                                    2. Visa Progress (Visa Started / Visa Issued)
                                  </span>
                                  <div className="flex flex-wrap items-center gap-1">
                                    {(['not_started', 'in_progress', 'issued'] as const).map((st) => (
                                      <button
                                        key={st}
                                        type="button"
                                        disabled={visaBusyId === i.id}
                                        onClick={() => {
                                          const nextInProgress =
                                            st === 'not_started'
                                              ? null
                                              : st === 'in_progress'
                                                ? vDraft.inProgressDate.trim() || today()
                                                : vDraft.inProgressDate.trim() || savedInProg || today();
                                          const nextIssued =
                                            st === 'issued' ? vDraft.issuedDate.trim() || today() : null;
                                          void saveCardVisa(
                                            i,
                                            st,
                                            nextInProgress,
                                            nextIssued,
                                            buildFullExtra({ enabled: true })
                                          );
                                        }}
                                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition-colors cursor-pointer ${
                                          vStatus === st
                                            ? st === 'issued'
                                              ? 'bg-emerald-600 text-white border-emerald-600'
                                              : st === 'in_progress'
                                                ? 'bg-amber-500 text-white border-amber-500'
                                                : 'bg-slate-700 text-white border-slate-700'
                                            : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-100'
                                        }`}
                                      >
                                        {st === 'in_progress' ? 'Visa Started (In Progress)' : VISA_STATUS_LABEL[st]}
                                      </button>
                                    ))}
                                    <select
                                      aria-label={`Visa status for ${i.invoiceNo}`}
                                      className={`${inputCls} !w-auto !py-0.5 !px-2 !text-[11px]`}
                                      value={vStatus}
                                      disabled={visaBusyId === i.id}
                                      onChange={(e) => {
                                        const nextStatus = e.target.value as VisaProgressStatus;
                                        const nextInProgress =
                                          nextStatus === 'not_started'
                                            ? null
                                            : nextStatus === 'in_progress'
                                              ? vDraft.inProgressDate.trim() || today()
                                              : vDraft.inProgressDate.trim() || null;
                                        const nextIssued =
                                          nextStatus === 'issued' ? vDraft.issuedDate.trim() || today() : null;
                                        void saveCardVisa(
                                          i,
                                          nextStatus,
                                          nextInProgress,
                                          nextIssued,
                                          buildFullExtra({ enabled: true })
                                        );
                                      }}
                                    >
                                      <option value="not_started">Not Started</option>
                                      <option value="in_progress">Visa Started (In Progress)</option>
                                      <option value="issued">Visa Issued</option>
                                    </select>
                                  </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  <label className="block space-y-0.5">
                                    <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                                      Visa Started Date{savedInProg ? ` (${niceDate(savedInProg)})` : ''}
                                    </span>
                                    <input
                                      type="date"
                                      aria-label={`In Progress Date for ${i.invoiceNo}`}
                                      className={`${inputCls} !py-1 !text-xs`}
                                      value={vDraft.inProgressDate}
                                      disabled={visaBusyId === i.id}
                                      onChange={(e) =>
                                        setVisaDrafts((prev) => ({
                                          ...prev,
                                          [i.id]: { ...vDraft, inProgressDate: e.target.value },
                                        }))
                                      }
                                    />
                                  </label>
                                  <label className="block space-y-0.5">
                                    <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                                      Visa Issued Date{savedIssued ? ` (${niceDate(savedIssued)})` : ''}
                                    </span>
                                    <input
                                      type="date"
                                      aria-label={`Issued Date for ${i.invoiceNo}`}
                                      className={`${inputCls} !py-1 !text-xs`}
                                      value={vDraft.issuedDate}
                                      disabled={visaBusyId === i.id}
                                      onChange={(e) =>
                                        setVisaDrafts((prev) => ({
                                          ...prev,
                                          [i.id]: { ...vDraft, issuedDate: e.target.value },
                                        }))
                                      }
                                    />
                                  </label>
                                </div>
                              </div>
                            )}

                            {/* 3. Hotel Booking Confirmation Separate Toggle + Hotel Name & Check-In/Out Dates */}
                            {showHotel && (
                              <div className="space-y-2 pt-2 border-t border-indigo-200/60 dark:border-indigo-900/50">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="text-[11px] font-bold text-indigo-900 dark:text-indigo-200">
                                    3. Hotel Booking Confirmation (Name &amp; Dates)
                                  </span>
                                  <div className="flex flex-wrap items-center gap-1">
                                    {(['not_started', 'in_progress', 'issued'] as const).map((st) => (
                                      <button
                                        key={st}
                                        type="button"
                                        disabled={visaBusyId === i.id}
                                        onClick={() => {
                                          const nextHotelInProg =
                                            st === 'not_started'
                                              ? null
                                              : st === 'in_progress'
                                                ? vDraft.hotelInProgressDate.trim() || today()
                                                : vDraft.hotelInProgressDate.trim() || savedHotelInProg || today();
                                          const nextHotelIssued =
                                            st === 'issued' ? vDraft.hotelIssuedDate.trim() || today() : null;
                                          void saveCardVisa(
                                            i,
                                            vStatus,
                                            vDraft.inProgressDate.trim() || null,
                                            vDraft.issuedDate.trim() || null,
                                            buildFullExtra({
                                              hotelEnabled: true,
                                              hotelStatus: st,
                                              hotelName: vDraft.hotelName.trim() || smartHotelDefault || null,
                                              hotelCheckInDate: vDraft.hotelCheckInDate.trim() || null,
                                              hotelCheckOutDate: vDraft.hotelCheckOutDate.trim() || null,
                                              hotelInProgressDate: nextHotelInProg,
                                              hotelIssuedDate: nextHotelIssued,
                                            })
                                          );
                                        }}
                                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition-colors cursor-pointer ${
                                          hStatus === st
                                            ? st === 'issued'
                                              ? 'bg-emerald-600 text-white border-emerald-600'
                                              : st === 'in_progress'
                                                ? 'bg-amber-500 text-white border-amber-500'
                                                : 'bg-slate-700 text-white border-slate-700'
                                            : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-100'
                                        }`}
                                      >
                                        {st === 'issued' ? '✓ Hotel Confirmed' : HOTEL_STATUS_LABEL[st]}
                                      </button>
                                    ))}
                                    <select
                                      aria-label={`Hotel status for ${i.invoiceNo}`}
                                      className={`${inputCls} !w-auto !py-0.5 !px-2 !text-[11px]`}
                                      value={hStatus}
                                      disabled={visaBusyId === i.id}
                                      onChange={(e) => {
                                        const nextHotelStatus = e.target.value as VisaProgressStatus;
                                        const nextHotelInProg =
                                          nextHotelStatus === 'not_started'
                                            ? null
                                            : nextHotelStatus === 'in_progress'
                                              ? vDraft.hotelInProgressDate.trim() || today()
                                              : vDraft.hotelInProgressDate.trim() || null;
                                        const nextHotelIssued =
                                          nextHotelStatus === 'issued'
                                            ? vDraft.hotelIssuedDate.trim() || today()
                                            : null;
                                        void saveCardVisa(
                                          i,
                                          vStatus,
                                          vDraft.inProgressDate.trim() || null,
                                          vDraft.issuedDate.trim() || null,
                                          buildFullExtra({
                                            hotelEnabled: true,
                                            hotelStatus: nextHotelStatus,
                                            hotelName: vDraft.hotelName.trim() || smartHotelDefault || null,
                                            hotelCheckInDate: vDraft.hotelCheckInDate.trim() || null,
                                            hotelCheckOutDate: vDraft.hotelCheckOutDate.trim() || null,
                                            hotelInProgressDate: nextHotelInProg,
                                            hotelIssuedDate: nextHotelIssued,
                                          })
                                        );
                                      }}
                                    >
                                      <option value="not_started">Not Started</option>
                                      <option value="in_progress">In Progress</option>
                                      <option value="issued">Hotel Confirmed</option>
                                    </select>
                                  </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  <label className="block space-y-0.5 sm:col-span-2">
                                    <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                                      Hotel Name (Shown on Customer Portal Timeline)
                                    </span>
                                    <input
                                      type="text"
                                      maxLength={160}
                                      placeholder="e.g. Pullman Zamzam Makkah / Hilton Baku / Swissotel"
                                      aria-label={`Hotel Name for ${i.invoiceNo}`}
                                      className={`${inputCls} !py-1 !text-xs`}
                                      value={vDraft.hotelName}
                                      disabled={visaBusyId === i.id}
                                      onChange={(e) =>
                                        setVisaDrafts((prev) => ({
                                          ...prev,
                                          [i.id]: { ...vDraft, hotelName: e.target.value },
                                        }))
                                      }
                                    />
                                  </label>
                                  <label className="block space-y-0.5">
                                    <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                                      Check-In Date{savedHotelCheckIn ? ` (${niceDate(savedHotelCheckIn)})` : ''}
                                    </span>
                                    <input
                                      type="date"
                                      aria-label={`Hotel Check-In Date for ${i.invoiceNo}`}
                                      className={`${inputCls} !py-1 !text-xs`}
                                      value={vDraft.hotelCheckInDate}
                                      disabled={visaBusyId === i.id}
                                      onChange={(e) =>
                                        setVisaDrafts((prev) => ({
                                          ...prev,
                                          [i.id]: { ...vDraft, hotelCheckInDate: e.target.value },
                                        }))
                                      }
                                    />
                                  </label>
                                  <label className="block space-y-0.5">
                                    <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                                      Check-Out Date{savedHotelCheckOut ? ` (${niceDate(savedHotelCheckOut)})` : ''}
                                    </span>
                                    <input
                                      type="date"
                                      aria-label={`Hotel Check-Out Date for ${i.invoiceNo}`}
                                      className={`${inputCls} !py-1 !text-xs`}
                                      value={vDraft.hotelCheckOutDate}
                                      disabled={visaBusyId === i.id}
                                      onChange={(e) =>
                                        setVisaDrafts((prev) => ({
                                          ...prev,
                                          [i.id]: { ...vDraft, hotelCheckOutDate: e.target.value },
                                        }))
                                      }
                                    />
                                  </label>
                                  <label className="block space-y-0.5">
                                    <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                                      Hotel In Progress Date{savedHotelInProg ? ` (${niceDate(savedHotelInProg)})` : ''}
                                    </span>
                                    <input
                                      type="date"
                                      aria-label={`Hotel In Progress Date for ${i.invoiceNo}`}
                                      className={`${inputCls} !py-1 !text-xs`}
                                      value={vDraft.hotelInProgressDate}
                                      disabled={visaBusyId === i.id}
                                      onChange={(e) =>
                                        setVisaDrafts((prev) => ({
                                          ...prev,
                                          [i.id]: { ...vDraft, hotelInProgressDate: e.target.value },
                                        }))
                                      }
                                    />
                                  </label>
                                  <label className="block space-y-0.5">
                                    <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                                      Hotel Confirmed Date{savedHotelIssued ? ` (${niceDate(savedHotelIssued)})` : ''}
                                    </span>
                                    <input
                                      type="date"
                                      aria-label={`Hotel Confirmed Date for ${i.invoiceNo}`}
                                      className={`${inputCls} !py-1 !text-xs`}
                                      value={vDraft.hotelIssuedDate}
                                      disabled={visaBusyId === i.id}
                                      onChange={(e) =>
                                        setVisaDrafts((prev) => ({
                                          ...prev,
                                          [i.id]: { ...vDraft, hotelIssuedDate: e.target.value },
                                        }))
                                      }
                                    />
                                  </label>
                                </div>
                              </div>
                            )}

                            {/* 4. Air Tickets Separate Toggle */}
                            {showTicket && (
                              <div className="space-y-1.5 pt-2 border-t border-indigo-200/60 dark:border-indigo-900/50">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="text-[11px] font-bold text-indigo-900 dark:text-indigo-200">
                                    4. Flight / Air Tickets Progress
                                  </span>
                                  <div className="flex flex-wrap items-center gap-1">
                                    {(['not_started', 'in_progress', 'issued'] as const).map((st) => (
                                      <button
                                        key={st}
                                        type="button"
                                        disabled={visaBusyId === i.id}
                                        onClick={() => {
                                          const nextTicketInProg =
                                            st === 'not_started'
                                              ? null
                                              : st === 'in_progress'
                                                ? vDraft.ticketInProgressDate.trim() || today()
                                                : vDraft.ticketInProgressDate.trim() || savedTicketInProg || today();
                                          const nextTicketIssued =
                                            st === 'issued' ? vDraft.ticketIssuedDate.trim() || today() : null;
                                          void saveCardVisa(
                                            i,
                                            vStatus,
                                            vDraft.inProgressDate.trim() || null,
                                            vDraft.issuedDate.trim() || null,
                                            buildFullExtra({
                                              ticketEnabled: true,
                                              ticketStatus: st,
                                              ticketInProgressDate: nextTicketInProg,
                                              ticketIssuedDate: nextTicketIssued,
                                            })
                                          );
                                        }}
                                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition-colors cursor-pointer ${
                                          tStatus === st
                                            ? st === 'issued'
                                              ? 'bg-emerald-600 text-white border-emerald-600'
                                              : st === 'in_progress'
                                                ? 'bg-amber-500 text-white border-amber-500'
                                                : 'bg-slate-700 text-white border-slate-700'
                                            : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-100'
                                        }`}
                                      >
                                        {st === 'issued' ? '✓ Ticket Issued' : VISA_STATUS_LABEL[st]}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  <input
                                    type="text"
                                    maxLength={160}
                                    placeholder="Airline / PNR / Sector (e.g. Saudia · LHE-JED)"
                                    className={`${inputCls} !py-1 !text-xs`}
                                    value={vDraft.ticketDetails}
                                    disabled={visaBusyId === i.id}
                                    onChange={(e) =>
                                      setVisaDrafts((prev) => ({
                                        ...prev,
                                        [i.id]: { ...vDraft, ticketDetails: e.target.value },
                                      }))
                                    }
                                  />
                                  <input
                                    type="date"
                                    aria-label={`Ticket Issued Date for ${i.invoiceNo}`}
                                    className={`${inputCls} !py-1 !text-xs`}
                                    value={vDraft.ticketIssuedDate}
                                    disabled={visaBusyId === i.id}
                                    onChange={(e) =>
                                      setVisaDrafts((prev) => ({
                                        ...prev,
                                        [i.id]: { ...vDraft, ticketIssuedDate: e.target.value },
                                      }))
                                    }
                                  />
                                </div>
                              </div>
                            )}

                            {/* 5. Tours & Transfers Separate Toggle */}
                            {showTransfer && (
                              <div className="space-y-1.5 pt-2 border-t border-indigo-200/60 dark:border-indigo-900/50">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="text-[11px] font-bold text-indigo-900 dark:text-indigo-200">
                                    5. Tours &amp; Transfers Progress
                                  </span>
                                  <div className="flex flex-wrap items-center gap-1">
                                    {(['not_started', 'in_progress', 'issued'] as const).map((st) => (
                                      <button
                                        key={st}
                                        type="button"
                                        disabled={visaBusyId === i.id}
                                        onClick={() => {
                                          const nextTrInProg =
                                            st === 'not_started'
                                              ? null
                                              : st === 'in_progress'
                                                ? vDraft.transferInProgressDate.trim() || today()
                                                : vDraft.transferInProgressDate.trim() || savedTransferInProg || today();
                                          const nextTrIssued =
                                            st === 'issued' ? vDraft.transferIssuedDate.trim() || today() : null;
                                          void saveCardVisa(
                                            i,
                                            vStatus,
                                            vDraft.inProgressDate.trim() || null,
                                            vDraft.issuedDate.trim() || null,
                                            buildFullExtra({
                                              transferEnabled: true,
                                              transferStatus: st,
                                              transferInProgressDate: nextTrInProg,
                                              transferIssuedDate: nextTrIssued,
                                            })
                                          );
                                        }}
                                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition-colors cursor-pointer ${
                                          trStatus === st
                                            ? st === 'issued'
                                              ? 'bg-emerald-600 text-white border-emerald-600'
                                              : st === 'in_progress'
                                                ? 'bg-amber-500 text-white border-amber-500'
                                                : 'bg-slate-700 text-white border-slate-700'
                                            : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-100'
                                        }`}
                                      >
                                        {st === 'issued' ? '✓ Transfers Confirmed' : HOTEL_STATUS_LABEL[st]}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  <input
                                    type="text"
                                    maxLength={160}
                                    placeholder="Transfer / Tour details (e.g. Private VIP Coaster / Haramain Train)"
                                    className={`${inputCls} !py-1 !text-xs`}
                                    value={vDraft.transferDetails}
                                    disabled={visaBusyId === i.id}
                                    onChange={(e) =>
                                      setVisaDrafts((prev) => ({
                                        ...prev,
                                        [i.id]: { ...vDraft, transferDetails: e.target.value },
                                      }))
                                    }
                                  />
                                  <input
                                    type="date"
                                    aria-label={`Transfer Confirmed Date for ${i.invoiceNo}`}
                                    className={`${inputCls} !py-1 !text-xs`}
                                    value={vDraft.transferIssuedDate}
                                    disabled={visaBusyId === i.id}
                                    onChange={(e) =>
                                      setVisaDrafts((prev) => ({
                                        ...prev,
                                        [i.id]: { ...vDraft, transferIssuedDate: e.target.value },
                                      }))
                                    }
                                  />
                                </div>
                              </div>
                            )}

                            {/* 6. Travel Insurance Separate Toggle */}
                            {showInsurance && (
                              <div className="space-y-1.5 pt-2 border-t border-indigo-200/60 dark:border-indigo-900/50">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="text-[11px] font-bold text-indigo-900 dark:text-indigo-200">
                                    6. Travel Insurance Progress
                                  </span>
                                  <div className="flex flex-wrap items-center gap-1">
                                    {(['not_started', 'in_progress', 'issued'] as const).map((st) => (
                                      <button
                                        key={st}
                                        type="button"
                                        disabled={visaBusyId === i.id}
                                        onClick={() => {
                                          const nextInsInProg =
                                            st === 'not_started'
                                              ? null
                                              : st === 'in_progress'
                                                ? vDraft.insuranceInProgressDate.trim() || today()
                                                : vDraft.insuranceInProgressDate.trim() || savedInsuranceInProg || today();
                                          const nextInsIssued =
                                            st === 'issued' ? vDraft.insuranceIssuedDate.trim() || today() : null;
                                          void saveCardVisa(
                                            i,
                                            vStatus,
                                            vDraft.inProgressDate.trim() || null,
                                            vDraft.issuedDate.trim() || null,
                                            buildFullExtra({
                                              insuranceEnabled: true,
                                              insuranceStatus: st,
                                              insuranceInProgressDate: nextInsInProg,
                                              insuranceIssuedDate: nextInsIssued,
                                            })
                                          );
                                        }}
                                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition-colors cursor-pointer ${
                                          insStatus === st
                                            ? st === 'issued'
                                              ? 'bg-emerald-600 text-white border-emerald-600'
                                              : st === 'in_progress'
                                                ? 'bg-amber-500 text-white border-amber-500'
                                                : 'bg-slate-700 text-white border-slate-700'
                                            : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-100'
                                        }`}
                                      >
                                        {st === 'issued' ? '✓ Policy Issued' : VISA_STATUS_LABEL[st]}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            )}

                            {vDirty && (
                              <div className="flex flex-wrap items-center gap-2 pt-1.5 border-t border-indigo-200/60 dark:border-indigo-900/50">
                                <button
                                  type="button"
                                  className={`${btnPrimary} !py-1 !px-2.5 !text-[11px]`}
                                  disabled={visaBusyId === i.id}
                                  onClick={() =>
                                    void saveCardVisa(
                                      i,
                                      vStatus,
                                      vDraft.inProgressDate.trim() || null,
                                      vDraft.issuedDate.trim() || null,
                                      buildFullExtra()
                                    )
                                  }
                                >
                                  {visaBusyId === i.id ? 'Saving…' : 'Save Hotel Name, Dates & Progress'}
                                </button>
                                <button
                                  type="button"
                                  className={`${btnGhost} !py-1 !px-2 !text-[11px]`}
                                  disabled={visaBusyId === i.id}
                                  onClick={() =>
                                    setVisaDrafts((prev) => {
                                      const next = { ...prev };
                                      delete next[i.id];
                                      return next;
                                    })
                                  }
                                >
                                  Reset
                                </button>
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-700 dark:text-slate-200">
                            {showVisa && (
                              <>
                                <span className="font-bold text-indigo-900 dark:text-indigo-200">
                                  Visa: {VISA_STATUS_LABEL[vStatus]}
                                </span>
                                <span>In Progress: <b>{savedInProg ? niceDate(savedInProg) : '—'}</b></span>
                                <span>Issued: <b>{savedIssued ? niceDate(savedIssued) : '—'}</b></span>
                              </>
                            )}
                            {showHotel && (
                              <span className="font-bold text-indigo-900 dark:text-indigo-200">
                                Hotel: {HOTEL_STATUS_LABEL[hStatus]}{savedHotelName ? ` (${savedHotelName})` : ''}
                              </span>
                            )}
                            {showTicket && (
                              <span className="font-bold text-indigo-900 dark:text-indigo-200">
                                Ticket: {VISA_STATUS_LABEL[tStatus]}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <button className={btnGhost} onClick={() => setView(i)}><Eye className="w-3.5 h-3.5" /> View</button>
                      <button className={btnPrimary} onClick={() => void pdf(i)}><FileDown className="w-3.5 h-3.5" /> Download PDF</button>
                      {canShare && <button className={btnGhost} onClick={() => void share(i)}><Share2 className="w-3.5 h-3.5" /> Share</button>}
                      {canEdit(i) && <button className={btnGhost} onClick={() => { setForm(toForm(i, company.ntn || '')); setError(''); }}><Pencil className="w-3.5 h-3.5" /> Edit</button>}
                      {isAdmin && (
                        <select
                          aria-label={`Invoice status for ${i.invoiceNo}`}
                          className={`${inputCls} !w-auto !py-1 !px-2.5 !text-xs font-semibold`}
                          value={i.status}
                          onChange={(e) => {
                            const next = e.target.value as CrmInvoice['status'];
                            if (next === 'cancelled') { void cancelWithRemarks(i); return; }
                            void act('invoice_status', { id: i.id, status: next });
                          }}
                        >
                          <option value="unpaid">Status: Unpaid</option>
                          <option value="paid">Status: Paid (Payment Approved)</option>
                          <option value="cancelled">Status: Cancelled</option>
                        </select>
                      )}
                      {(isAdmin || currentUser.role === 'accounts') && i.status !== 'paid' && <button className={btnGhost} onClick={() => void act('invoice_status', { id: i.id, status: 'paid' })}>{currentUser.role === 'accounts' && !isAdmin ? 'Mark as Received' : 'Mark as Paid'}</button>}
                      {isAdmin && i.status === 'paid' && <button className={btnGhost} onClick={() => void act('invoice_status', { id: i.id, status: 'unpaid' })}>Mark unpaid</button>}
                      {(isAdmin || i.createdBy === currentUser.id) && i.status === 'unpaid' && <button className={btnGhost} onClick={() => void cancelWithRemarks(i)}>Cancel invoice</button>}
                      {isStaff && i.status === 'cancelled' && <button className={btnGhost} onClick={() => void act('invoice_status', { id: i.id, status: 'unpaid' })}>Reopen</button>}
                      {isAdmin && <button className={btnDanger} aria-label="Delete invoice" onClick={() => { if (window.confirm(`Delete invoice ${i.invoiceNo} permanently?`)) void act('invoice_delete', { id: i.id }); }}><Trash2 className="w-3.5 h-3.5" /></button>}
                    </div>
                  </div>

                  {/* RIGHT HALF (50%): Vendor Payables for This Invoice */}
                  {!vendorSide && (
                    <div className={`min-w-0 lg:border-l lg:border-slate-200 dark:lg:border-slate-800 lg:pl-4 flex flex-col justify-between space-y-2 ${i.vendorStatus === 'paid' && invVendors.length > 0 ? 'rounded-lg p-2.5 -m-2.5 lg:ml-1.5 bg-emerald-100/90 dark:bg-emerald-950/50' : ''}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className={`text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5 ${i.vendorStatus === 'paid' ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
                          Vendor Payables (Office Only)
                          {invVendors.length > 0 && <Pill tone={i.vendorStatus === 'paid' ? 'green' : 'amber'}>{i.vendorStatus === 'paid' ? 'Vendors paid' : 'Vendors unpaid'}</Pill>}
                        </span>
                        <div className="flex flex-wrap items-center gap-2 text-[11px]">
                          <span className="text-slate-500">Total Payable:</span>
                          {vendorTotalsByCur.size > 0 ? (
                            [...vendorTotalsByCur.entries()].map(([cur, amt]) => (
                              <b key={cur} className={`font-mono px-2 py-0.5 rounded border ${i.vendorStatus === 'paid' ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60' : 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60'}`}>
                                {cur} {fmtAmount(amt)}
                              </b>
                            ))
                          ) : (
                            <b className="font-mono text-slate-400">{i.currency} 0</b>
                          )}
                        </div>
                      </div>

                      {invVendors.length > 0 ? (
                        <div className="space-y-1.5">
                          {invVendors.map((v, vi) => (
                            <div key={vi} className={`p-2.5 rounded-lg border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${i.vendorStatus === 'paid' ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/60' : 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-200/80 dark:border-amber-900/50'}`}>
                              <div className="min-w-0 space-y-0.5">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="font-bold text-slate-900 dark:text-slate-100">{v.name}</span>
                                  {v.description && <span className="text-[11px] text-slate-600 dark:text-slate-300">· {v.description}</span>}
                                </div>
                                {(v.unitPrice !== null && v.unitPrice !== undefined) && (
                                  <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                                    Unit price: {v.currency || i.currency} {fmtAmount(v.unitPrice)} × Units: {fmtAmount(v.units ?? 1)}
                                  </p>
                                )}
                                {v.bank && (
                                  <p className="text-[11px] text-slate-500 dark:text-slate-400 break-words">
                                    Bank: <span className="font-medium text-slate-700 dark:text-slate-300">{v.bank}</span>
                                  </p>
                                )}
                              </div>
                              <div className="sm:text-right shrink-0">
                                <span className="block text-[10px] text-slate-400 uppercase">Payable</span>
                                <b className={`font-mono text-xs ${i.vendorStatus === 'paid' ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
                                  {v.currency || i.currency} {fmtAmount(v.amount || 0)}
                                </b>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {invVendors.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          <button className={btnPrimary} onClick={() => void vendorPdf(i)}><FileDown className="w-3.5 h-3.5" /> Download vendor PDF</button>
                          {isStaff && i.status !== 'cancelled' && i.vendorStatus !== 'paid' && <button className={btnGhost} onClick={() => void act('invoice_vendor_status', { id: i.id, status: 'paid' })}>Mark vendors paid</button>}
                          {isStaff && i.vendorStatus === 'paid' && <button className={btnGhost} onClick={() => void act('invoice_vendor_status', { id: i.id, status: 'unpaid' })}>Mark vendors unpaid</button>}
                        </div>
                      )}
                      {invVendors.length === 0 && (
                        <div className="flex-1 flex items-center justify-between p-3 rounded-lg border border-dashed border-slate-200 dark:border-slate-800 text-xs text-slate-400">
                          <span>No vendor payables recorded for this invoice.</span>
                          {canEdit(i) && (
                            <button
                              type="button"
                              onClick={() => { setForm(toForm(i, company.ntn || '')); setError(''); }}
                              className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
                            >
                              + Add vendor
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {i.status === 'cancelled' && i.cancelRemarks && (
                  <p className="mt-3 text-[11px] rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100/80 dark:bg-slate-800/60 px-2.5 py-1.5 text-slate-700 dark:text-slate-300"><b>Cancelled</b>{i.cancelledBy ? ` by ${(empName.get(i.cancelledBy) || "a team member")}` : ''}: {i.cancelRemarks}</p>
                )}
                <button type="button" onClick={() => toggleOpen(i.id)} aria-expanded={openIds.has(i.id)}
                  className="mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/50 hover:bg-white dark:hover:bg-slate-800 py-1.5 text-[11px] font-bold text-slate-600 dark:text-slate-300 cursor-pointer transition-colors">
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-300 ${openIds.has(i.id) ? 'rotate-180' : ''}`} />
                  {openIds.has(i.id) ? 'Hide details' : 'Show customer details & actions'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <PortalInvoiceModal invoice={portalFor} settings={portalFor ? crm.data.portalInvoices?.[portalFor.id] : undefined} onClose={() => setPortalFor(null)} onSaved={() => void crm.refresh()} />

      {/* ---------- preview */}
      <Modal isOpen={Boolean(view)} onClose={() => setView(null)} title={view ? `${view.kind === 'vendor' ? 'Vendor payable' : 'Invoice'} ${view.invoiceNo}` : ''} subtitle={view?.kind === 'vendor' ? 'Digital copy for our records — not for the customer' : 'Preview — the PDF has the same layout'} maxWidth="4xl">
        {view && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <button className={btnPrimary} onClick={() => void pdf(view)}><FileDown className="w-3.5 h-3.5" /> Download PDF</button>
              {hasVendorLines(view) && <button className={btnGhost} onClick={() => void vendorPdf(view)}><FileDown className="w-3.5 h-3.5" /> Vendor PDF</button>}
              {canShare && <button className={btnGhost} onClick={() => void share(view)}><Share2 className="w-3.5 h-3.5" /> Share</button>}
              {canEdit(view) && <button className={btnGhost} onClick={() => { setForm(toForm(view, company.ntn || '')); setView(null); }}><Pencil className="w-3.5 h-3.5" /> Edit</button>}
            </div>
            {error && <ErrorNote message={error} />}
            {(view.vendors || []).length > 0 && (
              <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs space-y-1.5">
                <p className="font-bold text-amber-800 dark:text-amber-300 inline-flex items-center gap-1.5"><Info className="w-3.5 h-3.5" /> Vendor details — office record only, not on the PDF</p>
                {view.vendors.map((v, i) => (
                  <div key={i} className="text-slate-700 dark:text-slate-200">
                    <b>{v.name}</b>
                    {v.description ? <span> — {v.description}</span> : null}
                    {v.unitPrice !== null && v.unitPrice !== undefined ? <span className="text-slate-500"> (Unit price: {v.currency} {fmtAmount(v.unitPrice)} × Units: {fmtAmount(v.units ?? 1)})</span> : null}
                    {v.amount ? <> — payable <span className="font-mono font-bold">{v.currency} {fmtAmount(v.amount)}</span></> : null}
                    {v.bank && <span className="block whitespace-pre-wrap text-slate-500 dark:text-slate-400">Bank: {v.bank}</span>}
                  </div>
                ))}
              </div>
            )}
            <InvoicePreview inv={view} company={company} by={by(view)} />
          </div>
        )}
      </Modal>

      {/* ---------- form */}
      <Modal isOpen={Boolean(form)} onClose={() => setForm(null)} title={`${form?.id ? 'Edit' : 'New'} ${form?.kind === 'vendor' ? 'vendor payable' : 'invoice'}`} subtitle="The invoice number is created automatically" maxWidth="full">
        {form && calc && draft && (
          <div className="flex flex-col xl:flex-row gap-5 xl:items-start">
          <form onSubmit={save} className="space-y-5 min-w-0 xl:flex-1">
            {/* 1. Customer Details First (Ordered: Invoice No -> CRM ID / Query Code -> Customer Name) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label={form.kind === 'vendor' ? 'Bill No' : 'Invoice No'}>
                <input
                  className={`${inputCls} font-mono font-bold bg-slate-100 dark:bg-slate-800/80 text-blue-700 dark:text-blue-300`}
                  value={form.invoiceNo || (form.kind === 'vendor' ? 'PAY-(auto on save)' : 'INV-(auto on save)')}
                  readOnly
                />
              </Field>
              <Field label="CRM ID / Query Code (optional)"><input className={inputCls} value={form.crmId} onChange={(e) => patch({ crmId: e.target.value })} maxLength={80} /></Field>
              <Field label={form.kind === 'vendor' ? 'Vendor name *' : 'Customer name *'}><input className={inputCls} value={form.customerName} onChange={(e) => patch({ customerName: e.target.value })} maxLength={160} required /></Field>
              <Field label="Phone"><input className={inputCls} value={form.customerPhone} onChange={(e) => patch({ customerPhone: e.target.value })} maxLength={60} /></Field>
              <Field label="Reference"><input className={inputCls} value={form.reference} onChange={(e) => patch({ reference: e.target.value })} maxLength={120} /></Field>
              <Field label="Invoice currency *">
                <select className={inputCls} value={form.currency} onChange={(e) => changeInvoiceCurrency(e.target.value)}>
                  {currencies.map((c) => <option key={c.code} value={c.code}>{currencyLabel(c)}</option>)}
                </select>
              </Field>
              <Field label={form.kind === 'vendor' ? 'Bill date *' : 'Invoice date *'}><input className={inputCls} type="date" value={form.invoiceDate} onChange={(e) => patch({ invoiceDate: e.target.value })} required /></Field>
              {form.kind === 'customer' && (
                <div>
                  <Field label="NTN (optional)"><input className={inputCls} value={form.ntn} onChange={(e) => patch({ ntn: e.target.value })} maxLength={60} placeholder="Leave empty for no NTN" /></Field>
                  <label className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer"><input type="checkbox" checked={form.showNtn} onChange={(e) => patch({ showNtn: e.target.checked })} /> Show NTN on the invoice PDF</label>
                </div>
              )}
              <Field label="Due date (optional)"><input className={inputCls} type="date" value={form.dueDate} onChange={(e) => patch({ dueDate: e.target.value })} /></Field>
            </div>

            {form.kind === 'customer' && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-3">
                <Field label="Traveler names (optional)" hint="Add one traveler per line. You can enter as many as needed (up to 100).">
                  <textarea className={inputCls} rows={3} value={form.travelerNames} onChange={(e) => patch({ travelerNames: e.target.value })} placeholder={"Traveler 1\nTraveler 2\nTraveler 3"} maxLength={12000} />
                </Field>
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                  <input type="checkbox" checked={form.paymentReceived} onChange={(e) => patch({ paymentReceived: e.target.checked })} />
                  Payment received (employee confirmation)
                </label>
              </div>
            )}

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

            {customerPortalBetaEnabled && form.kind === 'customer' && (() => {
              const visaAutoDetected = hasVisaKeyword(form.sections, form.reference, form.notes);
              const visaTrackingActive = visaAutoDetected || form.visaEnabled;
              const hotelAutoDetected = hasHotelKeyword(form.sections, form.reference, form.notes);
              const hotelTrackingActive = hotelAutoDetected || form.hotelEnabled;
              const ticketAutoDetected = hasTicketKeyword(form.sections, form.reference, form.notes);
              const ticketTrackingActive = ticketAutoDetected || form.ticketEnabled;
              const transferAutoDetected = hasTransferKeyword(form.sections, form.reference, form.notes);
              const transferTrackingActive = transferAutoDetected || form.transferEnabled;
              const insuranceAutoDetected = hasInsuranceKeyword(form.sections, form.reference, form.notes);
              const insuranceTrackingActive = insuranceAutoDetected || form.insuranceEnabled;
              return (
                <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/50 dark:bg-indigo-950/20 p-3.5 space-y-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-indigo-200/60 dark:border-indigo-900/50">
                    <label className="inline-flex items-center gap-2 text-xs font-bold text-indigo-900 dark:text-indigo-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.paymentApproved}
                        onChange={(e) =>
                          patch({
                            paymentApproved: e.target.checked,
                            paymentApprovedDate: e.target.checked ? form.paymentApprovedDate || today() : '',
                          })
                        }
                      />
                      Payment Approved (Unlocks Customer Portal Process Steps)
                    </label>
                    {form.paymentApproved && (
                      <input
                        type="date"
                        className={`${inputCls} !w-auto !py-1 !text-xs`}
                        value={form.paymentApprovedDate}
                        onChange={(e) => patch({ paymentApprovedDate: e.target.value })}
                      />
                    )}
                  </div>

                  <div className="space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="inline-flex items-center gap-2 text-xs font-bold text-indigo-900 dark:text-indigo-200 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={visaTrackingActive}
                          disabled={visaAutoDetected}
                          onChange={(e) => patch({ visaEnabled: e.target.checked })}
                        />
                        Track Visa progress on Customers Page
                      </label>
                      {visaAutoDetected && <Pill tone="blue">Auto-detected from Catalogue</Pill>}
                    </div>
                    {visaTrackingActive && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <Field label="Visa progress status">
                          <select
                            className={inputCls}
                            value={form.visaStatus}
                            onChange={(e) => setFormVisaStatus(e.target.value as VisaProgressStatus)}
                          >
                            <option value="not_started">Not Started</option>
                            <option value="in_progress">Visa Started (In Progress)</option>
                            <option value="issued">Visa Issued</option>
                          </select>
                        </Field>
                        <Field label="Visa Started date">
                          <input
                            type="date"
                            className={inputCls}
                            value={form.visaInProgressDate}
                            onChange={(e) => patch({ visaInProgressDate: e.target.value })}
                          />
                        </Field>
                        <Field label="Visa Issued date">
                          <input
                            type="date"
                            className={inputCls}
                            value={form.visaIssuedDate}
                            onChange={(e) => patch({ visaIssuedDate: e.target.value })}
                          />
                        </Field>
                      </div>
                    )}
                  </div>

                  <div className="pt-2.5 border-t border-indigo-200/60 dark:border-indigo-900/50 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="inline-flex items-center gap-2 text-xs font-bold text-indigo-900 dark:text-indigo-200 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={hotelTrackingActive}
                          disabled={hotelAutoDetected}
                          onChange={(e) => patch({ hotelEnabled: e.target.checked })}
                        />
                        Track Hotel Booking Confirmation on Customers Page (Name &amp; Dates)
                      </label>
                      {hotelAutoDetected && <Pill tone="green">Auto-detected from Package / Hotel</Pill>}
                    </div>
                    {hotelTrackingActive && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="sm:col-span-2">
                          <Field label="Hotel Name">
                            <input
                              type="text"
                              maxLength={160}
                              placeholder="e.g. Pullman Zamzam Makkah / Hilton Baku"
                              className={inputCls}
                              value={form.hotelName}
                              onChange={(e) => patch({ hotelName: e.target.value })}
                            />
                          </Field>
                        </div>
                        <Field label="Hotel booking status">
                          <select
                            className={inputCls}
                            value={form.hotelStatus}
                            onChange={(e) => setFormHotelStatus(e.target.value as VisaProgressStatus)}
                          >
                            <option value="not_started">Not Started</option>
                            <option value="in_progress">In Progress</option>
                            <option value="issued">Hotel Confirmed</option>
                          </select>
                        </Field>
                        <Field label="Check-In date">
                          <input
                            type="date"
                            className={inputCls}
                            value={form.hotelCheckInDate}
                            onChange={(e) => patch({ hotelCheckInDate: e.target.value })}
                          />
                        </Field>
                        <Field label="Check-Out date">
                          <input
                            type="date"
                            className={inputCls}
                            value={form.hotelCheckOutDate}
                            onChange={(e) => patch({ hotelCheckOutDate: e.target.value })}
                          />
                        </Field>
                        <Field label="Hotel Confirmed date">
                          <input
                            type="date"
                            className={inputCls}
                            value={form.hotelIssuedDate}
                            onChange={(e) => patch({ hotelIssuedDate: e.target.value })}
                          />
                        </Field>
                      </div>
                    )}
                  </div>

                  <div className="pt-2.5 border-t border-indigo-200/60 dark:border-indigo-900/50 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="inline-flex items-center gap-2 text-xs font-bold text-indigo-900 dark:text-indigo-200 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={ticketTrackingActive}
                          disabled={ticketAutoDetected}
                          onChange={(e) => patch({ ticketEnabled: e.target.checked })}
                        />
                        Track Flight / Air Ticket progress on Customers Page
                      </label>
                      {ticketAutoDetected && <Pill tone="blue">Auto-detected from Ticket item</Pill>}
                    </div>
                    {ticketTrackingActive && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <Field label="Flight / Ticket status">
                          <select
                            className={inputCls}
                            value={form.ticketStatus}
                            onChange={(e) => setFormTicketStatus(e.target.value as VisaProgressStatus)}
                          >
                            <option value="not_started">Not Started</option>
                            <option value="in_progress">In Progress</option>
                            <option value="issued">Issued</option>
                          </select>
                        </Field>
                        <Field label="Airline / PNR details">
                          <input
                            type="text"
                            maxLength={160}
                            placeholder="e.g. Saudia · LHE-JED"
                            className={inputCls}
                            value={form.ticketDetails}
                            onChange={(e) => patch({ ticketDetails: e.target.value })}
                          />
                        </Field>
                        <Field label="Ticket Issued date">
                          <input
                            type="date"
                            className={inputCls}
                            value={form.ticketIssuedDate}
                            onChange={(e) => patch({ ticketIssuedDate: e.target.value })}
                          />
                        </Field>
                      </div>
                    )}
                  </div>

                  <div className="pt-2.5 border-t border-indigo-200/60 dark:border-indigo-900/50 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="inline-flex items-center gap-2 text-xs font-bold text-indigo-900 dark:text-indigo-200 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={transferTrackingActive}
                          disabled={transferAutoDetected}
                          onChange={(e) => patch({ transferEnabled: e.target.checked })}
                        />
                        Track Tours &amp; Transfers on Customers Page
                      </label>
                      {transferAutoDetected && <Pill tone="blue">Auto-detected from Package / Transfer</Pill>}
                    </div>
                    {transferTrackingActive && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <Field label="Tours & Transfers status">
                          <select
                            className={inputCls}
                            value={form.transferStatus}
                            onChange={(e) => setFormTransferStatus(e.target.value as VisaProgressStatus)}
                          >
                            <option value="not_started">Not Started</option>
                            <option value="in_progress">In Progress</option>
                            <option value="issued">Confirmed</option>
                          </select>
                        </Field>
                        <Field label="Transfer / Tour details">
                          <input
                            type="text"
                            maxLength={160}
                            placeholder="e.g. Private Coaster / Haramain Train"
                            className={inputCls}
                            value={form.transferDetails}
                            onChange={(e) => patch({ transferDetails: e.target.value })}
                          />
                        </Field>
                        <Field label="Confirmed date">
                          <input
                            type="date"
                            className={inputCls}
                            value={form.transferIssuedDate}
                            onChange={(e) => patch({ transferIssuedDate: e.target.value })}
                          />
                        </Field>
                      </div>
                    )}
                  </div>

                  <div className="pt-2.5 border-t border-indigo-200/60 dark:border-indigo-900/50 flex flex-wrap items-center justify-between gap-3">
                    <label className="inline-flex items-center gap-2 text-xs font-bold text-indigo-900 dark:text-indigo-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={insuranceTrackingActive}
                        disabled={insuranceAutoDetected}
                        onChange={(e) => patch({ insuranceEnabled: e.target.checked })}
                      />
                      Track Travel Insurance ({form.insuranceStatus === 'issued' ? 'Issued' : form.insuranceStatus === 'in_progress' ? 'In Progress' : 'Not Started'})
                    </label>
                    {insuranceTrackingActive && (
                      <select
                        className={`${inputCls} !w-auto !py-1 !text-xs`}
                        value={form.insuranceStatus}
                        onChange={(e) => setFormInsuranceStatus(e.target.value as VisaProgressStatus)}
                      >
                        <option value="not_started">Insurance: Not Started</option>
                        <option value="in_progress">Insurance: In Progress</option>
                        <option value="issued">Insurance: Policy Issued</option>
                      </select>
                    )}
                    <label className="inline-flex items-center gap-2 text-xs font-bold text-emerald-800 dark:text-emerald-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.travelReadyEnabled}
                        onChange={(e) =>
                          patch({
                            travelReadyEnabled: e.target.checked,
                            travelReadyDate: e.target.checked ? form.travelReadyDate || today() : '',
                          })
                        }
                      />
                      Mark Travel Ready Confirmed
                    </label>
                  </div>
                </div>
              );
            })()}

            {/* Vendor Details Bar at the Bottom of the Form (with optional Description, Unit Price, Units) */}
            {form.kind === 'customer' && (
              <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50/70 dark:bg-amber-950/20 p-3.5 space-y-3">
                <p className="text-[11px] font-bold text-amber-800 dark:text-amber-300 inline-flex items-center gap-1.5"><Info className="w-3.5 h-3.5 shrink-0" /> Vendor details — for office record and use only. Never printed on the customer’s invoice PDF.</p>
                {form.vendors.map((v, vi) => (
                  <div key={vi} className="p-2.5 rounded-lg bg-white/70 dark:bg-slate-900/50 border border-amber-200/80 dark:border-amber-800/50 space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-12 gap-2 items-end">
                      <div className="md:col-span-3"><Field label="Vendor name (optional)"><input className={inputCls} value={v.name} maxLength={160} placeholder="e.g. MEEZAB AIR" onChange={(e) => updateVendor(vi, { name: e.target.value })} /></Field></div>
                      <div className="md:col-span-4"><Field label="Description (optional)"><input className={inputCls} value={v.description} maxLength={300} placeholder="e.g. Ticket / Hotel / Visa details" onChange={(e) => updateVendor(vi, { description: e.target.value })} /></Field></div>
                      <div className="md:col-span-2"><Field label="Unit price (optional)"><input className={inputCls} type="number" inputMode="decimal" step="0.01" min="0" placeholder="0.00" value={v.unitPrice} onChange={(e) => updateVendor(vi, { unitPrice: e.target.value })} /></Field></div>
                      <div className="md:col-span-1"><Field label="Units (opt.)"><input className={inputCls} type="number" inputMode="decimal" step="any" min="0" placeholder="1" value={v.units} onChange={(e) => updateVendor(vi, { units: e.target.value })} /></Field></div>
                      <div className="md:col-span-2"><Field label="Payable / Total (opt.)"><input className={inputCls} type="number" inputMode="decimal" step="0.01" min="0" placeholder="0.00" value={v.amount} onChange={(e) => updateVendor(vi, { amount: e.target.value })} /></Field></div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                      <div className="sm:col-span-3 md:col-span-2"><Field label="Currency"><select className={inputCls} value={v.currency} onChange={(e) => updateVendor(vi, { currency: e.target.value })}>{currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}</select></Field></div>
                      <div className="sm:col-span-8 md:col-span-9"><Field label="Bank Acc Details (optional)"><input className={inputCls} value={v.bank} maxLength={600} placeholder="Bank, account title, account no. / IBAN" onChange={(e) => updateVendor(vi, { bank: e.target.value })} /></Field></div>
                      <div className="sm:col-span-1 md:pb-2 flex sm:justify-end">
                        {form.vendors.length > 1 && <button type="button" aria-label="Remove vendor" className="text-slate-400 hover:text-red-600 cursor-pointer" onClick={() => patch({ vendors: form.vendors.filter((_, i) => i !== vi) })}><X className="w-4 h-4" /></button>}
                      </div>
                    </div>
                  </div>
                ))}
                <button type="button" className={btnGhost} onClick={() => patch({ vendors: [...form.vendors, blankVendor(form.currency)] })}><Plus className="w-3.5 h-3.5" /> Add another vendor</button>
              </div>
            )}

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
