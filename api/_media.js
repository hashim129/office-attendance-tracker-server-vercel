// Media Team weekly posting calendar (actions called from api/crm.js).
// Media team members plan posts per day and platform, mark them posted with the live link,
// and Admin / CEO see every week's progress against the weekly targets they set.

export const MEDIA_KINDS = { post: 'Post', reel: 'Reel', story: 'Story', video: 'Video', carousel: 'Carousel', short: 'Short', live: 'Live' };
export const DEFAULT_PLATFORMS = [
  { id: 'instagram', name: 'Instagram', target: 5, handle: '' },
  { id: 'facebook', name: 'Facebook', target: 5, handle: '' },
  { id: 'tiktok', name: 'TikTok', target: 3, handle: '' },
  { id: 'youtube', name: 'YouTube', target: 1, handle: '' },
  { id: 'linkedin', name: 'LinkedIn', target: 2, handle: '' },
  { id: 'whatsapp', name: 'WhatsApp Channel', target: 3, handle: '' },
];
const STATUSES = ['planned', 'ready', 'posted', 'skipped'];
const PKT_MS = 5 * 3600 * 1000;
const pktDate = (ms = Date.now()) => new Date(ms + PKT_MS).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
/** Monday of the week that contains date d (YYYY-MM-DD). */
export const weekStartOf = (d) => { const t = new Date(`${d}T00:00:00Z`); const wd = (t.getUTCDay() + 6) % 7; return addDays(d, -wd); };
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && Number.isFinite(Date.parse(`${v}T00:00:00Z`));
const isTime = (v) => v === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v));

export const mapMediaPost = (r) => ({
  id: r.id, date: String(r.post_date).slice(0, 10), time: r.post_time || '', platform: r.platform, kind: r.kind, title: r.title || '', caption: r.caption || '',
  assignee: r.assignee || null, status: r.status, link: r.link || '', notes: r.notes || '', createdBy: r.created_by || null,
  postedAt: r.posted_at || null, postedBy: r.posted_by || null, createdAt: r.created_at, updatedAt: r.updated_at,
});

/** Late = not posted and its day is over (or its time passed more than an hour ago). */
export function isMissed(p, nowMs = Date.now()) {
  if (p.status === 'posted' || p.status === 'skipped') return false;
  const today = pktDate(nowMs);
  const d = String(p.post_date ?? p.date).slice(0, 10);
  if (d < today) return true;
  return false;
}

export function createMedia(h) {
  const { supabaseFetch, upsert, getOne, notify, id, str, bad, forbidden, notFound, flagOf, parseJsonObj } = h;

  async function config() {
    const row = await getOne('crm_company', 'media-config').catch(() => null);
    const d = parseJsonObj(row?.data, {});
    const platforms = Array.isArray(d.platforms) && d.platforms.length ? d.platforms : DEFAULT_PLATFORMS;
    return { platforms, lastSummaryWeek: d.lastSummaryWeek || '', lastReportMonth: d.lastReportMonth || '' };
  }
  async function saveConfig(next) {
    await upsert('crm_company', { id: 'media-config', data: next, updated_at: new Date().toISOString() });
  }
  async function staff() {
    return (await supabaseFetch('/employees?deleted_at=is.null&is_active=eq.true&select=id,name,role,pending_device_request')) || [];
  }
  const isMember = (e) => flagOf(e, 'mediaTeam');
  const managers = (list) => list.filter((e) => e.role === 'admin' || e.role === 'ceo').map((e) => e.id);
  async function postsBetween(from, to) {
    return (await supabaseFetch(`/crm_media_posts?post_date=gte.${from}&post_date=lte.${to}&select=*&order=post_date.asc,post_time.asc&limit=2000`)) || [];
  }

  let lastSweep = 0;
  /** Reminders: today's posts to the person doing them, late posts, missed posts (also to Admin/CEO), and a Monday summary. */
  async function sweep() {
    if (Date.now() - lastSweep < 5 * 60 * 1000) return;
    lastSweep = Date.now();
    const nowMs = Date.now();
    const today = pktDate(nowMs);
    const hour = new Date(nowMs + PKT_MS).getUTCHours();
    const rows = await postsBetween(addDays(today, -3), today);
    const people = await staff();
    const admins = managers(people);
    const members = people.filter(isMember).map((e) => e.id);
    const plat = Object.fromEntries((await config()).platforms.map((p) => [p.id, p.name]));
    for (const r of rows) {
      if (r.status === 'posted' || r.status === 'skipped') continue;
      const marks = new Set(String(r.reminded || '').split(',').filter(Boolean));
      const who = r.assignee ? [r.assignee] : members;
      const label = `${plat[r.platform] || r.platform} ${(MEDIA_KINDS[r.kind] || 'post').toLowerCase()}${r.title ? ` “${r.title}”` : ''}`;
      const d = String(r.post_date).slice(0, 10);
      let add = '';
      if (d < today && !marks.has('missed')) {
        add = 'missed';
        await notify([...who, ...admins], 'media', r.id, `Missed post: ${label} planned for ${d} was not posted.`);
      } else if (d === today && r.post_time && !marks.has('late')) {
        const [hh, mm] = r.post_time.split(':').map(Number);
        const dueMs = Date.parse(`${d}T00:00:00Z`) - PKT_MS + (hh * 60 + mm) * 60000;
        if (nowMs > dueMs + 60 * 60000) { add = 'late'; await notify(who, 'media', r.id, `Running late: ${label} was due at ${r.post_time} today. Post it and add the link.`); }
      }
      if (!add && d === today && hour >= 9 && !marks.has('today')) {
        add = 'today';
        await notify(who, 'media', r.id, `Today: ${label}${r.post_time ? ` at ${r.post_time}` : ''}.`);
      }
      if (add) {
        marks.add(add);
        if (add === 'missed') marks.add('today').add('late');
        await supabaseFetch(`/crm_media_posts?id=eq.${encodeURIComponent(r.id)}`, { method: 'PATCH', body: JSON.stringify({ reminded: [...marks].join(',') }) });
      }
    }
    // Monday morning: how last week went, for Admin / CEO
    const thisWeek = weekStartOf(today);
    const cfg = await config();
    if (new Date(nowMs + PKT_MS).getUTCDay() === 1 && hour >= 10 && cfg.lastSummaryWeek !== thisWeek) {
      const from = addDays(thisWeek, -7);
      const last = await postsBetween(from, addDays(thisWeek, -1));
      if (last.length || cfg.platforms.some((p) => p.target > 0)) {
        const posted = last.filter((r) => r.status === 'posted').length;
        const target = cfg.platforms.reduce((a, p) => a + (Number(p.target) || 0), 0);
        const missed = last.filter((r) => isMissed(r, nowMs)).length;
        await notify(admins, 'media', `med-week-${from}`, `Media last week: ${posted} of ${target} target posts done${missed ? `, ${missed} missed` : ''}. Open the Posting Calendar for details.`);
      }
      await saveConfig({ ...cfg, lastSummaryWeek: thisWeek });
    }
    // 1st of the month: last month's report is ready
    const monthNow = today.slice(0, 7);
    const cfg2 = await config();
    if (today.slice(8, 10) === '01' && hour >= 10 && cfg2.lastReportMonth !== monthNow) {
      const prev = new Date(Date.UTC(Number(monthNow.slice(0, 4)), Number(monthNow.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
      const label = new Date(`${prev}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      await notify(admins, 'media', `med-report-${prev}`, `The media report for ${label} is ready. Open the Posting Calendar → Monthly report (PDF).`);
      await saveConfig({ ...cfg2, lastReportMonth: monthNow });
    }
  }

  async function handle(action, body, me, isAdmin) {
    const member = isMember(me);
    if (!isAdmin && !member) throw forbidden('The Posting Calendar is for the Media Team. Ask Admin to switch it on for you.');

    if (action === 'media_list') {
      await sweep().catch((e) => console.error('media sweep', e?.message));
      const today = pktDate();
      const week = isDate(body.weekStart) ? weekStartOf(body.weekStart) : weekStartOf(today);
      const historyFrom = addDays(week, -7 * 7);
      const [cfg, people, rows, ideaRow] = await Promise.all([config(), staff(), postsBetween(historyFrom, addDays(week, 6)), getOne('crm_company', 'media-ideas').catch(() => null)]);
      return {
        today, weekStart: week, config: { platforms: cfg.platforms }, kinds: MEDIA_KINDS, canManage: isAdmin,
        members: people.filter((e) => isMember(e) || e.role === 'admin' || e.role === 'ceo').map((e) => ({ id: e.id, name: e.name, media: isMember(e) })),
        posts: rows.map(mapMediaPost),
        ideas: Array.isArray(parseJsonObj(ideaRow?.data, {}).items) ? parseJsonObj(ideaRow?.data, {}).items : [],
      };
    }

    if (action === 'media_save') {
      const x = body.post || {};
      const cfg = await config();
      const existing = x.id ? await getOne('crm_media_posts', x.id) : null;
      if (x.id && !existing) throw notFound('Post not found.');
      if (!isDate(x.date)) throw bad('Choose the posting date.');
      if (!isTime(x.time || '')) throw bad('Time should look like 18:30.');
      if (!cfg.platforms.some((p) => p.id === x.platform)) throw bad('Choose a platform.');
      if (!MEDIA_KINDS[x.kind]) throw bad('Choose what kind of post it is.');
      const people = await staff();
      const assignee = x.assignee ? String(x.assignee) : (member ? me.id : null);
      if (assignee && !people.some((e) => e.id === assignee)) throw bad('Choose who will post it.');
      const at = new Date().toISOString();
      const row = {
        ...(existing || { id: id('med'), created_by: me.id, created_at: at, status: 'planned', link: '', posted_at: null, posted_by: null, reminded: '' }),
        post_date: x.date, post_time: x.time || '', platform: x.platform, kind: x.kind,
        title: str(x.title, 160, { required: true, name: 'Title / idea' }), caption: str(x.caption, 2200, { name: 'Caption' }),
        notes: str(x.notes, 600, { name: 'Notes' }), assignee, updated_at: at,
      };
      if (existing && existing.post_date !== x.date) row.reminded = '';
      await upsert('crm_media_posts', row);
      if (assignee && assignee !== me.id && (!existing || existing.assignee !== assignee)) {
        await notify([assignee], 'media', row.id, `${me.name || 'Admin'} gave you a post: ${row.title} on ${row.post_date}${row.post_time ? ` at ${row.post_time}` : ''}.`, me.id);
      }
      return { post: mapMediaPost(row) };
    }

    if (action === 'media_status') {
      const existing = await getOne('crm_media_posts', body.id);
      if (!existing) throw notFound('Post not found.');
      const status = String(body.status || '');
      if (!STATUSES.includes(status)) throw bad('Choose a status.');
      const link = str(body.link, 500, { name: 'Link' });
      if (status === 'posted' && !/^https?:\/\/\S+\.\S+/.test(link)) throw bad('Paste the link of the live post, so it can be checked.');
      const at = new Date().toISOString();
      const row = { ...existing, status, link: status === 'posted' ? link : existing.link, updated_at: at,
        posted_at: status === 'posted' ? (existing.posted_at || at) : null, posted_by: status === 'posted' ? me.id : null };
      await upsert('crm_media_posts', row);
      return { post: mapMediaPost(row) };
    }

    if (action === 'media_delete') {
      const existing = await getOne('crm_media_posts', body.id);
      if (!existing) throw notFound('Post not found.');
      if (!isAdmin && existing.created_by !== me.id) throw forbidden('Only the person who planned it (or Admin) can delete this post.');
      await supabaseFetch(`/crm_media_posts?id=eq.${encodeURIComponent(existing.id)}`, { method: 'DELETE' });
      return {};
    }

    if (action === 'media_copy_week') {
      const to = isDate(body.weekStart) ? weekStartOf(body.weekStart) : null;
      if (!to) throw bad('Choose the week.');
      const prev = await postsBetween(addDays(to, -7), addDays(to, -1));
      if (!prev.length) throw bad('Last week has no posts to copy.');
      const at = new Date().toISOString();
      const rows = prev.map((r) => ({ ...r, id: id('med'), post_date: addDays(String(r.post_date).slice(0, 10), 7), status: 'planned', link: '', posted_at: null, posted_by: null, reminded: '', created_by: me.id, created_at: at, updated_at: at }));
      await upsert('crm_media_posts', rows);
      return { copied: rows.length };
    }

    // Ideas bank: post ideas waiting for a date
    if (action === 'media_idea_add') {
      const row = await getOne('crm_company', 'media-ideas').catch(() => null);
      const items = Array.isArray(parseJsonObj(row?.data, {}).items) ? parseJsonObj(row?.data, {}).items : [];
      const text = str(body.text, 300, { required: true, name: 'Idea' });
      const platform = String(body.platform || '').slice(0, 30);
      const next = [{ id: id('idea'), text, platform, by: me.id, byName: me.name || '', at: new Date().toISOString() }, ...items].slice(0, 200);
      await upsert('crm_company', { id: 'media-ideas', data: { items: next }, updated_at: new Date().toISOString() });
      return { ideas: next };
    }
    if (action === 'media_idea_remove') {
      const row = await getOne('crm_company', 'media-ideas').catch(() => null);
      const items = Array.isArray(parseJsonObj(row?.data, {}).items) ? parseJsonObj(row?.data, {}).items : [];
      const next = items.filter((x) => x.id !== body.id);
      await upsert('crm_company', { id: 'media-ideas', data: { items: next }, updated_at: new Date().toISOString() });
      return { ideas: next };
    }
    // One month of posts (month view and the monthly report)
    if (action === 'media_month') {
      const m = /^\d{4}-\d{2}$/.test(String(body.month || '')) ? body.month : pktDate().slice(0, 7);
      const last = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
      const [cfg, people, rows] = await Promise.all([config(), staff(), postsBetween(`${m}-01`, last)]);
      return { month: m, config: { platforms: cfg.platforms }, kinds: MEDIA_KINDS, members: people.filter((e) => isMember(e)).map((e) => ({ id: e.id, name: e.name })), posts: rows.map(mapMediaPost), today: pktDate() };
    }

    if (action === 'media_config_save') {
      if (!isAdmin) throw forbidden('Only Admin or the CEO can change the weekly targets.');
      const list = Array.isArray(body.platforms) ? body.platforms.slice(0, 12) : [];
      const platforms = list.map((p, i) => {
        const name = str(p?.name, 40, { required: true, name: `Platform ${i + 1}` });
        const pid = String(p?.id || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || `p${i}`;
        const target = Math.max(0, Math.min(50, Math.round(Number(p?.target) || 0)));
        return { id: pid, name, target, handle: str(p?.handle, 300, { name: `${name} link` }) };
      });
      if (!platforms.length) throw bad('Keep at least one platform.');
      const cfg = await config();
      await saveConfig({ ...cfg, platforms });
      return { config: { platforms } };
    }
    return null;
  }

  return { handle, sweep };
}
