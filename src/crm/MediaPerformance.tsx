import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Pencil, Trophy } from 'lucide-react';
import type { Employee } from '../types';
import { crmCall } from './crmApi';
import { btnGhost, btnPrimary, cardCls, inputCls, ErrorNote } from './ui';

/**
 * How the posted posts did: likes, comments, shares, views, saves and leads (enquiries) per post,
 * typed in by the Media Team, with simple charts by platform and by kind and the best five posts.
 */
const KEYS = ['views', 'likes', 'comments', 'shares', 'saves', 'leads'] as const;
type Key = typeof KEYS[number];
type Stats = Record<Key, number>;
type Post = {
  id: string; date: string; time: string; platform: string; kind: string; title: string; links: string[];
  assignee: string | null; assigneeName: string; stats: Stats | null; statsUpdatedAt: string | null; statsUpdatedByName: string;
};
type Data = { from: string; to: string; kinds: Record<string, string>; platforms: { id: string; name: string }[]; posts: Post[] };

const LABEL: Record<Key, string> = { views: 'Views', likes: 'Likes', comments: 'Comments', shares: 'Shares', saves: 'Saves', leads: 'Leads' };
const COLORS: Record<string, string> = { instagram: '#c13584', facebook: '#1877f2', tiktok: '#111827', youtube: '#e11d1d', linkedin: '#0a66c2', whatsapp: '#16a34a', x: '#334155', twitter: '#334155', snapchat: '#eab308', pinterest: '#e60023' };
const colorOf = (id: string) => COLORS[id] || '#64748b';
const thisMonth = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 7);
const shiftMonth = (m: string, n: number) => { const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const lastDay = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const nice = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const short = (n: number) => (n >= 1e6 ? `${Math.round(n / 1e5) / 10}M` : n >= 1e4 ? `${Math.round(n / 100) / 10}k` : Math.round(n).toLocaleString('en-US'));
const zero = (): Stats => ({ views: 0, likes: 0, comments: 0, shares: 0, saves: 0, leads: 0 });

/** Two thin bars per row (views and leads), each scaled to its own largest value. */
const PairBars: React.FC<{ title: string; rows: { key: string; label: string; color: string; views: number; leads: number; posts: number }[] }> = ({ title, rows }) => {
  const maxV = Math.max(1, ...rows.map((r) => r.views));
  const maxL = Math.max(1, ...rows.map((r) => r.leads));
  return (
    <div className={`${cardCls} p-3`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">{title}</h3>
        <span className="flex gap-3 text-[10px] text-slate-500">
          <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-sky-500" />Views</span>
          <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />Leads</span>
        </span>
      </div>
      {rows.length === 0 ? <p className="text-[11px] text-slate-500">No numbers yet.</p> : (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.key}>
              <div className="flex items-center justify-between text-[11px] mb-0.5 gap-2">
                <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-200 min-w-0 truncate"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.color }} />{r.label}<span className="font-normal text-slate-400">· {r.posts} post{r.posts === 1 ? '' : 's'}</span></span>
                <span className="tabular-nums text-slate-500 shrink-0">{short(r.views)} views · <b className="text-emerald-700 dark:text-emerald-400">{short(r.leads)} leads</b></span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden"><div className="h-full rounded-full bg-sky-500" style={{ width: `${(r.views / maxV) * 100}%` }} /></div>
              <div className="h-1.5 mt-0.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${(r.leads / maxL) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const MediaPerformance: React.FC<{ currentUser: Employee }> = ({ currentUser }) => {
  const [month, setMonth] = useState(thisMonth());
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<Key, string>>({ views: '', likes: '', comments: '', shares: '', saves: '', leads: '' });
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<'all' | 'missing'>('all');

  const load = useCallback(async (m: string) => {
    setLoading(true);
    try {
      const r = await crmCall<Data>('staff_media_stats_list', { from: `${m}-01`, to: lastDay(m) });
      setD(r); setErr('');
    } catch (e) {
      setErr((e as Error)?.message || 'Could not load the posts.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { setEditing(null); void load(month); }, [month, load, currentUser.id]);

  const platName = useMemo(() => Object.fromEntries((d?.platforms || []).map((p) => [p.id, p.name])), [d]);
  const kindName = (k: string) => d?.kinds?.[k] || k;

  const open = (p: Post) => {
    setEditing(p.id);
    setDraft(Object.fromEntries(KEYS.map((k) => [k, p.stats ? String(p.stats[k] || '') : ''])) as Record<Key, string>);
  };
  const save = async (p: Post) => {
    setSaving(true); setErr('');
    try {
      const stats = Object.fromEntries(KEYS.map((k) => [k, draft[k].replace(/[^\d]/g, '') || '0']));
      const r = await crmCall<{ postId: string; stats: Stats; statsUpdatedAt: string; statsUpdatedByName: string }>('staff_media_stats_save', { postId: p.id, stats });
      setD((cur) => cur ? { ...cur, posts: cur.posts.map((x) => x.id === p.id ? { ...x, stats: r.stats, statsUpdatedAt: r.statsUpdatedAt, statsUpdatedByName: r.statsUpdatedByName } : x) } : cur);
      setEditing(null);
    } catch (e) {
      setErr((e as Error)?.message || 'Could not save the numbers.');
    } finally {
      setSaving(false);
    }
  };

  const posts = d?.posts || [];
  const withStats = posts.filter((p) => p.stats);
  const totals = withStats.reduce((a, p) => { for (const k of KEYS) a[k] += p.stats![k]; return a; }, zero());
  const group = (keyOf: (p: Post) => string, labelOf: (k: string) => string, colorFor: (k: string) => string) => {
    const m = new Map<string, { key: string; label: string; color: string; views: number; leads: number; posts: number }>();
    for (const p of withStats) {
      const k = keyOf(p);
      const g = m.get(k) || { key: k, label: labelOf(k), color: colorFor(k), views: 0, leads: 0, posts: 0 };
      g.views += p.stats!.views; g.leads += p.stats!.leads; g.posts += 1;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.leads - a.leads || b.views - a.views);
  };
  const byPlatform = group((p) => p.platform, (k) => platName[k] || k, colorOf);
  const KIND_COLORS = ['#6366f1', '#f59e0b', '#ec4899', '#14b8a6', '#8b5cf6', '#0ea5e9', '#84cc16'];
  const kindKeys = Object.keys(d?.kinds || {});
  const byKind = group((p) => p.kind, kindName, (k) => KIND_COLORS[Math.max(0, kindKeys.indexOf(k)) % KIND_COLORS.length]);
  const best = [...withStats].sort((a, b) => b.stats!.leads - a.stats!.leads || b.stats!.views - a.stats!.views || b.stats!.likes - a.stats!.likes).slice(0, 5);
  const shown = filter === 'missing' ? posts.filter((p) => !p.stats) : posts;
  const tall = 'min-h-10';

  return (
    <div className="space-y-4" data-media-performance>
      <div className={`${cardCls} p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between`}>
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Post performance</h2>
          <p className="text-xs text-slate-500">Add the numbers for each live post. Leads = enquiries that came from the post.</p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className={`${btnGhost} ${tall} px-2.5`} onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month"><ChevronLeft className="w-4 h-4" /></button>
          <input type="month" aria-label="Month" className={`${inputCls} ${tall} w-40`} value={month} max={thisMonth()} onChange={(e) => setMonth(e.target.value || thisMonth())} />
          <button type="button" className={`${btnGhost} ${tall} px-2.5`} onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= thisMonth()} aria-label="Next month"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>

      <ErrorNote message={err} />

      {loading && !d && <div className="grid gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className={`${cardCls} h-28 animate-pulse bg-slate-100 dark:bg-slate-800/60`} />)}</div>}

      {d && posts.length === 0 && (
        <div className={`${cardCls} p-6 text-center`}>
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">No posted posts in {monthName(month)}</p>
          <p className="text-xs text-slate-500 mt-1">Posts show up here once they are marked posted in the calendar.</p>
        </div>
      )}

      {d && posts.length > 0 && (
        <div className={`space-y-4 ${loading ? 'opacity-60' : ''}`}>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {KEYS.map((k) => (
              <div key={k} className={`${cardCls} p-2.5`}>
                <p className="text-[10px] text-slate-500">{LABEL[k]}</p>
                <p className={`text-sm font-bold tabular-nums ${k === 'leads' ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-900 dark:text-slate-100'}`}>{short(totals[k])}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-500">{withStats.length} of {posts.length} posts have numbers.</p>

          <div className="grid gap-3 lg:grid-cols-3">
            <PairBars title="By platform" rows={byPlatform} />
            <PairBars title="By kind" rows={byKind} />
            <div className={`${cardCls} p-3`}>
              <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 mb-2 inline-flex items-center gap-1.5"><Trophy className="w-3.5 h-3.5 text-amber-500" /> Best 5 posts</h3>
              {best.length === 0 ? <p className="text-[11px] text-slate-500">Add numbers to see the best posts.</p> : (
                <ol className="space-y-2">
                  {best.map((p, i) => (
                    <li key={p.id} className="flex items-start gap-2">
                      <span className="w-5 h-5 shrink-0 rounded-full bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">{p.title || 'Untitled post'}</p>
                        <p className="text-[10px] text-slate-500">{platName[p.platform] || p.platform} · {kindName(p.kind)} · {nice(p.date)} · <b className="text-emerald-700 dark:text-emerald-400">{short(p.stats!.leads)} leads</b> · {short(p.stats!.views)} views</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={`${filter === 'all' ? btnPrimary : btnGhost} ${tall}`} onClick={() => setFilter('all')}>All posts ({posts.length})</button>
            <button type="button" className={`${filter === 'missing' ? btnPrimary : btnGhost} ${tall}`} onClick={() => setFilter('missing')}>Need numbers ({posts.length - withStats.length})</button>
          </div>

          {shown.length === 0 && <p className="text-xs text-slate-500">Every post has its numbers. Nice work.</p>}
          <div className="grid gap-2 md:grid-cols-2">
            {shown.map((p) => (
              <div key={p.id} className={`${cardCls} p-3 border-l-4`} style={{ borderLeftColor: colorOf(p.platform) }} data-mstat-post={p.id}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">{p.title || 'Untitled post'}</p>
                    <p className="text-[10px] text-slate-500">{platName[p.platform] || p.platform} · {kindName(p.kind)} · {nice(p.date)}{p.time ? ` ${p.time}` : ''}{p.assigneeName ? ` · ${p.assigneeName}` : ''}</p>
                  </div>
                  {p.links[0] && <a href={p.links[0]} target="_blank" rel="noopener noreferrer" className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Open the post"><ExternalLink className="w-4 h-4" /></a>}
                  {editing !== p.id && (
                    <button type="button" className={`${p.stats ? btnGhost : btnPrimary} ${tall}`} onClick={() => open(p)}>
                      <Pencil className="w-3.5 h-3.5" /> {p.stats ? 'Edit' : 'Add numbers'}
                    </button>
                  )}
                </div>
                {editing === p.id ? (
                  <form className="mt-2 space-y-2" onSubmit={(e) => { e.preventDefault(); void save(p); }}>
                    <div className="grid grid-cols-3 gap-2">
                      {KEYS.map((k, i) => (
                        <label key={k} className="block">
                          <span className="block text-[10px] font-semibold text-slate-500 mb-0.5">{LABEL[k]}</span>
                          <input
                            className={`${inputCls} ${tall} text-sm tabular-nums`} inputMode="numeric" pattern="[0-9]*" autoFocus={i === 0}
                            value={draft[k]} placeholder="0" onChange={(e) => setDraft({ ...draft, [k]: e.target.value.replace(/[^\d]/g, '').slice(0, 11) })}
                          />
                        </label>
                      ))}
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button type="button" className={`${btnGhost} ${tall}`} onClick={() => setEditing(null)}>Cancel</button>
                      <button type="submit" className={`${btnPrimary} ${tall}`} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                    </div>
                  </form>
                ) : p.stats ? (
                  <div className="mt-2 grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                    {KEYS.map((k) => (
                      <div key={k} className="rounded-md bg-slate-50 dark:bg-slate-800/60 px-1.5 py-1 text-center">
                        <p className="text-[9px] text-slate-500">{LABEL[k]}</p>
                        <p className={`text-xs font-bold tabular-nums ${k === 'leads' ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-200'}`}>{short(p.stats![k])}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
                {p.stats && p.statsUpdatedByName && editing !== p.id && <p className="text-[10px] text-slate-400 mt-1">Updated by {p.statsUpdatedByName}{p.statsUpdatedAt ? ` · ${new Date(p.statsUpdatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default MediaPerformance;
