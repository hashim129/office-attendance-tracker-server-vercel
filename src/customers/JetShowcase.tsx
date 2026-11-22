import { useEffect, useRef, useState } from 'react';

interface Props {
  /** Changes every time a booking has been found; starts a new flight. */
  showKey: number;
  /** Customer name shown on the banner. */
  name: string;
  /** Called when the box bursts open, which is when the booking details should appear. */
  onBlast: () => void;
}

const FLIGHT_MS = 4800;
const FALL_MS = 950;

/**
 * A small jet crosses the screen from left to right pulling a banner with the customer's name. A cartoon pilot
 * flies it. Near the right it drops a gift box, which bursts open where it lands and reveals the booking details.
 * Uses the Web Animations API so the drop point lines up exactly with the jet's position.
 */
export default function JetShowcase({ showKey, name, onBlast }: Props) {
  const jetRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [alive, setAlive] = useState(false);
  const [blast, setBlast] = useState<{ x: number; y: number; k: number } | null>(null);
  const blastCb = useRef(onBlast);
  blastCb.current = onBlast;

  useEffect(() => {
    if (!showKey) return;
    setAlive(true);
    setBlast(null);
  }, [showKey]);

  useEffect(() => {
    if (!alive) return;
    const jet = jetRef.current; const box = boxRef.current;
    if (!jet || !box) return;
    const vw = window.innerWidth; const vh = window.innerHeight;
    const s = vw < 640 ? 0.72 : vw < 1024 ? 1 : 1.3;
    const total = jet.offsetWidth * s;
    const top = Math.max(70, vh * 0.17);
    const x0 = -total - 20; const x1 = vw + 40;
    const dropX = vw * (vw < 640 ? 0.55 : 0.62);
    const landY = Math.min(vh - 90, Math.max(top + 200, vh * 0.62));
    const f = (dropX + 110 * s + 20) / (x1 - x0);
    const td = Math.max(600, Math.min(FLIGHT_MS - 900, f * FLIGHT_MS));
    const at = (t: number) => x0 + (x1 - x0) * t;
    const kf = [0, 0.25, 0.5, 0.75, 1].map((t, i) => ({ transform: `translate(${at(t)}px, ${[0, -14, 4, -10, 0][i]}px) scale(${s})`, offset: t }));
    jet.style.top = `${top}px`;
    const flight = jet.animate(kf, { duration: FLIGHT_MS, easing: 'linear', fill: 'both' });

    let blastTimer = 0;
    const dropTimer = window.setTimeout(() => {
      box.style.display = 'block'; box.style.left = `${dropX - 22}px`; box.style.top = `${top + 52 * s}px`;
      const fall = box.animate(
        [
          { transform: 'translateY(0) rotate(0deg) scale(0.9)', offset: 0, easing: 'cubic-bezier(0.3, 0, 0.9, 0.6)' },
          { transform: `translateY(${landY - top - 52 * s}px) rotate(320deg) scale(1.15)`, offset: 1 },
        ],
        { duration: FALL_MS, fill: 'forwards' }
      );
      fall.onfinish = () => {
        box.style.display = 'none';
        setBlast({ x: dropX, y: landY, k: Date.now() });
        blastCb.current();
      };
      blastTimer = 1;
    }, td);

    const endTimer = window.setTimeout(() => { setAlive(false); setBlast(null); }, FLIGHT_MS + 1800);
    return () => { window.clearTimeout(dropTimer); window.clearTimeout(endTimer); flight.cancel(); void blastTimer; };
  }, [alive]);

  if (!alive) return null;
  const label = name ? `Welcome, ${name.length > 26 ? `${name.slice(0, 25)}…` : name}` : 'Welcome aboard!';

  return (
    <div className="fx-jet-layer no-print" aria-hidden="true">
      <div ref={jetRef} className="fx-jet" style={{ transform: 'translate(-2000px, 0)' }}>
        <div className="fx-banner"><span>{label}</span></div>
        <svg className="fx-ropes" viewBox="0 0 56 60" width="56" height="60"><path d="M56 30 L0 6 M56 30 L0 54" stroke="#64748b" strokeWidth="1.4" fill="none" /></svg>
        <svg className="fx-jetsvg" viewBox="0 0 260 100" width="260" height="100">
          {/* tail fin and wings */}
          <path d="M28 42 L10 6 L42 6 L68 40Z" fill="#0369a1" />
          <path d="M132 40 L104 14 L128 14 L170 38Z" fill="#7dd3fc" stroke="#0284c7" strokeWidth="1" />
          {/* flame */}
          <g className="fx-flame"><path d="M22 52 C6 44 -4 52 -10 52 C-4 52 6 60 22 52Z" fill="#f59e0b" /><path d="M22 52 C12 48 6 52 2 52 C6 52 12 56 22 52Z" fill="#fde68a" /></g>
          {/* body */}
          <path d="M20 52 C20 40 40 36 70 36 L190 36 C220 36 246 46 254 54 C246 62 220 68 190 68 L70 68 C40 68 20 64 20 52Z" fill="#fff" stroke="#cbd5e1" strokeWidth="1.5" />
          <path d="M26 55 H246 C240 59 230 62 220 63 H34 C30 61 27 58 26 55Z" fill="#0ea5e9" />
          <text x="62" y="51" fontSize="9.5" fontWeight="800" fill="#075985" fontFamily="Manrope, system-ui, sans-serif" letterSpacing="0.6">BAHAAR JOURNEYS</text>
          {[132, 146, 160].map((x) => <circle key={x} cx={x} cy="46" r="3" fill="#bae6fd" stroke="#0284c7" strokeWidth="0.8" />)}
          <path d="M122 62 L86 94 L116 94 L176 64Z" fill="#38bdf8" stroke="#0284c7" strokeWidth="1" />
          {/* cockpit with pilot */}
          <path d="M170 40 C174 20 204 16 218 40Z" fill="rgba(186,230,253,0.85)" stroke="#0284c7" strokeWidth="1.2" />
          <g>
            <circle cx="194" cy="31" r="8" fill="#f1c27d" />
            <path d="M185.5 29 C186 20 202 20 202.5 29Z" fill="#f59e0b" />
            <rect x="193" y="27" width="10" height="5.5" rx="2.5" fill="#0f172a" />
            <circle cx="197" cy="29.7" r="1.4" fill="#7dd3fc" /><circle cx="201" cy="29.7" r="1.4" fill="#7dd3fc" />
            <path d="M192 36 q4 3 8 0" stroke="#7c2d12" strokeWidth="1.2" fill="none" strokeLinecap="round" />
            <path className="fx-scarf" d="M188 37 L170 36 L174 41 L168 44 L188 41Z" fill="#ef4444" />
          </g>
          <g className="fx-wave"><rect x="203" y="22" width="3.6" height="13" rx="1.8" fill="#f1c27d" /><circle cx="204.8" cy="21" r="3" fill="#f1c27d" /></g>
        </svg>
      </div>

      <div ref={boxRef} className="fx-box" style={{ display: 'none' }}>
        <svg viewBox="0 0 44 44" width="44" height="44">
          <rect x="4" y="16" width="36" height="24" rx="3" fill="#f59e0b" stroke="#b45309" strokeWidth="1.5" />
          <rect x="19" y="16" width="6" height="24" fill="#dc2626" />
          <rect x="2" y="10" width="40" height="8" rx="3" fill="#fbbf24" stroke="#b45309" strokeWidth="1.5" />
          <rect x="19" y="10" width="6" height="8" fill="#dc2626" />
        </svg>
      </div>

      {blast && (
        <div key={blast.k} className="fx-blast" style={{ left: blast.x, top: blast.y }}>
          <span className="fx-blast-flash" /><span className="fx-blast-ring" /><span className="fx-blast-ring r2" />
          <svg className="fx-blast-lid" viewBox="0 0 44 20" width="44" height="20"><rect x="2" y="4" width="40" height="8" rx="3" fill="#fbbf24" stroke="#b45309" strokeWidth="1.5" /><rect x="19" y="4" width="6" height="8" fill="#dc2626" /></svg>
          {Array.from({ length: 18 }, (_, i) => {
            const a = (i / 18) * Math.PI * 2; const d = 90 + (i % 3) * 40;
            return <span key={i} className="fx-spark" style={{ ['--dx' as string]: `${Math.cos(a) * d}px`, ['--dy' as string]: `${Math.sin(a) * d}px`, background: ['#f59e0b', '#38bdf8', '#ec4899', '#22c55e', '#fde047', '#a78bfa'][i % 6] }} />;
          })}
        </div>
      )}
    </div>
  );
}
