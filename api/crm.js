// CRM API (travel agency): customers, follow-ups/tasks, CEO meetings, notifications.
// Self-contained: only reads the employees table and its own crm_* tables.
// Every call needs the signed-in person's token; what they may do is decided here from the database, never from the browser.
import crypto from 'node:crypto';
import { isSupabaseConfigured, supabaseFetch, sweepShiftReminders } from './_supabase.js';
import { format12h, getShiftEndWindowMs } from './_cloud.js';
import { getSessionEmployee } from './_session.js';

const KINDS = ['meeting', 'corporate', 'internal', 'regular'];
const KIND_LABEL = { meeting: 'Meeting follow-up', corporate: 'Corporate follow-up', internal: 'Internal follow-up', regular: 'Regular customers follow-up' };
// Fixed inventory list: requests can only use these items (typing other items is not allowed).
const INVENTORY_ITEMS = ['Laptop', 'Keyboard', 'Mouse', 'Mouse Pad', 'Pen', 'Headphones', 'Writing Pads'];
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
const forbidden = (m = 'You do not have permission to do this.') => new HttpError(403, m, 'FORBIDDEN');
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

const mapCustomer = (r) => ({
  id: r.id, customerName: r.customer_name, companyName: r.company_name || '', destinations: asArray(r.destinations),
  customerNumber: r.customer_number || '', acquiredThrough: r.acquired_through || '', acquiredBy: r.acquired_by || '',
  createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
});
const mapFollowup = (r) => ({
  id: r.id, customerId: r.customer_id || null, participantIds: asArray(r.participant_ids), kind: r.kind, assignedTo: r.assigned_to, remarks: r.remarks || '', dueAt: r.due_at,
  status: r.status, outcomeRemarks: r.outcome_remarks || '', history: asArray(r.history), createdBy: r.created_by,
  createdAt: r.created_at, updatedAt: r.updated_at, completedAt: r.completed_at,
});
const mapInventory = (r) => ({
  id: r.id, requestedBy: r.requested_by, assignedTo: r.assigned_to, items: asArray(r.items), note: r.note || '', status: r.status,
  decisionRemarks: r.decision_remarks || '', decidedBy: r.decided_by || null, createdAt: r.created_at, updatedAt: r.updated_at,
});
const num = (v) => Number(v) || 0;
// Customers are only for administrators and for the employees an administrator has selected.
const hasCustomerAccess = (e) => {
  if (!e) return false;
  if (e.role === 'admin') return true;
  let p = e.pending_device_request;
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch { p = null; } }
  return Boolean(p && p.crmCustomerAccess);
};
const DEFAULT_COMPANY = {
  name: 'Bahaar Journeys (Pvt) Ltd', payTo: 'BAHAAR JOURNEYS (PVT) LTD', ntn: '6988772-2',
  address: '', phone: '', email: '', website: '', bankDetails: '', terms: '', footer: 'Thanking you',
};
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const mapInvoice = (r) => ({
  id: r.id, invoiceNo: r.invoice_no, createdBy: r.created_by, customerName: r.customer_name, customerPhone: r.customer_phone || '',
  customerAddress: r.customer_address || '', customerNtn: r.customer_ntn || '', reference: r.reference || '',
  invoiceDate: r.invoice_date, dueDate: r.due_date || null, currency: r.currency, sections: Array.isArray(r.sections) ? r.sections : [],
  taxLabel: r.tax_label || 'Tax', taxRate: num(r.tax_rate), discount: num(r.discount), advancePaid: num(r.advance_paid),
  subtotal: num(r.subtotal), taxAmount: num(r.tax_amount), total: num(r.total), balance: num(r.balance), notes: r.notes || '',
  status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
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

async function activeEmployees() {
  return (await supabaseFetch('/employees?deleted_at=is.null&is_active=eq.true&select=id,name,role')) || [];
}

async function notify(employeeIds, category, refId, message, exceptId) {
  const ids = [...new Set(employeeIds)].filter((e) => e && e !== exceptId);
  if (!ids.length) return;
  const at = nowIso();
  await upsert('crm_notifications', ids.map((e) => ({ id: id('ntf'), employee_id: e, category, ref_id: refId, message, created_at: at, read_at: null })));
}
const salesStaffIds = async () => (await activeEmployees()).filter((e) => e.role === 'admin' || e.role === 'accounts').map((e) => e.id);
const adminIds = async () => (await activeEmployees()).filter((e) => e.role === 'admin').map((e) => e.id);

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
    const isAdmin = me.role === 'admin';
    const canCust = hasCustomerAccess(me);
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
      const customers = (canCust ? allCustomers : allCustomers.filter((c) => linkedIds.has(c.id))).map(mapCustomer);
      const visibleInventory = inventory.filter((r) => isAdmin || r.requested_by === me.id || r.assigned_to === me.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map(mapInventory);
      const sales = salesRows.filter((x) => salesViewer || x.created_by === me.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map(mapSale);
      const history = notifs.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 200)
        .map((n) => ({ id: n.id, category: n.category, refId: n.ref_id, message: n.message, createdAt: n.created_at, read: Boolean(n.read_at) }));
      let invoices = [];
      let company = DEFAULT_COMPANY;
      if (action === 'list') {
        const [invRows, companyRow] = await Promise.all([getAll('crm_invoices'), getOne('crm_company', 'main')]);
        invoices = invRows.filter((x) => salesViewer || x.created_by === me.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map(mapInvoice);
        company = { ...DEFAULT_COMPANY, ...(companyRow?.data || {}) };
      }
      const since = Date.now() - 45 * 24 * 3600 * 1000;
      const visibleMeetings = meetings
        .filter((m) => Date.parse(m.end_at) >= since)
        .filter((m) => isAdmin || !['pending_approval', 'rejected'].includes(m.status) || m.requested_by === me.id)
        .map(mapMeeting);
      return res.status(200).json({
        ok: true, me: { id: me.id, role: me.role, customerAccess: canCust }, customers, followups: visibleFollowups, meetings: visibleMeetings, inventory: visibleInventory, inventoryItems: INVENTORY_ITEMS, sales, history, invoices, company, saleTypes: SALE_TYPES, currencies: CURRENCIES,
        unread: mine.map((n) => ({ id: n.id, category: n.category, refId: n.ref_id, message: n.message, createdAt: n.created_at })), badges,
      });
    }

    if (action === 'notifications_read') {
      const cat = ['followup', 'meeting', 'inventory', 'sale', 'reminder', 'invoice'].includes(body.category) ? body.category : null;
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
      const asks = (await myNotifications(me.id)).filter((n) => !n.read_at && n.category === 'reminder' && String(n.id).includes('-ask-'));
      if (asks.length) await upsert('crm_notifications', asks.map((n) => ({ ...n, read_at: at })));
      return res.status(200).json({ ok: true, confirmedAt: at });
    }

    // ---------------------------------------------------------------- customers
    if (action === 'customer_save') {
      if (!canCust) throw forbidden('You do not have access to Customers. Ask an administrator.');
      const c = body.customer || {};
      const destinations = asArray(c.destinations).map((d) => str(d, 100)).filter(Boolean);
      if (destinations.length > 30) throw bad('Too many destinations (max 30).');
      const fields = {
        customer_name: str(c.customerName, 120, { required: true, name: 'Customer name' }),
        company_name: str(c.companyName, 160, { name: 'Company name' }),
        destinations,
        customer_number: str(c.customerNumber, 60, { name: 'Customer number' }),
        acquired_through: str(c.acquiredThrough, 120, { name: 'Acquired through' }),
        acquired_by: str(c.acquiredBy, 80, { name: 'Acquired by' }),
        updated_at: nowIso(),
      };
      if (c.id) {
        const existing = await getOne('crm_customers', c.id);
        if (!existing || existing.deleted_at) throw notFound('Customer not found.');
        await upsert('crm_customers', { ...existing, ...fields });
        return res.status(200).json({ ok: true, customer: mapCustomer({ ...existing, ...fields }) });
      }
      const row = { id: id('cus'), ...fields, created_by: me.id, created_at: nowIso(), deleted_at: null };
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
        if (!canCust && f.customerId !== existingFu?.customer_id) throw forbidden('You do not have access to Customers. Ask an administrator.');
        customer = await getOne('crm_customers', f.customerId);
        if (!customer || customer.deleted_at) throw bad('The selected customer was not found.');
      } else if (f.newCustomer && String(f.newCustomer.customerName || '').trim()) {
        if (!canCust) throw forbidden('You do not have access to Customers. Ask an administrator.');
        const c = f.newCustomer;
        const destinations = asArray(c.destinations).map((d) => str(d, 100)).filter(Boolean).slice(0, 30);
        newCustomerRow = {
          id: id('cus'), customer_name: str(c.customerName, 120, { required: true, name: 'Customer name' }), company_name: str(c.companyName, 160, { name: 'Company name' }),
          destinations, customer_number: str(c.customerNumber, 60, { name: 'Customer number' }), acquired_through: str(c.acquiredThrough, 120, { name: 'Acquired through' }),
          acquired_by: str(c.acquiredBy, 80, { name: 'Acquired by' }), created_by: me.id, created_at: nowIso(), updated_at: nowIso(), deleted_at: null,
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
      if (existing.assigned_to !== me.id && !isAdmin) throw forbidden('Only the assigned employee (or an administrator) can update this follow-up.');
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
      if (fields.customer_id && !canCust) throw forbidden('You do not have access to Customers. Ask an administrator.');
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
    // Any employee requests items from the fixed list (with quantities) and assigns it to an Accounts or Admin employee.
    if (action === 'inventory_save') {
      const r = body.request || {};
      const merged = new Map();
      for (const line of asArray(r.items)) {
        const item = String(line?.item || '');
        if (!INVENTORY_ITEMS.includes(item)) throw bad('Only items from the inventory list can be requested.');
        const qty = Number(line?.qty);
        if (!Number.isInteger(qty) || qty < 1 || qty > 999) throw bad('Each quantity must be a whole number from 1 to 999.');
        merged.set(item, (merged.get(item) || 0) + qty);
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
          if (!hasPrice) return { description, note: true };
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
          return { description, unitPrice, units, currency: lineCur, rate, amount, taxable: Boolean(l.taxable) };
        });
        return { title: str(sec.title, 160, { name: 'Section title' }), lines };
      }).filter((sec) => sec.title || sec.lines.length);
      if (!priced) throw bad('Add at least one priced line to the invoice.');
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
      const base = {
        customer_name: str(x.customerName, 160, { required: true, name: 'Customer name' }), customer_phone: str(x.customerPhone, 60, { name: 'Phone' }),
        customer_address: str(x.customerAddress, 400, { name: 'Address' }), customer_ntn: str(x.customerNtn, 60, { name: 'Customer NTN' }),
        reference: str(x.reference, 120, { name: 'Reference' }), invoice_date: dateOnly(x.invoiceDate, 'Invoice date', true), due_date: dateOnly(x.dueDate, 'Due date', false),
        currency, sections, tax_label: str(x.taxLabel, 40, { name: 'Tax label' }) || 'Tax', tax_rate: taxRate, discount, advance_paid: advancePaid,
        subtotal: r2(subtotal), tax_amount: taxAmount, total, balance, notes: str(x.notes, 1500, { name: 'Notes' }),
      };
      const at = nowIso();
      if (x.id) {
        const existing = await getOne('crm_invoices', x.id);
        if (!existing) throw notFound('Invoice not found.');
        if (!isAdmin && me.role !== 'accounts' && !(existing.created_by === me.id && existing.status === 'unpaid')) throw forbidden('You can only edit your own unpaid invoices.');
        const row = { ...existing, ...base, updated_at: at };
        await upsert('crm_invoices', row);
        await notify(await salesStaffIds(), 'invoice', row.id, `${me.name || 'Someone'} updated invoice ${row.invoice_no} (${currency} ${total}).`, me.id);
        return res.status(200).json({ ok: true, invoice: mapInvoice(row) });
      }
      const invoiceNo = await supabaseFetch('/rpc/crm_next_invoice_no', { method: 'POST', body: '{}' });
      const row = { id: id('inv'), invoice_no: String(invoiceNo), created_by: me.id, status: 'unpaid', created_at: at, updated_at: at, ...base };
      await upsert('crm_invoices', row);
      await notify(await salesStaffIds(), 'invoice', row.id, `${me.name || 'An employee'} generated invoice ${row.invoice_no} for ${base.customer_name} (${currency} ${total}).`, me.id);
      return res.status(200).json({ ok: true, invoice: mapInvoice(row) });
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

    if (action === 'invoice_delete') {
      if (!isAdmin) throw forbidden('Only an administrator can delete an invoice. You can cancel it instead.');
      const existing = await getOne('crm_invoices', body.id);
      if (!existing) throw notFound('Invoice not found.');
      await supabaseFetch(`/crm_invoices?id=eq.${encodeURIComponent(existing.id)}`, { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action', code: 'BAD_REQUEST' });
  } catch (err) {
    if (!(err instanceof HttpError)) console.error('crm api error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'CRM request failed', code: err.code });
  }
}
