import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Compass, Luggage, MapPin, Plane, Ticket } from 'lucide-react';

/**
 * Light-weight 3D "launch" scene for the customer portal: a wireframe globe, floating glass travel tiles that fly in
 * from the depths when the page opens, and gentle parallax that follows the mouse (or the phone's tilt).
 * Pure CSS 3D, no libraries, and it stays still for people who prefer reduced motion.
 */
export function FloatingScene() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const apply = (x: number, y: number) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.setProperty('--rx', `${(-y * 10).toFixed(2)}deg`);
        el.style.setProperty('--ry', `${(x * 14).toFixed(2)}deg`);
      });
    };
    const onMove = (e: PointerEvent) => apply((e.clientX / window.innerWidth - 0.5) * 2, (e.clientY / window.innerHeight - 0.5) * 2);
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      apply(Math.max(-1, Math.min(1, e.gamma / 30)), Math.max(-1, Math.min(1, (e.beta - 45) / 30)));
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('deviceorientation', onTilt, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('deviceorientation', onTilt);
    };
  }, []);

  return (
    <div className="fx-scene no-print" aria-hidden="true">
      <div ref={ref} className="fx-stage">
        <div className="fx-globe">
          {[0, 30, 60, 90, 120, 150].map((deg) => (
            <span key={deg} className="fx-ring" style={{ transform: `rotateY(${deg}deg)` }} />
          ))}
          <span className="fx-ring fx-equator" />
          <span className="fx-ring fx-equator fx-tropic-a" />
          <span className="fx-ring fx-equator fx-tropic-b" />
          <span className="fx-core" />
          <span className="fx-orbit"><Plane className="w-5 h-5 text-white fx-orbit-plane" /></span>
        </div>
        <span className="fx-tile fx-t1"><Plane className="w-6 h-6" /></span>
        <span className="fx-tile fx-t2"><Compass className="w-6 h-6" /></span>
        <span className="fx-tile fx-t3"><Luggage className="w-6 h-6" /></span>
        <span className="fx-tile fx-t4"><MapPin className="w-6 h-6" /></span>
        <span className="fx-tile fx-t5"><Ticket className="w-6 h-6" /></span>
        <span className="fx-tile fx-t6"><Camera className="w-6 h-6" /></span>
        <span className="fx-cloud fx-c1" />
        <span className="fx-cloud fx-c2" />
        <span className="fx-cloud fx-c3" />
      </div>
    </div>
  );
}

/** A short burst of confetti, used when a visa is issued. Removes itself after a few seconds. */
export function Confetti({ burstKey }: { burstKey: string }) {
  const [alive, setAlive] = useState(false);
  useEffect(() => {
    if (!burstKey || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    setAlive(true);
    const t = window.setTimeout(() => setAlive(false), 4200);
    return () => window.clearTimeout(t);
  }, [burstKey]);
  const pieces = useMemo(
    () => Array.from({ length: 46 }, (_, i) => ({
      left: (i * 37) % 100,
      delay: ((i * 53) % 100) / 100,
      dur: 2.4 + ((i * 29) % 16) / 10,
      hue: [199, 160, 45, 330, 265, 20][i % 6],
      drift: ((i * 17) % 60) - 30,
      rot: (i * 47) % 360,
    })),
    []
  );
  if (!alive) return null;
  return (
    <div className="fx-confetti no-print" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          style={{ left: `${p.left}%`, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, background: `hsl(${p.hue} 90% 58%)`, ['--drift' as string]: `${p.drift}vw`, ['--rot' as string]: `${p.rot}deg` }}
        />
      ))}
    </div>
  );
}

/** Rotating destination word for the headline ("…your journey to Dubai"). */
export function RotatingWord({ words }: { words: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (words.length < 2 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = window.setInterval(() => setI((n) => (n + 1) % words.length), 2400);
    return () => window.clearInterval(t);
  }, [words.length]);
  return (
    <span key={i} className="fx-word inline-block bg-gradient-to-r from-sky-600 via-indigo-600 to-fuchsia-600 bg-clip-text text-transparent">
      {words[i] || ''}
    </span>
  );
}

/** Cards marked data-tilt lean toward the pointer, like a physical card. Attached once for the whole page. */
export function useTiltCards() {
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || window.matchMedia?.('(hover: none)').matches) return;
    let current: HTMLElement | null = null;
    const reset = () => { if (current) { current.style.transform = ''; current = null; } };
    const move = (e: PointerEvent) => {
      const card = (e.target as HTMLElement | null)?.closest?.('[data-tilt]') as HTMLElement | null;
      if (!card) { reset(); return; }
      if (current && current !== card) reset();
      current = card;
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = `perspective(800px) rotateX(${(-py * 7).toFixed(2)}deg) rotateY(${(px * 9).toFixed(2)}deg) translateZ(0) scale(1.015)`;
    };
    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerleave', reset);
    return () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerleave', reset); reset(); };
  }, []);
}

/** A small plane that crosses the screen each time a booking is looked up, with a short caption. */
export function PlaneFlight({ flightKey }: { flightKey: number }) {
  const [alive, setAlive] = useState(false);
  useEffect(() => {
    if (!flightKey || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    setAlive(true);
    const t = window.setTimeout(() => setAlive(false), 2300);
    return () => window.clearTimeout(t);
  }, [flightKey]);
  if (!alive) return null;
  return (
    <div className="fx-flight no-print" aria-hidden="true" key={flightKey}>
      <div className="fx-flight-x">
        <div className="fx-flight-y">
          <span className="fx-flight-trail" />
          <Plane className="fx-flight-plane" />
        </div>
      </div>
      <div className="fx-flight-label">Locating your booking…</div>
    </div>
  );
}
