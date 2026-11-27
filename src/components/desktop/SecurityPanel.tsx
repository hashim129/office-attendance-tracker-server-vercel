import React, { useEffect, useState } from 'react';
import { crmCall } from '../../crm/crmApi';

/** Office Settings (Admin / CEO): background timer + nightly backup health, and the activity log. */
const ago = (iso: string | null) => {
  if (!iso) return null;
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export const SecurityPanel: React.FC = () => {
  const [status, setStatus] = useState<{ lastTickAt: string | null; lastBackupAt: string | null } | null>(null);
  const [items, setItems] = useState<{ id: string; at: string; actorName: string; action: string; detail: string; ip: string }[]>([]);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    crmCall('system_status').then(setStatus).catch((e) => setErr(e?.message || ''));
    crmCall<{ items: any[] }>('audit_list').then((r) => setItems(r.items || [])).catch(() => null);
  }, []);
  const tickOk = status?.lastTickAt && Date.now() - Date.parse(status.lastTickAt) < 10 * 60000;
  const backupOk = status?.lastBackupAt && Date.now() - Date.parse(status.lastBackupAt) < 26 * 3600000;
  const shown = items.filter((i) => !q || `${i.actorName} ${i.action} ${i.detail} ${i.ip}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-4" data-security-panel>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
          <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">Reminder timer</p>
          <p className={`mt-1 text-sm font-semibold ${tickOk ? 'text-emerald-600' : 'text-amber-600'}`}>{status ? (tickOk ? 'Running' : 'Not running') : '…'}</p>
          <p className="text-[11px] text-slate-500">Last run: {ago(status?.lastTickAt || null) || 'never'}. Runs every 2 minutes so reminders and auto punch-out happen on time even when nobody has the app open.</p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
          <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">Nightly Google Drive backup</p>
          <p className={`mt-1 text-sm font-semibold ${backupOk ? 'text-emerald-600' : 'text-red-600'}`}>{status ? (backupOk ? 'Working' : 'Not received') : '…'}</p>
          <p className="text-[11px] text-slate-500">Last backup: {status?.lastBackupAt ? `${when(status.lastBackupAt)} (${ago(status.lastBackupAt)})` : 'none received yet'}. You get a notification if a night is missed.</p>
        </div>
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Activity log</p>
            <p className="text-[11px] text-slate-500">Sign-ins, wrong passwords, access and settings changes, deletions and exports (last 300).</p>
          </div>
          <input className="w-full sm:w-56 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs" placeholder="Search name or action" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="mt-3 max-h-96 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white dark:bg-slate-900"><tr className="text-left text-slate-500"><th className="py-1 font-medium">When</th><th className="font-medium">Who</th><th className="font-medium">What</th><th className="font-medium hidden sm:table-cell">IP</th></tr></thead>
            <tbody>
              {shown.map((i) => (
                <tr key={i.id} className="border-t border-slate-100 dark:border-slate-800 align-top">
                  <td className="py-1.5 pr-2 whitespace-nowrap text-slate-500">{when(i.at)}</td>
                  <td className="pr-2 font-medium text-slate-800 dark:text-slate-200">{i.actorName || '—'}</td>
                  <td className={`pr-2 ${/wrong|blocked|declined|deleted/.test(i.action) ? 'text-red-600' : 'text-slate-700 dark:text-slate-300'}`}>{i.action}{i.detail ? <span className="text-slate-500"> · {i.detail}</span> : null}</td>
                  <td className="hidden sm:table-cell text-slate-400">{i.ip}</td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={4} className="py-3 text-slate-500">Nothing logged yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
export default SecurityPanel;
