import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Copy, ExternalLink, Target, Check, Trash2, Pencil, Link2 } from 'lucide-react';
import type { Employee } from '../types';
import { Modal } from '../components/common/Modal';
import { crmCall } from './crmApi';
import { btnGhost, btnPrimary, btnDanger, cardCls, inputCls, Field } from './ui';
import { downloadReportPdf } from '../lib/reportPdf';

/**
 * Media Team posting calendar: plan the week's posts per platform, mark each one posted with its live link,
 * and see at a glance whether every platform hits its weekly target. Admin / CEO set the targets.
 */
type Platform = { id: string; name: string; target: number; handle: string };
type Post = {
  id: string; date: string; time: string; platform: string; kind: string; title: string; caption: string;
  assignee: string | null; status: 'planned' | 'ready' | 'posted' | 'skipped'; link: string; links?: string[]; notes: string; createdBy: string | null; postedAt: string | null;
};
type Idea = { id: string; text: string; platform: string; byName: string; at: string };
type Data = { ideas?: Idea[]; today: string; weekStart: string; config: { platforms: Platform[] }; kinds: Record<string, string>; canManage: boolean; members: { id: string; name: string; media: boolean }[]; posts: Post[] };

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
  const [links, setLinks] = useState<string[]>(['']);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [targets, setTargets] = useState<Platform[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [view, setView] = useState<'week' | 'month'>('week');
  const [monthData, setMonthData] = useState<{ month: string; posts: Post[] } | null>(null);
  const [ideaText, setIdeaText] = useState('');
  const [fromIdea, setFromIdea] = useState<string | null>(null);
  const [reportMonth, setReportMonth] = useState(() => { const d = new Date(Date.now() + 5 * 3600e3); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); });

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


  const loadMonth = async (m: string) => { try { const r = await crmCall<{ month: string; posts: Post[] }>('media_month', { month: m }); setMonthData(r); } catch (e: any) { setError(e?.message || 'Could not load the month.'); } };
  const monthReport = async () => {
    try {
      const r = await crmCall<{ month: string; posts: Post[]; members: { id: string; name: string }[]; config: { platforms: Platform[] } }>('media_month', { month: reportMonth });
      const last = new Date(Date.UTC(Number(r.month.slice(0, 4)), Number(r.month.slice(5, 7)), 0)).getUTCDate();
      const weeks = last / 7;
      const label = new Date(`${r.month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      const missedIn = (p: Post) => (p.status === 'planned' || p.status === 'ready') && p.date < (data?.today || '');
      const perPlat = r.config.platforms.map((pl) => { const ps = r.posts.filter((p) => p.platform === pl.id); const done = ps.filter((p) => p.status === 'posted').length; const target = Math.round(pl.target * weeks); return { platform: pl.name, posted: String(done), target: String(target), pct: target ? `${Math.round((done / target) * 100)}%` : '—', missed: String(ps.filter(missedIn).length) }; });
      const perPerson = r.members.map((m) => { const ps = r.posts.filter((p) => p.assignee === m.id); return { name: m.name, posted: String(ps.filter((p) => p.status === 'posted').length), missed: String(ps.filter(missedIn).length) }; });
      const posted = r.posts.filter((p) => p.status === 'posted').length;
      const target = r.config.platforms.reduce((a, p) => a + Math.round(p.target * weeks), 0);
      await downloadReportPdf({
        title: `Media report · ${label}`, subtitle: 'Posts on our social media pages against the targets', companyName: 'Bahaar Journeys', generatedBy: currentUser.name,
        summary: [['Posts done', `${posted} of ${target} target`], ['Missed', String(r.posts.filter(missedIn).length)], ['Planned in total', String(r.posts.length)]],
        columns: [{ key: 'platform', label: 'Platform', width: 3 }, { key: 'posted', label: 'Posted', width: 1.2, align: 'right' }, { key: 'target', label: 'Target', width: 1.2, align: 'right' }, { key: 'pct', label: 'Done', width: 1.2, align: 'right' }, { key: 'missed', label: 'Missed', width: 1.2, align: 'right' }],
        rows: perPlat,
        sections: [
          { heading: 'By person', columns: [{ key: 'name', label: 'Name', width: 3 }, { key: 'posted', label: 'Posted', width: 1.2, align: 'right' }, { key: 'missed', label: 'Missed', width: 1.2, align: 'right' }], rows: perPerson },
          { heading: 'Every post', columns: [{ key: 'date', label: 'Date', width: 1.4 }, { key: 'platform', label: 'Platform', width: 1.6 }, { key: 'title', label: 'Title', width: 4 }, { key: 'status', label: 'Status', width: 1.3 }, { key: 'link', label: 'Link', width: 4 }], rows: r.posts.map((p) => ({ date: p.date, platform: r.config.platforms.find((x) => x.id === p.platform)?.name || p.platform, title: p.title, status: p.status === 'posted' ? 'Posted' : missedIn(p) ? 'Missed' : p.status === 'skipped' ? 'Skipped' : 'Planned', link: p.link || '' })) },
        ],
      }, `media-report-${r.month}`);
    } catch (e: any) { setError(e?.message || 'Could not make the report.'); }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const payload = { ...editing, links: (editing.links || []).map((l) => l.trim()).filter(Boolean) };
    if (await run(() => crmCall('media_save', { post: payload }))) {
      setEditing(null);
      if (fromIdea) { const idv = fromIdea; setFromIdea(null); await crmCall('media_idea_remove', { id: idv }).catch(() => null); await load(); }
    }
  };
  const setStatus = async (p: Post, status: Post['status']) => {
    if (await run(() => crmCall('media_status', { id: p.id, status, links: status === 'posted' ? links.map((l) => l.trim()).filter(Boolean) : [] }))) { setOpen(null); setLinks(['']); }
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
      <button type="button" onClick={() => { setOpen(p); setLinks(p.links && p.links.length ? p.links : ['']); }} data-media-post
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
          <div className="inline-flex rounded-lg border border-slate-300 dark:border-slate-700 overflow-hidden text-xs font-semibold" data-view-toggle>
            {(['week', 'month'] as const).map((v) => <button key={v} className={`px-3 py-2 ${view === v ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : ''}`} onClick={() => { setView(v); if (v === 'month') void loadMonth(week.slice(0, 7)); }}>{v === 'week' ? 'Week' : 'Month'}</button>)}
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

      {view === 'month' && monthData && (() => {
        const m = monthData.month;
        const first = new Date(`${m}-01T00:00:00Z`);
        const lead = (first.getUTCDay() + 6) % 7;
        const daysIn = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
        const cells = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => `${m}-${String(i + 1).padStart(2, '0')}`)];
        const shift = (n: number) => { const d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + n, 1)); void loadMonth(d.toISOString().slice(0, 7)); };
        return (
          <div className={`${cardCls} p-3`} data-month-grid>
            <div className="flex items-center justify-between mb-2">
              <button className="p-1.5" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft className="w-4 h-4" /></button>
              <p className="text-sm font-semibold">{first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</p>
              <button className="p-1.5" aria-label="Next month" onClick={() => shift(1)}><ChevronRight className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[10.5px] text-slate-500 mb-1">{DAY.map((d) => <span key={d}>{d}</span>)}</div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((d, i) => {
                if (!d) return <span key={`x${i}`} />;
                const ps = monthData.posts.filter((p) => p.date === d);
                const done = ps.filter((p) => p.status === 'posted').length;
                const late = ps.filter((p) => missed(p, today)).length;
                return (
                  <button key={d} onClick={() => { setView('week'); void load(d); }} className={`rounded-lg border p-1 min-h-[52px] text-left ${d === today ? 'border-blue-400' : 'border-slate-200 dark:border-slate-800'}`}>
                    <span className="block text-[11px] font-semibold">{Number(d.slice(8))}</span>
                    <span className="flex flex-wrap gap-0.5 mt-0.5">{ps.slice(0, 6).map((p) => <i key={p.id} className="w-1.5 h-1.5 rounded-full" style={{ background: colorOf(p.platform), opacity: p.status === 'posted' ? 1 : 0.35 }} />)}</span>
                    {ps.length > 0 && <span className={`block text-[9.5px] mt-0.5 ${late ? 'text-red-600' : 'text-slate-500'}`}>{done}/{ps.length}{late ? ` · ${late} missed` : ''}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* the week */}
      <div className={`grid gap-3 md:grid-cols-7 ${view === 'month' ? 'hidden' : ''}`} data-week-grid>
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

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={`${cardCls} p-4`} data-ideas>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Ideas bank</p>
          <p className="text-xs text-slate-500">Jot down ideas; tap “Plan it” to put one on the calendar.</p>
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!ideaText.trim()) return; void run(() => crmCall('media_idea_add', { text: ideaText })).then(() => setIdeaText('')); }}>
            <input className={inputCls} placeholder="e.g. Customer review video from the Baku group" value={ideaText} maxLength={300} onChange={(e) => setIdeaText(e.target.value)} />
            <button className={btnPrimary} type="submit" disabled={busy}>Add</button>
          </form>
          <ul className="mt-2 space-y-1.5 max-h-56 overflow-y-auto">
            {(data.ideas || []).map((i) => (
              <li key={i.id} className="flex items-start justify-between gap-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 px-2.5 py-2 text-xs">
                <span><span className="text-slate-800 dark:text-slate-200">{i.text}</span><span className="block text-[10.5px] text-slate-400">{i.byName}</span></span>
                <span className="flex shrink-0 gap-2">
                  <button className="font-semibold text-blue-600" onClick={() => { setFromIdea(i.id); setEditing({ ...emptyPost(days.find((d) => d >= today) || week, data.config.platforms[0]?.id || '', data.members.some((m) => m.id === me && m.media) ? me : ''), title: i.text.slice(0, 160) }); }}>Plan it</button>
                  <button className="text-slate-400" aria-label="Remove idea" onClick={() => void run(() => crmCall('media_idea_remove', { id: i.id }))}>×</button>
                </span>
              </li>
            ))}
            {(data.ideas || []).length === 0 && <li className="text-xs text-slate-400">No ideas yet.</li>}
          </ul>
        </div>
        <div className={`${cardCls} p-4`}>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Monthly report</p>
          <p className="text-xs text-slate-500">Posts per platform against the targets, per person, with every link. Admin gets a reminder on the 1st.</p>
          <div className="mt-3 flex gap-2">
            <input type="month" className={`${inputCls} w-40`} value={reportMonth} onChange={(e) => setReportMonth(e.target.value)} />
            <button className={btnPrimary} onClick={() => void monthReport()} data-media-report>Monthly report (PDF)</button>
          </div>
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
            <LinkInputs links={editing.links && editing.links.length ? editing.links : ['']} onChange={(v) => setEditing({ ...editing, links: v })} label="Link(s) of the live post (optional, adding one marks it posted)" />
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
            {open.status === 'posted' && (open.links || []).length > 0 && (
              <div className="flex flex-col gap-1" data-post-links>
                {(open.links || []).map((l, k) => <a key={l} href={l} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 break-all"><ExternalLink className="w-3.5 h-3.5 shrink-0" /> {(open.links || []).length > 1 ? `Live post ${k + 1}` : 'Open the live post'} <span className="font-normal text-slate-400 truncate">{l.replace(/^https?:\/\//, '').slice(0, 40)}</span></a>)}
              </div>
            )}
            {open.status !== 'posted' && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-2">
                <LinkInputs links={links} onChange={setLinks} />
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

/** One or more links (e.g. the same post on several pages, or a carousel in parts). */
function LinkInputs({ links, onChange, label = 'Link(s) of the live post' }: { links: string[]; onChange: (v: string[]) => void; label?: string }) {
  const list = links.length ? links : [''];
  return (
    <Field label={label}>
      <div className="space-y-1.5" data-link-inputs>
        {list.map((l, k) => (
          <div key={k} className="flex gap-1.5">
            <div className="relative flex-1"><Link2 className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400" />
              <input className={`${inputCls} pl-8`} value={l} onChange={(e) => onChange(list.map((x, j) => (j === k ? e.target.value : x)))} placeholder="https://instagram.com/p/…" inputMode="url" />
            </div>
            {list.length > 1 && <button type="button" className="px-2 text-slate-400 hover:text-red-600" aria-label="Remove link" onClick={() => onChange(list.filter((_, j) => j !== k))}>×</button>}
          </div>
        ))}
        {list.length < 12 && <button type="button" className="text-[11px] font-semibold text-blue-600" onClick={() => onChange([...list, ''])} data-add-link>+ Add another link</button>}
      </div>
    </Field>
  );
}
