// Smart reminders: end-of-day summary, follow-up nudges and office arrive / leave reminders (phone app).
// Every reminder has a fixed id, so it is created once and never repeats.
import { supabaseFetch } from './_supabase.js';
import { pushNotificationRows } from './_push.js';

const PKT_MS = 5 * 3600 * 1000;
const pktNow = (ms = Date.now()) => new Date(ms + PKT_MS);
const pktDate = (ms = Date.now()) => pktNow(ms).toISOString().slice(0, 10);
const mins = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const asArray = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return []; } })() : []);

/** Inserts only rows whose id is new, then sends those to phones. */
async function addOnce(rows) {
  if (!rows.length) return [];
  const created = (await supabaseFetch('/crm_notifications', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify(rows),
  })) || [];
  if (created.length) await pushNotificationRows(created);
  return created;
}

function distanceM(aLat, aLng, bLat, bLng) {
  const R = 6371000; const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat); const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

let lastSweep = 0;
export async function sweepSmart(now = Date.now()) {
  if (now - lastSweep < 10 * 60 * 1000) return;
  lastSweep = now;
  await Promise.all([dailySummaries(now).catch((e) => console.error('summary', e?.message)), followupNudges(now).catch((e) => console.error('nudge', e?.message)), travelBalances(now).catch((e) => console.error('travel', e?.message)), customerDates(now).catch((e) => console.error('custdates', e?.message))]);
}

/** After someone punches out: today's hours, invoices, receipts and open follow-ups, once a day. */
export async function dailySummaries(now = Date.now()) {
  const today = pktDate(now);
  const done = (await supabaseFetch(`/attendance?date=eq.${today}&time_out=not.is.null&time_in=not.is.null&select=employee_id,time_in,time_out,breaks`)) || [];
  if (!done.length) return 0;
  const dayStartUtc = new Date(Date.parse(`${today}T00:00:00Z`) - PKT_MS).toISOString();
  const [invoices, receipts, followups] = await Promise.all([
    supabaseFetch(`/crm_invoices?created_at=gte.${encodeURIComponent(dayStartUtc)}&select=created_by,kind,status,currency,total`),
    supabaseFetch(`/crm_receipts?created_at=gte.${encodeURIComponent(dayStartUtc)}&select=created_by`),
    supabaseFetch('/crm_followups?status=in.(pending,rescheduled)&select=assigned_to'),
  ]);
  const rows = [];
  for (const r of done) {
    const a = mins(r.time_in); const b = mins(r.time_out);
    if (a === null || b === null) continue;
    let worked = b >= a ? b - a : b + 1440 - a;
    for (const br of asArray(r.breaks)) { const s = mins(br?.start); const e = mins(br?.end); if (s !== null && e !== null && e > s) worked -= e - s; }
    worked = Math.max(0, worked);
    const inv = (invoices || []).filter((x) => x.created_by === r.employee_id && (x.kind || 'customer') !== 'vendor' && x.status !== 'cancelled');
    const byCur = {};
    for (const x of inv) byCur[x.currency] = (byCur[x.currency] || 0) + num(x.total);
    const money = Object.entries(byCur).map(([c, v]) => `${c} ${Math.round(v).toLocaleString('en-US')}`).join(' + ');
    const rc = (receipts || []).filter((x) => x.created_by === r.employee_id).length;
    const open = (followups || []).filter((x) => x.assigned_to === r.employee_id).length;
    const bits = [`${Math.floor(worked / 60)}h ${String(worked % 60).padStart(2, '0')}m worked`];
    if (inv.length) bits.push(`${inv.length} invoice${inv.length === 1 ? '' : 's'}${money ? ` (${money})` : ''}`);
    if (rc) bits.push(`${rc} receipt${rc === 1 ? '' : 's'}`);
    if (open) bits.push(`${open} follow-up${open === 1 ? '' : 's'} still open`);
    rows.push({ id: `sum-${r.employee_id}-${today}`, employee_id: r.employee_id, category: 'reminder', ref_id: `sum-${today}`, message: `Your day: ${bits.join(' · ')}.`, created_at: new Date(now).toISOString(), read_at: null });
  }
  return (await addOnce(rows)).length;
}

/** Open follow-ups with no update for 5 days: a gentle nudge to the person handling it, at most every 5 days. */
export async function followupNudges(now = Date.now()) {
  const h = pktNow(now).getUTCHours();
  if (h < 10 || h >= 19) return 0;
  const cutoff = new Date(now - 5 * 86400000).toISOString();
  const stale = (await supabaseFetch(`/crm_followups?status=in.(pending,rescheduled)&updated_at=lt.${encodeURIComponent(cutoff)}&select=id,assigned_to,subject,remarks,customer_id,updated_at&limit=300`)) || [];
  if (!stale.length) return 0;
  const custIds = [...new Set(stale.map((f) => f.customer_id).filter(Boolean))];
  const custs = custIds.length ? (await supabaseFetch(`/crm_customers?id=in.(${custIds.map((c) => `"${c}"`).join(',')})&select=id,name`)) || [] : [];
  const cname = new Map(custs.map((c) => [c.id, c.name]));
  const bucket = Math.floor(now / (5 * 86400000));
  const rows = stale.filter((f) => f.assigned_to).map((f) => {
    const days = Math.floor((now - Date.parse(f.updated_at)) / 86400000);
    const what = f.subject || (f.customer_id && cname.get(f.customer_id)) || String(f.remarks || 'a follow-up').slice(0, 60);
    return { id: `nudge-${f.id}-${bucket}`, employee_id: f.assigned_to, category: 'followup', ref_id: f.id, message: `No update on “${what}” for ${days} days. Add a remark, reschedule or close it.`, created_at: new Date(now).toISOString(), read_at: null };
  });
  return (await addOnce(rows)).length;
}

/**
 * Phone app location check (every ~15 minutes in the background, only if the person switched it on):
 * at the office but not punched in → reminder; left the office while still punched in → reminder. Once a day each.
 */
export async function officeGeofence(employeeId, lat, lng, acc, now = Date.now()) {
  if (!employeeId || !Number.isFinite(lat) || !Number.isFinite(lng)) return 0;
  const [setRows, empRows] = await Promise.all([
    supabaseFetch('/settings?id=eq.current&select=data'),
    supabaseFetch(`/employees?id=eq.${encodeURIComponent(employeeId)}&select=id,shift_id,is_active`),
  ]);
  const s = setRows?.[0]?.data || {};
  const oLat = Number(s.officeLat); const oLng = Number(s.officeLng);
  if (!Number.isFinite(oLat) || !Number.isFinite(oLng) || s.officeLat === null || s.officeLng === null) return 0;
  const emp = empRows?.[0];
  if (!emp || emp.is_active === false) return 0;
  const radius = Math.max(50, num(s.officeRadiusM) || 300);
  const dist = distanceM(lat, lng, oLat, oLng);
  const slack = Math.min(num(acc), 150);
  const inside = dist - slack <= radius;
  const outside = dist - slack > radius + 200;
  const today = pktDate(now);
  const nowMin = pktNow(now).getUTCHours() * 60 + pktNow(now).getUTCMinutes();
  const shift = emp.shift_id ? (await supabaseFetch(`/shifts?id=eq.${encodeURIComponent(emp.shift_id)}&select=start_time,end_time,work_days`))?.[0] : null;
  const wd = pktNow(now).getUTCDay();
  const workDays = asArray(shift?.work_days).map(Number);
  if (workDays.length && !workDays.includes(wd)) return 0;
  const start = mins(shift?.start_time) ?? 600; const end = mins(shift?.end_time) ?? 1140;
  const rec = (await supabaseFetch(`/attendance?employee_id=eq.${encodeURIComponent(employeeId)}&date=eq.${today}&select=time_in,time_out,work_mode`))?.[0];
  const rows = [];
  const at = new Date(now).toISOString();
  if (inside && !rec?.time_in && nowMin >= start - 60 && nowMin <= end) {
    rows.push({ id: `geo-in-${employeeId}-${today}`, employee_id: employeeId, category: 'reminder', ref_id: `pin-${employeeId}-${today}`, message: 'You are at the office. Don’t forget to punch in.', created_at: at, read_at: null });
  }
  if (outside && rec?.time_in && !rec.time_out && rec.work_mode !== 'wfh' && rec.work_mode !== 'remote') {
    rows.push({ id: `geo-out-${employeeId}-${today}`, employee_id: employeeId, category: 'reminder', ref_id: `geo-out-${today}`, message: 'You have left the office but you are still punched in. Punch out if you are done for the day.', created_at: at, read_at: null });
  }
  return (await addOnce(rows)).length;
}

/** Customer travels within 3 days and still owes money: tell the person who made the invoice (once per invoice). */
export async function travelBalances(now = Date.now()) {
  const h = pktNow(now).getUTCHours();
  if (h < 10 || h >= 20) return 0;
  const today = pktDate(now);
  const until = pktDate(now + 3 * 86400000);
  const rows = (await supabaseFetch(`/crm_invoices?travel_date=gte.${today}&travel_date=lte.${until}&status=eq.unpaid&select=id,kind,invoice_no,customer_name,currency,balance,travel_date,created_by`)) || [];
  const out = rows.filter((r) => (r.kind || 'customer') !== 'vendor' && num(r.balance) > 0 && r.created_by).map((r) => ({
    id: `travel-${r.id}`, employee_id: r.created_by, category: 'invoice', ref_id: r.id,
    message: `${r.customer_name} travels on ${r.travel_date} and still owes ${r.currency} ${Math.round(num(r.balance)).toLocaleString('en-US')} (${r.invoice_no}). Open the invoice and tap “Payment reminder” to WhatsApp them.`,
    created_at: new Date(now).toISOString(), read_at: null,
  }));
  return (await addOnce(out)).length;
}

/** Customer birthdays (on the day) and passports expiring within 3 months: tell the person who added the customer. */
export async function customerDates(now = Date.now()) {
  const h = pktNow(now).getUTCHours();
  if (h < 9 || h >= 20) return 0;
  const today = pktDate(now);
  const in90 = pktDate(now + 90 * 86400000);
  const rows = (await supabaseFetch('/crm_customers?deleted_at=is.null&or=(birthday.not.is.null,passport_expiry.not.is.null)&select=id,customer_name,customer_number,birthday,passport_expiry,created_by')) || [];
  const out = [];
  const at = new Date(now).toISOString();
  for (const c of rows) {
    if (!c.created_by) continue;
    if (c.birthday && String(c.birthday).slice(5, 10) === today.slice(5, 10)) {
      out.push({ id: `cbday-${c.id}-${today.slice(0, 4)}`, employee_id: c.created_by, category: 'customer', ref_id: c.id, message: `It’s ${c.customer_name}’s birthday today. A quick WhatsApp greeting${c.customer_number ? ` (${c.customer_number})` : ''} keeps them close.`, created_at: at, read_at: null });
    }
    const pe = c.passport_expiry ? String(c.passport_expiry).slice(0, 10) : '';
    if (pe && pe >= today && pe <= in90) {
      out.push({ id: `cpass-${c.id}-${pe}`, employee_id: c.created_by, category: 'customer', ref_id: c.id, message: `${c.customer_name}’s passport expires on ${pe}. A good time to offer passport renewal and their next trip.`, created_at: at, read_at: null });
    }
  }
  return (await addOnce(out)).length;
}
