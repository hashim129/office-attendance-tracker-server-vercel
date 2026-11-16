// CRM API (travel agency): customers, follow-ups/tasks, CEO meetings, notifications.
// Self-contained: only reads the employees table and its own crm_* tables.
// Every call needs the signed-in person's token; what they may do is decided here from the database, never from the browser.
import crypto from 'node:crypto';
import { isSupabaseConfigured, supabaseFetch } from './_supabase.js';
import { getSessionEmployee } from './_session.js';

const KINDS = ['meeting', 'corporate', 'internal'];
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
  createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
});
const mapFollowup = (r) => ({
  id: r.id, customerId: r.customer_id, kind: r.kind, assignedTo: r.assigned_to, remarks: r.remarks || '', dueAt: r.due_at,
  status: r.status, outcomeRemarks: r.outcome_remarks || '', history: asArray(r.history), createdBy: r.created_by,
  createdAt: r.created_at, updatedAt: r.updated_at, completedAt: r.completed_at,
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
    const { action } = body;

    // ------------------------------------------------------------------ reading
    if (action === 'list' || action === 'badges') {
      const [followups, meetings, notifs] = await Promise.all([getAll('crm_followups'), getAll('crm_meetings'), getAll('crm_notifications')]);
      const mine = notifs.filter((n) => n.employee_id === me.id && !n.read_at);
      const myOpen = followups.filter((f) => f.assigned_to === me.id && OPEN.includes(f.status));
      const pendingApprovals = meetings.filter((m) => m.status === 'pending_approval').length;
      const badges = {
        tasksOpen: myOpen.length,
        tasksNew: mine.filter((n) => n.category === 'followup').length,
        meetingsNew: mine.filter((n) => n.category === 'meeting').length,
        meetingsPending: isAdmin ? pendingApprovals : 0,
      };
      if (action === 'badges') return res.status(200).json({ ok: true, badges });

      const customers = (await getAll('crm_customers')).filter((c) => !c.deleted_at).map(mapCustomer);
      const visibleFollowups = followups.filter((f) => isAdmin || f.assigned_to === me.id || f.created_by === me.id).map(mapFollowup);
      const since = Date.now() - 45 * 24 * 3600 * 1000;
      const visibleMeetings = meetings
        .filter((m) => Date.parse(m.end_at) >= since)
        .filter((m) => isAdmin || !['pending_approval', 'rejected'].includes(m.status) || m.requested_by === me.id)
        .map(mapMeeting);
      return res.status(200).json({
        ok: true, me: { id: me.id, role: me.role }, customers, followups: visibleFollowups, meetings: visibleMeetings,
        unread: mine.map((n) => ({ id: n.id, category: n.category, refId: n.ref_id, message: n.message, createdAt: n.created_at })), badges,
      });
    }

    if (action === 'notifications_read') {
      const cat = body.category === 'followup' || body.category === 'meeting' ? body.category : null;
      const rows = (await getAll('crm_notifications')).filter((n) => n.employee_id === me.id && !n.read_at && (!cat || n.category === cat));
      if (rows.length) await upsert('crm_notifications', rows.map((n) => ({ ...n, read_at: nowIso() })));
      return res.status(200).json({ ok: true, marked: rows.length });
    }

    // ---------------------------------------------------------------- customers
    if (action === 'customer_save') {
      const c = body.customer || {};
      const destinations = asArray(c.destinations).map((d) => str(d, 100)).filter(Boolean);
      if (destinations.length > 30) throw bad('Too many destinations (max 30).');
      const fields = {
        customer_name: str(c.customerName, 120, { required: true, name: 'Customer name' }),
        company_name: str(c.companyName, 160, { name: 'Company name' }),
        destinations,
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
      const customer = await getOne('crm_customers', f.customerId);
      if (!customer || customer.deleted_at) throw bad('Choose a customer for this follow-up.');
      await assertEmployee(String(f.assignedTo || ''), 'The employee for this follow-up');
      const fields = {
        customer_id: customer.id, kind, assigned_to: String(f.assignedTo),
        remarks: str(f.remarks, 4000, { name: 'Remarks' }), due_at: isoOrNull(f.dueAt, 'Due date'), updated_at: nowIso(),
      };
      const label = { meeting: 'Meeting follow-up', corporate: 'Corporate follow-up', internal: 'Internal follow-up' }[kind];
      if (f.id) {
        const existing = await getOne('crm_followups', f.id);
        if (!existing) throw notFound('Follow-up not found.');
        if (!isAdmin && existing.created_by !== me.id) throw forbidden('Only the person who created this follow-up (or an administrator) can change it.');
        if (!OPEN.includes(existing.status)) throw bad('This follow-up is already closed.');
        const row = { ...existing, ...fields };
        await upsert('crm_followups', row);
        if (existing.assigned_to !== fields.assigned_to) await notify([fields.assigned_to], 'followup', row.id, `${label} for ${customer.customer_name} was assigned to you.`, me.id);
        return res.status(200).json({ ok: true, followup: mapFollowup(row) });
      }
      const row = { id: id('fup'), ...fields, status: 'pending', outcome_remarks: '', history: [], created_by: me.id, created_at: nowIso(), completed_at: null };
      await upsert('crm_followups', row);
      await notify([fields.assigned_to], 'followup', row.id, `${label} for ${customer.customer_name} was assigned to you.`, me.id);
      return res.status(200).json({ ok: true, followup: mapFollowup(row) });
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
      const customer = await getOne('crm_customers', existing.customer_id);
      const words = { completed: 'completed', not_completed: 'could not be completed', rescheduled: 'was rescheduled' }[outcome];
      await notify([existing.created_by], 'followup', row.id, `Follow-up for ${customer?.customer_name || 'a customer'} ${words}.`, me.id);
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

    return res.status(400).json({ error: 'Unknown action', code: 'BAD_REQUEST' });
  } catch (err) {
    if (!(err instanceof HttpError)) console.error('crm api error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'CRM request failed', code: err.code });
  }
}
