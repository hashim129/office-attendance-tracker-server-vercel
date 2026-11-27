import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Copy, ExternalLink, Target, Check, Trash2, Pencil, Link2 } from 'lucide-react';
import type { Employee } from '../types';
import { Modal } from '../components/common/Modal';
import { crmCall } from './crmApi';
import { btnGhost, btnPrimary, btnDanger, cardCls, inputCls, Field } from './ui';

/**
 * Media Team posting calendar: plan the week's posts per platform, mark each one posted with its live link,
 * and see at a glance whether every platform hits its weekly target. Admin / CEO set the targets.
 */
type Platform = { id: string; name: string; target: number; handle: string };
type Post = {
  id: string; date: string; time: string; platform: string; kind: string; title: string; caption: string;
  assignee: string | null; status: 'planned' | 'ready' | 'posted' | 'skipped'; link: string; notes: string; createdBy: string | null; postedAt: string | null;
};
type Data = { today: string; weekStart: string; config: { platforms: Platform[] }; kinds: Record<string, string>; canManage: boolean; members: { id: string; name: string; media: boolean }[]; posts: Post[] };

const COLORS: Record<string, string> = { instagram: '#c13584', facebook: '#1877f2', tiktok: '#111827', youtube: '#e11d1d', linkedin: '#0a66c2', whatsapp: '#16a34a', x: '#334155', twitter: '#334155', snapchat: '#eab308', pinterest: '#e60023' };
const colorOf = (id: string) => COLORS[id] || '#64748b';
const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const nice = (d: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });
const missed = (p: Post, today: string) => (p.status === 'planned' || p.status === 'ready') && p.date < today;
const initials = (n: string) => n.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

const emptyPost = (date: string, platform: string, me: string): Partial<Post> => ({ date, time: '', platform, kind: 'post', title: '', caption: '', notes: '', assignee: me });

export const MediaCalendarView: React.FC<{ currentUser: Employee }> = ({ currentUser }) => {
  const [week, setWeek] = useState<string>('');
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Partial<Post> | null>(null);
  const [open, setOpen] = useState<Post | null>(null);
  const [link, setLink] = useState('');
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [targets, setTargets] = useState<Platform[]>([]);
  const [filter, setFilter] = useState<string>('all');

  const load = useCallback(async (w?: string) => {
    try {
      const r = await crmCall<Data>('media_list', { weekStart: w || week || undefined });
      setData(r); setWeek(r.weekStart); setError('');
    } catch (e: any) { setError(e?.message || 'Could not load the calendar.'); }
  }, [week]);
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); await load(); return true; } catch (e: any) { setError(e?.message || 'Something went wrong.'); return false; } finally { setBusy(false); }
  };

  const days = useMemo(() => (week ? DAY.map((_, i) => addDays(week, i)) : []), [week]);
  const name = useMemo(() => new Map((data?.members || []).map((m) => [m.id, m.name])), [data]);
  const plat = useMemo(() => new Map((data?.config.platforms || []).map((p) => [p.id, p])), [data]);
  const weekPosts = useMemo(() => (data?.posts || []).filter((p) => days.includes(p.date) && (filter === 'all' || p.platform === filter || p.assignee === filter)), [data, days, filter]);
  const today = data?.today || '';

  const progress = useMemo(() => (data?.config.platforms || []).map((p) => {
    const mine = (data?.posts || []).filter((x) => days.includes(x.date) && x.platform === p.id);
    return { ...p, posted: mine.filter((x) => x.status === 'posted').length, planned: mine.filter((x) => x.status !== 'skipped').length };
  }), [data, days]);
  const totalTarget = progress.reduce((a, p) => a + p.target, 0);
  const totalPosted = progress.reduce((a, p) => a + p.posted, 0);
  const lateCount = weekPosts.filter((p) => missed(p, today)).length;
  const daysLeft = today && week ? Math.max(0, 7 - Math.max(0, Math.round((Date.parse(today) - Date.parse(week)) / 86400000))) : 7;

  // last 8 weeks: team posted vs target, and a per-person record
  const history = useMemo(() => {
    if (!data) return [] as { week: string; posted: number }[];
    return Array.from({ length: 8 }, (_, i) => addDays(data.weekStart, -7 * (7 - i))).map((w) => {
      const span = Array.from({ length: 7 }, (_, d) => addDays(w, d));
      return { week: w, posted: data.posts.filter((p) => span.includes(p.date) && p.status === 'posted').length };
    });
  }, [data]);
  const people = useMemo(() => {
    if (!data) return [];
    const rows = data.members.filter((m) => m.media).map((m) => {
      const mine = data.posts.filter((p) => p.assignee === m.id && p.date <= data.today);
      const posted = mine.filter((p) => p.status === 'posted');
      const onTime = posted.filter((p) => p.postedAt && new Date(Date.parse(p.postedAt) + 5 * 3600e3).toISOString().slice(0, 10) <= p.date).length;
      return { ...m, posted: posted.length, onTime, missed: mine.filter((p) => missed(p, data.today)).length };
    });
    return rows.sort((a, b) => b.posted - a.posted);
  }, [data]);
  const maxHist = Math.max(totalTarget, ...history.map((h) => h.posted), 1);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    if (await run(() => crmCall('media_save', { post: editing }))) setEditing(null);
  };
  const setStatus = async (p: Post, status: Post['status']) => {
    if (await run(() => crmCall('media_status', { id: p.id, status, link: status === 'posted' ? link.trim() : '' }))) { setOpen(null); setLink(''); }
  };

  if (!data) {
    return (
      <div className="space-y-3" aria-busy="true">
        {error ? <div className={`${cardCls} p-6 text-sm text-slate-600`}>{error}</div> : [0, 1, 2].map((i) => <div key={i} className="skeleton h-24 rounded-xl" />)}
      </div>
    );
  }

  const me = currentUser.id;
  const PostCard = ({ p }: { p: Post }) => {
    const late = missed(p, today);
    const pf = plat.get(p.platform);
    return (
      <button type="button" onClick={() => { setOpen(p); setLink(p.link || ''); }} data-media-post
        className={`w-full text-left rounded-lg border bg-white dark:bg-slate-900 px-2.5 py-2 transition-colors hover:border-slate-400 dark:hover:border-slate-500 ${late ? 'border-red-300 dark:border-red-900' : 'border-slate-200 dark:border-slate-800'}`}
        style={{ borderLeft: `3px solid ${colorOf(p.platform)}` }}>
        <div className="flex items-center justify-between gap-2 text-[10.5px] text-slate-500 dark:text-slate-400">
          <span className="truncate">{pf?.name || p.platform} · {data.kinds[p.kind] || p.kind}{p.time ? ` · ${p.time}` : ''}</span>
          {p.assignee && <span className="shrink-0 rounded bg-slate-100 dark:bg-slate-800 px-1 font-semibold">{initials(name.get(p.assignee) || '?')}</span>}
        </div>
        <div className={`mt-0.5 text-xs font-semibold leading-snug ${p.status === 'skipped' ? 'line-through text-slate-400' : 'text-slate-900 dark:text-slate-100'}`}>{p.title}</div>
        <div className="mt-1 text-[10.5px] font-semibold">
          {p.status === 'posted' ? <span className="text-emerald-700 dark:text-emerald-400">Posted</span>
            : late ? <span className="text-red-600 dark:text-red-400">Missed</span>
            : p.status === 'ready' ? <span className="text-blue-700 dark:text-blue-400">Ready to post</span>
            : p.status === 'skipped' ? <span className="text-slate-400">Skipped</span>
            : <span className="text-slate-500">Planned</span>}
        </div>
      </button>
    );
  };

  return (
    <div className="space-y-4" data-media-calendar>
      {/* header */}
      <div className={`${cardCls} p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}>
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Plan the week</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Plan each post, publish it, then paste the live link. Missed posts are flagged automatically.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-lg border border-slate-300 dark:border-slate-700">
            <button className="p-2" aria-label="Previous week" onClick={() => void load(addDays(week, -7))}><ChevronLeft className="w-4 h-4" /></button>
            <button className="px-2 text-xs font-semibold min-w-[120px]" onClick={() => void load(today)} title="Back to this week">{nice(week)} – {nice(addDays(week, 6))}</button>
            <button className="p-2" aria-label="Next week" onClick={() => void load(addDays(week, 7))}><ChevronRight className="w-4 h-4" /></button>
          </div>
          {data.canManage && <button className={btnGhost} onClick={() => { setTargets(data.config.platforms.map((p) => ({ ...p }))); setTargetsOpen(true); }}><Target className="w-3.5 h-3.5" /> Targets</button>}
          {weekPosts.length === 0 && <button className={btnGhost} disabled={busy} onClick={() => void run(() => crmCall('media_copy_week', { weekStart: week }))} data-copy-week><Copy className="w-3.5 h-3.5" /> Copy last week</button>}
          <button className={btnPrimary} onClick={() => setEditing(emptyPost(days.find((d) => d >= today) || week, data.config.platforms[0]?.id || '', data.members.some((m) => m.id === me && m.media) ? me : ''))} data-plan-post><Plus className="w-3.5 h-3.5" /> Plan a post</button>
        </div>
      </div>
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      {/* this week against targets */}
      <div className={`${cardCls} p-4`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100" data-week-score>
            {totalPosted} of {totalTarget} posts done this week
            {lateCount > 0 && <span className="ml-2 text-red-600 dark:text-red-400">· {lateCount} missed</span>}
          </p>
          <p className="text-xs text-slate-500">{week <= today && today <= addDays(week, 6) ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : week > today ? 'Upcoming week' : 'Past week'}</p>
        </div>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {progress.map((p) => {
            const pct = p.target ? Math.min(100, Math.round((p.posted / p.target) * 100)) : 0;
            const short = Math.max(0, p.target - p.posted);
            return (
              <button key={p.id} type="button" onClick={() => setFilter(filter === p.id ? 'all' : p.id)} className={`text-left rounded-lg p-2 -m-1 ${filter === p.id ? 'bg-slate-100 dark:bg-slate-800' : ''}`}>
                <div className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-200"><i className="w-2 h-2 rounded-full" style={{ background: colorOf(p.id) }} />{p.name}</span>
                  <span className="tabular-nums font-semibold text-slate-900 dark:text-slate-100">{p.posted}/{p.target}</span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: colorOf(p.id) }} /></div>
                <p className="mt-1 text-[10.5px] text-slate-500">{short === 0 && p.target > 0 ? 'Target met' : p.target === 0 ? 'No target' : `${short} more needed${p.planned - p.posted > 0 ? ` · ${p.planned - p.posted} planned` : ''}`}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* the week */}
      <div className="grid gap-3 md:grid-cols-7" data-week-grid>
        {days.map((d, i) => {
          const list = weekPosts.filter((p) => p.date === d).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
          const isToday = d === today;
          return (
            <div key={d} className={`rounded-xl border p-2 md:min-h-[120px] ${isToday ? 'border-blue-400 bg-blue-50/40 dark:bg-blue-950/20' : 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40'}`}>
              <div className="flex items-center justify-between px-0.5 pb-2">
                <span className={`text-xs font-semibold ${isToday ? 'text-blue-700 dark:text-blue-300' : 'text-slate-600 dark:text-slate-300'}`}>{DAY[i]} {nice(d, { day: 'numeric' })}{isToday ? ' · Today' : ''}</span>
                <button className="rounded p-1 text-slate-400 hover:text-slate-700 hover:bg-white dark:hover:bg-slate-800" aria-label={`Plan a post on ${DAY[i]}`} onClick={() => setEditing(emptyPost(d, data.config.platforms[0]?.id || '', data.members.some((m) => m.id === me && m.media) ? me : ''))}><Plus className="w-3.5 h-3.5" /></button>
              </div>
              <div className="space-y-1.5">
                {list.map((p) => <PostCard key={p.id} p={p} />)}
                {list.length === 0 && <p className="px-1 pb-1 md:py-2 text-[11px] text-slate-400">Nothing planned</p>}
              </div>
            </div>
          );
        })}
      </div>

      {/* record */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={`${cardCls} p-4`}>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Last 8 weeks</p>
          <p className="text-xs text-slate-500">Posts done each week. The line is this week’s target ({totalTarget}).</p>
          <div className="relative mt-4 flex h-28 items-end gap-2">
            <div className="absolute inset-x-0 border-t border-dashed border-slate-400" style={{ bottom: `${(totalTarget / maxHist) * 100}%` }} />
            {history.map((h) => (
              <div key={h.week} className="flex-1 flex flex-col items-center justify-end h-full">
                <span className="text-[10px] tabular-nums text-slate-500">{h.posted}</span>
                <div className={`w-full rounded-t ${h.posted >= totalTarget && totalTarget > 0 ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-slate-600'}`} style={{ height: `${(h.posted / maxHist) * 100}%`, minHeight: 2 }} />
                <span className="mt-1 text-[9.5px] text-slate-400">{nice(h.week)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className={`${cardCls} p-4`}>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Media team record</p>
          <p className="text-xs text-slate-500">Last 8 weeks. Tap a name to see only their posts.</p>
          <table className="mt-3 w-full text-xs">
            <thead><tr className="text-left text-slate-500"><th className="py-1 font-medium">Name</th><th className="font-medium text-right">Posted</th><th className="font-medium text-right">On time</th><th className="font-medium text-right">Missed</th></tr></thead>
            <tbody>
              {people.map((m) => (
                <tr key={m.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1.5"><button className={`font-medium ${filter === m.id ? 'text-blue-700' : 'text-slate-800 dark:text-slate-200'}`} onClick={() => setFilter(filter === m.id ? 'all' : m.id)}>{m.name}</button></td>
                  <td className="text-right tabular-nums">{m.posted}</td>
                  <td className="text-right tabular-nums">{m.posted ? `${Math.round((m.onTime / m.posted) * 100)}%` : '—'}</td>
                  <td className={`text-right tabular-nums ${m.missed ? 'text-red-600 font-semibold' : ''}`}>{m.missed}</td>
                </tr>
              ))}
              {people.length === 0 && <tr><td colSpan={4} className="py-3 text-slate-500">No one is in the Media Team yet. Admin can switch it on in the Employee Directory.</td></tr>}
            </tbody>
          </table>
          {data.config.platforms.some((p) => p.handle) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {data.config.platforms.filter((p) => p.handle).map((p) => <a key={p.id} href={p.handle} target="_blank" rel="noreferrer" className={btnGhost}><ExternalLink className="w-3.5 h-3.5" /> {p.name}</a>)}
            </div>
          )}
        </div>
      </div>

      {/* plan / edit */}
      <Modal isOpen={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.id ? 'Edit post' : 'Plan a post'} maxWidth="lg">
        {editing && (
          <form onSubmit={save} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date"><input type="date" className={inputCls} value={editing.date || ''} onChange={(e) => setEditing({ ...editing, date: e.target.value })} required /></Field>
              <Field label="Time (optional)"><input type="time" className={inputCls} value={editing.time || ''} onChange={(e) => setEditing({ ...editing, time: e.target.value })} /></Field>
              <Field label="Platform">
                <select className={inputCls} value={editing.platform} onChange={(e) => setEditing({ ...editing, platform: e.target.value })}>
                  {data.config.platforms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Type">
                <select className={inputCls} value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value })}>
                  {Object.entries(data.kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Title / idea"><input className={inputCls} value={editing.title || ''} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="e.g. Umrah December packages reel" required maxLength={160} /></Field>
            <Field label="Caption (optional)"><textarea className={`${inputCls} min-h-[70px]`} value={editing.caption || ''} onChange={(e) => setEditing({ ...editing, caption: e.target.value })} maxLength={2200} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Who posts it">
                <select className={inputCls} value={editing.assignee || ''} onChange={(e) => setEditing({ ...editing, assignee: e.target.value || null })}>
                  <option value="">Anyone in the media team</option>
                  {data.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </Field>
              <Field label="Notes (optional)"><input className={inputCls} value={editing.notes || ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} maxLength={600} /></Field>
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className={btnGhost} onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className={btnPrimary} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        )}
      </Modal>

      {/* one post */}
      <Modal isOpen={Boolean(open)} onClose={() => setOpen(null)} title={open?.title || ''} subtitle={open ? `${plat.get(open.platform)?.name || open.platform} · ${data.kinds[open.kind] || open.kind} · ${nice(open.date, { weekday: 'long', day: 'numeric', month: 'short' })}${open.time ? ` at ${open.time}` : ''}` : ''} maxWidth="md">
        {open && (
          <div className="space-y-3 text-sm">
            <p className="text-xs text-slate-500">By {open.assignee ? name.get(open.assignee) || 'Former employee' : 'anyone in the media team'}{missed(open, today) ? ' · This post was missed' : ''}</p>
            {open.caption && <p className="whitespace-pre-wrap rounded-lg bg-slate-50 dark:bg-slate-800 p-3 text-xs">{open.caption}</p>}
            {open.notes && <p className="text-xs text-slate-600 dark:text-slate-300">Notes: {open.notes}</p>}
            {open.status === 'posted' && open.link && <a href={open.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700"><ExternalLink className="w-3.5 h-3.5" /> Open the live post</a>}
            {open.status !== 'posted' && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-2">
                <Field label="Link of the live post"><div className="relative"><Link2 className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400" /><input className={`${inputCls} pl-8`} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://instagram.com/p/…" inputMode="url" /></div></Field>
                <button className={`${btnPrimary} w-full`} disabled={busy} onClick={() => void setStatus(open, 'posted')} data-mark-posted><Check className="w-3.5 h-3.5" /> Mark as posted</button>
              </div>
            )}
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex flex-wrap gap-2">
              {open.status === 'planned' && <button className={btnGhost} disabled={busy} onClick={() => void setStatus(open, 'ready')}>Design ready</button>}
              {open.status !== 'planned' && <button className={btnGhost} disabled={busy} onClick={() => void setStatus(open, 'planned')}>Back to planned</button>}
              {open.status !== 'skipped' && open.status !== 'posted' && <button className={btnGhost} disabled={busy} onClick={() => void setStatus(open, 'skipped')}>Skip this one</button>}
              <button className={btnGhost} onClick={() => { setEditing({ ...open }); setOpen(null); }}><Pencil className="w-3.5 h-3.5" /> Edit</button>
              {(data.canManage || open.createdBy === me) && <button className={btnDanger} disabled={busy} onClick={() => { if (window.confirm('Delete this post from the calendar?')) void run(() => crmCall('media_delete', { id: open.id })).then((ok) => ok && setOpen(null)); }}><Trash2 className="w-3.5 h-3.5" /></button>}
            </div>
          </div>
        )}
      </Modal>

      {/* weekly targets (Admin / CEO) */}
      <Modal isOpen={targetsOpen} onClose={() => setTargetsOpen(false)} title="Weekly targets" subtitle="How many posts each platform needs every week" maxWidth="md">
        <div className="space-y-2">
          {targets.map((p, i) => (
            <div key={i} className="grid grid-cols-[1fr_70px_1fr_auto] gap-2 items-center">
              <input className={inputCls} value={p.name} onChange={(e) => setTargets(targets.map((t, j) => (j === i ? { ...t, name: e.target.value } : t)))} aria-label="Platform name" />
              <input className={inputCls} type="number" min={0} max={50} value={p.target} onChange={(e) => setTargets(targets.map((t, j) => (j === i ? { ...t, target: Number(e.target.value) } : t)))} aria-label="Posts per week" />
              <input className={inputCls} value={p.handle} placeholder="Page link (optional)" onChange={(e) => setTargets(targets.map((t, j) => (j === i ? { ...t, handle: e.target.value } : t)))} aria-label="Page link" />
              <button className="p-2 text-slate-400 hover:text-red-600" aria-label="Remove platform" onClick={() => setTargets(targets.filter((_, j) => j !== i))}><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
          <button className={btnGhost} onClick={() => setTargets([...targets, { id: '', name: '', target: 1, handle: '' }])}><Plus className="w-3.5 h-3.5" /> Add platform</button>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button className={btnGhost} onClick={() => setTargetsOpen(false)}>Cancel</button>
            <button className={btnPrimary} disabled={busy} onClick={() => void run(() => crmCall('media_config_save', { platforms: targets })).then((ok) => ok && setTargetsOpen(false))}>Save targets</button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default MediaCalendarView;
