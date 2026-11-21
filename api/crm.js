// CRM API (travel agency): customers, follow-ups/tasks, CEO meetings, notifications.
// Self-contained: only reads the employees table and its own crm_* tables.
// Every call needs the signed-in person's token; what they may do is decided here from the database, never from the browser.
import crypto from 'node:crypto';
import { isSupabaseConfigured, supabaseFetch, sweepShiftReminders } from './_supabase.js';
import { format12h, getShiftEndWindowMs } from './_cloud.js';
import { getSessionEmployee } from './_session.js';

const KINDS = ['meeting', 'corporate', 'internal', 'regular'];
const KIND_LABEL = { meeting: 'Meeting follow-up', corporate: 'Corporate follow-up', internal: 'Internal follow-up', regular: 'Regular customers follow-up' };
// Default inventory list + dynamic catalog managed by Admin & Accounts in Supabase
const DEFAULT_INVENTORY_ITEMS = [
  'Laptop',
  'Keyboard',
  'Mouse',
  'Mouse Pad',
  'Pen',
  'Headphones',
  'Writing Pads',
  'Tissues',
  'SIMs',
  'Laptop Charger',
  'Mobile Charger',
  'Mobile Package',
];
const INVENTORY_STATUSES = ['approved', 'rejected', 'delivered'];
const SALE_TYPES = { visa: 'Visa', ticket: 'Ticket', hotel: 'Hotel', transfers: 'Transfers', insurance: 'Insurance', others: 'Others' };
const CURRENCIES = ['PKR', 'USD', 'EUR', 'GBP', 'AED', 'SAR', 'QAR', 'KWD', 'OMR', 'BHD', 'TRY', 'INR', 'BDT', 'LKR', 'NPR', 'AFN', 'CAD', 'AUD', 'NZD', 'CNY', 'JPY', 'KRW', 'HKD', 'SGD', 'MYR', 'THB', 'IDR', 'PHP', 'VND', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'RUB', 'UAH', 'GEL', 'AZN', 'AMD', 'KZT', 'UZS', 'EGP', 'JOD', 'LBP', 'IQD', 'IRR', 'MAD', 'TND', 'DZD', 'ZAR', 'KES', 'NGN', 'GHS', 'ETB', 'TZS', 'MXN', 'BRL', 'ARS'];
const OUTCOMES = ['completed', 'not_completed', 'rescheduled'];
const OPEN = ['pending', 'rescheduled'];
const LIMIT = 5000;

class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
const bad = (m, code = 'BAD_REQUEST') => new HttpError(400, m, code);
const forbidden = (m = 'You do not have permission to do this.', code = 'FORBIDDEN') => new HttpError(403, m, code);
const notFound = (m = 'Not found.') => new HttpError(404, m, 'NOT_FOUND');

const id = (p) => `${p}-${crypto.randomUUID()}`;
const nowIso = () => new Date().toISOString();
const str = (v, max, { required = false, name = 'Value' } = {}) => {
  const s = String(v ?? '').trim();
  if (required && !s) throw bad(`${name} is required.`);
  if (s.length > max) throw bad(`${name} is too long (max ${max} characters).`);
  return s;
};
const isoOrNull = (v, name, { required = false } = {}) => {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${name} is required.`);
    return null;
  }
  const t = Date.parse(v);
  if (!Number.isFinite(t)) throw bad(`${name} is not a valid date and time.`);
  return new Date(t).toISOString();
};
const asArray = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return []; } })() : []);
const parseJsonObj = (v, fallback = {}) => {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
};
const VISA_STATUSES = ['not_started', 'in_progress', 'issued'];
const VISA_WORD_RE = /\bvisa\b/i;
function hasVisaKeyword(sections) {
  return asArray(sections).some((sec) => {
    if (VISA_WORD_RE.test(String(sec?.title || ''))) return true;
    return asArray(sec?.lines).some((ln) => VISA_WORD_RE.test(String(ln?.description || '')));
  });
}
const strictDateOnly = (v, name) => {
  if (v === undefined || v === null || v === '') return null;
  const d = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw bad(`${name} must be a valid YYYY-MM-DD date.`);
  const dt = new Date(`${d}T00:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== d) {
    throw bad(`${name} is not a valid calendar date.`);
  }
  return d;
};
const safeDateOnly = (v) => {
  if (!v) return null;
  const d = String(v).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const dt = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === d ? d : null;
};
const todayPktDate = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Karachi',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
async function isCustomerPortalBetaEnabled() {
  const rows = await supabaseFetch('/settings?id=eq.current&select=data');
  const data = parseJsonObj(rows?.[0]?.data, {});
  return data.customerPortalBetaEnabled !== false;
}
function normalizeVisaProgress(raw, existing = null) {
  const enabled = raw?.enabled !== false;
  const status = String(raw?.status || 'not_started');
  if (!VISA_STATUSES.includes(status)) throw bad('Choose Not Started, In Progress, or Issued.');
  const exInProg = safeDateOnly(existing?.inProgressDate);
  const exIssued = safeDateOnly(existing?.issuedDate);
  const inProgressDate = raw?.inProgressDate !== undefined
    ? strictDateOnly(raw.inProgressDate, 'In Progress date')
    : (status === 'in_progress' ? (exInProg || todayPktDate()) : status === 'issued' ? exInProg : null);
  const issuedDate = raw?.issuedDate !== undefined
    ? strictDateOnly(raw.issuedDate, 'Issued date')
    : (status === 'issued' ? (exIssued || todayPktDate()) : null);
  return {
    enabled,
    status,
    inProgressDate,
    issuedDate,
    updatedAt: nowIso(),
  };
}
function formatVisaProgress(raw, rowUpdatedAt = null) {
  const vp = parseJsonObj(raw, null);
  if (!vp || vp.enabled !== true) return null;
  const status = VISA_STATUSES.includes(vp.status) ? vp.status : 'not_started';
  return {
    enabled: true,
    status,
    inProgressDate: safeDateOnly(vp.inProgressDate),
    issuedDate: safeDateOnly(vp.issuedDate),
    updatedAt: vp.updatedAt || rowUpdatedAt || null,
  };
}

const DESC_PREFIX = '__desc__:';
const extractCustDesc = (r) => {
  const raw = asArray(r?.shared_with);
  const token = raw.find((x) => typeof x === 'string' && x.startsWith(DESC_PREFIX));
  return r?.description ? String(r.description) : token ? token.slice(DESC_PREFIX.length) : '';
};
const cleanSharedIds = (arr) => asArray(arr).filter((x) => typeof x === 'string' && !x.startsWith(DESC_PREFIX));
const packSharedWith = (ids, description) => {
  const clean = cleanSharedIds(ids);
  const desc = String(description || '').trim();
  return desc ? [...clean, `${DESC_PREFIX}${desc}`] : clean;
};

const mapCustomer = (r) => ({
  id: r.id, customerName: r.customer_name, companyName: r.company_name || '', description: extractCustDesc(r), destinations: asArray(r.destinations),
  customerNumber: r.customer_number || '', acquiredThrough: r.acquired_through || '', acquiredBy: r.acquired_by || '',
  sharedWith: cleanSharedIds(r.shared_with), createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
});
const mapFollowup = (r) => ({
  id: r.id, customerId: r.customer_id || null, participantIds: asArray(r.participant_ids), kind: r.kind, assignedTo: r.assigned_to, remarks: r.remarks || '', dueAt: r.due_at,
  status: r.status, outcomeRemarks: r.outcome_remarks || '', history: asArray(r.history), createdBy: r.created_by,
  createdAt: r.created_at, updatedAt: r.updated_at, completedAt: r.completed_at, remarkLog: asArray(r.remark_log),
});
const mapInventory = (r) => ({
  id: r.id, requestedBy: r.requested_by, assignedTo: r.assigned_to, items: asArray(r.items), note: r.note || '', status: r.status,
  decisionRemarks: r.decision_remarks || '', decidedBy: r.decided_by || null, createdAt: r.created_at, updatedAt: r.updated_at,
});
const num = (v) => Number(v) || 0;
const flagOf = (e, name) => {
  let p = e && e.pending_device_request;
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch { p = null; } }
  return Boolean(p && p[name]);
};
// Sales: Admin, Accounts and CEO always; any other employee only when an administrator has switched it on for them.
const hasSalesAccess = (e) => Boolean(e) && (['admin', 'accounts', 'ceo'].includes(e.role) || flagOf(e, 'salesAccess'));
const DEFAULT_COMPANY = {
  name: 'Bahaar Journeys (Pvt) Ltd', payTo: 'BAHAAR JOURNEYS (PVT) LTD', ntn: '6988772-2',
  address: '', phone: '', email: '', website: '', bankDetails: '', terms: '', footer: 'Thanking you',
};
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const mapInvoice = (r, visaProgress = null) => ({
  id: r.id, kind: r.kind === 'vendor' ? 'vendor' : 'customer', crmId: r.crm_id || '', queryCode: r.query_code || '', invoiceNo: r.invoice_no, createdBy: r.created_by, customerName: r.customer_name, customerPhone: r.customer_phone || '',
  customerAddress: r.customer_address || '', customerNtn: r.customer_ntn || '', reference: r.reference || '',
  invoiceDate: r.invoice_date, dueDate: r.due_date || null, currency: r.currency, sections: asArray(r.sections),
  taxLabel: r.tax_label || 'Tax', taxRate: num(r.tax_rate), discount: num(r.discount), advancePaid: num(r.advance_paid),
  subtotal: num(r.subtotal), taxAmount: num(r.tax_amount), total: num(r.total), balance: num(r.balance), notes: r.notes || '',
  vendors: asArray(r.vendors), ntn: r.ntn === null || r.ntn === undefined ? null : String(r.ntn), showNtn: r.show_ntn !== false,
  status: r.status, vendorStatus: r.vendor_status === 'paid' ? 'paid' : 'unpaid', vendorPaidAt: r.vendor_paid_at || null, vendorPaidBy: r.vendor_paid_by || null,
  visaProgress: r.kind === 'vendor' ? null : (visaProgress || null), createdAt: r.created_at, updatedAt: r.updated_at,
});
const RECEIPT_ITEMS = ['Package', 'Visa Charges', 'Air Tickets', 'Hotel', 'Transfers', 'Insurance', 'Service Charges'];
const mapReceipt = (r) => ({
  id: r.id, receiptNo: r.receipt_no, createdBy: r.created_by, queryCode: r.query_code, clientName: r.client_name, items: asArray(r.items), otherItem: r.other_item || '',
  paymentType: r.payment_type === 'partial' ? 'partial' : 'full', currency: r.currency, totalAmount: num(r.total_amount), amountReceived: num(r.amount_received),
  method: r.method === 'bank' ? 'bank' : 'cash', bankName: r.bank_name || '', referenceNo: r.reference_no || '', hasProof: Boolean(r.has_proof), purpose: r.purpose || '',
  createdAt: r.created_at, updatedAt: r.updated_at,
});
const mapSale = (r) => ({
  id: r.id, couponNo: r.coupon_no, createdBy: r.created_by, saleType: r.sale_type, otherType: r.other_type || '',
  customerName: r.customer_name, vendorName: r.vendor_name, packageDetails: r.package_details, paxName: r.pax_name,
  currency: r.currency, costAmount: num(r.cost_amount), saleAmount: num(r.sale_amount), queryCode: r.query_code, psfProfit: num(r.psf_profit),
  status: r.status, paymentStatus: r.payment_status, reviewRemarks: r.review_remarks || '', reviewedBy: r.reviewed_by || null,
  reviewedAt: r.reviewed_at || null, createdAt: r.created_at, updatedAt: r.updated_at,
});
const mapMeeting = (r) => ({
  id: r.id, title: r.title, customerId: r.customer_id || null, externalName: r.external_name || '', attendeeIds: asArray(r.attendee_ids),
  startAt: r.start_at, endAt: r.end_at, location: r.location || '', notes: r.notes || '', status: r.status,
  requestedBy: r.requested_by || null, decidedBy: r.decided_by || null, decisionNote: r.decision_note || '',
  createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
});

const upsert = (table, rows) => supabaseFetch(`/${table}`, {
  method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
});
const getAll = async (table) => (await supabaseFetch(`/${table}?select=*&limit=${LIMIT}`)) || [];
const myNotifications = async (empId) => (await supabaseFetch(`/crm_notifications?employee_id=eq.${encodeURIComponent(empId)}&order=created_at.desc&limit=300&select=*`)) || [];
const getOne = async (table, rowId) => (await supabaseFetch(`/${table}?id=eq.${encodeURIComponent(rowId)}&select=*`))?.[0] || null;

async function getInventoryCatalog() {
  try {
    const row = await getOne('crm_company', 'inventory_catalog');
    const custom = asArray(row?.data?.customItems).map((x) => String(x || '').trim()).filter(Boolean);
    const removed = new Set(asArray(row?.data?.removedItems).map((x) => String(x || '').trim().toLowerCase()));
    const combined = [];
    const seen = new Set();
    for (const item of [...DEFAULT_INVENTORY_ITEMS, ...custom]) {
      const key = item.toLowerCase();
      if (!key || seen.has(key) || removed.has(key)) continue;
      seen.add(key);
      combined.push(item);
    }
    return combined;
  } catch {
    return [...DEFAULT_INVENTORY_ITEMS];
  }
}

const PURCHASE_CATEGORIES = ['ticket', 'hotel', 'visa', 'tour', 'insurance', 'other'];

async function getPurchaseSchema() {
  try {
    const row = await getOne('crm_company', 'purchases_schema');
    const customFields = asArray(row?.data?.customFields).filter((f) => f && f.id && f.label);
    const customCategories = asArray(row?.data?.customCategories).filter((c) => c && c.id && c.label);
    return { customFields, customCategories };
  } catch {
    return { customFields: [], customCategories: [] };
  }
}

async function getPurchaseCustomFields() {
  const { customFields } = await getPurchaseSchema();
  return customFields;
}

async function getAllPurchases() {
  try {
    const rows = (await supabaseFetch(`/crm_company?id=like.pur-*&order=updated_at.desc&limit=${LIMIT}&select=*`)) || [];
    return rows.map((r) => ({ ...(r.data || {}), id: r.id, updatedAt: r.updated_at || r.data?.updatedAt || '' })).filter((p) => p && p.purchaseNo);
  } catch {
    return [];
  }
}

async function activeEmployees() {
  return (await supabaseFetch('/employees?deleted_at=is.null&is_active=eq.true&select=id,name,role')) || [];
}

async function notify(employeeIds, category, refId, message, exceptId) {
  const ids = [...new Set(employeeIds)].filter((e) => e && e !== exceptId);
  if (!ids.length) return;
  const at = nowIso();
  await upsert('crm_notifications', ids.map((e) => ({ id: id('ntf'), employee_id: e, category, ref_id: refId, message, created_at: at, read_at: null })));
}
const salesStaffIds = async () => (await activeEmployees()).filter((e) => e.role === 'admin' || e.role === 'accounts' || e.role === 'ceo').map((e) => e.id);
const accountsIds = async () => (await activeEmployees()).filter((e) => e.role === 'accounts').map((e) => e.id);
const adminIds = async () => (await activeEmployees()).filter((e) => e.role === 'admin' || e.role === 'ceo').map((e) => e.id);

async function assertEmployee(empId, label = 'Employee') {
  const list = await activeEmployees();
  const found = list.find((e) => e.id === empId);
  if (!found) throw bad(`${label} was not found or is not active.`);
  return found;
}

// A meeting slot is busy when another scheduled meeting overlaps it.
async function assertSlotFree(startAt, endAt, exceptId) {
  const clash = (await getAll('crm_meetings')).find((m) =>
    m.id !== exceptId && m.status === 'scheduled' && Date.parse(m.start_at) < Date.parse(endAt) && Date.parse(m.end_at) > Date.parse(startAt));
  if (clash) {
    throw new HttpError(409, `The CEO already has "${clash.title}" at that time. Please choose another slot.`, 'SLOT_BUSY');
  }
}

function readMeetingInput(m, { requireEnd = true } = {}) {
  const startAt = isoOrNull(m?.startAt, 'Start time', { required: true });
  const endAt = isoOrNull(m?.endAt, 'End time', { required: requireEnd });
  if (Date.parse(endAt) <= Date.parse(startAt)) throw bad('The end time must be after the start time.');
  if (Date.parse(endAt) - Date.parse(startAt) > 12 * 3600 * 1000) throw bad('A meeting cannot be longer than 12 hours.');
  return {
    title: str(m?.title, 160, { required: true, name: 'Meeting title' }),
    customer_id: m?.customerId ? String(m.customerId) : null,
    external_name: str(m?.externalName, 160, { name: 'Outside person / company' }),
    location: str(m?.location, 200, { name: 'Location or link' }),
    notes: str(m?.notes, 4000, { name: 'Notes' }),
    start_at: startAt,
    end_at: endAt,
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isSupabaseConfigured()) return res.status(501).json({ error: 'The CRM needs the cloud database.', code: 'NO_CRM' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const me = await getSessionEmployee(body.sessionToken);
    if (!me) throw new HttpError(401, 'Please sign in again.', 'SESSION_REQUIRED');
    const isAdmin = me.role === 'admin' || me.role === 'ceo'; // the CEO has every administrator right in the CRM and Office sections
    const seeAllCust = isAdmin || me.role === 'accounts' || me.role === 'ceo';
    // Everyone can add customers; they see their own plus the ones shared with them. Admin, CEO and Accounts see all.
    const canSeeCust = (c) => seeAllCust || c.created_by === me.id || asArray(c.shared_with).includes(me.id);
    const canSales = hasSalesAccess(me);
    const { action } = body;

    // ------------------------------------------------------------------ reading
    if (action === 'list' || action === 'badges') {
      // Punch-out reminders are created here too, so they reach people who have the portal open.
      await sweepShiftReminders({ getShiftEndWindowMs, format12h });
      const [followups, meetings, notifs, inventory, salesRows] = await Promise.all([getAll('crm_followups'), getAll('crm_meetings'), myNotifications(me.id), getAll('crm_inventory_requests'), getAll('crm_sales')]);
      const mine = notifs.filter((n) => !n.read_at);
      const salesViewer = isAdmin || me.role === 'accounts' || me.role === 'ceo';
      // Deadlines coming up (or just missed) for this person: drives the live countdown alerts on every page.
      const nowMs = Date.now();
      const upcoming = [];
      for (const f of followups) {
        if (!OPEN.includes(f.status) || !f.due_at) continue;
        if (f.assigned_to !== me.id && !asArray(f.participant_ids).includes(me.id)) continue;
        const t = Date.parse(f.due_at);
        if (t > nowMs + 3 * 86400000 || t < nowMs - 86400000) continue;
        upcoming.push({ kind: 'followup', id: f.id, title: `${KIND_LABEL[f.kind] || 'Follow-up'}${f.remarks ? `: ${String(f.remarks).slice(0, 50)}` : ''}`, at: f.due_at });
      }
      for (const m of meetings) {
        if (m.status !== 'scheduled') continue;
        if (!isAdmin && !asArray(m.attendee_ids).includes(me.id) && m.requested_by !== me.id) continue;
        const t = Date.parse(m.start_at);
        if (t > nowMs + 3 * 86400000 || t < nowMs - 3600000) continue;
        upcoming.push({ kind: 'meeting', id: m.id, title: `Meeting: ${m.title}`, at: m.start_at });
      }
      const myOpen = followups.filter((f) => f.assigned_to === me.id && OPEN.includes(f.status));
      const pendingApprovals = meetings.filter((m) => m.status === 'pending_approval').length;
      const badges = {
        tasksOpen: myOpen.length,
        tasksNew: mine.filter((n) => n.category === 'followup').length,
        meetingsNew: mine.filter((n) => n.category === 'meeting').length,
        meetingsPending: isAdmin ? pendingApprovals : 0,
        inventoryNew: mine.filter((n) => n.category === 'inventory').length,
        inventoryPending: inventory.filter((r) => r.assigned_to === me.id && r.status === 'pending').length,
        salesNew: mine.filter((n) => n.category === 'sale').length,
        invoiceNew: mine.filter((n) => n.category === 'invoice').length,
        receiptNew: mine.filter((n) => n.category === 'receipt').length,
        salesPending: (isAdmin || me.role === 'accounts') ? salesRows.filter((x) => x.status === 'pending').length : 0,
        unreadTotal: mine.length,
        unreadLatest: [...mine].sort((x, y) => String(y.created_at).localeCompare(String(x.created_at))).slice(0, 5).map((n) => ({ id: n.id, category: n.category, message: n.message })),
        upcoming,
      };
      if (action === 'badges') return res.status(200).json({ ok: true, badges });

      const visibleFollowups = followups.filter((f) => isAdmin || f.assigned_to === me.id || f.created_by === me.id || asArray(f.participant_ids).includes(me.id)).map(mapFollowup);
      const allCustomers = (await getAll('crm_customers')).filter((c) => !c.deleted_at);
      // Employees without Customers access only ever see the customer attached to a follow-up/meeting they are part of.
      const linkedIds = new Set([...visibleFollowups.map((f) => f.customerId), ...meetings.filter((m) => asArray(m.attendee_ids).includes(me.id) || m.requested_by === me.id).map((m) => m.customer_id)].filter(Boolean));
      const customers = allCustomers.filter((c) => canSeeCust(c) || linkedIds.has(c.id)).map(mapCustomer);
      const visibleInventory = inventory.filter((r) => isAdmin || r.requested_by === me.id || r.assigned_to === me.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map(mapInventory);
      const sales = (!canSales ? [] : salesRows).filter((x) => salesViewer || x.created_by === me.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map(mapSale);
      const history = notifs.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 200)
        .map((n) => ({ id: n.id, category: n.category, refId: n.ref_id, message: n.message, createdAt: n.created_at, read: Boolean(n.read_at) }));
      let invoices = [];
      let receipts = [];
      let purchases = [];
      let purchaseCustomFields = [];
      let purchaseCustomCategories = [];
      let company = DEFAULT_COMPANY;
      let inventoryItems = DEFAULT_INVENTORY_ITEMS;
      if (action === 'list') {
        const [invRows, companyRow, receiptRows, catalogItems, allPurchases, purchaseSchema, betaEnabled] = await Promise.all([
          getAll('crm_invoices'),
          getOne('crm_company', 'main'),
          supabaseFetch(`/crm_receipts?select=id,receipt_no,created_by,query_code,client_name,items,other_item,payment_type,currency,total_amount,amount_received,method,bank_name,reference_no,has_proof,purpose,created_at,updated_at&order=created_at.desc&limit=${LIMIT}`),
          getInventoryCatalog(),
          getAllPurchases(),
          getPurchaseSchema(),
          isCustomerPortalBetaEnabled(),
        ]);
        const visaByInvId = new Map();
        if (betaEnabled) {
          const visaRows = (await supabaseFetch(`/crm_company?id=like.visa-*&select=id,data,updated_at&limit=${LIMIT}`)) || [];
          for (const vr of visaRows) {
            if (typeof vr?.id === 'string' && vr.id.startsWith('visa-')) {
              const vp = formatVisaProgress(vr.data, vr.updated_at || null);
              if (vp) visaByInvId.set(vr.id.slice(5), vp);
            }
          }
        }
        // Receipts go to Accounts (and Admin / CEO); everyone else only sees the receipts they made themselves.
        receipts = (receiptRows || []).filter((x) => salesViewer || x.created_by === me.id).map(mapReceipt);
        invoices = invRows
          .filter((x) => salesViewer || x.created_by === me.id)
          .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
          .map((r) => mapInvoice(r, betaEnabled && r.kind !== 'vendor' ? (visaByInvId.get(r.id) || null) : null));
        purchases = (allPurchases || []).filter((x) => salesViewer || x.createdBy === me.id);
        purchaseCustomFields = purchaseSchema?.customFields || [];
        purchaseCustomCategories = purchaseSchema?.customCategories || [];
        company = { ...DEFAULT_COMPANY, ...parseJsonObj(companyRow?.data, {}) };
        inventoryItems = catalogItems;
      }
      const since = Date.now() - 45 * 24 * 3600 * 1000;
      const visibleMeetings = meetings
        .filter((m) => Date.parse(m.end_at) >= since)
        .filter((m) => isAdmin || !['pending_approval', 'rejected'].includes(m.status) || m.requested_by === me.id)
        .map(mapMeeting);
      return res.status(200).json({
        ok: true, me: { id: me.id, role: me.role, customerAccess: true, salesAccess: canSales }, customers, followups: visibleFollowups, meetings: visibleMeetings, inventory: visibleInventory, inventoryItems, sales, purchases, purchaseCustomFields, purchaseCustomCategories, history, invoices, receipts, company, saleTypes: SALE_TYPES, currencies: CURRENCIES,
        unread: mine.map((n) => ({ id: n.id, category: n.category, refId: n.ref_id, message: n.message, createdAt: n.created_at })), badges,
      });
    }

    if (action === 'notifications_read') {
      const cat = ['followup', 'meeting', 'inventory', 'sale', 'reminder', 'invoice', 'receipt'].includes(body.category) ? body.category : null;
      const rows = (await myNotifications(me.id)).filter((n) => !n.read_at && (!cat || n.category === cat));
      if (rows.length) await upsert('crm_notifications', rows.map((n) => ({ ...n, read_at: nowIso() })));
      return res.status(200).json({ ok: true, marked: rows.length });
    }

    // Employee answers "Are you still working online?" - postpones the automatic punch-out
    if (action === 'work_confirm') {
      const since = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
      const open = await supabaseFetch(`/attendance?employee_id=eq.${encodeURIComponent(me.id)}&time_out=is.null&time_in=not.is.null&date=gte.${since}&select=id&order=date.desc&limit=1`);
      if (!Array.isArray(open) || !open[0]) throw bad('You are not punched in right now.');
      const at = nowIso();
      await supabaseFetch(`/attendance?id=eq.${encodeURIComponent(open[0].id)}&time_out=is.null`, {
        method: 'PATCH',
        body: JSON.stringify({ work_confirmed_at: at, record_updated_at: at }),
      });
      const asks = (await myNotifications(me.id)).filter((n) => !n.read_at && n.category === 'reminder' && /-(end|ask-\d+-\d+)$/.test(String(n.id)));
      if (asks.length) await upsert('crm_notifications', asks.map((n) => ({ ...n, read_at: at })));
      return res.status(200).json({ ok: true, confirmedAt: at });
    }

    // ---------------------------------------------------------------- customers
    if (action === 'customer_save') {
      const c = body.customer || {};
      const destinations = asArray(c.destinations).map((d) => str(d, 100)).filter(Boolean);
      if (destinations.length > 30) throw bad('Too many destinations (max 30).');
      const description = str(c.description, 2000, { name: 'Customer description' });
      const fields = {
        customer_name: str(c.customerName, 120, { required: true, name: 'Customer name' }),
        company_name: str(c.companyName, 160, { name: 'Company name' }),
        destinations,
        customer_number: str(c.customerNumber, 60, { name: 'Customer number' }),
        acquired_through: str(c.acquiredThrough, 120, { name: 'Acquired through' }),
        acquired_by: str(c.acquiredBy, 80, { name: 'Acquired by' }),
        updated_at: nowIso(),
      };
      // Only the person who added the customer (or Admin / CEO / Accounts) decides who else may see it.
      const staffList = await activeEmployees();
      const sharedWith = [...new Set(cleanSharedIds(c.sharedWith).map(String))].slice(0, 100);
      for (const sid of sharedWith) if (!staffList.some((e) => e.id === sid)) throw bad('One of the employees chosen to see this customer was not found or is no longer active.');
      if (c.id) {
        const existing = await getOne('crm_customers', c.id);
        if (!existing || existing.deleted_at) throw notFound('Customer not found.');
        if (!seeAllCust && existing.created_by !== me.id) throw forbidden('You can only change customers you added.');
        const cleanNewShared = sharedWith.filter((x) => x !== existing.created_by);
        const upd = { ...existing, ...fields, shared_with: packSharedWith(cleanNewShared, description) };
        await upsert('crm_customers', upd);
        const prevShared = cleanSharedIds(existing.shared_with);
        const newlyShared = cleanNewShared.filter((x) => !prevShared.includes(x) && x !== me.id);
        if (newlyShared.length) await notify(newlyShared, 'followup', existing.id, `${me.name || 'A colleague'} shared customer ${fields.customer_name} with you.`, me.id);
        return res.status(200).json({ ok: true, customer: mapCustomer(upd) });
      }
      const cleanNewShared = sharedWith.filter((x) => x !== me.id);
      const row = { id: id('cus'), ...fields, shared_with: packSharedWith(cleanNewShared, description), created_by: me.id, created_at: nowIso(), deleted_at: null };
      if (cleanNewShared.length) await notify(cleanNewShared, 'followup', row.id, `${me.name || 'A colleague'} shared customer ${fields.customer_name} with you.`, me.id);
      await upsert('crm_customers', row);
      return res.status(200).json({ ok: true, customer: mapCustomer(row) });
    }

    if (action === 'customer_delete') {
      if (!isAdmin) throw forbidden('Only an administrator can delete a customer.');
      const existing = await getOne('crm_customers', body.id);
      if (!existing) throw notFound('Customer not found.');
      await upsert('crm_customers', { ...existing, deleted_at: nowIso(), updated_at: nowIso() });
      return res.status(200).json({ ok: true });
    }

    // ---------------------------------------------------------------- follow-ups
    if (action === 'followup_save') {
      const f = body.followup || {};
      const kind = String(f.kind || '');
      if (!KINDS.includes(kind)) throw bad('Choose a follow-up type.');
      await assertEmployee(String(f.assignedTo || ''), 'The employee for this follow-up');
      // The customer is optional. It can be an existing one, or a new one typed in right here.
      let customer = null;
      let newCustomerRow = null;
      const existingFu = f.id ? await getOne('crm_followups', f.id) : null;
      if (f.customerId) {
        customer = await getOne('crm_customers', f.customerId);
        if (!customer || customer.deleted_at) throw bad('The selected customer was not found.');
        if (f.customerId !== existingFu?.customer_id && !canSeeCust(customer)) throw forbidden('You can only use customers you added or that were shared with you.');
      } else if (f.newCustomer && String(f.newCustomer.customerName || '').trim()) {
        const c = f.newCustomer;
        const destinations = asArray(c.destinations).map((d) => str(d, 100)).filter(Boolean).slice(0, 30);
        const newDesc = str(c.description, 2000, { name: 'Customer description' });
        newCustomerRow = {
          id: id('cus'), customer_name: str(c.customerName, 120, { required: true, name: 'Customer name' }), company_name: str(c.companyName, 160, { name: 'Company name' }),
          destinations, customer_number: str(c.customerNumber, 60, { name: 'Customer number' }), acquired_through: str(c.acquiredThrough, 120, { name: 'Acquired through' }),
          acquired_by: str(c.acquiredBy, 80, { name: 'Acquired by' }), shared_with: packSharedWith([], newDesc), created_by: me.id, created_at: nowIso(), updated_at: nowIso(), deleted_at: null,
        };
        customer = newCustomerRow;
      }
      // Optional extra employees who also see this follow-up and are notified.
      const staff = await activeEmployees();
      const participantIds = [...new Set(asArray(f.participantIds).map(String))].filter((p) => p !== String(f.assignedTo));
      if (participantIds.length > 30) throw bad('Too many extra employees (max 30).');
      for (const p of participantIds) if (!staff.some((e) => e.id === p)) throw bad('One of the extra employees was not found or is no longer active.');
      const fields = {
        customer_id: customer ? customer.id : null, kind, assigned_to: String(f.assignedTo), participant_ids: participantIds,
        remarks: str(f.remarks, 4000, { name: 'Remarks' }), due_at: isoOrNull(f.dueAt, 'Due date'), updated_at: nowIso(),
      };
      if (!customer && !fields.remarks) throw bad('Without a customer, please type the follow-up remarks so it can be identified.');
      const label = KIND_LABEL[kind];
      const forWhom = customer ? ` for ${customer.customer_name}` : '';
      if (newCustomerRow) await upsert('crm_customers', newCustomerRow);
      if (f.id) {
        const existing = await getOne('crm_followups', f.id);
        if (!existing) throw notFound('Follow-up not found.');
        if (!isAdmin && existing.created_by !== me.id) throw forbidden('Only the person who created this follow-up (or an administrator) can change it.');
        if (!OPEN.includes(existing.status)) throw bad('This follow-up is already closed.');
        const row = { ...existing, ...fields };
        await upsert('crm_followups', row);
        if (existing.assigned_to !== fields.assigned_to) await notify([fields.assigned_to], 'followup', row.id, `${label}${forWhom} was assigned to you.`, me.id);
        const addedPeople = participantIds.filter((p) => !asArray(existing.participant_ids).includes(p));
        await notify(addedPeople, 'followup', row.id, `You were added to a ${label.toLowerCase()}${forWhom}.`, me.id);
        return res.status(200).json({ ok: true, followup: mapFollowup(row), customer: newCustomerRow ? mapCustomer(newCustomerRow) : undefined });
      }
      const row = { id: id('fup'), ...fields, status: 'pending', outcome_remarks: '', history: [], created_by: me.id, created_at: nowIso(), completed_at: null };
      await upsert('crm_followups', row);
      await notify([fields.assigned_to], 'followup', row.id, `${label}${forWhom} was assigned to you.`, me.id);
      await notify(participantIds, 'followup', row.id, `You were added to a ${label.toLowerCase()}${forWhom}.`, me.id);
      return res.status(200).json({ ok: true, followup: mapFollowup(row), customer: newCustomerRow ? mapCustomer(newCustomerRow) : undefined });
    }

    if (action === 'followup_outcome') {
      const existing = await getOne('crm_followups', body.id);
      if (!existing) throw notFound('Follow-up not found.');
      if (existing.assigned_to !== me.id && existing.created_by !== me.id && !isAdmin) throw forbidden('Only the person who created this follow-up, the assigned employee, an administrator or the CEO can close or update it.');
      const outcome = String(body.outcome || '');
      if (!OUTCOMES.includes(outcome)) throw bad('Choose Completed, Not completed or Rescheduled.');
      const remarks = str(body.remarks, 4000, { name: 'Remarks' });
      const newDue = outcome === 'rescheduled' ? isoOrNull(body.newDueAt, 'New date', { required: true }) : existing.due_at;
      const at = nowIso();
      const history = [...asArray(existing.history), { at, by: me.id, outcome, remarks, dueAt: newDue }];
      const row = {
        ...existing, status: outcome, outcome_remarks: remarks, due_at: newDue, history, updated_at: at,
        completed_at: outcome === 'rescheduled' ? null : at,
      };
      await upsert('crm_followups', row);
      const customer = existing.customer_id ? await getOne('crm_customers', existing.customer_id) : null;
      const words = { completed: 'completed', not_completed: 'could not be completed', rescheduled: 'was rescheduled' }[outcome];
      await notify([existing.created_by, ...(await adminIds())], 'followup', row.id, `Follow-up${customer ? ` for ${customer.customer_name}` : ''} ${words}.`, me.id);
      return res.status(200).json({ ok: true, followup: mapFollowup(row) });
    }

    // Everyone on a follow-up (creator, assigned, added/tagged people, admin, CEO) can add their own remarks; they are kept permanently.
    if (action === 'followup_remark') {
      const existing = await getOne('crm_followups', body.id);
      if (!existing) throw notFound('Follow-up not found.');
      const involved = existing.created_by === me.id || existing.assigned_to === me.id || asArray(existing.participant_ids).includes(me.id);
      if (!involved && !isAdmin) throw forbidden('Only people on this follow-up can add remarks.');
      const text = str(body.text, 2000, { required: true, name: 'Remark' });
      const at = nowIso();
      const entry = { id: id('rmk'), at, by: me.id, text };
      const remarkLog = [...asArray(existing.remark_log), entry].slice(-500);
      const row = { ...existing, remark_log: remarkLog, updated_at: at };
      await upsert('crm_followups', row);
      const customer = existing.customer_id ? await getOne('crm_customers', existing.customer_id) : null;
      const others = [existing.created_by, existing.assigned_to, ...asArray(existing.participant_ids)].filter((x) => x && x !== me.id);
      await notify([...new Set(others)], 'followup', row.id, `${me.name || 'Someone'} added a remark on the follow-up${customer ? ` for ${customer.customer_name}` : ''}.`, me.id);
      return res.status(200).json({ ok: true, followup: mapFollowup(row) });
    }

    if (action === 'followup_delete') {
      const existing = await getOne('crm_followups', body.id);
      if (!existing) throw notFound('Follow-up not found.');
      if (!isAdmin && existing.created_by !== me.id) throw forbidden('Only the person who created this follow-up (or an administrator) can delete it.');
      await supabaseFetch(`/crm_followups?id=eq.${encodeURIComponent(existing.id)}`, { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }

    // ------------------------------------------------------------------ meetings
    // Administrator sets up a CEO meeting (with colleagues and/or outside people) and the colleagues are notified.
    if (action === 'meeting_save') {
      if (!isAdmin) throw forbidden('Only an administrator can set up CEO meetings. You can request a slot instead.');
      const m = body.meeting || {};
      const fields = readMeetingInput(m);
      const attendeeIds = [...new Set(asArray(m.attendeeIds).map(String))];
      const staff = await activeEmployees();
      for (const a of attendeeIds) if (!staff.some((e) => e.id === a)) throw bad('One of the selected employees is not active.');
      if (fields.customer_id) {
        const c = await getOne('crm_customers', fields.customer_id);
        if (!c || c.deleted_at) throw bad('The selected customer was not found.');
      }
      if (m.id) {
        const existing = await getOne('crm_meetings', m.id);
        if (!existing) throw notFound('Meeting not found.');
        await assertSlotFree(fields.start_at, fields.end_at, existing.id);
        const row = { ...existing, ...fields, attendee_ids: attendeeIds, status: existing.status === 'pending_approval' ? 'pending_approval' : 'scheduled', updated_at: nowIso() };
        await upsert('crm_meetings', row);
        const added = attendeeIds.filter((a) => !asArray(existing.attendee_ids).includes(a));
        await notify(added, 'meeting', row.id, `You were added to a CEO meeting: ${row.title}.`, me.id);
        await notify(asArray(existing.attendee_ids).filter((a) => attendeeIds.includes(a)), 'meeting', row.id, `CEO meeting updated: ${row.title}.`, me.id);
        return res.status(200).json({ ok: true, meeting: mapMeeting(row) });
      }
      await assertSlotFree(fields.start_at, fields.end_at);
      const row = { id: id('mtg'), ...fields, attendee_ids: attendeeIds, status: 'scheduled', requested_by: null, decided_by: null, decision_note: '', created_by: me.id, created_at: nowIso(), updated_at: nowIso() };
      await upsert('crm_meetings', row);
      await notify(attendeeIds, 'meeting', row.id, `You were added to a CEO meeting: ${row.title}.`, me.id);
      return res.status(200).json({ ok: true, meeting: mapMeeting(row) });
    }

    // Any employee can ask for their own slot with the CEO; the administrator decides.
    if (action === 'meeting_request') {
      const fields = readMeetingInput(body.meeting || {});
      if (fields.customer_id) {
        const cu = await getOne('crm_customers', fields.customer_id);
        if (!cu || cu.deleted_at) throw bad('The selected customer was not found.');
        if (!canSeeCust(cu)) throw forbidden('You can only use customers you added or that were shared with you.');
      }
      if (Date.parse(fields.start_at) < Date.now() - 5 * 60 * 1000) throw bad('Please choose a time in the future.');
      await assertSlotFree(fields.start_at, fields.end_at);
      const row = { id: id('mtg'), ...fields, attendee_ids: [me.id], status: 'pending_approval', requested_by: me.id, decided_by: null, decision_note: '', created_by: me.id, created_at: nowIso(), updated_at: nowIso() };
      await upsert('crm_meetings', row);
      await notify(await adminIds(), 'meeting', row.id, `${me.name || 'An employee'} requested a CEO meeting: ${row.title}.`, me.id);
      return res.status(200).json({ ok: true, meeting: mapMeeting(row) });
    }

    if (action === 'meeting_decide') {
      if (!isAdmin) throw forbidden('Only an administrator can approve or reject meeting requests.');
      const existing = await getOne('crm_meetings', body.id);
      if (!existing) throw notFound('Meeting not found.');
      if (existing.status !== 'pending_approval') throw bad('This request has already been decided.');
      const approve = body.approve === true;
      if (approve) await assertSlotFree(existing.start_at, existing.end_at, existing.id);
      const row = { ...existing, status: approve ? 'scheduled' : 'rejected', decided_by: me.id, decision_note: str(body.note, 1000, { name: 'Note' }), updated_at: nowIso() };
      await upsert('crm_meetings', row);
      await notify([existing.requested_by], 'meeting', row.id, approve ? `Your CEO meeting request was approved: ${row.title}.` : `Your CEO meeting request was not approved: ${row.title}.`, me.id);
      return res.status(200).json({ ok: true, meeting: mapMeeting(row) });
    }

    if (action === 'meeting_cancel' || action === 'meeting_complete') {
      const existing = await getOne('crm_meetings', body.id);
      if (!existing) throw notFound('Meeting not found.');
      if (action === 'meeting_complete' && !isAdmin) throw forbidden('Only an administrator can close a meeting.');
      if (action === 'meeting_cancel' && !isAdmin && existing.requested_by !== me.id) throw forbidden('Only an administrator or the person who requested it can cancel this meeting.');
      const status = action === 'meeting_cancel' ? 'cancelled' : 'completed';
      const row = { ...existing, status, updated_at: nowIso() };
      await upsert('crm_meetings', row);
      if (status === 'cancelled') await notify(asArray(existing.attendee_ids), 'meeting', row.id, `CEO meeting cancelled: ${row.title}.`, me.id);
      return res.status(200).json({ ok: true, meeting: mapMeeting(row) });
    }

    // ---------------------------------------------------------------- inventory requests
    if (action === 'inventory_item_add') {
      if (!isAdmin && me.role !== 'accounts') throw forbidden('Only Admin or Accounts can add inventory products.');
      const newItem = str(body.item, 80, { required: true, name: 'Product name' });
      const row = await getOne('crm_company', 'inventory_catalog');
      const custom = asArray(row?.data?.customItems).map((x) => String(x || '').trim()).filter(Boolean);
      const removed = asArray(row?.data?.removedItems).map((x) => String(x || '').trim()).filter((x) => x.toLowerCase() !== newItem.toLowerCase());
      if (![...DEFAULT_INVENTORY_ITEMS, ...custom].some((x) => x.toLowerCase() === newItem.toLowerCase())) {
        custom.push(newItem);
      }
      await upsert('crm_company', { id: 'inventory_catalog', data: { customItems: custom, removedItems: removed }, updated_at: nowIso() });
      const inventoryItems = await getInventoryCatalog();
      return res.status(200).json({ ok: true, inventoryItems });
    }

    if (action === 'inventory_item_remove') {
      if (!isAdmin && me.role !== 'accounts') throw forbidden('Only Admin or Accounts can remove inventory products.');
      const target = str(body.item, 80, { required: true, name: 'Product name' });
      const row = await getOne('crm_company', 'inventory_catalog');
      const custom = asArray(row?.data?.customItems).map((x) => String(x || '').trim()).filter((x) => x && x.toLowerCase() !== target.toLowerCase());
      const removed = asArray(row?.data?.removedItems).map((x) => String(x || '').trim()).filter(Boolean);
      if (DEFAULT_INVENTORY_ITEMS.some((x) => x.toLowerCase() === target.toLowerCase()) && !removed.some((x) => x.toLowerCase() === target.toLowerCase())) {
        removed.push(target);
      }
      await upsert('crm_company', { id: 'inventory_catalog', data: { customItems: custom, removedItems: removed }, updated_at: nowIso() });
      const inventoryItems = await getInventoryCatalog();
      return res.status(200).json({ ok: true, inventoryItems });
    }

    // Any employee requests items from the catalog (with quantities) and assigns it to an Accounts or Admin employee.
    if (action === 'inventory_save') {
      const r = body.request || {};
      const catalog = await getInventoryCatalog();
      const catalogByLower = new Map(catalog.map((x) => [x.toLowerCase(), x]));
      const merged = new Map();
      for (const line of asArray(r.items)) {
        const rawItem = String(line?.item || '').trim();
        const canonical = catalogByLower.get(rawItem.toLowerCase());
        if (!canonical) throw bad('Only items from the inventory list can be requested.');
        const qty = Number(line?.qty);
        if (!Number.isInteger(qty) || qty < 1 || qty > 999) throw bad('Each quantity must be a whole number from 1 to 999.');
        merged.set(canonical, (merged.get(canonical) || 0) + qty);
      }
      if (!merged.size) throw bad('Add at least one item.');
      const items = [...merged].map(([item, qty]) => ({ item, qty: Math.min(999, qty) }));
      const staff = await activeEmployees();
      const assignee = staff.find((e) => e.id === String(r.assignedTo || ''));
      if (!assignee || !['accounts', 'admin'].includes(assignee.role)) throw bad('Assign the request to an Accounts or Admin employee.');
      const at = nowIso();
      const row = { id: id('inv'), requested_by: me.id, assigned_to: assignee.id, items, note: str(r.note, 1000, { name: 'Note' }), status: 'pending', decision_remarks: '', decided_by: null, created_at: at, updated_at: at };
      await upsert('crm_inventory_requests', row);
      const summary = items.map((i) => `${i.qty} x ${i.item}`).join(', ');
      await notify([assignee.id, ...(await adminIds())], 'inventory', row.id, `${me.name || 'An employee'} requested inventory: ${summary}.`, me.id);
      return res.status(200).json({ ok: true, request: mapInventory(row) });
    }

    if (action === 'inventory_decide') {
      const existing = await getOne('crm_inventory_requests', body.id);
      if (!existing) throw notFound('Request not found.');
      if (existing.assigned_to !== me.id && !isAdmin) throw forbidden('Only the person this request is assigned to (or an administrator) can update it.');
      const status = String(body.status || '');
      if (!INVENTORY_STATUSES.includes(status)) throw bad('Choose Approved, Rejected or Delivered.');
      if (['rejected', 'delivered'].includes(existing.status)) throw bad('This request is already closed.');
      const row = { ...existing, status, decision_remarks: str(body.remarks, 1000, { name: 'Remarks' }), decided_by: me.id, updated_at: nowIso() };
      await upsert('crm_inventory_requests', row);
      const words = { approved: 'was approved', rejected: 'was rejected', delivered: 'was delivered' }[status];
      await notify([existing.requested_by], 'inventory', row.id, `Your inventory request ${words}.`, me.id);
      await notify(await adminIds(), 'inventory', row.id, `${me.name || 'Someone'} marked an inventory request as ${status}.`, me.id);
      return res.status(200).json({ ok: true, request: mapInventory(row) });
    }

    if (action === 'inventory_delete') {
      const existing = await getOne('crm_inventory_requests', body.id);
      if (!existing) throw notFound('Request not found.');
      if (!isAdmin && !(existing.requested_by === me.id && existing.status === 'pending')) throw forbidden('You can only withdraw your own request while it is still pending.');
      await supabaseFetch(`/crm_inventory_requests?id=eq.${encodeURIComponent(existing.id)}`, { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }

    // ---------------------------------------------------------------- sales coupons
    // Any employee generates a coupon; Accounts / Admin review it (approve or decline) and mark it paid or unpaid.
    if (String(action).startsWith('sale_') && !canSales) throw forbidden('You do not have access to Sales. Ask an administrator.');
    if (action === 'sale_save') {
      const x = body.sale || {};
      const saleType = String(x.saleType || '');
      if (!SALE_TYPES[saleType]) throw bad('Choose a sale type.');
      const otherType = saleType === 'others' ? str(x.otherType, 80, { required: true, name: 'Sale type (Others)' }) : '';
      const money = (v, label) => {
        const n = Number(v);
        if (v === '' || v === null || v === undefined || !Number.isFinite(n)) throw bad(`${label} is required (numbers only).`);
        if (Math.abs(n) > 9999999999) throw bad(`${label} is too large.`);
        return Math.round(n * 100) / 100;
      };
      const currency = String(x.currency || '').toUpperCase();
      if (!CURRENCIES.includes(currency)) throw bad('Choose a currency from the list.');
      const costAmount = money(x.costAmount, 'Cost amount');
      const saleAmount = money(x.saleAmount, 'Sale amount');
      const psfProfit = money(x.psfProfit, 'PSF / Profit');
      if (costAmount < 0 || saleAmount < 0) throw bad('Cost and sale amounts cannot be negative.');
      const couponNo = await supabaseFetch('/rpc/crm_next_sale_no', { method: 'POST', body: '{}' });
      const at = nowIso();
      const row = {
        id: id('sale'), coupon_no: String(couponNo), created_by: me.id, sale_type: saleType, other_type: otherType,
        customer_name: str(x.customerName, 160, { required: true, name: 'Customer name' }),
        vendor_name: str(x.vendorName, 160, { required: true, name: 'Vendor name' }),
        package_details: str(x.packageDetails, 2000, { required: true, name: 'Package details' }),
        pax_name: str(x.paxName, 400, { required: true, name: 'PAX name' }),
        currency, cost_amount: costAmount, sale_amount: saleAmount,
        query_code: str(x.queryCode, 80, { required: true, name: 'Query code' }), psf_profit: psfProfit,
        status: 'pending', payment_status: 'unpaid', review_remarks: '', reviewed_by: null, reviewed_at: null, created_at: at, updated_at: at,
      };
      await upsert('crm_sales', row);
      const kind = saleType === 'others' ? otherType : SALE_TYPES[saleType];
      await notify(await salesStaffIds(), 'sale', row.id, `${me.name || 'An employee'} generated sales coupon ${row.coupon_no} (${kind}, ${currency} ${saleAmount}).`, me.id);
      return res.status(200).json({ ok: true, sale: mapSale(row) });
    }

    if (action === 'sale_decide' || action === 'sale_payment') {
      if (!isAdmin && me.role !== 'accounts') throw forbidden('Only the Accounts Officer (or an administrator) can review sales coupons.');
      const existing = await getOne('crm_sales', body.id);
      if (!existing) throw notFound('Coupon not found.');
      const at = nowIso();
      let row; let message;
      if (action === 'sale_decide') {
        const status = String(body.status || '');
        if (!['approved', 'declined', 'pending'].includes(status)) throw bad('Choose Approve or Decline.');
        row = { ...existing, status, review_remarks: str(body.remarks, 1000, { name: 'Remarks' }), reviewed_by: me.id, reviewed_at: at, updated_at: at };
        if (status === 'declined') row.payment_status = 'unpaid';
        message = status === 'approved' ? `Your sales coupon ${existing.coupon_no} was approved.` : status === 'declined' ? `Your sales coupon ${existing.coupon_no} was declined.` : `Your sales coupon ${existing.coupon_no} was sent back to pending.`;
      } else {
        const pay = String(body.paymentStatus || '');
        if (!['paid', 'unpaid'].includes(pay)) throw bad('Choose Paid or Not paid.');
        if (existing.status !== 'approved') throw bad('Approve the coupon before marking it paid.');
        row = { ...existing, payment_status: pay, reviewed_by: me.id, reviewed_at: at, updated_at: at };
        message = `Your sales coupon ${existing.coupon_no} was marked ${pay === 'paid' ? 'PAID' : 'NOT PAID'}.`;
      }
      await upsert('crm_sales', row);
      await notify([existing.created_by], 'sale', row.id, message, me.id);
      return res.status(200).json({ ok: true, sale: mapSale(row) });
    }

    if (action === 'sale_delete') {
      const existing = await getOne('crm_sales', body.id);
      if (!existing) throw notFound('Coupon not found.');
      if (!isAdmin && !(existing.created_by === me.id && existing.status === 'pending')) throw forbidden('You can only withdraw your own coupon while it is still pending.');
      await supabaseFetch(`/crm_sales?id=eq.${encodeURIComponent(existing.id)}`, { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }

    // ---------------------------------------------------------------- invoices
    if (action === 'company_save') {
      if (!isAdmin && me.role !== 'accounts') throw forbidden('Only Admin or Accounts can change the company details.');
      const c = body.company || {};
      const data = {
        name: str(c.name, 160, { required: true, name: 'Company name' }), payTo: str(c.payTo, 160, { name: 'Cheque payee' }), ntn: str(c.ntn, 60, { name: 'NTN' }),
        address: str(c.address, 400, { name: 'Address' }), phone: str(c.phone, 80, { name: 'Phone' }), email: str(c.email, 120, { name: 'Email' }),
        website: str(c.website, 120, { name: 'Website' }), bankDetails: str(c.bankDetails, 600, { name: 'Bank details' }), terms: str(c.terms, 1200, { name: 'Terms' }),
        footer: str(c.footer, 200, { name: 'Footer line' }),
      };
      await upsert('crm_company', { id: 'main', data, updated_at: nowIso() });
      return res.status(200).json({ ok: true, company: { ...DEFAULT_COMPANY, ...data } });
    }

    if (action === 'invoice_save') {
      const x = body.invoice || {};
      const existing = x.id ? await getOne('crm_invoices', x.id) : null;
      if (x.id && !existing) throw notFound('Invoice not found.');
      const kind = existing ? (existing.kind === 'vendor' ? 'vendor' : 'customer') : (x.kind === 'vendor' ? 'vendor' : 'customer');
      const vendorBill = kind === 'vendor';
      const usedKeys = new Set();
      const keyOf = (k, prefix) => {
        let v = /^[A-Za-z0-9_-]{1,40}$/.test(String(k || '')) ? String(k) : '';
        if (!v || usedKeys.has(v)) v = id(prefix);
        usedKeys.add(v);
        return v;
      };
      const currency = String(x.currency || '').toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw bad('Choose the invoice currency.');
      const money = (v, label, { min = 0 } = {}) => {
        const n = Number(v === '' || v === null || v === undefined ? 0 : v);
        if (!Number.isFinite(n) || n < min || n > 9999999999) throw bad(`${label} is not a valid amount.`);
        return n;
      };
      const taxRate = money(x.taxRate, 'Tax rate');
      if (taxRate > 100) throw bad('Tax rate cannot be more than 100%.');
      const sectionsIn = Array.isArray(x.sections) ? x.sections.slice(0, 30) : [];
      let subtotal = 0; let taxable = 0; let priced = 0;
      const sections = sectionsIn.map((sec, si) => {
        const lines = (Array.isArray(sec.lines) ? sec.lines : []).slice(0, 60).map((l, li) => {
          const description = str(l.description, 300, { required: true, name: `Section ${si + 1}, line ${li + 1} description` });
          const hasPrice = !(l.unitPrice === '' || l.unitPrice === null || l.unitPrice === undefined);
          if (!hasPrice) return { description, note: true, key: keyOf(l.key, 'ln'), locked: Boolean(l.locked) };
          const unitPrice = money(l.unitPrice, `Unit price of "${description}"`);
          const units = money(l.units === '' || l.units === undefined ? 1 : l.units, `Units of "${description}"`);
          const lineCur = String(l.currency || currency).toUpperCase();
          if (!/^[A-Z]{3}$/.test(lineCur)) throw bad(`Currency of "${description}" is not valid.`);
          let rate = 1;
          if (lineCur !== currency) {
            rate = Number(l.rate);
            if (!Number.isFinite(rate) || rate <= 0) throw bad(`Enter the exchange rate for "${description}" (1 ${lineCur} = ? ${currency}).`);
          }
          const amount = r2(unitPrice * units * rate);
          subtotal += amount; priced++;
          if (l.taxable) taxable += amount;
          return { description, unitPrice, units, currency: lineCur, rate, amount, taxable: Boolean(l.taxable), key: keyOf(l.key, 'ln'), locked: Boolean(l.locked) };
        });
        return { title: str(sec.title, 160, { name: 'Section title' }), key: keyOf(sec.key, 'sec'), locked: Boolean(sec.locked), lines };
      }).filter((sec) => sec.title || sec.lines.length);
      if (!priced) throw bad('Add at least one priced line to the invoice.');
      // Save & lock: lines saved as locked can never be changed or removed (not even by Admin); new lines can always be added.
      if (existing) {
        const sig = (l) => JSON.stringify([l.description, Boolean(l.note), l.unitPrice ?? null, l.units ?? null, l.currency ?? null, l.rate ?? null, Boolean(l.taxable)]);
        const newLineByKey = new Map();
        sections.forEach((sec) => sec.lines.forEach((l) => newLineByKey.set(l.key, { sec, l })));
        const newSecByKey = new Map(sections.map((sec) => [sec.key, sec]));
        for (const ps of Array.isArray(existing.sections) ? existing.sections : []) {
          if (ps.locked) {
            const ns = ps.key && newSecByKey.get(ps.key);
            if (!ns || ns.title !== ps.title) throw bad('A saved & locked section cannot be changed or removed.');
            ns.locked = true;
          }
          for (const pl of ps.lines || []) {
            if (!pl.locked) continue;
            const f = pl.key && newLineByKey.get(pl.key);
            if (!f || f.sec.key !== ps.key || sig(f.l) !== sig(pl)) throw bad('A saved & locked line cannot be changed or removed. You can add new lines.');
            f.l.locked = true;
          }
        }
      }
      const discount = money(x.discount, 'Discount');
      const advancePaid = money(x.advancePaid, 'Advance received');
      const taxAmount = r2(taxable * taxRate / 100);
      const total = r2(subtotal + taxAmount - discount);
      if (total < 0) throw bad('The discount is larger than the invoice total.');
      const balance = r2(Math.max(0, total - advancePaid));
      const dateOnly = (v, name, required) => {
        const d = String(v || '').slice(0, 10);
        if (!d) { if (required) throw bad(`${name} is required.`); return null; }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) throw bad(`${name} is not a valid date.`);
        return d;
      };
      const crmQuery = str(x.crmId || x.queryCode, 80, { name: 'CRM ID / Query Code' });
      // Vendors we pay for this invoice: office record only, never printed on the customer's PDF.
      const vendors = vendorBill ? [] : (Array.isArray(x.vendors) ? x.vendors.slice(0, 20) : []).map((v, vi) => {
        const name = str(v?.name, 160, { name: `Vendor ${vi + 1} name` });
        const description = str(v?.description, 300, { name: `Vendor ${vi + 1} description` });
        const bank = str(v?.bank, 600, { name: `Vendor ${vi + 1} bank account details` });
        const hasUnitPrice = !(v?.unitPrice === '' || v?.unitPrice === null || v?.unitPrice === undefined);
        const hasUnits = !(v?.units === '' || v?.units === null || v?.units === undefined);
        const hasAmount = !(v?.amount === '' || v?.amount === null || v?.amount === undefined);
        if (!name && !description && !bank && !hasAmount && !hasUnitPrice && !hasUnits) return null;
        if (!name) throw bad(`Enter the name of vendor ${vi + 1}.`);
        const vCur = String(v?.currency || currency).toUpperCase();
        if (!/^[A-Z]{3}$/.test(vCur)) throw bad(`Currency of vendor ${name} is not valid.`);
        const unitPrice = hasUnitPrice ? money(v.unitPrice, `Unit price for ${name}`) : null;
        const units = hasUnits ? money(v.units, `Units for ${name}`) : null;
        const computedAmt = unitPrice !== null ? r2(unitPrice * (units ?? 1)) : 0;
        const amount = hasAmount ? money(v.amount, `Payable to ${name}`) : computedAmt;
        return { name, description, unitPrice, units, amount, currency: vCur, bank };
      }).filter(Boolean);
      const base = {
        customer_name: str(x.customerName, 160, { required: true, name: vendorBill ? 'Vendor name' : 'Customer name' }), customer_phone: str(x.customerPhone, 60, { name: 'Phone' }),
        customer_address: str(x.customerAddress, 400, { name: 'Address' }), customer_ntn: str(x.customerNtn, 60, { name: 'Customer NTN' }),
        // one box on the form: "CRM ID / Query Code" (kept in both columns so searches and reports find it either way)
        reference: str(x.reference, 120, { name: 'Reference' }), crm_id: crmQuery, query_code: crmQuery,
        ntn: str(x.ntn, 60, { name: 'NTN' }), show_ntn: x.showNtn !== false, vendors, invoice_date: dateOnly(x.invoiceDate, 'Invoice date', true), due_date: dateOnly(x.dueDate, 'Due date', false),
        currency, sections, tax_label: str(x.taxLabel, 40, { name: 'Tax label' }) || 'Tax', tax_rate: taxRate, discount, advance_paid: advancePaid,
        subtotal: r2(subtotal), tax_amount: taxAmount, total, balance, notes: str(x.notes, 1500, { name: 'Notes' }),
      };
      const at = nowIso();
      if (existing && !isAdmin && me.role !== 'accounts' && !(existing.created_by === me.id && existing.status === 'unpaid')) {
        throw forbidden('You can only edit your own unpaid invoices.');
      }
      const betaEnabled = await isCustomerPortalBetaEnabled();
      let visaOp = null; // null | 'delete' | 'upsert'
      let visaObj = null;
      if (betaEnabled && !vendorBill) {
        if (x.visaProgress === undefined) {
          const existingVisaRow = existing ? await getOne('crm_company', `visa-${existing.id}`) : null;
          const existingVp = existingVisaRow
            ? formatVisaProgress(existingVisaRow.data, existingVisaRow.updated_at || null)
            : null;
          if (existingVp) {
            visaObj = existingVp;
          } else if (hasVisaKeyword(sections)) {
            visaObj = normalizeVisaProgress(
              { enabled: true, status: 'not_started', inProgressDate: null, issuedDate: null },
              null
            );
            visaOp = 'upsert';
          }
        } else if (x.visaProgress === null || x.visaProgress === false || x.visaProgress?.enabled === false) {
          visaOp = existing ? 'delete' : null;
          visaObj = null;
        } else {
          const existingVisaRow = existing ? await getOne('crm_company', `visa-${existing.id}`) : null;
          const existingVp = existingVisaRow ? parseJsonObj(existingVisaRow.data, null) : null;
          visaObj = normalizeVisaProgress({ ...x.visaProgress, enabled: true }, existingVp);
          visaOp = 'upsert';
        }
      }
      if (existing) {
        const row = { ...existing, ...base, updated_at: at };
        await upsert('crm_invoices', row);
        if (visaOp === 'delete') {
          await supabaseFetch(`/crm_company?id=eq.${encodeURIComponent(`visa-${row.id}`)}`, { method: 'DELETE' });
        } else if (visaOp === 'upsert' && visaObj) {
          await upsert('crm_company', { id: `visa-${row.id}`, data: visaObj, updated_at: visaObj.updatedAt });
        }
        await notify(await salesStaffIds(), 'invoice', row.id, `${me.name || 'Someone'} updated ${vendorBill ? 'vendor payable' : 'invoice'} ${row.invoice_no} (${currency} ${total}).`, me.id);
        return res.status(200).json({ ok: true, invoice: mapInvoice(row, visaObj) });
      }
      const invoiceNo = await supabaseFetch(vendorBill ? '/rpc/crm_next_payable_no' : '/rpc/crm_next_invoice_no', { method: 'POST', body: '{}' });
      const row = { id: id('inv'), kind, invoice_no: String(invoiceNo), created_by: me.id, status: 'unpaid', created_at: at, updated_at: at, ...base };
      await upsert('crm_invoices', row);
      if (visaOp === 'upsert' && visaObj) {
        await upsert('crm_company', { id: `visa-${row.id}`, data: visaObj, updated_at: visaObj.updatedAt });
      }
      await notify(await salesStaffIds(), 'invoice', row.id, `${me.name || 'An employee'} generated ${vendorBill ? 'vendor payable' : 'invoice'} ${row.invoice_no} ${vendorBill ? 'for vendor' : 'for'} ${base.customer_name} (${currency} ${total}).`, me.id);
      return res.status(200).json({ ok: true, invoice: mapInvoice(row, visaObj) });
    }

    if (action === 'invoice_visa_update') {
      const betaEnabled = await isCustomerPortalBetaEnabled();
      if (!betaEnabled) throw forbidden('Customer Portal Beta is currently disabled.', 'BETA_DISABLED');
      const invId = str(body.id, 100, { required: true, name: 'Invoice ID' });
      const existing = await getOne('crm_invoices', invId);
      if (!existing) throw notFound('Invoice not found.');
      if (existing.kind === 'vendor') throw bad('Visa progress tracking is only available for customer invoices.');
      if (!isAdmin && me.role !== 'accounts' && existing.created_by !== me.id) {
        throw forbidden('Only the invoice creator, Accounts, or Admin can update Visa progress.');
      }
      const vpInput = body.visaProgress && typeof body.visaProgress === 'object' && !Array.isArray(body.visaProgress)
        ? body.visaProgress
        : {
            enabled: body.enabled,
            status: body.status,
            inProgressDate: body.inProgressDate,
            issuedDate: body.issuedDate,
          };
      const visaRowId = `visa-${existing.id}`;
      if (vpInput.enabled === false) {
        await supabaseFetch(`/crm_company?id=eq.${encodeURIComponent(visaRowId)}`, { method: 'DELETE' });
        return res.status(200).json({ ok: true, visaProgress: null, invoice: mapInvoice(existing, null) });
      }
      const existingVisaRow = await getOne('crm_company', visaRowId);
      const existingVp = existingVisaRow ? parseJsonObj(existingVisaRow.data, null) : null;
      const vpObj = normalizeVisaProgress({ ...vpInput, enabled: true }, existingVp);
      await upsert('crm_company', { id: visaRowId, data: vpObj, updated_at: vpObj.updatedAt });
      return res.status(200).json({ ok: true, visaProgress: vpObj, invoice: mapInvoice(existing, vpObj) });
    }

    if (action === 'invoice_status') {
      const existing = await getOne('crm_invoices', body.id);
      if (!existing) throw notFound('Invoice not found.');
      const status = String(body.status || '');
      if (!['unpaid', 'paid', 'cancelled'].includes(status)) throw bad('Choose Unpaid, Paid or Cancelled.');
      const staff = isAdmin || me.role === 'accounts';
      if (!staff && !(existing.created_by === me.id && status === 'cancelled' && existing.status === 'unpaid')) throw forbidden('Only Accounts or Admin can change the invoice status.');
      const row = { ...existing, status, updated_at: nowIso() };
      await upsert('crm_invoices', row);
      if (existing.created_by !== me.id) await notify([existing.created_by], 'invoice', row.id, `Your invoice ${existing.invoice_no} was marked ${status.toUpperCase()}.`, me.id);
      return res.status(200).json({ ok: true, invoice: mapInvoice(row) });
    }

    // The vendor side of an invoice is paid separately from the customer side (Accounts / Admin / CEO).
    if (action === 'invoice_vendor_status') {
      const existing = await getOne('crm_invoices', body.id);
      if (!existing) throw notFound('Invoice not found.');
      const status = String(body.status || '');
      if (!['unpaid', 'paid'].includes(status)) throw bad('Choose Paid or Unpaid for the vendor side.');
      if (!(isAdmin || me.role === 'accounts')) throw forbidden('Only Accounts or Admin can mark the vendor side paid.');
      if (existing.kind === 'vendor') throw bad('This is a vendor payable itself. Use its own Mark paid button.');
      const at = nowIso();
      const row = { ...existing, vendor_status: status, vendor_paid_at: status === 'paid' ? at : null, vendor_paid_by: status === 'paid' ? me.id : null, updated_at: at };
      await upsert('crm_invoices', row);
      if (existing.created_by !== me.id) await notify([existing.created_by], 'invoice', row.id, `Vendor side of invoice ${existing.invoice_no} was marked ${status.toUpperCase()}.`, me.id);
      return res.status(200).json({ ok: true, invoice: mapInvoice(row) });
    }

    if (action === 'invoice_delete') {
      if (!isAdmin) throw forbidden('Only an administrator can delete an invoice. You can cancel it instead.');
      const existing = await getOne('crm_invoices', body.id);
      if (!existing) throw notFound('Invoice not found.');
      await supabaseFetch(`/crm_invoices?id=eq.${encodeURIComponent(existing.id)}`, { method: 'DELETE' });
      await supabaseFetch(`/crm_company?id=eq.${encodeURIComponent(`visa-${existing.id}`)}`, { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }

    // ---------------------------------------------------------------- receipts
    if (action === 'receipt_save') {
      const x = body.receipt || {};
      const existing = x.id ? await getOne('crm_receipts', x.id) : null;
      if (x.id && !existing) throw notFound('Receipt not found.');
      if (existing && !(isAdmin || me.role === 'accounts' || existing.created_by === me.id)) throw forbidden('You can only edit your own receipts.');
      const money = (v, label) => {
        const n = Number(v);
        if (v === '' || v === null || v === undefined || !Number.isFinite(n) || n < 0 || n > 9999999999) throw bad(`${label} is not a valid amount.`);
        return r2(n);
      };
      const currency = String(x.currency || '').toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw bad('Choose the currency.');
      const items = [...new Set(asArray(x.items).map(String))].filter((i) => RECEIPT_ITEMS.includes(i));
      const otherItem = str(x.otherItem, 120, { name: 'Other item' });
      const paymentType = x.paymentType === 'partial' ? 'partial' : 'full';
      // The form no longer asks what the whole thing was sold for: only the amount received is entered.
      const amountReceived = x.amountReceived !== undefined && x.amountReceived !== null && x.amountReceived !== ''
        ? money(x.amountReceived, 'Amount received')
        : money(x.totalAmount, 'Amount received');
      if (amountReceived <= 0) throw bad('Enter the amount received.');
      // older partial receipts keep the total they were saved with (their balance still shows)
      const totalAmount = x.totalAmount !== undefined && x.totalAmount !== null && x.totalAmount !== '' && num(x.totalAmount) >= amountReceived
        ? money(x.totalAmount, 'Total payment sold for')
        : (existing && num(existing.total_amount) > amountReceived ? num(existing.total_amount) : amountReceived);
      const method = x.method === 'bank' ? 'bank' : 'cash';
      let proof = existing ? existing.proof_image || null : null;
      if (x.removeProof) proof = null;
      if (x.proofImage) {
        const data = String(x.proofImage);
        if (!/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(data)) throw bad('The screenshot must be a JPG, JPEG or PNG image.');
        if (data.length > 2_500_000) throw bad('The screenshot is too large. Please upload a smaller image.');
        proof = data;
      }
      const base = {
        query_code: str(x.queryCode, 80, { required: true, name: 'Query code' }), client_name: str(x.clientName, 160, { required: true, name: 'Client name' }),
        items, other_item: otherItem, payment_type: paymentType, currency, total_amount: totalAmount, amount_received: amountReceived, method,
        bank_name: method === 'bank' ? str(x.bankName, 120, { name: 'Bank name' }) : '', reference_no: str(x.referenceNo, 160, { name: 'Reference No / Transaction ID' }),
        proof_image: proof, has_proof: Boolean(proof), purpose: str(x.purpose, 400, { name: 'On account of' }),
      };
      const at = nowIso();
      const describe = (r) => `${r.client_name} (query ${r.query_code}): ${r.currency} ${r.amount_received} received ${r.method === 'bank' ? 'by bank transfer' : 'in cash'}, ${r.payment_type === 'partial' ? `partial payment of ${r.total_amount}` : 'full payment'}.`;
      const accounts = await accountsIds();
      if (existing) {
        const row = { ...existing, ...base, updated_at: at };
        await upsert('crm_receipts', row);
        await notify(accounts, 'receipt', row.id, `${me.name || 'Someone'} updated receipt ${row.receipt_no} - ${describe(row)}`, me.id);
        return res.status(200).json({ ok: true, receipt: mapReceipt(row) });
      }
      const receiptNo = await supabaseFetch('/rpc/crm_next_receipt_no', { method: 'POST', body: '{}' });
      const row = { id: id('rcp'), receipt_no: String(receiptNo), created_by: me.id, created_at: at, updated_at: at, ...base };
      await upsert('crm_receipts', row);
      await notify(accounts, 'receipt', row.id, `${me.name || 'An employee'} created receipt ${row.receipt_no} - ${describe(row)}`, me.id);
      return res.status(200).json({ ok: true, receipt: mapReceipt(row) });
    }

    if (action === 'receipt_proof') {
      const existing = await getOne('crm_receipts', body.id);
      if (!existing) throw notFound('Receipt not found.');
      if (!(isAdmin || me.role === 'accounts' || me.role === 'ceo' || existing.created_by === me.id)) throw forbidden();
      return res.status(200).json({ ok: true, image: existing.proof_image || null });
    }

    if (action === 'receipt_delete') {
      if (!isAdmin) throw forbidden('Only an administrator can delete a receipt.');
      const existing = await getOne('crm_receipts', body.id);
      if (!existing) throw notFound('Receipt not found.');
      await supabaseFetch(`/crm_receipts?id=eq.${encodeURIComponent(existing.id)}`, { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }

    // ---------------------------------------------------------------- purchases (+Add Vendor)
    if (action === 'purchase_field_add') {
      if (!isAdmin && me.role !== 'accounts') throw forbidden('Only Admin or Accounts can add custom purchase columns.');
      const label = str(body.label, 80, { required: true, name: 'Column name' });
      const { customFields: existingFields, customCategories } = await getPurchaseSchema();
      const validCats = ['all', ...PURCHASE_CATEGORIES, ...customCategories.map((c) => c.id)];
      const category = validCats.includes(body.category) ? body.category : 'all';
      if (!existingFields.some((f) => f.label.toLowerCase() === label.toLowerCase() && f.category === category)) {
        existingFields.push({ id: id('pf'), category, label });
      }
      await upsert('crm_company', { id: 'purchases_schema', data: { customFields: existingFields, customCategories }, updated_at: nowIso() });
      return res.status(200).json({ ok: true, purchaseCustomFields: existingFields, purchaseCustomCategories: customCategories });
    }

    if (action === 'purchase_field_remove') {
      if (!isAdmin && me.role !== 'accounts') throw forbidden('Only Admin or Accounts can remove custom purchase columns.');
      const targetId = String(body.fieldId || body.id || '');
      const { customFields, customCategories } = await getPurchaseSchema();
      const existingFields = customFields.filter((f) => f.id !== targetId);
      await upsert('crm_company', { id: 'purchases_schema', data: { customFields: existingFields, customCategories }, updated_at: nowIso() });
      return res.status(200).json({ ok: true, purchaseCustomFields: existingFields, purchaseCustomCategories: customCategories });
    }

    if (action === 'purchase_category_add') {
      if (!isAdmin && me.role !== 'accounts') throw forbidden('Only Admin or Accounts can add custom purchase categories.');
      const label = str(body.label, 80, { required: true, name: 'Category name' });
      const { customFields, customCategories } = await getPurchaseSchema();
      const builtinLabels = ['ticket purchase', 'hotel purchase', 'visa purchase', 'tours & transfers', 'insurance', 'other service'];
      if (
        !builtinLabels.includes(label.toLowerCase()) &&
        !customCategories.some((c) => c.label.toLowerCase() === label.toLowerCase())
      ) {
        customCategories.push({ id: id('pcat'), label });
      }
      await upsert('crm_company', { id: 'purchases_schema', data: { customFields, customCategories }, updated_at: nowIso() });
      return res.status(200).json({ ok: true, purchaseCustomCategories: customCategories, purchaseCustomFields: customFields });
    }

    if (action === 'purchase_category_remove') {
      if (!isAdmin && me.role !== 'accounts') throw forbidden('Only Admin or Accounts can remove custom purchase categories.');
      const targetId = String(body.categoryId || body.id || '');
      const { customFields, customCategories } = await getPurchaseSchema();
      const nextCategories = customCategories.filter((c) => c.id !== targetId);
      await upsert('crm_company', { id: 'purchases_schema', data: { customFields, customCategories: nextCategories }, updated_at: nowIso() });
      return res.status(200).json({ ok: true, purchaseCustomCategories: nextCategories, purchaseCustomFields: customFields });
    }

    if (action === 'purchase_save') {
      const x = body.purchase || body;
      const existingRow = x.id ? await getOne('crm_company', x.id) : null;
      const existing = existingRow?.data || null;
      if (x.id && !existing) throw notFound('Purchase record not found.');
      if (existing && !(isAdmin || me.role === 'accounts' || existing.createdBy === me.id)) {
        throw forbidden('You can only edit your own purchase records.');
      }

      const { customCategories } = await getPurchaseSchema();
      const customCatMap = new Map(customCategories.map((c) => [c.id, c.label]));

      const customerName = str(x.customerName, 160, { required: true, name: 'Customer name' });
      const careOf = str(x.careOf, 160, { name: 'C/O' });
      const crmId = str(x.crmId, 80, { name: 'Query Code / CRM ID' });
      const currency = String(x.currency || 'PKR').toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw bad('Choose a valid currency.');
      const purchaseDate = String(x.purchaseDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
      const notes = str(x.notes, 2000, { name: 'Notes' });

      const moneyOpt = (v, label, { required = false } = {}) => {
        if (v === '' || v === null || v === undefined) {
          if (required) throw bad(`${label} is required.`);
          return null;
        }
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 9999999999) throw bad(`${label} is not a valid amount.`);
        return r2(n);
      };

      const rawItems = asArray(x.items);
      if (!rawItems.length) throw bad('Add at least one vendor purchase item.');

      let totalPayable = 0;
      let totalReceivable = 0;
      const items = rawItems.slice(0, 40).map((it, idx) => {
        const rawCat = String(it?.category || 'other');
        const isBuiltin = PURCHASE_CATEGORIES.includes(rawCat);
        const isCustom = customCatMap.has(rawCat);
        const category = isBuiltin || isCustom ? rawCat : 'other';
        const catTitle = isBuiltin
          ? { ticket: 'Ticket', hotel: 'Hotel', visa: 'Visa', tour: 'Tours & Transfers', insurance: 'Insurance', other: 'Other' }[category]
          : (customCatMap.get(category) || it?.categoryLabel || 'Custom Service');
        const vendorName = str(it?.vendorName, 160, { required: true, name: `${catTitle} #${idx + 1} Vendor / Issued By` });
        const quantity = it?.quantity !== '' && it?.quantity !== null && it?.quantity !== undefined ? Math.max(1, Number(it.quantity) || 1) : 1;
        const unitPayable = moneyOpt(it?.unitPayable, `${catTitle} #${idx + 1} Unit Payable`, { required: false });
        const rawPayable = moneyOpt(it?.payable, `${catTitle} #${idx + 1} Payable Price`, { required: unitPayable === null });
        const payable = rawPayable !== null ? rawPayable : r2((unitPayable || 0) * quantity);
        const receivable = moneyOpt(it?.receivable, `${catTitle} #${idx + 1} Receivable`, { required: false });
        const itemCurrency = /^[A-Z]{3}$/.test(String(it?.currency || '').toUpperCase()) ? String(it.currency).toUpperCase() : currency;
        const paymentDueDate = it?.paymentDueDate ? String(it.paymentDueDate).slice(0, 10) : null;

        const VALID_PAID_METHODS = ['unpaid', 'faiq_card', 'ali_card', 'third_party', 'other', 'card', 'cash', 'bank_transfer'];
        const paidByMethod = VALID_PAID_METHODS.includes(it?.paidByMethod) ? it.paidByMethod : 'unpaid';
        const cardOption = ['faiq_card', 'ali_card', 'third_party', 'other', ''].includes(it?.cardOption) ? (it.cardOption || '') : '';
        const cardBank = str(it?.cardBank, 160, { name: 'Card bank' });
        const paidBySpecify = str(it?.paidBySpecify, 200, { name: 'Paid by details' });

        // Category-specific validations
        const ticketNumber = category === 'ticket' ? str(it?.ticketNumber, 120, { required: true, name: `Ticket #${idx + 1} Ticket Number` }) : str(it?.ticketNumber, 120);
        const hotelName = category === 'hotel' ? str(it?.hotelName, 160, { required: true, name: `Hotel #${idx + 1} Hotel Name` }) : str(it?.hotelName, 160);
        const rooms = str(it?.rooms, 80, { name: 'Rooms' });
        const checkInDate = it?.checkInDate ? String(it.checkInDate).slice(0, 10) : null;
        const checkOutDate = it?.checkOutDate ? String(it.checkOutDate).slice(0, 10) : null;
        const countries = category === 'visa' ? str(it?.countries, 200, { required: true, name: `Visa #${idx + 1} Countries` }) : str(it?.countries, 200);
        const visaType = category === 'visa' ? str(it?.visaType, 120, { required: true, name: `Visa #${idx + 1} Visa Type` }) : str(it?.visaType, 120);
        const tourDescription = category === 'tour' ? str(it?.tourDescription, 400, { required: true, name: `Tour #${idx + 1} Description of Tour` }) : str(it?.tourDescription, 400);
        const tourDate = it?.tourDate ? String(it.tourDate).slice(0, 10) : null;
        const persons = it?.persons !== '' && it?.persons !== null && it?.persons !== undefined ? Math.max(0, Math.round(Number(it.persons) || 0)) : null;
        const insuranceType = category === 'insurance' ? str(it?.insuranceType, 160, { required: true, name: `Insurance #${idx + 1} Type` }) : str(it?.insuranceType, 160);
        const insuranceDays = it?.insuranceDays !== '' && it?.insuranceDays !== null && it?.insuranceDays !== undefined ? Math.max(0, Math.round(Number(it.insuranceDays) || 0)) : null;
        const description = str(it?.description, 400);

        const rawCustom = it?.customValues && typeof it.customValues === 'object' ? it.customValues : {};
        const customValues = {};
        for (const [k, v] of Object.entries(rawCustom)) {
          const val = str(v, 300);
          if (val) customValues[String(k).slice(0, 80)] = val;
        }

        totalPayable = r2(totalPayable + payable);
        if (receivable !== null) totalReceivable = r2(totalReceivable + receivable);

        return {
          id: it?.id || id('pit'),
          category,
          categoryLabel: isCustom ? catTitle : undefined,
          vendorName,
          quantity,
          unitPayable: unitPayable ?? payable,
          payable,
          receivable,
          currency: itemCurrency,
          paymentDueDate,
          paidByMethod,
          cardOption,
          cardBank,
          paidBySpecify,
          ticketNumber,
          hotelName,
          rooms,
          checkInDate,
          checkOutDate,
          countries,
          visaType,
          tourDescription,
          tourDate,
          persons,
          insuranceType,
          insuranceDays,
          description,
          customValues,
        };
      });

      const allPaid = items.every((i) => i.paidByMethod !== 'unpaid');
      const somePaid = items.some((i) => i.paidByMethod !== 'unpaid');
      const autoStatus = allPaid ? 'paid' : somePaid ? 'partial' : 'unpaid';
      const status = ['unpaid', 'paid', 'partial'].includes(x.status) ? x.status : (existing?.status || autoStatus);

      const at = nowIso();
      if (existing) {
        const updatedPurchase = {
          ...existing,
          customerName,
          careOf,
          crmId,
          purchaseDate,
          currency,
          items,
          totalPayable,
          totalReceivable,
          notes,
          status,
          updatedAt: at,
        };
        await upsert('crm_company', { id: existing.id, data: updatedPurchase, updated_at: at });
        return res.status(200).json({ ok: true, purchase: updatedPurchase });
      }

      const existingPurchases = await getAllPurchases();
      const nextNum = existingPurchases.length + 1;
      const purchaseNo = `PUR-${String(nextNum).padStart(6, '0')}`;
      const rowId = id('pur');
      const newPurchase = {
        id: rowId,
        purchaseNo,
        createdBy: me.id,
        customerName,
        careOf,
        crmId,
        purchaseDate,
        currency,
        items,
        totalPayable,
        totalReceivable,
        notes,
        status: autoStatus,
        createdAt: at,
        updatedAt: at,
      };
      await upsert('crm_company', { id: rowId, data: newPurchase, updated_at: at });
      await notify(await salesStaffIds(), 'invoice', rowId, `${me.name || 'An employee'} added vendor purchase ${purchaseNo} for ${customerName} (${currency} ${totalPayable}).`, me.id);
      return res.status(200).json({ ok: true, purchase: newPurchase });
    }

    if (action === 'purchase_status') {
      const existingRow = await getOne('crm_company', body.id);
      if (!existingRow?.data) throw notFound('Purchase record not found.');
      if (!isAdmin && me.role !== 'accounts' && existingRow.data.createdBy !== me.id) {
        throw forbidden('Only Admin, Accounts, or the creator can update purchase status.');
      }
      const status = ['unpaid', 'paid', 'partial'].includes(body.status) ? body.status : 'unpaid';
      const at = nowIso();
      const updated = { ...existingRow.data, status, updatedAt: at };
      await upsert('crm_company', { id: existingRow.id, data: updated, updated_at: at });
      return res.status(200).json({ ok: true, purchase: updated });
    }

    if (action === 'purchase_delete') {
      if (!isAdmin) throw forbidden('Only an administrator can delete a purchase record.');
      await supabaseFetch(`/crm_company?id=eq.${encodeURIComponent(body.id)}`, { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action', code: 'BAD_REQUEST' });
  } catch (err) {
    if (!(err instanceof HttpError)) console.error('crm api error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'CRM request failed', code: err.code });
  }
}
