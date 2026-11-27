import React, { useRef, useState } from 'react';
import { haptic } from '../../lib/phoneApp';

/** Swipe a card to the right on a phone to run its main action (e.g. update a follow-up). */
export const SwipeRow: React.FC<{ enabled: boolean; label: string; onSwipe: () => void; children: React.ReactNode }> = ({ enabled, label, onSwipe, children }) => {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; locked: 'x' | 'y' | null } | null>(null);
  const moved = useRef(false);
  if (!enabled) return <>{children}</>;
  const reset = () => { start.current = null; setDx(0); };
  return (
    <div className="relative overflow-hidden rounded-xl" data-swipe-row>
      <div className={`absolute inset-y-0 left-0 flex items-center pl-4 text-xs font-semibold text-white bg-emerald-600 transition-opacity ${dx > 8 ? 'opacity-100' : 'opacity-0'}`} style={{ width: Math.max(dx, 0) + 24 }} aria-hidden>
        {dx > 90 ? `Release: ${label}` : label}
      </div>
      <div
        style={{ transform: `translateX(${dx}px)`, transition: start.current ? 'none' : 'transform 0.2s ease' }}
        onTouchStart={(e) => { start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, locked: null }; moved.current = false; }}
        onTouchMove={(e) => {
          const s = start.current; if (!s) return;
          const x = e.touches[0].clientX - s.x; const y = e.touches[0].clientY - s.y;
          if (!s.locked && (Math.abs(x) > 10 || Math.abs(y) > 10)) s.locked = Math.abs(x) > Math.abs(y) ? 'x' : 'y';
          if (s.locked === 'x') { moved.current = true; setDx(Math.max(0, Math.min(140, x))); }
        }}
        onTouchEnd={() => { const go = dx > 90; reset(); if (go) { haptic('tap'); onSwipe(); } }}
        onTouchCancel={reset}
        onClickCapture={(e) => { if (moved.current) { e.stopPropagation(); e.preventDefault(); moved.current = false; } }}
      >
        {children}
      </div>
    </div>
  );
};
export default SwipeRow;
