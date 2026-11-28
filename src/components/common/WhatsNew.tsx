import React, { useEffect, useMemo, useState } from 'react';
import type { ActiveDesktopTab, Employee } from '../../types';
import { WHATS_NEW, stepFor, type WhatsNewRelease } from '../../lib/whatsNew';
import { crmCall } from '../../crm/crmApi';
import { inPhoneApp } from '../../lib/phoneApp';

const LOCAL = (id: string) => `bahaar_whatsnew_seen_${id}`;
const localSeen = (uid: string): string[] => { try { return JSON.parse(localStorage.getItem(LOCAL(uid)) || '[]'); } catch { return []; } };

/**
 * Must-see walkthrough after every update: each new release opens once for every person (on any device),
 * step by step, until they reach “Got it”. Can be opened again from the menu (“What’s new”).
 */
export const WhatsNewWalkthrough: React.FC<{ currentUser: Employee; onNavigate: (tab: ActiveDesktopTab) => void; openRequest: number }> = ({ currentUser, onNavigate, openRequest }) => {
  const [release, setRelease] = useState<WhatsNewRelease | null>(null);
  const [i, setI] = useState(0);
  const latest = WHATS_NEW[0];

  // first sign-in after an update: show it if this person has not gone through it yet
  useEffect(() => {
    if (!latest) return;
    if (localSeen(currentUser.id).includes(latest.id)) return;
    let alive = true;
    crmCall<{ seen: string[] }>('whatsnew_mine')
      .then((r) => { if (!alive) return; if (r.seen.includes(latest.id)) { try { localStorage.setItem(LOCAL(currentUser.id), JSON.stringify([...localSeen(currentUser.id), latest.id])); } catch { /* ignore */ } } else { setRelease(latest); setI(0); } })
      .catch(() => { if (alive) { setRelease(latest); setI(0); } });
    return () => { alive = false; };
  }, [currentUser.id, latest?.id]);

  // opened again from the menu
  useEffect(() => { if (openRequest > 0 && latest) { setRelease(latest); setI(0); } }, [openRequest]);

  const steps = useMemo(() => (release ? release.steps.filter((s) => stepFor(s, currentUser, inPhoneApp())) : []), [release, currentUser]);
  if (!release || steps.length === 0) return null;
  const step = steps[Math.min(i, steps.length - 1)];
  const last = i >= steps.length - 1;
  const finish = () => {
    try { localStorage.setItem(LOCAL(currentUser.id), JSON.stringify([...new Set([...localSeen(currentUser.id), release.id])])); } catch { /* ignore */ }
    void crmCall('whatsnew_seen', { id: release.id }).catch(() => null);
    setRelease(null);
  };
  return (
    <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-slate-900/55 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="What’s new" data-app-modal data-whats-new>
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 px-5 py-4 text-white">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-white/80">What’s new · {release.date}</p>
          <p className="text-lg font-bold leading-tight">{release.title}</p>
          <div className="mt-3 flex gap-1" aria-hidden>{steps.map((_, k) => <span key={k} className={`h-1 flex-1 rounded-full ${k <= i ? 'bg-white' : 'bg-white/30'}`} />)}</div>
        </div>
        <div className="px-5 py-4 min-h-[170px]">
          <p className="text-[11px] font-semibold text-slate-400">{i + 1} of {steps.length}</p>
          <h3 className="mt-1 text-base font-bold text-slate-900 dark:text-slate-100" data-whats-new-title>{step.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">{step.text}</p>
          {step.where && <p className="mt-3 inline-flex rounded-lg bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-[11.5px] font-medium text-slate-600 dark:text-slate-300">Where: {step.where}</p>}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800 px-5 py-3">
          <button type="button" className="text-xs font-semibold text-slate-500 disabled:opacity-30" disabled={i === 0} onClick={() => setI((k) => Math.max(0, k - 1))}>← Back</button>
          <div className="flex gap-2">
            {step.tab && <button type="button" className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200" onClick={() => { onNavigate(step.tab!); }}>Show me</button>}
            {last
              ? <button type="button" className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white" onClick={finish} data-whats-new-done>Got it</button>
              : <button type="button" className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white" onClick={() => setI((k) => k + 1)} data-whats-new-next>Next →</button>}
          </div>
        </div>
      </div>
    </div>
  );
};
export default WhatsNewWalkthrough;
