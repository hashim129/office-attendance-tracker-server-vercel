// Pure helpers for the invoice payment history (several payments received at different times on one invoice).
// Kept free of database calls so they can be tested on their own. All money is rounded to 2 decimals.

export const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const asArray = (v) => (Array.isArray(v) ? v : []);
const MAX_PAYMENTS = 60;

export class PaymentError extends Error {
  constructor(message) { super(message); this.name = 'PaymentError'; }
}

export const sumPayments = (payments) => r2(asArray(payments).reduce((a, p) => a + (Number(p?.amount) || 0), 0));

/** A stored payment, cleaned. Never trusts the shape of old or hand-edited rows. */
export const cleanStored = (p) => ({
  id: String(p?.id || ''),
  date: /^\d{4}-\d{2}-\d{2}$/.test(String(p?.date || '')) ? String(p.date) : '',
  amount: r2(Number(p?.amount) || 0),
  note: String(p?.note || '').slice(0, 200),
  method: p?.method === 'bank' ? 'bank' : p?.method === 'cash' ? 'cash' : '',
  receiptId: p?.receiptId ? String(p.receiptId) : null,
  receiptNo: p?.receiptNo ? String(p.receiptNo) : null,
  by: String(p?.by || ''),
  byName: String(p?.byName || ''),
  at: String(p?.at || ''),
});

const validDate = (v, label) => {
  const d = String(v || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) throw new PaymentError(`${label} is not a valid date.`);
  return d;
};

/** Date (Pakistan time) of an ISO timestamp, as YYYY-MM-DD. */
export const pktDate = (iso) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : new Date(t + 5 * 3600 * 1000).toISOString().slice(0, 10);
};

/**
 * Builds the new payment list for an invoice save.
 *  - existing:   payments already stored on the invoice
 *  - incoming:   the list sent by the form
 *  - privileged: Admin / CEO / Accounts may change or remove saved payments; everyone else may only add
 *  - receipts:   Map(receiptId -> receipt row) for every receipt the incoming list wants to attach (already checked by the caller)
 * Returns { payments, added, removed } where added / removed are the entries that changed.
 */
export function buildPayments({ existing, incoming, privileged, actor, nowIso, receipts = new Map() }) {
  const stored = asArray(existing).map(cleanStored).filter((p) => p.id);
  const byId = new Map(stored.map((p) => [p.id, p]));
  const list = asArray(incoming);
  if (list.length > MAX_PAYMENTS) throw new PaymentError(`An invoice can have up to ${MAX_PAYMENTS} payments.`);
  const seen = new Set();
  const out = [];
  const added = [];
  for (let i = 0; i < list.length; i++) {
    const x = list[i] || {};
    const prev = x.id ? byId.get(String(x.id)) : null;
    if (prev) {
      if (seen.has(prev.id)) continue;
      seen.add(prev.id);
      const amount = x.amount === undefined || x.amount === '' ? prev.amount : r2(Number(x.amount));
      const date = x.date ? validDate(x.date, `Payment ${i + 1} date`) : prev.date;
      const note = x.note === undefined ? prev.note : String(x.note || '').trim().slice(0, 200);
      const changed = amount !== prev.amount || date !== prev.date || note !== prev.note;
      if (changed && !privileged) throw new PaymentError('A saved payment cannot be changed. Ask Accounts or an administrator to correct it.');
      if (changed && prev.receiptId) throw new PaymentError('A payment that came from a receipt cannot be edited. Remove it and add the right receipt instead.');
      if (!(amount > 0) || amount > 9999999999) throw new PaymentError(`Payment ${i + 1} is not a valid amount.`);
      out.push({ ...prev, amount, date, note });
      continue;
    }
    // new payment
    const receipt = x.receiptId ? receipts.get(String(x.receiptId)) : null;
    if (x.receiptId && !receipt) throw new PaymentError('The receipt you picked could not be attached.');
    if (receipt && out.some((p) => p.receiptId === String(receipt.id)) ) throw new PaymentError('That receipt is already attached to this invoice.');
    const amount = receipt ? r2(Number(receipt.amount_received) || 0) : r2(Number(x.amount));
    if (!(amount > 0) || amount > 9999999999) throw new PaymentError(`Payment ${i + 1} needs an amount greater than zero.`);
    const date = receipt ? (pktDate(receipt.created_at) || validDate(x.date, `Payment ${i + 1} date`)) : validDate(x.date, `Payment ${i + 1} date`);
    const entry = {
      id: `pay-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
      date, amount,
      note: String(x.note || '').trim().slice(0, 200),
      method: receipt ? (receipt.method === 'bank' ? 'bank' : 'cash') : (x.method === 'bank' ? 'bank' : x.method === 'cash' ? 'cash' : ''),
      receiptId: receipt ? String(receipt.id) : null,
      receiptNo: receipt ? String(receipt.receipt_no || '') : null,
      by: actor.id, byName: actor.name || '', at: nowIso,
    };
    out.push(entry);
    added.push(entry);
  }
  const removed = stored.filter((p) => !seen.has(p.id));
  if (removed.length && !privileged) throw new PaymentError('A saved payment cannot be removed. Ask Accounts or an administrator.');
  // oldest payment first, like the printed invoice
  out.sort((a, b) => (a.date === b.date ? String(a.at).localeCompare(String(b.at)) : a.date.localeCompare(b.date)));
  return { payments: out, added, removed };
}

/** Throws when the payments add up to more than the invoice total. */
export function assertWithinTotal(payments, total) {
  const paid = sumPayments(payments);
  if (paid - Number(total) > 0.009) throw new PaymentError(`The payments (${paid}) are more than the invoice total (${r2(total)}).`);
  return paid;
}

/** Can this receipt be attached to this invoice? Returns an error text, or '' when fine. */
export function receiptProblem(receipt, { invoiceId, invoiceCurrency, customerName, crmQuery, canSee }) {
  if (!receipt) return 'That receipt was not found.';
  if (!canSee) return 'You can only attach receipts you made yourself.';
  if (receipt.linked_invoice_id && receipt.linked_invoice_id !== invoiceId) return `Receipt ${receipt.receipt_no} is already attached to another invoice.`;
  if (String(receipt.currency || '').toUpperCase() !== String(invoiceCurrency || '').toUpperCase()) return `Receipt ${receipt.receipt_no} is in ${receipt.currency}, but the invoice is in ${invoiceCurrency}.`;
  const sameQuery = crmQuery && String(receipt.query_code || '').trim().toLowerCase() === String(crmQuery).trim().toLowerCase();
  const sameName = customerName && String(receipt.client_name || '').trim().toLowerCase() === String(customerName).trim().toLowerCase();
  if (!sameQuery && !sameName) return `Receipt ${receipt.receipt_no} belongs to a different customer.`;
  return '';
}
