// Books add-on (actions books_*, routed from api/crm.js):
//   quotations (QT-0001...), vendor ledger, cash & bank book, overdue customer invoices (+ morning reminders).
// It only READS invoices, receipts and purchases. Its own records live in crm_company rows:
//   quote-<uuid>            a quotation
//   quote-counter           { n } last quotation number
//   books-od-sent-<invId>   { at } last overdue reminder for that invoice
//   books-od-day-<date>     { at, count } the morning overdue run for that day is done

const PKT_MS = 5 * 3600 * 1000;
const pktDay = (ms = Date.now()) => new Date(ms + PKT_MS).toISOString().slice(0, 10);
const pktDayOf = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? pktDay(t) : ''; };
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && Number.isFinite(Date.parse(`${v}T00:00:00Z`));
const dayDiff = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
const num = (v) => Number(v) || 0;
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const asArray = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? (() => { try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch { return []; } })() : []);
const fmt = (n) => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const QUOTE_ID = /^quote-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const vendorKey = (name) => String(name || '').toLowerCase().replace(/\s+/g, '');
const add = (obj, cur, v) => { obj[cur] = r2((obj[cur] || 0) + v); };

/** Which money account a payment went through. Cards and third-party payments are "other". */
const accountOfMethod = (m) => {
  const x = String(m || '').toLowerCase();
  if (x === 'cash') return 'cash';
  if (x === 'bank' || x === 'bank_transfer' || x === 'online') return 'bank';
  return 'other';
};
const METHOD_LABEL = { cash: 'Cash', bank_transfer: 'Bank transfer', card: 'Card', faiq_card: 'Card (Faiq)', ali_card: 'Card (Ali)', third_party: 'Third party', other: 'Other' };
const CAT_LABEL = { ticket: 'Ticket', hotel: 'Hotel', visa: 'Visa', tour: 'Tours & Transfers', insurance: 'Insurance', other: 'Other' };

export function createBooks(h) {
  const { supabaseFetch, upsert, getOne, notify, id, str, bad, forbidden, notFound, parseJsonObj, activeEmployees, fxRates, toPkr, canSeeInvoice } = h;
  const isBooks = (me) => ['admin', 'ceo', 'accounts'].includes(me?.role);
  const needBooks = (me) => { if (!isBooks(me)) throw forbidden('Only Admin, the CEO or Accounts can open this page.'); };

  // ------------------------------------------------------------------ quotations
  const mapQuote = (row) => ({ ...parseJsonObj(row.data, {}), id: row.id, updatedAt: row.updated_at || null });
  async function allQuotes() {
    const rows = (await supabaseFetch('/crm_company?id=like.quote-*&select=id,data,updated_at&order=updated_at.desc&limit=2000')) || [];
    return rows.filter((r) => QUOTE_ID.test(r.id)).map(mapQuote).filter((q) => q.quoteNo);
  }
  async function oneQuote(qid) {
    if (!QUOTE_ID.test(String(qid || ''))) throw notFound('Quotation not found.');
    const row = await getOne('crm_company', qid);
    const q = row ? mapQuote(row) : null;
    if (!q || !q.quoteNo) throw notFound('Quotation not found.');
    return q;
  }
  const canSeeQuote = (q, me) => isBooks(me) || q.createdBy === me.id;
  async function saveQuote(q) {
    const at = new Date().toISOString();
    const { id: qid, updatedAt, ...data } = q;
    await upsert('crm_company', { id: qid, data: { ...data, updatedAt: at }, updated_at: at });
    return { ...q, updatedAt: at };
  }
  async function nextQuoteNo() {
    const row = await getOne('crm_company', 'quote-counter').catch(() => null);
    let n = Math.max(0, Math.floor(num(parseJsonObj(row?.data, {}).n)));
    // never reuse a number, even if the counter row was lost
    if (!row) for (const q of await allQuotes()) n = Math.max(n, Number(String(q.quoteNo).replace(/\D/g, '')) || 0);
    n += 1;
    await upsert('crm_company', { id: 'quote-counter', data: { n }, updated_at: new Date().toISOString() });
    return `QT-${String(n).padStart(4, '0')}`;
  }
  const logLine = (me, text) => ({ at: new Date().toISOString(), by: me.id, byName: me.name || '', text: String(text).slice(0, 400) });
  function summaryOf(list) {
    const per = {};
    for (const q of list) {
      if (q.status !== 'approved') continue;
      const c = (per[q.currency] ||= { currency: q.currency, approvedOpen: 0, count: 0 });
      c.approvedOpen = r2(c.approvedOpen + num(q.total)); c.count += 1;
    }
    return Object.values(per).sort((a, b) => b.approvedOpen - a.approvedOpen);
  }
  function cleanQuote(x) {
    const currency = String(x.currency || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw bad('Choose the currency.');
    const money = (v, label) => {
      const n = Number(v === '' || v === null || v === undefined ? 0 : v);
      if (!Number.isFinite(n) || n < 0 || n > 9999999999) throw bad(`${label} is not a valid amount.`);
      return r2(n);
    };
    const lines = asArray(x.lines).slice(0, 60).map((l, i) => {
      const description = str(l?.description, 300, { name: `Line ${i + 1} description` });
      const blank = !description && (l?.unitPrice === '' || l?.unitPrice === undefined || l?.unitPrice === null);
      if (blank) return null;
      if (!description) throw bad(`Write what line ${i + 1} is for.`);
      const units = l?.units === '' || l?.units === undefined || l?.units === null ? 1 : money(l.units, `Units of "${description}"`);
      const unitPrice = money(l?.unitPrice, `Price of "${description}"`);
      return { description, units, unitPrice, amount: r2(units * unitPrice) };
    }).filter(Boolean);
    if (!lines.length) throw bad('Add at least one line to the quotation.');
    const subtotal = r2(lines.reduce((a, l) => a + l.amount, 0));
    const discount = money(x.discount, 'Discount');
    if (discount > subtotal) throw bad('The discount is larger than the quotation total.');
    const dateOpt = (v, name) => { const d = String(v || '').slice(0, 10); if (!d) return null; if (!isDate(d)) throw bad(`${name} is not a valid date.`); return d; };
    return {
      customerName: str(x.customerName, 160, { required: true, name: 'Customer name' }),
      customerPhone: str(x.customerPhone, 60, { name: 'Phone' }),
      customerId: x.customerId ? String(x.customerId).slice(0, 80) : null,
      currency, lines, subtotal, discount, total: r2(subtotal - discount),
      notes: str(x.notes, 1500, { name: 'Notes' }),
      validUntil: dateOpt(x.validUntil, 'Valid until'),
      travelDate: dateOpt(x.travelDate, 'Travel date'),
    };
  }

  async function quoteAction(action, body, me, ctx) {
    if (!ctx.canSales) throw forbidden('Quotations are part of Sales. Ask an administrator to switch Sales on for you.');
    if (action === 'books_quote_list' || action === 'books_quote_summary') {
      const list = (await allQuotes()).filter((q) => canSeeQuote(q, me));
      if (action === 'books_quote_summary') return { currencies: summaryOf(list) };
      return { quotes: list, seeAll: isBooks(me), approvedOpen: summaryOf(list), today: pktDay() };
    }
    if (action === 'books_quote_customers') {
      const rows = (await supabaseFetch('/crm_customers?deleted_at=is.null&select=id,customer_name,customer_number,created_by,shared_with&limit=5000')) || [];
      return { customers: rows.filter((c) => ctx.canSeeCust(c)).map((c) => ({ id: c.id, name: c.customer_name || '', phone: c.customer_number || '' })).slice(0, 3000) };
    }
    if (action === 'books_quote_save') {
      const x = body.quote || {};
      const existing = x.id ? await oneQuote(x.id) : null;
      if (existing && !canSeeQuote(existing, me)) throw forbidden('You can only change your own quotations.');
      if (existing && existing.status === 'converted') throw bad('This quotation is already an invoice, so it cannot be changed.');
      const clean = cleanQuote(x);
      if (clean.customerId) {
        const c = await getOne('crm_customers', clean.customerId).catch(() => null);
        if (!c || c.deleted_at || !ctx.canSeeCust(c)) throw bad('That customer was not found. Pick one from the list or leave it empty.');
      }
      const at = new Date().toISOString();
      if (existing) {
        const q = await saveQuote({ ...existing, ...clean, log: [...asArray(existing.log), logLine(me, 'Edited')].slice(-100) });
        return { quote: q };
      }
      const q = await saveQuote({
        id: id('quote'), quoteNo: await nextQuoteNo(), ...clean, status: 'draft', statusReason: '',
        createdBy: me.id, createdByName: me.name || '', createdAt: at, invoiceId: null, invoiceNo: null, convertedAt: null,
        log: [logLine(me, 'Created')],
      });
      return { quote: q };
    }
    if (action === 'books_quote_status') {
      const q = await oneQuote(body.id);
      if (!canSeeQuote(q, me)) throw forbidden('You can only change your own quotations.');
      if (q.status === 'converted') throw bad('This quotation is already an invoice.');
      const status = String(body.status || '');
      if (!['draft', 'sent', 'approved', 'declined'].includes(status)) throw bad('Choose Sent, Approved or Declined.');
      const reason = str(body.reason, 400, { name: 'Reason' });
      const saved = await saveQuote({ ...q, status, statusReason: reason, statusAt: new Date().toISOString(), statusBy: me.id,
        log: [...asArray(q.log), logLine(me, `Marked ${status}${reason ? `: ${reason}` : ''}`)].slice(-100) });
      if (q.createdBy && q.createdBy !== me.id) {
        await notify([q.createdBy], 'sale', q.id, `${me.name || 'Someone'} marked your quotation ${q.quoteNo} (${q.customerName}) as ${status}${reason ? `: ${reason}` : ''}.`, me.id);
      }
      return { quote: saved };
    }
    if (action === 'books_quote_delete') {
      const q = await oneQuote(body.id);
      if (q.status === 'converted') throw bad('This quotation is already an invoice, so it cannot be deleted.');
      if (!ctx.isAdmin && q.createdBy !== me.id) throw forbidden('Only the person who made it (or Admin) can delete this quotation.');
      await supabaseFetch(`/crm_company?id=eq.${encodeURIComponent(q.id)}`, { method: 'DELETE' });
      return { deleted: q.id };
    }
    if (action === 'books_quote_converted') {
      const q = await oneQuote(body.id);
      if (!canSeeQuote(q, me)) throw forbidden('You can only change your own quotations.');
      const invoiceId = str(body.invoiceId, 120, { required: true, name: 'Invoice' });
      if (q.status === 'converted') {
        if (q.invoiceId === invoiceId) return { quote: q };
        throw bad(`This quotation is already invoice ${q.invoiceNo || ''}.`.replace(' .', '.'));
      }
      const inv = await getOne('crm_invoices', invoiceId).catch(() => null);
      if (!inv || inv.kind === 'vendor') throw bad('That invoice was not found.');
      const saved = await saveQuote({ ...q, status: 'converted', invoiceId, invoiceNo: String(inv.invoice_no || body.invoiceNo || ''), convertedAt: new Date().toISOString(), convertedBy: me.id,
        log: [...asArray(q.log), logLine(me, `Turned into invoice ${inv.invoice_no || ''}`)].slice(-100) });
      return { quote: saved };
    }
    return null;
  }

  // ------------------------------------------------------------------ shared readers
  async function purchases() {
    const rows = (await supabaseFetch('/crm_company?id=like.pur-*&select=id,data,updated_at&order=updated_at.desc&limit=5000')) || [];
    return rows.map((r) => ({ ...parseJsonObj(r.data, {}), id: r.id })).filter((p) => p.purchaseNo && p.status !== 'cancelled' && !p.deleted);
  }
  async function vendorBills() {
    const rows = (await supabaseFetch('/crm_invoices?kind=eq.vendor&select=*&limit=5000')) || [];
    return rows.filter((r) => r.kind === 'vendor' && r.status !== 'cancelled');
  }
  /** Payments made on a vendor bill: the `payments` list, or the whole bill on the day it was marked paid. */
  function billPayments(b) {
    const list = asArray(b.payments).filter((p) => p && num(p.amount) > 0).map((p) => ({
      date: isDate(p.date) ? p.date : pktDayOf(p.at) || pktDayOf(b.updated_at), amount: r2(num(p.amount)), method: p.method || '', note: p.note || '',
    }));
    const sum = r2(list.reduce((a, p) => a + p.amount, 0));
    if (b.status === 'paid' && sum < num(b.total)) {
      list.push({ date: pktDayOf(b.payment_received_at) || pktDayOf(b.updated_at) || String(b.invoice_date || '').slice(0, 10), amount: r2(num(b.total) - sum), method: '', note: 'Marked paid' });
    }
    return list;
  }
  /** Day a paid purchase item was paid: its own date if it has one, else when the purchase was marked paid, else the purchase date. */
  function purchasePaidDay(p, it) {
    for (const k of ['paidAt', 'paidDate', 'paymentDate']) { const d = String(it?.[k] || '').slice(0, 10); if (isDate(d)) return d; }
    if (p.status === 'paid' && (!it.paidByMethod || it.paidByMethod === 'unpaid')) {
      const hit = asArray(p.editLog).filter((e) => /payment status: paid/i.test(String(e?.text || ''))).pop();
      if (hit?.at) return pktDayOf(hit.at);
    }
    const d = String(p.purchaseDate || '').slice(0, 10);
    return isDate(d) ? d : pktDayOf(p.createdAt);
  }
  const itemPaid = (p, it) => p.status === 'paid' || (it.paidByMethod && it.paidByMethod !== 'unpaid');
  const itemText = (p, it) => {
    const cat = it.categoryLabel || CAT_LABEL[it.category] || 'Item';
    const what = it.ticketNumber || it.hotelName || it.visaType || it.tourDescription || it.insuranceType || it.description || '';
    return `${cat}${what ? `: ${what}` : ''} · ${p.customerName || ''} (${p.purchaseNo}${p.invoiceNo ? `, invoice ${p.invoiceNo}` : ''})`;
  };

  // ------------------------------------------------------------------ vendor ledger
  async function vendorLedger() {
    const [bills, purs, fx] = await Promise.all([vendorBills(), purchases(), fxRates().catch(() => null)]);
    const vendors = new Map();
    const vend = (name) => {
      const key = vendorKey(name);
      if (!key) return null;
      if (!vendors.has(key)) vendors.set(key, { key, name: String(name).trim().replace(/\s+/g, ' '), names: new Set(), per: {}, entries: [] });
      const v = vendors.get(key); v.names.add(String(name).trim().replace(/\s+/g, ' '));
      return v;
    };
    const cur = (v, c) => (v.per[c] ||= { currency: c, booked: 0, paid: 0, owed: 0 });
    for (const b of bills) {
      const v = vend(b.customer_name); if (!v) continue;
      const c = String(b.currency || 'PKR').toUpperCase(); const total = r2(num(b.total));
      const pays = billPayments(b); const paid = Math.min(total, r2(pays.reduce((a, p) => a + p.amount, 0)));
      const pc = cur(v, c); pc.booked = r2(pc.booked + total); pc.paid = r2(pc.paid + paid);
      v.entries.push({ date: String(b.invoice_date || '').slice(0, 10) || pktDayOf(b.created_at), kind: 'booked', source: 'bill', ref: b.invoice_no, refId: b.id, text: `Vendor bill ${b.invoice_no}${b.notes ? ` · ${String(b.notes).slice(0, 80)}` : ''}`, currency: c, amount: total, dueDate: b.due_date || null });
      for (const p of pays) v.entries.push({ date: p.date, kind: 'paid', source: 'bill', ref: b.invoice_no, refId: b.id, text: `Paid on bill ${b.invoice_no}${p.method ? ` (${METHOD_LABEL[p.method] || p.method})` : ''}${p.note && p.note !== 'Marked paid' ? ` · ${p.note}` : ''}`, currency: c, amount: Math.min(p.amount, total) });
    }
    for (const p of purs) {
      for (const it of asArray(p.items)) {
        const v = vend(it.vendorName); if (!v) continue;
        const c = String(it.currency || p.currency || 'PKR').toUpperCase(); const amt = r2(num(it.payable));
        if (!amt) continue;
        const pc = cur(v, c); pc.booked = r2(pc.booked + amt);
        const day = String(p.purchaseDate || '').slice(0, 10) || pktDayOf(p.createdAt);
        v.entries.push({ date: day, kind: 'booked', source: 'purchase', ref: p.purchaseNo, refId: p.id, text: itemText(p, it), currency: c, amount: amt, dueDate: it.paymentDueDate || null });
        if (itemPaid(p, it)) {
          pc.paid = r2(pc.paid + amt);
          v.entries.push({ date: purchasePaidDay(p, it), kind: 'paid', source: 'purchase', ref: p.purchaseNo, refId: p.id, text: `Paid${it.paidByMethod && it.paidByMethod !== 'unpaid' ? ` by ${METHOD_LABEL[it.paidByMethod] || it.paidByMethod}` : ''} · ${p.purchaseNo}`, currency: c, amount: amt });
        }
      }
    }
    const list = [...vendors.values()].map((v) => {
      const currencies = Object.values(v.per).map((c) => ({ ...c, owed: r2(Math.max(0, c.booked - c.paid)) })).sort((a, b) => b.owed - a.owed);
      v.entries.sort((a, b) => String(a.date).localeCompare(String(b.date)) || (a.kind === 'booked' ? -1 : 1));
      const run = {};
      const entries = v.entries.map((e) => { add(run, e.currency, e.kind === 'booked' ? e.amount : -e.amount); return { ...e, balance: run[e.currency] }; });
      const owedPkr = r2(currencies.reduce((a, c) => a + (toPkr(c.owed, c.currency, fx) ?? c.owed), 0));
      return { key: v.key, name: v.name, otherNames: [...v.names].filter((n) => n !== v.name), currencies, owedPkr, entries, lastDate: entries.length ? entries[entries.length - 1].date : null };
    }).sort((a, b) => b.owedPkr - a.owedPkr || a.name.localeCompare(b.name));
    const totals = {};
    for (const v of list) for (const c of v.currencies) { const t = (totals[c.currency] ||= { currency: c.currency, booked: 0, paid: 0, owed: 0 }); t.booked = r2(t.booked + c.booked); t.paid = r2(t.paid + c.paid); t.owed = r2(t.owed + c.owed); }
    return { vendors: list, totals: Object.values(totals).sort((a, b) => b.owed - a.owed), today: pktDay() };
  }

  // ------------------------------------------------------------------ cash & bank book
  async function cashbook(body) {
    const today = pktDay();
    const from = isDate(body.from) ? body.from : `${today.slice(0, 7)}-01`;
    const to = isDate(body.to) ? body.to : today;
    if (to < from) throw bad('The end date is before the start date.');
    const account = ['cash', 'bank'].includes(body.account) ? body.account : 'all';
    const [receipts, bills, purs] = await Promise.all([
      supabaseFetch('/crm_receipts?select=id,receipt_no,client_name,query_code,currency,amount_received,method,bank_name,created_at&limit=10000').then((r) => r || []),
      vendorBills(), purchases(),
    ]);
    const moves = [];
    for (const r of receipts) {
      const amt = r2(num(r.amount_received)); if (!(amt > 0)) continue;
      moves.push({ date: pktDayOf(r.created_at), dir: 'in', account: r.method === 'bank' ? 'bank' : 'cash', currency: String(r.currency || 'PKR').toUpperCase(), amount: amt, ref: r.receipt_no, refId: r.id, source: 'receipt', text: `Receipt ${r.receipt_no} · ${r.client_name || ''}${r.method === 'bank' && r.bank_name ? ` (${r.bank_name})` : ''}` });
    }
    for (const b of bills) {
      for (const p of billPayments(b)) {
        if (!p.date) continue;
        moves.push({ date: p.date, dir: 'out', account: accountOfMethod(p.method), currency: String(b.currency || 'PKR').toUpperCase(), amount: p.amount, ref: b.invoice_no, refId: b.id, source: 'bill', text: `Paid ${b.customer_name || 'vendor'} · bill ${b.invoice_no}` });
      }
    }
    for (const p of purs) {
      for (const it of asArray(p.items)) {
        if (!itemPaid(p, it) || !(num(it.payable) > 0)) continue;
        const day = purchasePaidDay(p, it); if (!day) continue;
        moves.push({ date: day, dir: 'out', account: accountOfMethod(it.paidByMethod), method: it.paidByMethod || '', currency: String(it.currency || p.currency || 'PKR').toUpperCase(), amount: r2(num(it.payable)), ref: p.purchaseNo, refId: p.id, source: 'purchase', text: `Paid ${it.vendorName || 'vendor'} · ${p.purchaseNo}${it.paidByMethod && it.paidByMethod !== 'unpaid' ? ` (${METHOD_LABEL[it.paidByMethod] || it.paidByMethod})` : ''}` });
      }
    }
    const use = moves.filter((m) => m.date && (account === 'all' || m.account === account));
    const opening = {};
    for (const m of use) if (m.date < from) add(opening, m.currency, m.dir === 'in' ? m.amount : -m.amount);
    const inRange = use.filter((m) => m.date >= from && m.date <= to).sort((a, b) => a.date.localeCompare(b.date) || (a.dir === 'in' ? -1 : 1));
    const bal = { ...opening }; const tin = {}; const tout = {};
    const days = [];
    for (const m of inRange) {
      let d = days[days.length - 1];
      if (!d || d.date !== m.date) { d = { date: m.date, in: {}, out: {}, balance: {}, entries: [] }; days.push(d); }
      add(m.dir === 'in' ? d.in : d.out, m.currency, m.amount);
      add(m.dir === 'in' ? tin : tout, m.currency, m.amount);
      add(bal, m.currency, m.dir === 'in' ? m.amount : -m.amount);
      d.entries.push(m);
      d.balance = { ...bal };
    }
    const currencies = [...new Set([...Object.keys(opening), ...Object.keys(tin), ...Object.keys(tout)])].sort((a, b) => (a === 'PKR' ? -1 : b === 'PKR' ? 1 : a.localeCompare(b)));
    return { from, to, account, opening, days, totals: { in: tin, out: tout, closing: bal }, currencies, otherCount: account === 'all' ? use.filter((m) => m.account === 'other' && m.date >= from && m.date <= to).length : 0 };
  }

  // ------------------------------------------------------------------ overdue invoices
  async function overdueRows(today = pktDay()) {
    const rows = (await supabaseFetch('/crm_invoices?kind=neq.vendor&status=neq.cancelled&select=*&limit=5000')) || [];
    const out = [];
    for (const r of rows) {
      if ((r.kind || 'customer') === 'vendor' || r.status === 'cancelled' || r.status === 'paid') continue;
      const balance = r2(num(r.balance)); if (!(balance > 0)) continue;
      const due = isDate(String(r.due_date || '').slice(0, 10)) ? String(r.due_date).slice(0, 10) : isDate(String(r.travel_date || '').slice(0, 10)) ? String(r.travel_date).slice(0, 10) : '';
      if (!due || due >= today) continue;
      out.push({ row: r, item: {
        id: r.id, invoiceNo: r.invoice_no, customerName: r.customer_name || '', customerPhone: r.customer_phone || '', currency: String(r.currency || 'PKR').toUpperCase(),
        total: r2(num(r.total)), balance, dueDate: due, dueFrom: isDate(String(r.due_date || '').slice(0, 10)) ? 'due' : 'travel', daysOverdue: dayDiff(today, due),
        createdBy: r.created_by || null, saleBy: r.sale_by || null,
      } });
    }
    out.sort((a, b) => a.item.dueDate.localeCompare(b.item.dueDate) || String(a.item.invoiceNo).localeCompare(String(b.item.invoiceNo)));
    return out;
  }
  const totalsOf = (items) => {
    const t = {};
    for (const i of items) { const x = (t[i.currency] ||= { currency: i.currency, balance: 0, count: 0 }); x.balance = r2(x.balance + i.balance); x.count += 1; }
    return Object.values(t).sort((a, b) => b.balance - a.balance);
  };

  let lastSweep = 0;
  /** Each morning after 10:00 PKT: one note per newly overdue invoice to its maker / seller (again after 7 days), and one summary to Accounts + Admin. */
  async function sweep() {
    if (Date.now() - lastSweep < 10 * 60 * 1000) return;
    lastSweep = Date.now();
    const nowMs = Date.now();
    if (new Date(nowMs + PKT_MS).getUTCHours() < 10) return;
    const today = pktDay(nowMs);
    const dayId = `books-od-day-${today}`;
    if (await getOne('crm_company', dayId).catch(() => null)) return;
    const list = await overdueRows(today);
    await upsert('crm_company', { id: dayId, data: { at: new Date(nowMs).toISOString(), count: list.length }, updated_at: new Date(nowMs).toISOString() });
    if (!list.length) return;
    const sentRows = (await supabaseFetch('/crm_company?id=like.books-od-sent-*&select=id,data&limit=10000')) || [];
    const lastSent = new Map(sentRows.map((r) => [r.id, Date.parse(parseJsonObj(r.data, {}).at || '') || 0]));
    const staff = await activeEmployees();
    const active = new Set(staff.map((e) => e.id));
    for (const { item } of list) {
      const mark = `books-od-sent-${item.id}`;
      if (nowMs - (lastSent.get(mark) || 0) < 7 * 86400000) continue;
      const who = [item.createdBy, item.saleBy].filter((x) => x && active.has(x));
      await upsert('crm_company', { id: mark, data: { at: new Date(nowMs).toISOString(), invoiceNo: item.invoiceNo }, updated_at: new Date(nowMs).toISOString() });
      if (who.length) {
        await notify(who, 'invoice', item.id, `Invoice ${item.invoiceNo} for ${item.customerName} is ${item.daysOverdue} day${item.daysOverdue === 1 ? '' : 's'} past its ${item.dueFrom === 'due' ? 'due date' : 'travel date'}. Balance still to be received: ${item.currency} ${fmt(item.balance)}. Please follow up with the customer.`);
      }
    }
    const heads = staff.filter((e) => ['admin', 'ceo', 'accounts'].includes(e.role)).map((e) => e.id);
    const money = totalsOf(list.map((x) => x.item)).map((t) => `${t.currency} ${fmt(t.balance)}`).join(', ');
    await notify(heads, 'invoice', `books-overdue-${today}`, `${list.length} customer invoice${list.length === 1 ? ' is' : 's are'} overdue today, with ${money} still to be received. Open Overdue invoices to follow up.`);
  }

  async function handle(action, body, me, ctx) {
    if (action.startsWith('books_quote_')) return quoteAction(action, body, me, ctx);
    if (action === 'books_vendor_ledger') { needBooks(me); return vendorLedger(); }
    if (action === 'books_cashbook') { needBooks(me); return cashbook(body || {}); }
    if (action === 'books_overdue') {
      const today = pktDay();
      const all = isBooks(me);
      const items = (await overdueRows(today)).filter((x) => all || canSeeInvoice(x.row, me, false)).map((x) => x.item);
      const ids = new Set(items.flatMap((i) => [i.createdBy, i.saleBy]).filter(Boolean));
      const names = new Map((await activeEmployees().catch(() => [])).filter((e) => ids.has(e.id)).map((e) => [e.id, e.name]));
      return { today, seeAll: all, invoices: items.map((i) => ({ ...i, createdByName: names.get(i.createdBy) || '', saleByName: i.saleBy ? names.get(i.saleBy) || '' : '' })), totals: totalsOf(items) };
    }
    return null;
  }

  return { handle, sweep };
}
