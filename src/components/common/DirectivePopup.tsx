import React, { useEffect, useRef, useState } from 'react';
import { Megaphone, X } from 'lucide-react';
import { CeoComment } from '../../types';

interface Props {
  comments: CeoComment[];
  userId: string;
  onRead: (id: string) => void;
}

const SEEN_KEY = 'office_directive_popup_seen_v1';
const loadSeen = (): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { return new Set(); }
};
const saveSeen = (s: Set<string>) => {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(s).slice(-200))); } catch { /* ignore */ }
};

function ding() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [660, 880].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.start(t); o.stop(t + 0.32);
    });
  } catch { /* sound is optional */ }
}

/** Pops up in the middle of the screen whenever the CEO / an admin sends this person a directive or mention. */
export const DirectivePopup: React.FC<Props> = ({ comments, userId, onRead }) => {
  const [queue, setQueue] = useState<CeoComment[]>([]);
  const seen = useRef<Set<string>>(loadSeen());

  useEffect(() => {
    const fresh = comments.filter((c) => c.employeeId === userId && !c.isRead && !seen.current.has(c.id));
    if (fresh.length === 0) return;
    fresh.forEach((c) => seen.current.add(c.id));
    saveSeen(seen.current);
    setQueue((q) => [...q, ...fresh]);
    ding();
  }, [comments, userId]);

  const current = queue[0];
  if (!current) return null;
  const close = (markRead: boolean) => {
    if (markRead) onRead(current.id);
    setQueue((q) => q.slice(1));
  };
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="page-enter w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-indigo-200 dark:border-indigo-900 overflow-hidden">
        <div className="bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 text-white px-5 py-4 flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center"><Megaphone className="w-5 h-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-white/80">Message from management</p>
            <p className="text-base font-extrabold truncate">{current.fromName || 'Management'}</p>
          </div>
          <button type="button" onClick={() => close(false)} aria-label="Close for now" className="p-1.5 rounded-lg hover:bg-white/20"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-slate-800 dark:text-slate-100 whitespace-pre-wrap break-words leading-relaxed">{current.message}</p>
          <p className="text-[11px] text-slate-400 mt-2">{new Date(current.createdAt).toLocaleString()}</p>
        </div>
        <div className="px-5 pb-5 flex items-center justify-between gap-3">
          <span className="text-[11px] text-slate-400">{queue.length > 1 ? `${queue.length - 1} more waiting` : ''}</span>
          <button type="button" onClick={() => close(true)} className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold">Got it</button>
        </div>
      </div>
    </div>
  );
};
