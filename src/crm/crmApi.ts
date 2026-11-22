import { getSessionToken } from '../lib/storage';

export type FollowupKind = 'meeting' | 'corporate' | 'internal' | 'regular' | 'personal';
export type InventoryStatus = 'pending' | 'approved' | 'rejected' | 'delivered';
export type FollowupStatus = 'pending' | 'completed' | 'not_completed' | 'rescheduled';
export type MeetingStatus = 'scheduled' | 'pending_approval' | 'rejected' | 'cancelled' | 'completed';

export interface CrmCustomer {
  id: string;
  customerName: string;
  companyName: string;
  description?: string;
  destinations: string[];
  customerNumber: string;
  acquiredThrough: string;
  acquiredBy: string; // employee id (or a typed name)
  /** Employees the creator allows to see this customer */
  sharedWith: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CrmHistoryEntry {
  at: string;
  by: string;
  outcome: string;
  remarks: string;
  dueAt: string | null;
}

export interface CrmFollowup {
  id: string;
  customerId: string | null;
  participantIds: string[];
  kind: FollowupKind;
  assignedTo: string;
  remarks: string;
  dueAt: string | null;
  status: FollowupStatus;
  outcomeRemarks: string;
  history: CrmHistoryEntry[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** Remarks added by everyone on the follow-up, kept permanently */
  remarkLog?: { id: string; at: string; by: string; text: string }[];
}

export interface CrmMeeting {
  id: string;
  title: string;
  customerId: string | null;
  externalName: string;
  attendeeIds: string[];
  startAt: string;
  endAt: string;
  location: string;
  notes: string;
  status: MeetingStatus;
  requestedBy: string | null;
  decidedBy: string | null;
  decisionNote: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CrmInventoryLine {
  item: string;
  qty: number;
}

export interface CrmInventoryRequest {
  id: string;
  requestedBy: string;
  assignedTo: string;
  items: CrmInventoryLine[];
  note: string;
  status: InventoryStatus;
  decisionRemarks: string;
  decidedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CrmBadges {
  tasksOpen: number;
  tasksNew: number;
  meetingsNew: number;
  meetingsPending: number;
  inventoryNew: number;
  inventoryPending: number;
  salesNew: number;
  invoiceNew: number;
  receiptNew: number;
  customersNew: number;
  salesPending: number;
  unreadTotal: number;
  /** My open deadlines (follow-ups / meetings) within the next 3 days, plus just-missed ones. */
  upcoming: CrmUpcoming[];
  unreadLatest: { id: string; category: CrmCategory; message: string }[];
}

export type CrmCategory = 'followup' | 'meeting' | 'inventory' | 'sale' | 'reminder' | 'invoice' | 'receipt' | 'customer';

export interface CrmUpcoming {
  kind: 'followup' | 'meeting';
  id: string;
  title: string;
  at: string;
}

export type SaleType = 'visa' | 'ticket' | 'hotel' | 'transfers' | 'insurance' | 'others';

export interface CrmSale {
  id: string;
  couponNo: string;
  createdBy: string;
  saleType: SaleType;
  otherType: string;
  customerName: string;
  vendorName: string;
  packageDetails: string;
  paxName: string;
  currency: string;
  costAmount: number;
  saleAmount: number;
  queryCode: string;
  psfProfit: number;
  status: 'pending' | 'approved' | 'declined';
  paymentStatus: 'unpaid' | 'paid';
  reviewRemarks: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceLine {
  description: string;
  /** A text-only row (no price), e.g. a route or a sub-heading. */
  note?: boolean;
  unitPrice?: number;
  units?: number;
  currency?: string;
  /** How many invoice-currency units one unit of the line currency is worth. */
  rate?: number;
  amount?: number;
  taxable?: boolean;
  /** Stable id of the line and whether it was saved & locked (locked lines can never be edited or removed). */
  key?: string;
  locked?: boolean;
}

export interface InvoiceSection {
  title: string;
  key?: string;
  locked?: boolean;
  lines: InvoiceLine[];
}

export type VisaProgressStatus = 'not_started' | 'in_progress' | 'issued';

export interface VisaProgress {
  enabled: boolean;
  status: VisaProgressStatus;
  inProgressDate: string | null; // YYYY-MM-DD
  issuedDate: string | null;     // YYYY-MM-DD
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
  updatedAt?: string | null;
}

export interface CrmInvoice {
  id: string;
  /** 'customer' = what we bill customers; 'vendor' = what we owe a vendor (payable, never printed on a customer's invoice) */
  kind: 'customer' | 'vendor';
  crmId: string;
  queryCode: string;
  invoiceNo: string;
  createdBy: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerNtn: string;
  reference: string;
  /** Vendors we pay for this invoice: office record only, never printed on the PDF */
  vendors: InvoiceVendor[];
  /** NTN printed on this invoice. null = the company NTN (older invoices); '' = none */
  ntn: string | null;
  showNtn: boolean;
  invoiceDate: string;
  dueDate: string | null;
  currency: string;
  sections: InvoiceSection[];
  taxLabel: string;
  taxRate: number;
  discount: number;
  advancePaid: number;
  subtotal: number;
  taxAmount: number;
  total: number;
  balance: number;
  notes: string;
  status: 'unpaid' | 'paid' | 'cancelled';
  /** Paid state of the vendor side (what we owe the vendors listed on this invoice), separate from the customer side */
  vendorStatus?: 'unpaid' | 'paid';
  vendorPaidAt?: string | null;
  cancelRemarks?: string;
  cancelledBy?: string | null;
  cancelledAt?: string | null;
  vendorPaidBy?: string | null;
  visaProgress?: VisaProgress | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceVendor {
  name: string;
  description?: string;
  unitPrice?: number | null;
  units?: number | null;
  amount: number;
  currency: string;
  bank: string;
}

export const RECEIPT_ITEMS = ['Package', 'Visa Charges', 'Air Tickets', 'Hotel', 'Transfers', 'Insurance', 'Service Charges'] as const;

export interface CrmReceipt {
  id: string;
  receiptNo: string;
  createdBy: string;
  queryCode: string;
  clientName: string;
  items: string[];
  otherItem: string;
  paymentType: 'full' | 'partial';
  currency: string;
  totalAmount: number;
  amountReceived: number;
  method: 'cash' | 'bank';
  bankName: string;
  referenceNo: string;
  hasProof: boolean;
  purpose: string;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyProfile {
  name: string;
  payTo: string;
  ntn: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  bankDetails: string;
  terms: string;
  footer: string;
}

export const EMPTY_COMPANY: CompanyProfile = { name: '', payTo: '', ntn: '', address: '', phone: '', email: '', website: '', bankDetails: '', terms: '', footer: '' };

export interface CrmHistoryItem {
  id: string;
  category: CrmCategory;
  refId: string;
  message: string;
  createdAt: string;
  read: boolean;
}

export interface CrmUnread {
  id: string;
  category: CrmCategory;
  refId: string;
  message: string;
  createdAt: string;
}

export type PurchaseCategory = 'ticket' | 'hotel' | 'visa' | 'tour' | 'insurance' | 'other' | string;

export interface PurchaseCustomCategory {
  id: string;
  label: string;
}

export interface PurchaseCustomField {
  id: string;
  category: PurchaseCategory | 'all';
  label: string;
}

export interface CrmPurchaseItem {
  id: string;
  category: PurchaseCategory;
  categoryLabel?: string;
  vendorName: string;
  quantity?: number;
  unitPayable?: number;
  payable: number;
  receivable: number | null;
  currency: string;
  paymentDueDate: string | null;
  // Paid By fields (present on every category)
  paidByMethod: 'unpaid' | 'faiq_card' | 'ali_card' | 'third_party' | 'other' | 'card' | 'cash' | 'bank_transfer';
  cardOption?: 'faiq_card' | 'ali_card' | 'third_party' | 'other' | '';
  cardBank?: string;
  paidBySpecify?: string;
  // Ticket specific
  ticketNumber?: string;
  // Hotel specific
  hotelName?: string;
  rooms?: string;
  checkInDate?: string | null;
  checkOutDate?: string | null;
  // Visa specific
  countries?: string;
  visaType?: string;
  // Tours & Transfers specific
  tourDescription?: string;
  tourDate?: string | null;
  persons?: number | null;
  // Insurance specific
  insuranceType?: string;
  insuranceDays?: number | null;
  // Other / notes
  description?: string;
  // Live admin-defined custom fields: { [fieldId or label]: value }
  customValues?: Record<string, string>;
}

export interface CrmPurchase {
  id: string;
  purchaseNo: string;
  createdBy: string;
  customerName: string;
  careOf: string;
  crmId: string;
  purchaseDate: string;
  currency: string;
  items: CrmPurchaseItem[];
  totalPayable: number;
  totalReceivable: number;
  notes: string;
  status: 'unpaid' | 'paid' | 'partial';
  createdAt: string;
  updatedAt: string;
}

export interface CrmPortalQuery {
  id: string;
  queryRef: string;
  customerName: string;
  mobileNumber: string;
  desiredCountries: string[];
  desiredDays: string;
  desiredServices: string[];
  notes: string;
  packageTitle: string;
  trackingQuery: string;
  crmId: string;
  isExistingCustomer: boolean;
  status: 'new' | 'contacted' | 'quoted' | 'closed';
  assignedTo?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CrmData {
  customers: CrmCustomer[];
  followups: CrmFollowup[];
  meetings: CrmMeeting[];
  /** Times the CEO is booked through a Meeting follow-up (shown in the Meetings portal) */
  bookedSlots: { id: string; title: string; startAt: string; endAt: string }[];
  unread: CrmUnread[];
  inventory: CrmInventoryRequest[];
  inventoryItems: string[];
  sales: CrmSale[];
  purchases?: CrmPurchase[];
  portalQueries?: CrmPortalQuery[];
  purchaseCustomFields?: PurchaseCustomField[];
  purchaseCustomCategories?: PurchaseCustomCategory[];
  invoices: CrmInvoice[];
  receipts: CrmReceipt[];
  company: CompanyProfile;
  history: CrmHistoryItem[];
  saleTypes: Record<string, string>;
  currencies: string[];
  badges: CrmBadges;
}

export const EMPTY_BADGES: CrmBadges = { tasksOpen: 0, tasksNew: 0, meetingsNew: 0, meetingsPending: 0, inventoryNew: 0, inventoryPending: 0, salesNew: 0, invoiceNew: 0, receiptNew: 0, customersNew: 0, salesPending: 0, unreadTotal: 0, upcoming: [], unreadLatest: [] };

export class CrmError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

/** Calls the CRM server. The server decides what the signed-in person may see or do. */
export async function crmCall<T = any>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const sessionToken = getSessionToken();
  if (!sessionToken) throw new CrmError('Please sign out and sign in again to use the CRM.', 'SESSION_REQUIRED');
  let res: Response;
  try {
    res = await fetch('/api/crm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, sessionToken, ...payload }),
    });
  } catch {
    throw new CrmError('No internet connection. Please try again.', 'OFFLINE');
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // not JSON
  }
  if (!res.ok || !data || data.ok === false) {
    throw new CrmError((data && (data.error || data.message)) || 'The CRM could not complete that request.', data?.code);
  }
  return data as T;
}

export interface UpdateInvoiceVisaProgressInput {
  id: string;
  enabled?: boolean;
  status?: VisaProgressStatus;
  inProgressDate?: string | null;
  issuedDate?: string | null;
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

export async function updateInvoiceVisaProgress(
  input: UpdateInvoiceVisaProgressInput
): Promise<{ ok: boolean; invoice: CrmInvoice; visaProgress?: VisaProgress | null }> {
  const payload: Record<string, unknown> = {
    ...input,
  };
  return crmCall<{ ok: boolean; invoice: CrmInvoice; visaProgress?: VisaProgress | null }>(
    'invoice_visa_update',
    payload
  );
}
