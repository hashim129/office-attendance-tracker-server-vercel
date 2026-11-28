// Staff extras (actions staff_*, called from api/crm.js):
//   - performance card per employee for a month (Admin / CEO)
//   - short leave and shift swap requests (a record and notifications only: shifts and attendance are never changed)
//   - daily sales-target nudge (background sweep), with a personal on / off switch
//   - media post performance (likes, views, leads... per posted crm_media_posts row)
// Everything new is stored as crm_company rows: slv-<uuid>, nudge-off-<empId>, nudge-sent-*, mstat-<postId>.
import { MEDIA_KINDS, DEFAULT_PLATFORMS } from './_media.js';

const PKT_MS = 5 * 3600 * 1000;
const pktNow = (ms = Date.now()) => new Date(ms + PKT_MS);
const pktDate = (ms = Date.now()) => pktNow(ms).toISOString().slice(0, 10);
const pktMonth = (ms = Date.now()) => pktDate(ms).slice(0, 7);
const isMonth = (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || ''));
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const isTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ''));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const asArray = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return []; } })() : []);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const monthEnd = (m) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
const monthLabel = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const weekday = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
const inMonthIso = (iso, m) => Boolean(iso) && Number.isFinite(Date.parse(iso)) && pktMonth(Date.parse(iso)) === m;
const mins = (t) => { const x = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return x ? Number(x[1]) * 60 + Number(x[2]) : null; };
const fmtMoney = (n) => Math.round(n).toLocaleString('en-US');
const to12 = (t) => { const m = mins(t); if (m === null) return t || ''; const h = Math.floor(m / 60); const mm = String(m % 60).padStart(2, '0'); return `${((h + 11) % 12) + 1}:${mm} ${h < 12 ? 'am' : 'pm'}`; };
const dayText = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Working days (Mon–Sat) from `from` to `to`, both included. */
export function workingDaysBetween(from, to) {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (weekday(d) !== 0) n += 1;
  return n;
}

/** Minutes worked on one attendance row (saved value first, else punch-in to punch-out less breaks). */
function workedMinutes(r) {
  const saved = num(r.total_worked_minutes);
  if (saved > 0) return saved;
  const a = mins(r.time_in); const b = mins(r.time_out);
  if (a === null || b === null) return 0;
  let w = b >= a ? b - a : b + 1440 - a;
  for (const br of asArray(r.breaks)) {
    const s = mins(br?.start); const e = mins(br?.end);
    if (s !== null && e !== null) w -= e >= s ? e - s : 1440 - s + e;
  }
  return Math.max(0, w);
}

const STAT_KEYS = ['likes', 'comments', 'shares', 'views', 'saves', 'leads'];

export function createStaff(h) {
  const { supabaseFetch, upsert, getOne, notify, id, str, bad, forbidden, notFound, flagOf, parseJsonObj, invoiceBook, fxRates, toPkr, audit } = h;

  /** Active staff with their flags (activeEmployees() leaves the flags out). */
  async function staffRows() {
    const rows = (await supabaseFetch('/employees?deleted_at=is.null&is_active=eq.true&select=id,name,role,shift_id,pending_device_request')) || [];
    return rows.filter((e) => e.role !== 'superadmin');
  }
  const adminIdsOf = (list) => list.filter((e) => e.role === 'admin' || e.role === 'ceo').map((e) => e.id);
  const isAdminRole = (e) => e && (e.role === 'admin' || e.role === 'ceo');

  async function targets() {
    const row = await getOne('crm_company', 'sales-targets').catch(() => null);
    const t = parseJsonObj(row?.data, {});
    return { currency: String(t.currency || 'PKR').slice(0, 6) || 'PKR', team: num(t.team), people: parseJsonObj(t.people, {}) };
  }
  /** Convert an amount to the target currency (null when there is no rate). */
  const conv = (amount, from, to, fx) => {
    if (!from || from === to) return num(amount);
    const pkr = toPkr(amount, from, fx);
    if (pkr === null) return null;
    if (to === 'PKR') return pkr;
    const r = fx?.rates?.[to];
    return r ? pkr * r : null;
  };
  /** Sales and profit per person for a month in one currency (sale_by wins, as in invoiceBook). */
  async function salesByPerson(month, currency) {
    const fx = await fxRates();
    const book = (await invoiceBook(fx)).filter((b) => inMonthIso(b.createdAt, month));
    const per = new Map(); const missing = new Set();
    for (const b of book) {
      const sale = conv(b.total, b.currency, currency, fx);
      if (sale === null) { missing.add(b.currency); continue; }
      const p = per.get(b.by) || { sales: 0, profit: 0, invoices: 0, profitInvoices: 0 };
      p.sales += sale; p.invoices += 1;
      if (b.hasPayable && b.profit !== null) {
        const pr = conv(b.profit, b.currency, currency, fx);
        if (pr !== null) { p.profit += pr; p.profitInvoices += 1; }
      }
      per.set(b.by, p);
    }
    return { per, missing: [...missing] };
  }

  // ------------------------------------------------------------------ performance
  async function performance(month) {
    const from = `${month}-01`; const to = monthEnd(month);
    const nowMs = Date.now();
    const [people, att, leaves, fups, posts, tg] = await Promise.all([
      staffRows(),
      supabaseFetch(`/attendance?date=gte.${from}&date=lte.${to}&select=*&limit=20000`),
      supabaseFetch(`/leaves?deleted_at=is.null&status=eq.approved&start_date=lte.${to}&end_date=gte.${from}&select=employee_id,start_date,end_date,leave_type&limit=5000`),
      supabaseFetch('/crm_followups?select=id,assigned_to,status,due_at,created_at,completed_at&limit=20000'),
      supabaseFetch(`/crm_media_posts?post_date=gte.${from}&post_date=lte.${to}&select=id,assignee,posted_by,status,post_date&limit=5000`),
      targets(),
    ]);
    const { per: sales, missing } = await salesByPerson(month, tg.currency);
    const monthStartMs = Date.parse(`${from}T00:00:00Z`) - PKT_MS;
    const monthEndMs = Date.parse(`${addDays(to, 1)}T00:00:00Z`) - PKT_MS;
    const out = people.map((e) => {
      const rows = (att || []).filter((r) => r.employee_id === e.id);
      const present = rows.filter((r) => r.time_in && r.status !== 'absent' && r.status !== 'on_leave');
      const days = new Set(present.map((r) => String(r.date).slice(0, 10)));
      const lateDays = new Set(present.filter((r) => r.status === 'late').map((r) => String(r.date).slice(0, 10)));
      const closed = present.filter((r) => r.time_out);
      const totalMin = closed.reduce((a, r) => a + workedMinutes(r), 0);
      let leaveDays = 0;
      for (const l of (leaves || []).filter((x) => x.employee_id === e.id && x.leave_type !== 'remote_work')) {
        const s = String(l.start_date).slice(0, 10) < from ? from : String(l.start_date).slice(0, 10);
        const t = String(l.end_date).slice(0, 10) > to ? to : String(l.end_date).slice(0, 10);
        if (s <= t) leaveDays += workingDaysBetween(s, t);
      }
      const mine = (fups || []).filter((f) => f.assigned_to === e.id);
      const done = mine.filter((f) => f.status === 'completed' && inMonthIso(f.completed_at, month));
      const overdue = mine.filter((f) => {
        const due = Date.parse(f.due_at || '');
        if (!Number.isFinite(due) || due < monthStartMs || due >= monthEndMs || due > nowMs) return false;
        if (f.status === 'pending' || f.status === 'rescheduled') return true;
        const c = Date.parse(f.completed_at || '');
        return f.status === 'completed' && Number.isFinite(c) && c > due;
      }).length;
      const spans = done.map((f) => (Date.parse(f.completed_at) - Date.parse(f.created_at)) / 3600000).filter((x) => Number.isFinite(x) && x >= 0);
      const media = flagOf(e, 'mediaTeam');
      const myPosts = (posts || []).filter((p) => (p.assignee || p.posted_by) === e.id && p.status !== 'skipped');
      const s = sales.get(e.id) || { sales: 0, profit: 0, invoices: 0, profitInvoices: 0 };
      const target = num(tg.people[e.id]);
      return {
        id: e.id, name: e.name || 'Employee', role: e.role,
        daysPresent: days.size, lateDays: lateDays.size,
        avgHours: closed.length ? r2(totalMin / closed.length / 60) : 0,
        leaveDays,
        sales: r2(s.sales), invoices: s.invoices, profit: r2(s.profit), profitInvoices: s.profitInvoices,
        target, targetPct: target > 0 ? Math.round((s.sales / target) * 1000) / 10 : null,
        followupsDone: done.length, followupsOverdue: overdue,
        avgFollowupHours: spans.length ? r2(spans.reduce((a, x) => a + x, 0) / spans.length) : null,
        media, postsDone: media || myPosts.length ? myPosts.filter((p) => p.status === 'posted').length : null, postsPlanned: media || myPosts.length ? myPosts.length : null,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
    const today = pktDate(nowMs);
    return {
      month, currency: tg.currency, people: out, missingRates: missing,
      workingDays: workingDaysBetween(from, to), workingDaysSoFar: today < from ? 0 : workingDaysBetween(from, today < to ? today : to),
    };
  }

  // ------------------------------------------------------------------ short leave & shift swap
  const mapSlv = (r) => ({ ...parseJsonObj(r.data, {}), id: r.id, updatedAt: r.updated_at });
  async function allSlv() {
    const rows = (await supabaseFetch('/crm_company?id=like.slv-*&select=id,data,updated_at&order=updated_at.desc&limit=2000')) || [];
    return rows.map(mapSlv).filter((x) => x.requesterId);
  }
  async function getSlv(rid) {
    if (!/^slv-[0-9a-f-]{36}$/.test(String(rid || ''))) throw bad('Request not found.');
    const row = await getOne('crm_company', rid);
    if (!row) throw notFound('This request was not found.');
    return mapSlv(row);
  }
  async function saveSlv(x) {
    const at = new Date().toISOString();
    const { id: rid, updatedAt, ...data } = x;
    await upsert('crm_company', { id: rid, data: { ...data, updatedAt: at }, updated_at: at });
    return { ...data, id: rid, updatedAt: at };
  }
  async function shiftLabel(emp) {
    if (!emp?.shift_id) return '';
    const s = (await supabaseFetch(`/shifts?id=eq.${encodeURIComponent(emp.shift_id)}&select=id,name,start_time,end_time`).catch(() => null))?.[0];
    if (!s) return '';
    return `${s.name || 'Shift'}${s.start_time && s.end_time ? ` (${to12(s.start_time)} – ${to12(s.end_time)})` : ''}`;
  }
  const describe = (x) => (x.type === 'swap'
    ? `shift swap with ${x.peerName} on ${dayText(x.date)}`
    : `short leave on ${dayText(x.date)}, ${to12(x.from)} – ${to12(x.to)}`);

  async function shortHandle(action, body, me, isAdmin) {
    if (action === 'staff_short_list') {
      const [list, people] = await Promise.all([allSlv(), staffRows()]);
      const mine = list.filter((x) => x.requesterId === me.id);
      const waiting = list.filter((x) => x.peerId === me.id && x.status === 'waiting_peer');
      const forMe = list.filter((x) => x.peerId === me.id && x.status !== 'waiting_peer').slice(0, 30);
      const toApprove = isAdmin ? list.filter((x) => x.status === 'pending' && x.requesterId !== me.id) : [];
      const decided = isAdmin ? list.filter((x) => ['approved', 'declined'].includes(x.status)).slice(0, 40) : [];
      return {
        today: pktDate(), isAdmin, mine: mine.slice(0, 100), waiting, swapsWithMe: forMe, toApprove, decided,
        colleagues: people.filter((e) => e.id !== me.id).map((e) => ({ id: e.id, name: e.name })).sort((a, b) => String(a.name).localeCompare(String(b.name))),
      };
    }

    if (action === 'staff_short_request') {
      const x = body.request || body;
      const type = x.type === 'swap' ? 'swap' : x.type === 'short' ? 'short' : null;
      if (!type) throw bad('Choose short leave or shift swap.');
      if (!isDate(x.date)) throw bad('Choose the date.');
      const today = pktDate();
      if (x.date < addDays(today, -7)) throw bad('That date is too far back. Choose a date from the last 7 days or later.');
      if (x.date > addDays(today, 120)) throw bad('Choose a date within the next 4 months.');
      const people = await staffRows();
      const at = new Date().toISOString();
      const list = await allSlv();
      const admins = adminIdsOf(people);
      const meRow = people.find((e) => e.id === me.id) || me;
      if (type === 'short') {
        if (!isTime(x.from) || !isTime(x.to)) throw bad('Enter the from and to times, like 14:00.');
        if (mins(x.to) <= mins(x.from)) throw bad('The “to” time should be after the “from” time.');
        const when = ['late', 'early', 'other'].includes(x.when) ? x.when : 'other';
        const reason = str(x.reason, 500, { required: true, name: 'Reason' });
        if (list.some((r) => r.requesterId === me.id && r.type === 'short' && r.date === x.date && ['pending'].includes(r.status) && !(mins(x.to) <= mins(r.from) || mins(x.from) >= mins(r.to)))) {
          throw bad('You already have a short leave request for that time waiting for approval.');
        }
        const row = await saveSlv({ id: id('slv'), type, when, date: x.date, from: x.from, to: x.to, reason, requesterId: me.id, requesterName: me.name || '', status: 'pending', createdAt: at });
        await notify(admins, 'reminder', row.id, `${me.name || 'A colleague'} asked for ${describe(row)}${when === 'late' ? ' (coming late)' : when === 'early' ? ' (leaving early)' : ''}. Reason: ${reason.slice(0, 120)}`, me.id);
        return { request: row };
      }
      const peer = people.find((e) => e.id === String(x.peerId || ''));
      if (!peer) throw bad('Choose the colleague you want to swap with.');
      if (peer.id === me.id) throw bad('Choose a colleague, not yourself.');
      if (list.some((r) => r.requesterId === me.id && r.type === 'swap' && r.date === x.date && ['waiting_peer', 'pending'].includes(r.status))) {
        throw bad('You already have a shift swap request for that date. Cancel it first to ask someone else.');
      }
      const reason = str(x.reason, 500, { name: 'Reason' });
      const [myShift, peerShift] = await Promise.all([shiftLabel(meRow), shiftLabel(peer)]);
      const row = await saveSlv({ id: id('slv'), type, date: x.date, reason, requesterId: me.id, requesterName: me.name || '', peerId: peer.id, peerName: peer.name || '', myShift, peerShift, status: 'waiting_peer', createdAt: at });
      await notify([peer.id], 'reminder', row.id, `${me.name || 'A colleague'} wants to swap shifts with you on ${dayText(row.date)}${myShift ? ` (their shift: ${myShift})` : ''}. Open Leave Requests to accept or decline.`, me.id);
      return { request: row };
    }

    if (action === 'staff_short_peer') {
      const x = await getSlv(body.id);
      if (x.type !== 'swap' || x.peerId !== me.id) throw forbidden('Only the colleague asked can answer this swap.');
      if (x.status !== 'waiting_peer') throw bad('This swap request has already been answered.');
      const accept = body.accept === true;
      const note = str(body.note, 300, { name: 'Note' });
      const row = await saveSlv({ ...x, status: accept ? 'pending' : 'peer_declined', peerAt: new Date().toISOString(), peerNote: note });
      if (accept) {
        const admins = adminIdsOf(await staffRows());
        await notify([x.requesterId], 'reminder', x.id, `${me.name || 'Your colleague'} accepted your shift swap for ${dayText(x.date)}. It now goes to Admin for approval.`, me.id);
        await notify(admins.filter((a) => a !== x.requesterId), 'reminder', x.id, `Shift swap to approve: ${x.requesterName} and ${x.peerName} on ${dayText(x.date)} (both agreed).`, me.id);
      } else {
        await notify([x.requesterId], 'reminder', x.id, `${me.name || 'Your colleague'} declined the shift swap for ${dayText(x.date)}${note ? `: ${note}` : '.'}`, me.id);
      }
      return { request: row };
    }

    if (action === 'staff_short_decide') {
      if (!isAdmin) throw forbidden('Only Admin or the CEO can approve these requests.');
      const x = await getSlv(body.id);
      if (x.requesterId === me.id) throw forbidden('Someone else needs to approve your own request.');
      if (x.status === 'waiting_peer') throw bad('The colleague has not accepted this swap yet.');
      if (x.status !== 'pending') throw bad('This request has already been decided or cancelled.');
      const approve = body.approve === true || body.decision === 'approve';
      const note = str(body.note, 300, { name: 'Note' });
      const row = await saveSlv({ ...x, status: approve ? 'approved' : 'declined', decidedBy: me.id, decidedByName: me.name || '', decidedAt: new Date().toISOString(), decisionNote: note });
      const msg = `${me.name || 'Admin'} ${approve ? 'approved' : 'declined'} the ${describe(x)}${note ? `: ${note}` : '.'}`;
      await notify([x.requesterId, ...(x.type === 'swap' && x.peerId ? [x.peerId] : [])], 'reminder', x.id, msg, me.id);
      await audit(me, approve ? 'approved a short leave / swap' : 'declined a short leave / swap', `${x.requesterName}: ${describe(x)}`);
      return { request: row };
    }

    if (action === 'staff_short_cancel') {
      const x = await getSlv(body.id);
      if (x.requesterId !== me.id) throw forbidden('Only the person who asked can cancel this request.');
      if (!['waiting_peer', 'pending'].includes(x.status)) throw bad('Only a request that is still waiting can be cancelled.');
      const row = await saveSlv({ ...x, status: 'cancelled', cancelledAt: new Date().toISOString() });
      if (x.status === 'waiting_peer' && x.peerId) await notify([x.peerId], 'reminder', x.id, `${me.name || 'Your colleague'} cancelled the shift swap request for ${dayText(x.date)}.`, me.id);
      if (x.status === 'pending') {
        const admins = adminIdsOf(await staffRows());
        await notify([...admins, ...(x.type === 'swap' && x.peerId ? [x.peerId] : [])], 'reminder', x.id, `${me.name || 'A colleague'} cancelled the ${describe(x)}.`, me.id);
      }
      return { request: row };
    }
    return null;
  }

  // ------------------------------------------------------------------ daily target nudge
  async function myTargetState(empId, nowMs = Date.now()) {
    const month = pktMonth(nowMs);
    const tg = await targets();
    const target = num(tg.people[empId]);
    const today = pktDate(nowMs);
    const daysLeft = workingDaysBetween(today, monthEnd(month));
    if (!target) return { month, currency: tg.currency, target: 0, sales: 0, remaining: 0, daysLeft };
    const { per } = await salesByPerson(month, tg.currency);
    const sales = r2(per.get(empId)?.sales || 0);
    return { month, currency: tg.currency, target, sales, remaining: r2(Math.max(0, target - sales)), daysLeft };
  }
  /** Claims a marker row once (true only for the first caller). */
  async function claim(markerId, data = {}) {
    const created = await supabaseFetch('/crm_company', {
      method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify([{ id: markerId, data: { ...data, at: new Date().toISOString() }, updated_at: new Date().toISOString() }]),
    });
    return Array.isArray(created) && created.length > 0;
  }

  let lastSweep = 0;
  async function sweep() {
    const nowMs = Date.now();
    if (nowMs - lastSweep < 10 * 60 * 1000) return;
    lastSweep = nowMs;
    const p = pktNow(nowMs);
    if (p.getUTCDay() === 0 || p.getUTCHours() !== 10) return;
    const today = pktDate(nowMs);
    const tg = await targets();
    const ids = Object.entries(tg.people).filter(([, v]) => num(v) > 0).map(([k]) => k);
    if (!ids.length) return;
    if (!(await claim(`nudge-sent-${today}`))) return;
    const month = pktMonth(nowMs);
    const [people, offRows, { per }] = await Promise.all([
      staffRows(),
      supabaseFetch('/crm_company?id=like.nudge-off-*&select=id,data&limit=2000'),
      salesByPerson(month, tg.currency),
    ]);
    const off = new Set((offRows || []).filter((r) => parseJsonObj(r.data, {}).off === true).map((r) => String(r.id).slice('nudge-off-'.length)));
    const daysLeft = workingDaysBetween(today, monthEnd(month));
    for (const e of people) {
      const target = num(tg.people[e.id]);
      if (!target || off.has(e.id)) continue;
      const sales = per.get(e.id)?.sales || 0;
      try {
        if (sales >= target) {
          if (await claim(`nudge-sent-done-${e.id}-${month}`)) {
            await notify([e.id], 'sale', `nudge-${month}`, `Well done! You reached your ${monthLabel(month)} sales target: ${tg.currency} ${fmtMoney(sales)} of ${tg.currency} ${fmtMoney(target)}.`);
          }
        } else {
          await notify([e.id], 'sale', `nudge-${month}`, `You need ${tg.currency} ${fmtMoney(target - sales)} more this month to reach your target (${daysLeft} working day${daysLeft === 1 ? '' : 's'} left).`);
        }
      } catch (err) { console.error('target nudge', err?.message); }
    }
  }

  // ------------------------------------------------------------------ media post performance
  async function mediaConfig() {
    const row = await getOne('crm_company', 'media-config').catch(() => null);
    const d = parseJsonObj(row?.data, {});
    return Array.isArray(d.platforms) && d.platforms.length ? d.platforms : DEFAULT_PLATFORMS;
  }
  const cleanStats = (src) => {
    const o = {};
    for (const k of STAT_KEYS) {
      const v = src?.[k];
      if (v === '' || v === null || v === undefined) { o[k] = 0; continue; }
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) throw bad(`${k[0].toUpperCase()}${k.slice(1)} should be 0 or more.`);
      o[k] = Math.min(1e10, Math.round(n));
    }
    return o;
  };

  async function mediaHandle(action, body, me, isAdmin) {
    if (!isAdmin && !flagOf(me, 'mediaTeam')) throw forbidden('Post performance is for the Media Team. Ask Admin to switch it on for you.');
    if (action === 'staff_media_stats_list') {
      const m = pktMonth();
      const from = isDate(body.from) ? body.from : `${m}-01`;
      const to = isDate(body.to) ? body.to : monthEnd(m);
      if (to < from) throw bad('The end date is before the start date.');
      if (Date.parse(to) - Date.parse(from) > 400 * 86400000) throw bad('Choose up to about one year at a time.');
      const [posts, statRows, platforms, people] = await Promise.all([
        supabaseFetch(`/crm_media_posts?post_date=gte.${from}&post_date=lte.${to}&status=eq.posted&select=*&order=post_date.desc&limit=3000`),
        supabaseFetch('/crm_company?id=like.mstat-*&select=id,data,updated_at&limit=5000'),
        mediaConfig(),
        staffRows(),
      ]);
      const stats = new Map((statRows || []).map((r) => [String(r.id).slice('mstat-'.length), parseJsonObj(r.data, {})]));
      const nameOf = new Map(people.map((e) => [e.id, e.name]));
      return {
        from, to, kinds: MEDIA_KINDS, platforms: platforms.map((p) => ({ id: p.id, name: p.name })),
        posts: (posts || []).map((r) => {
          const s = stats.get(r.id);
          return {
            id: r.id, date: String(r.post_date).slice(0, 10), time: r.post_time || '', platform: r.platform, kind: r.kind, title: r.title || '',
            links: String(r.link || '').split(/\s+/).filter(Boolean), assignee: r.assignee || r.posted_by || null,
            assigneeName: nameOf.get(r.assignee || r.posted_by) || '',
            stats: s ? Object.fromEntries(STAT_KEYS.map((k) => [k, num(s[k])])) : null,
            statsUpdatedAt: s?.updatedAt || null, statsUpdatedByName: s?.updatedByName || '',
          };
        }),
      };
    }
    if (action === 'staff_media_stats_save') {
      const postId = String(body.postId || body.id || '');
      const post = postId ? await getOne('crm_media_posts', postId) : null;
      if (!post) throw notFound('Post not found.');
      if (post.status !== 'posted') throw bad('Numbers can only be added once the post is live (marked posted).');
      const stats = cleanStats(body.stats || body);
      const at = new Date().toISOString();
      await upsert('crm_company', { id: `mstat-${post.id}`, data: { ...stats, postId: post.id, updatedAt: at, updatedBy: me.id, updatedByName: me.name || '' }, updated_at: at });
      return { postId: post.id, stats, statsUpdatedAt: at, statsUpdatedByName: me.name || '' };
    }
    return null;
  }

  async function handle(action, body, me, ctx = {}) {
    const isAdmin = Boolean(ctx.isAdmin) || isAdminRole(me);
    body = body || {};
    if (action === 'staff_performance') {
      if (!isAdmin) throw forbidden('Only Admin or the CEO can see the performance cards.');
      const month = isMonth(body.month) ? body.month : pktMonth();
      return performance(month);
    }
    if (action.startsWith('staff_short_')) return shortHandle(action, body, me, isAdmin);
    if (action === 'staff_nudge_get') {
      const row = await getOne('crm_company', `nudge-off-${me.id}`).catch(() => null);
      const st = await myTargetState(me.id);
      return { off: parseJsonObj(row?.data, {}).off === true, ...st };
    }
    if (action === 'staff_nudge_set') {
      const off = body.off === true;
      await upsert('crm_company', { id: `nudge-off-${me.id}`, data: { off, at: new Date().toISOString() }, updated_at: new Date().toISOString() });
      return { off };
    }
    if (action === 'staff_media_stats_list' || action === 'staff_media_stats_save') return mediaHandle(action, body, me, isAdmin);
    return null;
  }

  return { handle, sweep };
}
