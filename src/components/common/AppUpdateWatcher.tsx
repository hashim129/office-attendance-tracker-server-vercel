import React, { useEffect, useRef, useState } from 'react';

declare const __APP_BUILD__: string;
const CURRENT = typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : '';
const CHECK_MS = 3 * 60 * 1000;

/** True when reloading now would not throw away anything the person is typing or a window they have open. */
function safeToReload(): boolean {
  const a = document.activeElement as HTMLElement | null;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) return false;
  if (document.querySelector('[role="dialog"], [aria-modal="true"], form[data-dirty="true"]')) return false;
  return true;
}

/**
 * Keeps long-open windows current (website tab, Windows app window, phone app): checks every few minutes
 * and whenever the app comes back to the front whether a newer version was published. When it is safe
 * (nothing being typed, no window open) it reloads by itself; otherwise it shows a small "Update" button.
 */
export const AppUpdateWatcher: React.FC = () => {
  const [ready, setReady] = useState(false);
  const pending = useRef(false);

  useEffect(() => {
    if (!CURRENT) return undefined;
    let stopped = false;
    const check = async () => {
      if (stopped || pending.current || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
      try {
        const r = await fetch(`/build.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok) return;
        const { id } = await r.json();
        if (id && id !== CURRENT) { pending.current = true; setReady(true); }
      } catch { /* offline or not deployed with build info: try later */ }
    };
    const onShow = () => {
      if (document.visibilityState !== 'visible') {
        // leaving the app: a perfect moment to switch to the new version unnoticed
        if (pending.current && safeToReload()) window.location.reload();
        return;
      }
      if (pending.current && safeToReload()) { window.location.reload(); return; }
      void check();
    };
    const t = window.setInterval(check, CHECK_MS);
    const first = window.setTimeout(check, 20000);
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', onShow);
    return () => { stopped = true; window.clearInterval(t); window.clearTimeout(first); document.removeEventListener('visibilitychange', onShow); window.removeEventListener('focus', onShow); };
  }, []);

  if (!ready) return null;
  return (
    <button type="button" onClick={() => window.location.reload()} data-app-update
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[95] rounded-full bg-slate-900 text-white text-xs font-bold px-4 py-2.5 shadow-2xl inline-flex items-center gap-2 cursor-pointer">
      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> New version ready · Tap to update
    </button>
  );
};
