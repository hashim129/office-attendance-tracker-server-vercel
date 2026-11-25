import React, { useEffect, useRef, useState } from 'react';
import { Bell, Clock, X } from 'lucide-react';
import { installSoundUnlock, playAlertSound } from './sound';
import { ActiveDesktopTab } from '../types';
import { CrmUpcoming, crmCall } from './crmApi';
import { CrmState } from './useCrm';
import { formatRemaining, isWorkPrompt } from './ui';

interface Toast {
  key: string;
  kind: 'deadline' | 'notice' | 'reminder';
  text: string;
  tab: ActiveDesktopTab;
  refId?: string;
  urgent?: boolean;
  ask?: boolean; // "Are you still working?" prompt with a confirm button
}

const SEEN_KEY = 'crm_alerts_seen_v1';
const loadSeen = (): Set<string> => {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(SEEN_KEY) || '[]'));
  } catch {
    return new Set();
  }
};
const saveSeen = (s: Set<string>) => {
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-300)));
  } catch {
    // storage may be blocked; alerts just repeat after a reload
  }
};

const WARN_MS = 15 * 60 * 1000;

/**
 * Live alerts on every page: a heads-up 15 minutes before a follow-up/meeting is due and another when it is due,
 * plus a pop-up for each new notification. Each alert shows once per sign-in session.
 */
export const LiveAlerts: React.FC<{ crm: CrmState; onOpen: (tab: ActiveDesktopTab, refId?: string) => void }> = ({ crm, onOpen }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seen = useRef<Set<string>>(loadSeen());
  useEffect(() => { installSoundUnlock(); }, []);
  const primed = useRef(false);
  const upcoming = crm.badges.upcoming;
  const latest = crm.badges.unreadLatest;

  const push = (t: Toast) => {
    if (seen.current.has(t.key)) return;
    seen.current.add(t.key);
    saveSeen(seen.current);
    setToasts((list) => [...list.filter((x) => x.key !== t.key), t].slice(-4));
    playAlertSound(t.kind === 'notice' ? 'notice' : 'warning');
    try {
      if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(t.kind === 'deadline' ? 'Deadline' : t.kind === 'reminder' ? 'Reminder' : 'New notification', { body: t.text, tag: t.key });
    } catch {
      // desktop alerts are optional
    }
    // a confirm prompt stays until answered (the next prompt comes within 5 minutes)
    if (t.kind !== 'deadline') window.setTimeout(() => setToasts((list) => list.filter((x) => x.key !== t.key)), t.ask ? 5 * 60 * 1000 : 20000);
  };

  // New notifications. The first load only records what is already waiting, so signing in does not flood the screen.
  useEffect(() => {
    if (!primed.current) {
      if (latest.length === 0 && crm.badges.unreadTotal === 0 && upcoming.length === 0 && !crm.data.history.length && crm.loading) return;
      primed.current = true;
      // Things already waiting at sign-in are not announced, except punch-out reminders (they are time-sensitive).
      latest.filter((n) => n.category !== 'reminder').forEach((n) => seen.current.add(`n:${n.id}`));
      saveSeen(seen.current);
    }
    latest.forEach((n) => push({
      key: `n:${n.id}`,
      kind: n.category === 'reminder' ? 'reminder' : 'notice',
      urgent: n.category === 'reminder',
      ask: n.category === 'reminder' && isWorkPrompt(n.id),
      text: n.message,
      refId: n.refId,
      tab: n.category === 'followup' ? 'crm-tasks' : n.category === 'meeting' ? 'crm-meetings' : n.category === 'sale' ? 'crm-sales' : n.category === 'invoice' ? 'crm-invoices' : n.category === 'receipt' ? 'crm-receipts' : n.category === 'customer' ? 'crm-customers' : n.category === 'reminder' ? 'clock' : 'crm-inventory',
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest]);

  // Deadlines: check every 5 seconds against the live clock.
  useEffect(() => {
    const check = () => {
      const now = Date.now();
      upcoming.forEach((u: CrmUpcoming) => {
        const at = Date.parse(u.at);
        if (!Number.isFinite(at)) return;
        const left = at - now;
        const tab: ActiveDesktopTab = u.kind === 'meeting' ? 'crm-meetings' : 'crm-tasks';
        if (left <= 0 && left > (u.kind === 'meeting' ? -120000 : -3600000)) push({ key: `d:${u.id}:${u.at}:now`, kind: 'deadline', urgent: true, text: `${u.title} — ${u.kind === 'meeting' ? 'starting now' : 'deadline reached'}.`, tab });
        else if (left > 0 && left <= WARN_MS) push({ key: `d:${u.id}:${u.at}:soon`, kind: 'deadline', text: `${u.title} — ${u.kind === 'meeting' ? 'starts' : 'due'} in ${formatRemaining(left)}.`, tab });
      });
    };
    check();
    const t = window.setInterval(check, 5000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upcoming]);

  const [confirming, setConfirming] = useState<string | null>(null);
  const confirmWorking = async (key: string) => {
    setConfirming(key);
    try {
      await crmCall('work_confirm');
      setToasts((l) => l.filter((x) => !x.ask));
      crm.refresh();
    } catch {
      // if it fails the prompt stays so the employee can tap again
    } finally {
      setConfirming(null);
    }
  };

  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-[6.25rem] right-4 z-[80] w-[min(92vw,22rem)] space-y-2" role="region" aria-label="Live alerts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.key} className={`rounded-xl border shadow-lg p-3 flex items-start gap-2.5 bg-white dark:bg-slate-900 ${t.urgent ? 'border-red-400 dark:border-red-700' : t.kind === 'deadline' ? 'border-amber-400 dark:border-amber-700' : 'border-blue-300 dark:border-blue-800'}`}>
          {t.kind !== 'notice' ? <Clock className={`w-4 h-4 mt-0.5 shrink-0 ${t.urgent ? 'text-red-600' : 'text-amber-600'}`} /> : <Bell className="w-4 h-4 mt-0.5 shrink-0 text-blue-600" />}
          <button className="flex-1 text-left text-xs text-slate-800 dark:text-slate-100 cursor-pointer" onClick={() => { onOpen(t.tab, t.refId); setToasts((l) => l.filter((x) => x.key !== t.key)); }}>
            <span className="block font-bold text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">{t.ask ? 'Are you still working?' : t.kind === 'reminder' ? 'Punch-out reminder' : t.kind === 'deadline' ? (t.urgent ? 'Deadline now' : 'Deadline soon') : 'New notification'}</span>
            {t.text}
          </button>
          {t.ask && (
            <button
              disabled={confirming === t.key}
              className="self-center shrink-0 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold px-2.5 py-1.5 cursor-pointer disabled:opacity-60"
              onClick={() => confirmWorking(t.key)}
            >
              {confirming === t.key ? '…' : "Yes, I'm working"}
            </button>
          )}
          <button aria-label="Dismiss" className="text-slate-400 hover:text-slate-700 cursor-pointer" onClick={() => setToasts((l) => l.filter((x) => x.key !== t.key))}><X className="w-3.5 h-3.5" /></button>
        </div>
      ))}
    </div>
  );
};
