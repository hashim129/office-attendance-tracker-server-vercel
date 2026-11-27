import React, { useCallback, useEffect, useState } from 'react';
import { crmCall } from '../../crm/crmApi';

type Ann = { id: string; title: string; body: string; byName: string; at: string; seenByMe: boolean; seenCount?: number; total?: number; notSeen?: string[] };
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** Shows each new announcement once (until "Got it"). */
export const AnnouncementPopup: React.FC<{ trigger: string }> = ({ trigger }) => {
  const [item, setItem] = useState<Ann | null>(null);
  useEffect(() => {
    crmCall<{ items: Ann[] }>('announcement_list').then((r) => setItem(r.items.find((a) => !a.seenByMe) || null)).catch(() => null);
  }, [trigger]);
  if (!item) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true" data-app-modal data-announcement>
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-2xl">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-600">Announcement</p>
        <h3 className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">{item.title}</h3>
        {item.body && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{item.body}</p>}
        <p className="mt-3 text-[11px] text-slate-500">{item.byName} · {when(item.at)}</p>
        <button className="mt-4 w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white" onClick={() => { const id = item.id; setItem(null); void crmCall('announcement_seen', { id }).catch(() => null); }}>Got it</button>
      </div>
    </div>
  );
};

/** Admin / CEO: post announcements and see who has read them. */
export const AnnouncementsAdmin: React.FC = () => {
  const [items, setItems] = useState<Ann[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = useCallback(() => crmCall<{ items: Ann[] }>('announcement_list').then((r) => setItems(r.items)).catch(() => null), []);
  useEffect(() => { void load(); }, [load]);
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3" data-announcements-admin>
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Announcements</p>
      <div className="grid gap-2">
        <input className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs" placeholder="Title, e.g. Office closed on Friday" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs min-h-[60px]" placeholder="Message (optional)" value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} />
        {err && <p className="text-xs text-red-600">{err}</p>}
        <button className="justify-self-end rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50" disabled={busy || !title.trim()}
          onClick={async () => { setBusy(true); setErr(''); try { await crmCall('announcement_post', { title, body }); setTitle(''); setBody(''); await load(); } catch (e: any) { setErr(e?.message || 'Could not post.'); } finally { setBusy(false); } }}>
          Post to everyone
        </button>
      </div>
      {items.map((a) => (
        <div key={a.id} className="border-t border-slate-100 dark:border-slate-800 pt-2 text-xs">
          <div className="flex items-start justify-between gap-2">
            <div><p className="font-semibold text-slate-800 dark:text-slate-200">{a.title}</p><p className="text-slate-500">{when(a.at)} · seen by {a.seenCount ?? 0} of {a.total ?? 0}</p></div>
            <button className="text-slate-400 hover:text-red-600" onClick={() => void crmCall('announcement_delete', { id: a.id }).then(load)}>Remove</button>
          </div>
          {a.notSeen && a.notSeen.length > 0 && <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">Not seen yet: {a.notSeen.join(', ')}</p>}
        </div>
      ))}
    </div>
  );
};
