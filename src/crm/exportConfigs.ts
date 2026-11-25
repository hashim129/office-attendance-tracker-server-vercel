import { CrmCustomer, CrmFollowup, CrmInventoryRequest, CrmInvoice, CrmMeeting, CrmPurchase, CrmReceipt, CrmSale } from './crmApi';
import { PdfColumn, fmtDateTimePk, fmtDayText, money, ReportSection } from '../lib/reportPdf';
import { crmQueryOf } from './invoiceHelpers';

/**
 * What each section's PDF contains. Every report has "Created on" and "Created by" columns,
 * so the date, time and person who made every record are on the page.
 */
export type NameOf = (id: string) => string;
export type Cells = Record<string, string>;

const createdCols = (): PdfColumn[] => [
  { key: 'created', label: 'Created (date & time)', width: 1.5 },
  { key: 'by', label: 'Created by', width: 1.2 },
];
const createdCells = (createdAt: string, createdBy: string, nameOf: NameOf): Cells => ({ created: fmtDateTimePk(createdAt), by: nameOf(createdBy) });

/** Totals per currency, printed as summary boxes: [["Total PKR", "1,000"], ...] */
export function perCurrency<T>(rows: T[], cur: (r: T) => string, label: string, value: (r: T) => number): [string, string][] {
  const map = new Map<string, number>();
  rows.forEach((r) => map.set(cur(r), (map.get(cur(r)) || 0) + (Number(value(r)) || 0)));
  return [...map.entries()].map(([c, v]) => [`${label} ${c}`, money(v)] as [string, string]);
}

// ---------------------------------------------------------------- invoices
export const invoiceColumns = (): PdfColumn[] => [
  { key: 'no', label: 'Invoice No', width: 1.1 },
  { key: 'customer', label: 'Customer', width: 1.7 },
  { key: 'crm', label: 'CRM ID / Query', width: 1.1 },
  { key: 'phone', label: 'Customer No', width: 1.1 },
  { key: 'date', label: 'Invoice date', width: 1.1 },
  { key: 'cur', label: 'Cur', width: 0.5 },
  { key: 'total', label: 'Total', width: 1.1, align: 'right' },
  { key: 'received', label: 'Received', width: 1.1, align: 'right' },
  { key: 'balance', label: 'Balance', width: 1.1, align: 'right' },
  { key: 'status', label: 'Status', width: 0.9 },
  ...createdCols(),
];
export const invoiceCells = (i: CrmInvoice, nameOf: NameOf): Cells => ({
  no: i.invoiceNo, customer: i.customerName, crm: crmQueryOf(i) || '-', phone: i.customerPhone || '-', date: fmtDayText(i.invoiceDate), cur: i.currency,
  total: money(i.total), received: money(i.advancePaid), balance: money(i.balance),
  status: i.status === 'cancelled' ? 'Cancelled' : i.kind === 'vendor' ? (i.status === 'paid' ? 'Paid' : 'Unpaid') : (i.status === 'paid' ? 'Received' : i.balance <= 0 ? 'Fully paid' : i.advancePaid > 0 ? 'Part paid' : 'Unpaid'),
  ...createdCells(i.createdAt, i.createdBy, nameOf),
});
export const invoiceSearch = (customerNumbers: Map<string, string>) => [
  { label: 'invoice no.', get: (i: CrmInvoice) => i.invoiceNo },
  { label: 'CRM ID / query code', get: (i: CrmInvoice) => `${i.crmId || ''} ${i.queryCode || ''}` },
  { label: 'customer no.', get: (i: CrmInvoice) => `${i.customerPhone || ''} ${customerNumbers.get((i.customerName || '').trim().toLowerCase()) || ''}` },
  { label: 'customer name', get: (i: CrmInvoice) => i.customerName },
];
export const invoiceSummary = (rows: CrmInvoice[]): [string, string][] => [
  ['Invoices', String(rows.length)],
  ...perCurrency(rows.filter((r) => r.status !== 'cancelled'), (r) => r.currency, 'Total', (r) => r.total),
  ...perCurrency(rows.filter((r) => r.status !== 'cancelled'), (r) => r.currency, 'Received', (r) => r.advancePaid),
  ...perCurrency(rows.filter((r) => r.status !== 'cancelled'), (r) => r.currency, 'Balance', (r) => r.balance),
];

/** Money still to come in from customers, and money still owed to vendors, as one PDF. */
export function receivablesPayablesSections(invoices: CrmInvoice[], nameOf: NameOf): { sections: ReportSection[]; summary: [string, string][] } {
  const receivable = invoices.filter((i) => (i.kind || 'customer') !== 'vendor' && i.status !== 'cancelled' && i.status !== 'paid' && i.balance > 0)
    .sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')));
  const payBills = invoices.filter((i) => i.kind === 'vendor' && i.status === 'unpaid');
  const vendorSides = invoices.filter((i) => (i.kind || 'customer') !== 'vendor' && i.status !== 'cancelled' && i.vendorStatus !== 'paid' && (i.vendors || []).some((v) => (v.amount || 0) > 0));
  const recCols: PdfColumn[] = [
    { key: 'no', label: 'Invoice', width: 1.1 }, { key: 'customer', label: 'Customer', width: 1.8 }, { key: 'crm', label: 'CRM ID', width: 1.1 },
    { key: 'due', label: 'Due date', width: 1.1 }, { key: 'cur', label: 'Cur', width: 0.5 }, { key: 'total', label: 'Total', width: 1.1, align: 'right' },
    { key: 'received', label: 'Received', width: 1.1, align: 'right' }, { key: 'balance', label: 'Balance due', width: 1.2, align: 'right' }, ...createdCols(),
  ];
  const recRows = receivable.map((i) => ({ no: i.invoiceNo, customer: i.customerName, crm: crmQueryOf(i) || '-', due: i.dueDate ? fmtDayText(i.dueDate) : '-', cur: i.currency, total: money(i.total), received: money(i.advancePaid), balance: money(i.balance), ...createdCells(i.createdAt, i.createdBy, nameOf) }));
  const payCols: PdfColumn[] = [
    { key: 'kind', label: 'Type', width: 1.3 }, { key: 'no', label: 'Reference', width: 1.1 }, { key: 'vendor', label: 'Vendor / customer', width: 1.9 },
    { key: 'due', label: 'Due date', width: 1.1 }, { key: 'cur', label: 'Cur', width: 0.5 }, { key: 'amount', label: 'Payable', width: 1.2, align: 'right' }, ...createdCols(),
  ];
  const payRows: Cells[] = [
    ...payBills.map((i) => ({ kind: 'Vendor payable bill', no: i.invoiceNo, vendor: i.customerName, due: i.dueDate ? fmtDayText(i.dueDate) : '-', cur: i.currency, amount: money(i.total), ...createdCells(i.createdAt, i.createdBy, nameOf) })),
    ...vendorSides.flatMap((i) => (i.vendors || []).filter((v) => (v.amount || 0) > 0).map((v) => ({ kind: 'Vendor side of invoice', no: i.invoiceNo, vendor: `${v.name || '-'} (for ${i.customerName})`, due: i.dueDate ? fmtDayText(i.dueDate) : '-', cur: v.currency || i.currency, amount: money(v.amount || 0), ...createdCells(i.createdAt, i.createdBy, nameOf) }))),
  ];
  const payAmounts: { cur: string; amount: number }[] = [
    ...payBills.map((i) => ({ cur: i.currency, amount: i.total })),
    ...vendorSides.flatMap((i) => (i.vendors || []).filter((v) => (v.amount || 0) > 0).map((v) => ({ cur: v.currency || i.currency, amount: v.amount || 0 }))),
  ];
  const recTotals = perCurrency(receivable, (r) => r.currency, 'Receivable', (r) => r.balance);
  const payTotals = perCurrency(payAmounts, (r) => r.cur, 'Payable', (r) => r.amount);
  return {
    sections: [
      { heading: `Receivables - money still to come in (${receivable.length})`, columns: recCols, rows: recRows, totals: recTotals.length ? { customer: 'TOTAL', balance: recTotals.map(([k, v]) => `${k.replace('Receivable ', '')} ${v}`).join(' | ') } : null },
      { heading: `Payables - money still owed to vendors (${payRows.length})`, columns: payCols, rows: payRows, totals: payTotals.length ? { vendor: 'TOTAL', amount: payTotals.map(([k, v]) => `${k.replace('Payable ', '')} ${v}`).join(' | ') } : null },
    ],
    summary: [...recTotals, ...payTotals],
  };
}

// ---------------------------------------------------------------- purchases
export const purchaseColumns = (): PdfColumn[] => [
  { key: 'no', label: 'Purchase No', width: 1.1 },
  { key: 'customer', label: 'Customer', width: 1.6 },
  { key: 'crm', label: 'CRM ID', width: 1 },
  { key: 'date', label: 'Purchase date', width: 1.1 },
  { key: 'items', label: 'Items', width: 2 },
  { key: 'cur', label: 'Cur', width: 0.5 },
  { key: 'payable', label: 'Payable', width: 1.1, align: 'right' },
  { key: 'receivable', label: 'Receivable', width: 1.1, align: 'right' },
  { key: 'status', label: 'Status', width: 0.8 },
  ...createdCols(),
];
export const purchaseCells = (p: CrmPurchase, nameOf: NameOf): Cells => ({
  no: p.purchaseNo, customer: p.customerName, crm: p.crmId || '-', date: fmtDayText(p.purchaseDate),
  items: (p.items || []).map((it) => `${it.categoryLabel || it.category}${it.vendorName ? ` - ${it.vendorName}` : ''}`).join('; ') || '-',
  cur: p.currency, payable: money(p.totalPayable), receivable: money(p.totalReceivable), status: p.status === 'paid' ? 'Paid' : p.status === 'partial' ? 'Part paid' : 'Unpaid',
  ...createdCells(p.createdAt, p.createdBy, nameOf),
});
export const purchaseSearch = [
  { label: 'purchase no.', get: (p: CrmPurchase) => p.purchaseNo },
  { label: 'CRM ID', get: (p: CrmPurchase) => p.crmId },
  { label: 'customer', get: (p: CrmPurchase) => `${p.customerName} ${p.careOf || ''}` },
  { label: 'vendor / ticket no.', get: (p: CrmPurchase) => (p.items || []).map((it) => `${it.vendorName || ''} ${it.ticketNumber || ''}`).join(' ') },
];
export const purchaseSummary = (rows: CrmPurchase[]): [string, string][] => [
  ['Purchases', String(rows.length)],
  ...perCurrency(rows, (r) => r.currency, 'Payable', (r) => r.totalPayable),
  ...perCurrency(rows, (r) => r.currency, 'Receivable', (r) => r.totalReceivable),
];

// ---------------------------------------------------------------- sales
export const saleColumns = (): PdfColumn[] => [
  { key: 'no', label: 'Coupon', width: 1 },
  { key: 'query', label: 'Query code', width: 1 },
  { key: 'customer', label: 'Customer', width: 1.5 },
  { key: 'vendor', label: 'Vendor', width: 1.3 },
  { key: 'type', label: 'Type', width: 0.9 },
  { key: 'cur', label: 'Cur', width: 0.5 },
  { key: 'sale', label: 'Sale', width: 1, align: 'right' },
  { key: 'cost', label: 'Cost', width: 1, align: 'right' },
  { key: 'psf', label: 'PSF / profit', width: 1, align: 'right' },
  { key: 'status', label: 'Status', width: 1 },
  ...createdCols(),
];
export const saleCells = (s: CrmSale, nameOf: NameOf, types: Record<string, string>): Cells => ({
  no: s.couponNo, query: s.queryCode, customer: s.customerName, vendor: s.vendorName, type: s.saleType === 'others' && s.otherType ? s.otherType : types[s.saleType] || s.saleType,
  cur: s.currency, sale: money(s.saleAmount), cost: money(s.costAmount), psf: money(s.psfProfit),
  status: `${s.status === 'approved' ? 'Approved' : s.status === 'declined' ? 'Declined' : 'Pending'}${s.status === 'approved' ? ` / ${s.paymentStatus === 'paid' ? 'Paid' : 'Unpaid'}` : ''}`,
  ...createdCells(s.createdAt, s.createdBy, nameOf),
});
export const saleSearch = [
  { label: 'coupon no.', get: (s: CrmSale) => s.couponNo },
  { label: 'query code', get: (s: CrmSale) => s.queryCode },
  { label: 'customer', get: (s: CrmSale) => s.customerName },
  { label: 'vendor', get: (s: CrmSale) => s.vendorName },
];
export const saleSummary = (rows: CrmSale[]): [string, string][] => [
  ['Coupons', String(rows.length)],
  ...perCurrency(rows, (r) => r.currency, 'Sale', (r) => r.saleAmount),
  ...perCurrency(rows, (r) => r.currency, 'Profit', (r) => r.psfProfit),
];

// ---------------------------------------------------------------- receipts
export const receiptColumns = (): PdfColumn[] => [
  { key: 'no', label: 'Receipt', width: 1 },
  { key: 'client', label: 'Client', width: 1.6 },
  { key: 'query', label: 'Query code', width: 1 },
  { key: 'cur', label: 'Cur', width: 0.5 },
  { key: 'amount', label: 'Received', width: 1.1, align: 'right' },
  { key: 'method', label: 'Method', width: 1.2 },
  { key: 'type', label: 'Payment', width: 0.9 },
  { key: 'ref', label: 'Reference', width: 1.3 },
  { key: 'invoice', label: 'On invoice', width: 1 },
  ...createdCols(),
];
export const receiptCells = (r: CrmReceipt, nameOf: NameOf, invoiceNoOf: (id: string) => string): Cells => ({
  no: r.receiptNo, client: r.clientName, query: r.queryCode, cur: r.currency, amount: money(r.amountReceived), method: r.method === 'bank' ? `Bank${r.bankName ? ` - ${r.bankName}` : ''}` : 'Cash',
  type: r.paymentType === 'partial' ? 'Partial' : 'Full', ref: r.referenceNo || '-', invoice: r.linkedInvoiceId ? invoiceNoOf(r.linkedInvoiceId) || 'Yes' : '-',
  ...createdCells(r.createdAt, r.createdBy, nameOf),
});
export const receiptSearch = [
  { label: 'receipt no.', get: (r: CrmReceipt) => r.receiptNo },
  { label: 'query code', get: (r: CrmReceipt) => r.queryCode },
  { label: 'client', get: (r: CrmReceipt) => r.clientName },
  { label: 'reference', get: (r: CrmReceipt) => r.referenceNo },
];
export const receiptSummary = (rows: CrmReceipt[]): [string, string][] => [['Receipts', String(rows.length)], ...perCurrency(rows, (r) => r.currency, 'Received', (r) => r.amountReceived)];

// ---------------------------------------------------------------- customers
export const customerColumns = (): PdfColumn[] => [
  { key: 'name', label: 'Customer', width: 1.6 },
  { key: 'company', label: 'Company', width: 1.4 },
  { key: 'number', label: 'Customer No', width: 1.2 },
  { key: 'dest', label: 'Destinations', width: 1.6 },
  { key: 'through', label: 'Acquired through', width: 1.2 },
  { key: 'acq', label: 'Acquired by', width: 1.2 },
  ...createdCols(),
];
export const customerCells = (c: CrmCustomer, nameOf: NameOf): Cells => ({
  name: c.customerName, company: c.companyName || '-', number: c.customerNumber || '-', dest: (c.destinations || []).join(', ') || '-', through: c.acquiredThrough || '-',
  acq: c.acquiredBy ? nameOf(c.acquiredBy) : '-', ...createdCells(c.createdAt, c.createdBy, nameOf),
});
export const customerSearch = [
  { label: 'customer no.', get: (c: CrmCustomer) => c.customerNumber },
  { label: 'name', get: (c: CrmCustomer) => `${c.customerName} ${c.companyName || ''}` },
  { label: 'destination', get: (c: CrmCustomer) => (c.destinations || []).join(' ') },
];

// ---------------------------------------------------------------- follow-ups
export const followupColumns = (): PdfColumn[] => [
  { key: 'subject', label: 'Follow-up', width: 2 },
  { key: 'kind', label: 'Category', width: 1.2 },
  { key: 'customer', label: 'Customer', width: 1.3 },
  { key: 'taking', label: 'Taking it', width: 1.1 },
  { key: 'due', label: 'Due', width: 1.3 },
  { key: 'status', label: 'Status', width: 1 },
  { key: 'notes', label: 'Notes / updates', width: 3 },
  ...createdCols(),
];
export const followupCells = (f: CrmFollowup, nameOf: NameOf, customerName: (id: string | null) => string, kindLabel: Record<string, string>, statusLabel: Record<string, string>): Cells => ({
  subject: (f.kind === 'internal' && f.subject ? f.subject : f.remarks || kindLabel[f.kind] || f.kind).slice(0, 140),
  kind: kindLabel[f.kind] || f.kind, customer: customerName(f.customerId) || '-', taking: nameOf(f.assignedTo), due: f.dueAt ? fmtDateTimePk(f.dueAt) : '-', status: statusLabel[f.status] || f.status,
  notes: (f.remarkLog || []).map((n) => `${fmtDateTimePk(n.at)} ${nameOf(n.by)}: ${n.text}`).join('\n') || f.outcomeRemarks || '-',
  ...createdCells(f.createdAt, f.createdBy, nameOf),
});
export const followupSearch = [
  { label: 'subject', get: (f: CrmFollowup) => `${f.subject || ''} ${f.remarks || ''}` },
  { label: 'category', get: (f: CrmFollowup) => f.kind },
];

// ---------------------------------------------------------------- meetings
export const meetingColumns = (): PdfColumn[] => [
  { key: 'title', label: 'Meeting', width: 2 },
  { key: 'when', label: 'When', width: 1.6 },
  { key: 'who', label: 'With', width: 1.6 },
  { key: 'place', label: 'Location', width: 1.2 },
  { key: 'status', label: 'Status', width: 1 },
  { key: 'notes', label: 'Notes / updates', width: 3 },
  ...createdCols(),
];
export const meetingCells = (m: CrmMeeting, nameOf: NameOf, customerName: (id: string | null) => string): Cells => ({
  title: m.title, when: `${fmtDateTimePk(m.startAt)} - ${fmtDateTimePk(m.endAt).split(', ').pop()}`,
  who: [...(m.attendeeIds || []).map(nameOf), customerName(m.customerId), m.externalName].filter(Boolean).join(', ') || '-', place: m.location || '-',
  status: m.status.replace('_', ' '), notes: (m.noteLog || []).map((n) => `${fmtDateTimePk(n.at)} ${nameOf(n.by)}: ${n.text}`).join('\n') || m.notes || '-',
  ...createdCells(m.createdAt, m.createdBy || m.requestedBy || '', nameOf),
});
export const meetingSearch = [{ label: 'title', get: (m: CrmMeeting) => `${m.title} ${m.externalName || ''}` }];

// ---------------------------------------------------------------- inventory
export const inventoryColumns = (): PdfColumn[] => [
  { key: 'items', label: 'Items', width: 2.5 },
  { key: 'for', label: 'Requested for', width: 1.3 },
  { key: 'status', label: 'Status', width: 1 },
  { key: 'note', label: 'Note / decision', width: 2.5 },
  ...createdCols(),
];
export const inventoryCells = (r: CrmInventoryRequest, nameOf: NameOf): Cells => ({
  items: (r.items || []).map((l) => `${l.qty} x ${l.item}`).join(', '), for: nameOf(r.assignedTo), status: r.status,
  note: [r.note, r.decisionRemarks && `Decision: ${r.decisionRemarks}`].filter(Boolean).join(' | ') || '-', ...createdCells(r.createdAt, r.requestedBy, nameOf),
});
export const inventorySearch = [{ label: 'item', get: (r: CrmInventoryRequest) => (r.items || []).map((l) => l.item).join(' ') }];
