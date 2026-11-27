/** A short confetti burst with a message (first punch of the month, sales target reached). No library, removes itself. */
export function celebrate(message: string): void {
  if (typeof document === 'undefined') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const wrap = document.createElement('div');
  wrap.setAttribute('data-celebrate', '');
  wrap.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:120;overflow:hidden';
  const colors = ['#2563eb', '#16a34a', '#f59e0b', '#e11d48', '#0ea5e9', '#a855f7'];
  for (let i = 0; i < 70; i++) {
    const p = document.createElement('i');
    const x = Math.random() * 100; const d = 1.6 + Math.random() * 1.4; const r = Math.random() * 720 - 360;
    p.style.cssText = `position:absolute;top:-12px;left:${x}%;width:${6 + Math.random() * 6}px;height:${8 + Math.random() * 8}px;background:${colors[i % colors.length]};border-radius:2px;opacity:.95`;
    p.animate([{ transform: 'translate(0,0) rotate(0)' }, { transform: `translate(${Math.random() * 120 - 60}px, ${window.innerHeight + 40}px) rotate(${r}deg)` }], { duration: d * 1000, easing: 'cubic-bezier(.2,.6,.4,1)', delay: Math.random() * 300, fill: 'forwards' });
    wrap.appendChild(p);
  }
  const note = document.createElement('div');
  note.textContent = message;
  note.style.cssText = 'position:absolute;left:50%;top:18%;transform:translateX(-50%);max-width:86vw;padding:10px 16px;border-radius:12px;background:#fff;color:#0f172a;font:600 14px/1.35 system-ui,sans-serif;box-shadow:0 10px 30px rgba(15,23,42,.18);text-align:center';
  wrap.appendChild(note);
  document.body.appendChild(wrap);
  window.setTimeout(() => wrap.remove(), 3400);
}

/** Runs fn only once per key (kept on this device). */
export function once(key: string, fn: () => void): void {
  try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch { /* private mode */ }
  fn();
}
