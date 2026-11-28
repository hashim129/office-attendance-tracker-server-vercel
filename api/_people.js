// Customer extras (actions called from api/crm.js with the prefix people_):
//  - customer documents (passport, visa, CNIC, ticket ...) with expiry reminders
//  - group bookings (e.g. "Umrah Dec batch") with members, invoices and totals
//  - feedback after travel (a private link the customer opens, see publicFeedback below)
// Everything is stored as rows in crm_company. Invoices, receipts and purchases are only read, never changed.
import crypto from 'node:crypto';

const PKT_MS = 5 * 3600 * 1000;
const DAY_MS = 86400000;
const pktDate = (ms = Date.now()) => new Date(ms + PKT_MS).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && Number.isFinite(Date.parse(`${v}T00:00:00Z`));
const num = (v) => Number(v) || 0;
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const asArr = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? (() => { try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch { return []; } })() : []);
const objOf = (v) => {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const x = JSON.parse(v); return x && typeof x === 'object' && !Array.isArray(x) ? x : {}; } catch { return {}; } }
  return {};
};
const ROW_LIMIT = 2000;

export const DOC_TYPES = { passport: 'Passport', visa: 'Visa', cnic: 'CNIC', ticket: 'Ticket', other: 'Other' };
/** Same rule and size limit as the receipt proof picture (api/crm.js receipt_save), plus PDF files. */
const FILE_RE = /^data:(image\/(?:jpeg|png)|application\/pdf);base64,[A-Za-z0-9+/=]+$/;
const FILE_MAX = 2_500_000;
const REMIND_AT = [60, 30, 7];
const RATINGS = ['visa', 'hotel', 'flights', 'staff'];
const TOKEN_RE = /^[A-Za-z0-9]{24}$/;
const TOKEN_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const newToken = () => { const b = crypto.randomBytes(24); let s = ''; for (let i = 0; i < 24; i++) s += TOKEN_CHARS[b[i] % TOKEN_CHARS.length]; return s; };

const mapDoc = (r) => {
  const d = objOf(r.data);
  return {
    id: r.id, customerId: d.customerId, type: DOC_TYPES[d.type] ? d.type : 'other', typeLabel: DOC_TYPES[d.type] || 'Other', number: d.number || '', expiry: d.expiry || null,
    notes: d.notes || '', hasFile: Boolean(d.hasFile), fileType: d.fileType || '', fileName: d.fileName || '',
    createdBy: d.createdBy || null, createdByName: d.createdByName || '', createdAt: d.createdAt || r.updated_at, updatedAt: r.updated_at,
  };
};
const mapGroup = (r) => {
  const d = objOf(r.data);
  return {
    id: r.id, name: d.name || '', travelDate: d.travelDate || null, notes: d.notes || '', customerIds: asArr(d.customerIds), invoiceIds: asArr(d.invoiceIds),
    createdBy: d.createdBy || null, createdByName: d.createdByName || '', createdAt: d.createdAt || r.updated_at, updatedAt: r.updated_at,
  };
};
const cleanStars = (v, required, name, bad) => {
  if (v === undefined || v === null || v === '' || v === 0) { if (required) throw bad(`Choose ${name}.`); return null; }
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw bad(`${name} must be 1 to 5 stars.`);
  return n;
};
const mapFeedback = (r) => {
  const d = objOf(r.data);
  return { token: r.id.slice(3), invoiceId: d.invoiceId, invoiceNo: d.invoiceNo || '', customerName: d.customerName || '', phone: d.phone || '', createdBy: d.createdBy || null, createdAt: d.createdAt || r.updated_at, response: d.response || null };
};

export function createPeople(h) {
  const { supabaseFetch, upsert, getOne, notify, id, str, bad, forbidden, notFound, activeEmployees, canSeeInvoice } = h;
  const nowIso = () => new Date().toISOString();
  const rowsLike = async (prefix) => ((await supabaseFetch(`/crm_company?id=like.${prefix}-*&select=id,data,updated_at&order=updated_at.desc&limit=${ROW_LIMIT}`)) || []).filter((r) => String(r.id).startsWith(`${prefix}-`));
  const save = (rowId, data) => upsert('crm_company', { id: rowId, data, updated_at: nowIso() });
  const del = (rowId) => supabaseFetch(`/crm_company?id=eq.${encodeURIComponent(rowId)}`, { method: 'DELETE' });
  const markSent = (key) => upsert('crm_company', { id: `psent-${key}`, data: { at: nowIso() }, updated_at: nowIso() });

  async function customerFor(customerId, ctx) {
    const cid = String(customerId || '');
    if (!cid) throw bad('Choose the customer.');
    const c = await getOne('crm_customers', cid);
    if (!c || c.deleted_at) throw notFound('Customer not found.');
    if (!ctx.canSeeCust(c)) throw forbidden('This customer is not shared with you.');
    return c;
  }
  async function docRow(docId, ctx) {
    const rid = String(docId || '');
    if (!/^cdoc-[0-9a-f-]{36}$/.test(rid)) throw notFound('Document not found.');
    const row = await getOne('crm_company', rid);
    if (!row) throw notFound('Document not found.');
    const cust = await customerFor(objOf(row.data).customerId, ctx);
    return { row, cust };
  }

  // ------------------------------------------------------------ groups
  const groupStaff = (me, ctx) => ctx.isAdmin || me.role === 'accounts';
  const canSeeGroup = (g, me, ctx) => groupStaff(me, ctx) || g.createdBy === me.id;
  async function groupFor(gid, me, ctx) {
    const rid = String(gid || '');
    if (!/^grp-[0-9a-f-]{36}$/.test(rid)) throw notFound('Group not found.');
    const row = await getOne('crm_company', rid);
    if (!row) throw notFound('Group not found.');
    const g = mapGroup(row);
    if (!canSeeGroup(g, me, ctx)) throw forbidden('Only the person who made this group, Admin, the CEO or Accounts can open it.');
    return { row, g };
  }
  const inList = (ids) => `(${ids.map((x) => `"${String(x).replace(/"/g, '')}"`).join(',')})`;
  async function fetchByIds(table, ids, select) {
    const out = [];
    for (let i = 0; i < ids.length; i += 50) {
      const part = ids.slice(i, i + 50);
      if (part.length) out.push(...((await supabaseFetch(`/${table}?id=in.${encodeURIComponent(inList(part))}&select=${select}`)) || []));
    }
    return out;
  }

  // ------------------------------------------------------------ reminders
  let lastSweep = 0;
  async function sweep() {
    const gap = Date.now() - lastSweep;
    if (gap >= 0 && gap < 30 * 60 * 1000) return;
    lastSweep = Date.now();
    const today = pktDate();
    const dayRow = await getOne('crm_company', 'people-sweep-day').catch(() => null);
    if (objOf(dayRow?.data).day === today) return;
    await save('people-sweep-day', { day: today, at: nowIso() });
    const sentOf = async (keys) => new Set((await fetchByIds('crm_company', keys.map((k) => `psent-${k}`), 'id')).map((r) => r.id.slice(6)));

    // 1. documents 60, 30 and 7 days before expiry, to the customer's owner (once each)
    const docs = (await rowsLike('cdoc')).map(mapDoc).filter((d) => d.expiry && isDate(d.expiry));
    const near = [];
    for (const d of docs) {
      const left = daysBetween(today, d.expiry);
      if (left < 0 || left > 60) continue;
      const band = REMIND_AT.filter((b) => left <= b).pop();
      near.push({ d, left, key: `doc-${d.id.slice(5)}-${d.expiry}-${band}` });
    }
    const docSent = near.length ? await sentOf(near.map((x) => x.key)) : new Set();
    const due = near.filter((x) => !docSent.has(x.key));
    if (due.length) {
      const custIds = [...new Set(due.map((x) => x.d.customerId).filter(Boolean))];
      const custs = new Map((await fetchByIds('crm_customers', custIds, 'id,customer_name,created_by,deleted_at')).map((c) => [c.id, c]));
      for (const { d, left, key } of due) {
        const c = custs.get(d.customerId);
        if (c && !c.deleted_at && c.created_by) {
          const when = left === 0 ? 'today' : left === 1 ? 'tomorrow' : `in ${left} days`;
          await notify([c.created_by], 'customer', c.id, `${c.customer_name}'s ${d.typeLabel.toLowerCase()}${d.number ? ` (${d.number})` : ''} expires ${when}, on ${d.expiry}.`);
        }
        await markSent(key);
      }
    }

    // 2. trips that ended 2 to 4 days ago without a feedback link: remind the invoice creator (once per invoice)
    const invs = (await supabaseFetch(`/crm_invoices?travel_date=gte.${addDays(today, -4)}&travel_date=lte.${addDays(today, -2)}&select=id,kind,invoice_no,customer_name,status,created_by,travel_date&limit=${ROW_LIMIT}`)) || [];
    const ended = invs.filter((i) => (i.kind || 'customer') !== 'vendor' && i.status !== 'cancelled' && i.created_by);
    const askSent = ended.length ? await sentOf(ended.map((i) => `fbask-${i.id}`)) : new Set();
    const open = ended.filter((i) => !askSent.has(`fbask-${i.id}`));
    if (open.length) {
      const linked = new Set((await fetchByIds('crm_company', open.map((i) => `fbinv-${i.id}`), 'id')).map((r) => r.id.slice(6)));
      for (const i of open) {
        if (!linked.has(i.id)) await notify([i.created_by], 'invoice', i.id, `Ask ${i.customer_name} for feedback: their trip on invoice ${i.invoice_no} was on ${String(i.travel_date).slice(0, 10)}. Open the invoice and tap "Ask for feedback".`);
        await markSent(`fbask-${i.id}`);
      }
    }
  }

  // ------------------------------------------------------------ actions
  async function handle(action, body, me, ctx) {
    const staff = ctx.isAdmin || me.role === 'accounts';

    // ---------- customer documents
    if (action === 'people_docs_list') {
      await customerFor(body.customerId, ctx);
      const docs = (await rowsLike('cdoc')).map(mapDoc).filter((d) => d.customerId === String(body.customerId));
      docs.sort((a, b) => String(a.expiry || '9999').localeCompare(String(b.expiry || '9999')));
      return { docs, today: pktDate(), types: DOC_TYPES };
    }

    if (action === 'people_doc_save') {
      const x = body.doc || {};
      let existing = null;
      let cust;
      if (x.id) ({ row: existing, cust } = await docRow(x.id, ctx));
      else cust = await customerFor(x.customerId, ctx);
      const prev = objOf(existing?.data);
      const type = String(x.type || '');
      if (!DOC_TYPES[type]) throw bad('Choose the document type.');
      const expiry = x.expiry ? String(x.expiry) : '';
      if (expiry && !isDate(expiry)) throw bad('The expiry date is not a valid date.');
      const rid = existing ? existing.id : id('cdoc');
      const fileId = `cdocf-${rid.slice(5)}`;
      let hasFile = Boolean(prev.hasFile); let fileType = prev.fileType || ''; let fileName = prev.fileName || '';
      if (x.file) {
        const data = String(x.file);
        const m = FILE_RE.exec(data);
        if (!m) throw bad('The file must be a JPG, PNG or PDF.');
        if (data.length > FILE_MAX) throw bad('The file is too large. Please upload a smaller picture or PDF (under about 1.8 MB).');
        await save(fileId, { file: data, docId: rid, customerId: cust.id });
        hasFile = true; fileType = m[1]; fileName = str(x.fileName, 120, { name: 'File name' }) || (m[1] === 'application/pdf' ? 'document.pdf' : 'document.jpg');
      } else if (x.removeFile && hasFile) {
        await del(fileId);
        hasFile = false; fileType = ''; fileName = '';
      }
      const data = {
        customerId: cust.id, type, number: str(x.number, 60, { name: 'Document number' }), expiry: expiry || null, notes: str(x.notes, 600, { name: 'Notes' }),
        hasFile, fileType, fileName, createdBy: prev.createdBy || me.id, createdByName: prev.createdByName || me.name || '', createdAt: prev.createdAt || nowIso(), updatedBy: me.id,
      };
      await save(rid, data);
      return { doc: mapDoc({ id: rid, data, updated_at: nowIso() }) };
    }

    if (action === 'people_doc_delete') {
      const { row, cust } = await docRow(body.id, ctx);
      const d = objOf(row.data);
      if (!(ctx.seeAllCust || d.createdBy === me.id || cust.created_by === me.id)) throw forbidden('Only the person who added this document, the customer owner, Admin, the CEO or Accounts can delete it.');
      await del(row.id);
      await del(`cdocf-${row.id.slice(5)}`).catch(() => null);
      return {};
    }

    if (action === 'people_doc_file') {
      const { row } = await docRow(body.id, ctx);
      const f = await getOne('crm_company', `cdocf-${row.id.slice(5)}`);
      const d = objOf(row.data);
      return { file: objOf(f?.data).file || null, fileType: d.fileType || '', fileName: d.fileName || '' };
    }

    if (action === 'people_docs_expiring') {
      const days = Math.max(1, Math.min(365, Math.round(num(body.days) || 60)));
      const today = pktDate();
      const until = addDays(today, days);
      const docs = (await rowsLike('cdoc')).map(mapDoc).filter((d) => d.expiry && isDate(d.expiry) && d.expiry <= until);
      if (!docs.length) return { docs: [], today, days };
      const custIds = [...new Set(docs.map((d) => d.customerId).filter(Boolean))];
      const custs = new Map((await fetchByIds('crm_customers', custIds, '*')).filter((c) => !c.deleted_at && ctx.canSeeCust(c)).map((c) => [c.id, c]));
      const out = docs.filter((d) => custs.has(d.customerId)).map((d) => ({ ...d, customerName: custs.get(d.customerId).customer_name, customerPhone: custs.get(d.customerId).customer_number || '', daysLeft: daysBetween(today, d.expiry), expired: d.expiry < today }));
      out.sort((a, b) => a.expiry.localeCompare(b.expiry));
      return { docs: out, today, days };
    }

    // ---------- group bookings
    if (action === 'people_group_list') {
      const groups = (await rowsLike('grp')).map(mapGroup).filter((g) => canSeeGroup(g, me, ctx));
      groups.sort((a, b) => String(a.travelDate || '9999').localeCompare(String(b.travelDate || '9999')) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return { groups, canCreate: ctx.canSales, today: pktDate() };
    }

    if (action === 'people_group_save') {
      const x = body.group || {};
      let prev = null;
      if (x.id) prev = (await groupFor(x.id, me, ctx)).g;
      else if (!ctx.canSales) throw forbidden('Group bookings need sales access. Ask Admin to switch it on for you.');
      const name = str(x.name, 120, { required: true, name: 'Group name' });
      const travelDate = x.travelDate ? String(x.travelDate) : '';
      if (travelDate && !isDate(travelDate)) throw bad('The travel date is not a valid date.');
      const cleanIds = (v, max, label) => {
        const list = [...new Set(asArr(v).map((s) => String(s || '').trim()).filter(Boolean))];
        if (list.length > max) throw bad(`A group can have at most ${max} ${label}.`);
        if (list.some((s) => !/^[A-Za-z0-9_-]{1,80}$/.test(s))) throw bad('Bad request.');
        return list;
      };
      const customerIds = cleanIds(x.customerIds, 300, 'members');
      const invoiceIds = cleanIds(x.invoiceIds, 300, 'invoices');
      // newly added members and invoices must be ones this person can see
      const newCust = customerIds.filter((c) => !prev?.customerIds.includes(c));
      if (newCust.length) {
        const found = new Map((await fetchByIds('crm_customers', newCust, '*')).map((c) => [c.id, c]));
        for (const c of newCust) {
          const row = found.get(c);
          if (!row || row.deleted_at) throw bad('One of the members was not found. Refresh and try again.');
          if (!ctx.canSeeCust(row)) throw forbidden(`${row.customer_name} is not shared with you.`);
        }
      }
      const newInv = invoiceIds.filter((i) => !prev?.invoiceIds.includes(i));
      if (newInv.length) {
        const found = new Map((await fetchByIds('crm_invoices', newInv, 'id,kind,invoice_no,status,created_by,sale_by,tagged')).map((r) => [r.id, r]));
        for (const i of newInv) {
          const row = found.get(i);
          if (!row || row.kind === 'vendor') throw bad('One of the invoices was not found. Refresh and try again.');
          if (!canSeeInvoice(row, me, staff)) throw forbidden(`Invoice ${row.invoice_no} is not one of yours.`);
        }
      }
      const rid = prev ? prev.id : id('grp');
      const data = {
        name, travelDate: travelDate || null, notes: str(x.notes, 1000, { name: 'Notes' }), customerIds, invoiceIds,
        createdBy: prev?.createdBy || me.id, createdByName: prev?.createdByName || me.name || '', createdAt: prev?.createdAt || nowIso(), updatedBy: me.id,
      };
      await save(rid, data);
      return { group: mapGroup({ id: rid, data, updated_at: nowIso() }) };
    }

    if (action === 'people_group_delete') {
      const { g } = await groupFor(body.id, me, ctx);
      await del(g.id);
      return {};
    }

    if (action === 'people_group_detail') {
      const { g } = await groupFor(body.id, me, ctx);
      const [custs, invs] = await Promise.all([
        fetchByIds('crm_customers', g.customerIds, 'id,customer_name,company_name,customer_number,deleted_at'),
        fetchByIds('crm_invoices', g.invoiceIds, 'id,kind,invoice_no,customer_name,customer_phone,currency,total,balance,status,travel_date,created_by'),
      ]);
      const cmap = new Map(custs.map((c) => [c.id, c]));
      const imap = new Map(invs.map((i) => [i.id, i]));
      const members = g.customerIds.map((cid) => cmap.get(cid)).filter((c) => c && !c.deleted_at)
        .map((c) => ({ id: c.id, name: c.customer_name, companyName: c.company_name || '', phone: c.customer_number || '' }));
      const invoices = g.invoiceIds.map((iid) => imap.get(iid)).filter(Boolean).map((i) => {
        const cancelled = i.status === 'cancelled';
        const total = num(i.total);
        const balance = i.status === 'paid' ? 0 : num(i.balance);
        return { id: i.id, invoiceNo: i.invoice_no, customerName: i.customer_name, customerPhone: i.customer_phone || '', currency: i.currency || 'PKR', total, received: r2(Math.max(0, total - balance)), balance: r2(balance), status: i.status, cancelled, travelDate: i.travel_date || null };
      });
      const totals = {};
      for (const i of invoices) {
        if (i.cancelled) continue;
        const t = (totals[i.currency] ||= { currency: i.currency, total: 0, received: 0, balance: 0, count: 0 });
        t.total = r2(t.total + i.total); t.received = r2(t.received + i.received); t.balance = r2(t.balance + i.balance); t.count += 1;
      }
      return { group: g, members, invoices, totals: Object.values(totals) };
    }

    // ---------- feedback after travel
    if (action === 'people_feedback_link') {
      const inv = await getOne('crm_invoices', String(body.invoiceId || ''));
      if (!inv || inv.kind === 'vendor') throw notFound('Invoice not found.');
      if (!canSeeInvoice(inv, me, staff)) throw forbidden('You can only ask for feedback on your own invoices.');
      if (inv.status === 'cancelled') throw bad('This invoice is cancelled.');
      const origin = String(body.origin || '').replace(/\/+$/, '');
      if (!/^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(origin)) throw bad('Could not make the link. Please open the app from its https address and try again.');
      const idx = objOf((await getOne('crm_company', `fbinv-${inv.id}`))?.data).token;
      const existing = TOKEN_RE.test(String(idx || '')) ? await getOne('crm_company', `fb-${idx}`) : null;
      let token;
      if (existing) token = existing.id.slice(3);
      else {
        token = newToken();
        await save(`fb-${token}`, { invoiceId: inv.id, invoiceNo: inv.invoice_no, customerName: inv.customer_name, phone: inv.customer_phone || '', createdBy: me.id, createdAt: nowIso(), response: null });
        await save(`fbinv-${inv.id}`, { token });
      }
      return { token, url: `${origin}/?feedback=${token}`, submitted: Boolean(existing && objOf(existing.data).response) };
    }

    if (action === 'people_feedback_list') {
      const rows = (await rowsLike('fb')).map(mapFeedback);
      let visible = rows;
      if (!ctx.isAdmin) {
        const invIds = [...new Set(rows.map((r) => r.invoiceId).filter(Boolean))];
        const invs = new Map((await fetchByIds('crm_invoices', invIds, 'id,created_by,sale_by,tagged')).map((i) => [i.id, i]));
        visible = rows.filter((r) => r.createdBy === me.id || canSeeInvoice(invs.get(r.invoiceId), me, false));
      }
      const answered = visible.filter((r) => r.response).sort((a, b) => String(b.response.at).localeCompare(String(a.response.at)));
      const avg = (key) => { const v = answered.map((r) => r.response[key]).filter((n) => Number.isFinite(n) && n > 0); return v.length ? { avg: r2(v.reduce((a, n) => a + n, 0) / v.length), count: v.length } : { avg: null, count: 0 }; };
      const names = new Map(((await activeEmployees()) || []).map((e) => [e.id, e.name]));
      return {
        responses: answered.map((r) => ({ ...r, createdByName: names.get(r.createdBy) || '' })),
        waiting: visible.filter((r) => !r.response).length, sent: visible.length,
        averages: { overall: avg('overall'), ...Object.fromEntries(RATINGS.map((k) => [k, avg(k)])) },
        seesAll: Boolean(ctx.isAdmin),
      };
    }
    return null;
  }

  return { handle, sweep };
}

/**
 * Public feedback page (called from api/public-customers.js, no sign-in): feedback_get and feedback_submit.
 * deps = { supabaseFetch, pushNotificationRows }. Returns { status, body, headers? }.
 */
export async function publicFeedback(body, clientIp, deps) {
  const { supabaseFetch, pushNotificationRows } = deps;
  const at = new Date().toISOString();
  const nowMs = Date.now();
  const fail = (status, error, message) => ({ status, body: { ok: false, error, message } });
  const upsertCompany = (row) => supabaseFetch('/crm_company?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify([row]) });

  // the same per-IP fixed window as the portal lookups (20 requests / 5 minutes)
  const rlId = `rl_fb_${crypto.createHash('sha256').update(String(clientIp || 'unknown')).digest('hex').slice(0, 24)}`;
  const rl = objOf((await supabaseFetch(`/crm_company?id=eq.${encodeURIComponent(rlId)}&select=data`))?.[0]?.data);
  const start = Number(rl.windowStart);
  const inWindow = Number.isFinite(start) && start > 0 && nowMs - start < 5 * 60 * 1000;
  const windowStart = inWindow ? start : nowMs;
  const count = inWindow ? Math.max(0, Number(rl.count) || 0) : 0;
  if (count >= 20) {
    const retryAfterSec = Math.max(1, Math.ceil((windowStart + 5 * 60 * 1000 - nowMs) / 1000));
    return { status: 429, headers: { 'Retry-After': String(retryAfterSec) }, body: { ok: false, error: 'RATE_LIMITED', retryAfterSec, message: `Too many requests. Please wait ${retryAfterSec} seconds and try again.` } };
  }
  await upsertCompany({ id: rlId, data: { count: count + 1, windowStart, updatedAt: at }, updated_at: at });

  const token = String(body.token || '');
  if (!TOKEN_RE.test(token)) return fail(404, 'NOT_FOUND', 'This feedback link is not valid.');
  const row = (await supabaseFetch(`/crm_company?id=eq.fb-${token}&select=id,data,updated_at`))?.[0];
  if (!row) return fail(404, 'NOT_FOUND', 'This feedback link is not valid.');
  const d = objOf(row.data);
  const firstName = String(d.customerName || '').trim().split(/\s+/)[0] || '';

  if (body.action === 'feedback_get') {
    return { status: 200, body: { ok: true, customerName: firstName, submitted: Boolean(d.response), brand: { name: 'Bahaar Journeys', logo: '/bahaar-logo.png' } } };
  }
  if (body.action !== 'feedback_submit') return fail(400, 'INVALID_ACTION', 'Unsupported action.');
  if (d.response) return fail(409, 'ALREADY_SUBMITTED', 'Thank you, your feedback for this trip has already been received.');
  const badErr = (m) => Object.assign(new Error(m), { publicBad: true });
  let response;
  try {
    response = { overall: cleanStars(body.overall, true, 'an overall rating', badErr) };
    for (const k of RATINGS) response[k] = cleanStars(body[k], false, k, badErr);
  } catch (e) {
    if (e.publicBad) return fail(400, 'INVALID', e.message);
    throw e;
  }
  const comment = String(body.comment ?? '').trim();
  if (comment.length > 1000) return fail(400, 'INVALID', 'Please keep your comment under 1000 characters.');
  response.comment = comment;
  response.at = at;
  await upsertCompany({ id: row.id, data: { ...d, response }, updated_at: at });
  // tell the person who sent the link
  if (d.createdBy) {
    const n = { id: `ntf-${crypto.randomUUID()}`, employee_id: d.createdBy, category: 'invoice', ref_id: d.invoiceId || row.id, message: `${d.customerName || 'A customer'} rated their trip ${response.overall} of 5${comment ? `: “${comment.slice(0, 120)}${comment.length > 120 ? '…' : ''}”` : '.'}`, created_at: at, read_at: null };
    try {
      await supabaseFetch('/crm_notifications', { method: 'POST', body: JSON.stringify([n]) });
      if (pushNotificationRows) await pushNotificationRows([n]);
    } catch (e) { console.error('feedback notify failed', e?.message); }
  }
  return { status: 200, body: { ok: true, submitted: true } };
}
