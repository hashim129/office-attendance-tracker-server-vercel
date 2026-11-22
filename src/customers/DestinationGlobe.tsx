import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Compass, MapPin, Plane, Sparkles } from 'lucide-react';
import type { Destination } from './destinations';
import { LAND_DOTS } from './landDots';

/** Where each curated destination sits on the globe (latitude, longitude). */
const COORDS: Record<string, [number, number]> = {
  'makkah-madinah': [21.42, 39.83],
  'dubai-abu-dhabi': [25.2, 55.27],
  doha: [25.29, 51.53],
  'baku-shahdag': [40.41, 49.87],
  'tashkent-samarkand': [40.2, 68.0],
  almaty: [43.24, 76.89],
  'istanbul-cappadocia': [41.01, 28.98],
  'london-edinburgh': [51.51, -0.13],
  'paris-swiss-alps': [48.86, 2.35],
  'kuala-lumpur-langkawi': [3.14, 101.69],
  bali: [-8.4, 115.19],
  maldives: [3.2, 73.22],
  tokyo: [35.68, 139.69],
};
/** The journey starts in Lahore, where Bahaar Journeys is based. */
const ORIGIN: [number, number] = [31.55, 74.34];

const RAD = Math.PI / 180;
type V3 = [number, number, number];
const toVec = (lat: number, lon: number): V3 => [Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD), Math.cos(lat * RAD) * Math.cos(lon * RAD)];

const kmBetween = (a: [number, number], b: [number, number]) => {
  const dLat = (b[0] - a[0]) * RAD; const dLon = (b[1] - a[1]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
};

interface Props {
  destinations: Destination[];
  onOpen: (dest: Destination) => void;
  onSurprise?: () => void;
}

/**
 * Interactive 3D globe: drag to spin it, tap a glowing pin to fly there from Lahore, or press "Surprise me".
 * Drawn on a canvas with plain maths (no libraries); it pauses when off screen and stays still for reduced motion.
 */
export default function DestinationGlobe({ destinations, onOpen, onSurprise }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const sel = useRef<string | null>(null);
  const hov = useRef<string | null>(null);
  const view = useRef({ lon: 62, lat: 22, vLon: 0, vLat: 0, dragging: false, moved: 0, targetLat: null as number | null, targetLon: null as number | null, flightStart: 0 });
  const surpriseTimer = useRef<number | null>(null);

  const pins = useMemo(
    () => destinations.filter((d) => COORDS[d.id]).map((d) => ({ d, ll: COORDS[d.id], v: toVec(COORDS[d.id][0], COORDS[d.id][1]) })),
    [destinations]
  );
  const dots = useMemo(() => {
    const out: V3[] = [];
    for (let i = 0; i + 1 < LAND_DOTS.length; i += 2) out.push(toVec(LAND_DOTS[i], LAND_DOTS[i + 1]));
    return out;
  }, []);
  const reduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const focus = useCallback((id: string) => {
    const c = COORDS[id]; if (!c) return;
    sel.current = id; setSelectedId(id);
    const v = view.current;
    v.targetLat = Math.max(-40, Math.min(55, c[0] * 0.8));
    // shortest way round
    let lon = c[1]; const diff = ((lon - v.lon + 540) % 360) - 180; lon = v.lon + diff;
    v.targetLon = lon; v.flightStart = performance.now();
  }, []);

  const surprise = useCallback(() => {
    const pool = pins.filter((p) => p.d.id !== sel.current);
    if (!pool.length) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    focus(pick.d.id);
    onSurprise?.();
    if (surpriseTimer.current) window.clearTimeout(surpriseTimer.current);
    surpriseTimer.current = window.setTimeout(() => onOpen(pick.d), 2200);
  }, [pins, focus, onOpen, onSurprise]);

  useEffect(() => () => { if (surpriseTimer.current) window.clearTimeout(surpriseTimer.current); }, []);

  useEffect(() => {
    const canvas = canvasRef.current; const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    let w = 0; let h = 0; let dpr = 1; let raf = 0; let visible = true;
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = wrap.clientWidth; h = wrap.clientHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(wrap);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) loop(); }, { threshold: 0.05 });
    io.observe(wrap);

    const project = (p: V3, lat0: number, lon0: number, R: number, cx: number, cy: number, lift = 1) => {
      const sl = Math.sin(lat0 * RAD); const cl = Math.cos(lat0 * RAD); const lo = lon0 * RAD;
      // rotate around Y by -lon0 then around X by lat0
      const x1 = p[0] * Math.cos(lo) - p[2] * Math.sin(lo);
      const z1 = p[0] * Math.sin(lo) + p[2] * Math.cos(lo);
      const y2 = p[1] * cl - z1 * sl;
      const z2 = p[1] * sl + z1 * cl;
      return { x: cx + x1 * R * lift, y: cy - y2 * R * lift, z: z2 * lift };
    };

    const arcPoints = (a: V3, b: V3, n = 48) => {
      const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
      const om = Math.acos(dot); const so = Math.sin(om) || 1;
      const pts: { v: V3; lift: number }[] = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n; const k1 = Math.sin((1 - t) * om) / so; const k2 = Math.sin(t * om) / so;
        pts.push({ v: [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2], lift: 1 + Math.sin(Math.PI * t) * Math.min(0.32, om * 0.2) });
      }
      return pts;
    };
    const originV = toVec(ORIGIN[0], ORIGIN[1]);

    function loop() {
      if (!visible) return;
      raf = requestAnimationFrame(draw);
    }

    function draw(now: number) {
      const v = view.current;
      // motion
      if (v.targetLon !== null && v.targetLat !== null) {
        v.lon += (v.targetLon - v.lon) * 0.07; v.lat += (v.targetLat - v.lat) * 0.07;
        if (Math.abs(v.targetLon - v.lon) < 0.15 && Math.abs(v.targetLat - v.lat) < 0.15) { v.targetLon = null; v.targetLat = null; }
      } else if (!v.dragging) {
        v.lon += v.vLon; v.lat = Math.max(-60, Math.min(60, v.lat + v.vLat));
        v.vLon *= 0.95; v.vLat *= 0.95;
        if (!reduced && !hov.current && !sel.current && Math.abs(v.vLon) < 0.05) v.lon += 0.12;
      }
      const R = Math.min(w, h) * 0.42; const cx = w / 2; const cy = h / 2;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, w, h);
      // atmosphere + ocean
      const glow = ctx!.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.28);
      glow.addColorStop(0, 'rgba(56,189,248,0.38)'); glow.addColorStop(1, 'rgba(56,189,248,0)');
      ctx!.fillStyle = glow; ctx!.beginPath(); ctx!.arc(cx, cy, R * 1.28, 0, 7); ctx!.fill();
      const sea = ctx!.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
      sea.addColorStop(0, '#1e3a8a'); sea.addColorStop(0.6, '#0f1f4d'); sea.addColorStop(1, '#070d24');
      ctx!.fillStyle = sea; ctx!.beginPath(); ctx!.arc(cx, cy, R, 0, 7); ctx!.fill();
      // graticule
      ctx!.lineWidth = 0.7; ctx!.strokeStyle = 'rgba(125,211,252,0.14)';
      for (let lat = -60; lat <= 60; lat += 30) {
        ctx!.beginPath(); let pen = false;
        for (let lon = -180; lon <= 180; lon += 6) {
          const p = project(toVec(lat, lon), v.lat, v.lon, R, cx, cy);
          if (p.z > 0) { if (!pen) { ctx!.moveTo(p.x, p.y); pen = true; } else ctx!.lineTo(p.x, p.y); } else pen = false;
        }
        ctx!.stroke();
      }
      for (let lon = -180; lon < 180; lon += 30) {
        ctx!.beginPath(); let pen = false;
        for (let lat = -90; lat <= 90; lat += 6) {
          const p = project(toVec(lat, lon), v.lat, v.lon, R, cx, cy);
          if (p.z > 0) { if (!pen) { ctx!.moveTo(p.x, p.y); pen = true; } else ctx!.lineTo(p.x, p.y); } else pen = false;
        }
        ctx!.stroke();
      }
      // land
      for (const d of dots) {
        const p = project(d, v.lat, v.lon, R, cx, cy);
        if (p.z <= 0) continue;
        ctx!.fillStyle = `rgba(147,220,255,${0.25 + p.z * 0.6})`;
        const s = 0.9 + p.z * 1.1;
        ctx!.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
      // flight arc to the chosen / hovered pin
      const active = pins.find((p) => p.d.id === (sel.current || hov.current));
      if (active) {
        const pts = arcPoints(originV, active.v);
        const t = ((((now - v.flightStart) % 2600) + 2600) % 2600) / 2600;
        const upto = Math.max(0, Math.min(pts.length - 1, Math.floor(t * (pts.length - 1))));
        ctx!.lineWidth = 1.4; ctx!.strokeStyle = 'rgba(251,191,36,0.35)'; ctx!.setLineDash([3, 4]);
        ctx!.beginPath(); let pen = false;
        pts.forEach((q) => { const p = project(q.v, v.lat, v.lon, R, cx, cy, q.lift); if (p.z > -0.02) { if (!pen) { ctx!.moveTo(p.x, p.y); pen = true; } else ctx!.lineTo(p.x, p.y); } else pen = false; });
        ctx!.stroke(); ctx!.setLineDash([]);
        ctx!.lineWidth = 2.2; ctx!.strokeStyle = 'rgba(253,224,71,0.95)'; ctx!.beginPath(); pen = false;
        for (let i = Math.max(0, upto - 10); i <= upto; i++) { const q = pts[i]; const p = project(q.v, v.lat, v.lon, R, cx, cy, q.lift); if (p.z > -0.02) { if (!pen) { ctx!.moveTo(p.x, p.y); pen = true; } else ctx!.lineTo(p.x, p.y); } }
        ctx!.stroke();
        const head = pts[upto]; const hp = project(head.v, v.lat, v.lon, R, cx, cy, head.lift);
        if (hp.z > -0.02) {
          ctx!.fillStyle = '#fff'; ctx!.shadowColor = '#fde047'; ctx!.shadowBlur = 14;
          ctx!.beginPath(); ctx!.arc(hp.x, hp.y, 3.4, 0, 7); ctx!.fill(); ctx!.shadowBlur = 0;
        }
      }
      // origin pin (Lahore)
      const o = project(originV, v.lat, v.lon, R, cx, cy);
      if (o.z > 0) {
        ctx!.fillStyle = '#fbbf24'; ctx!.beginPath(); ctx!.arc(o.x, o.y, 4, 0, 7); ctx!.fill();
        ctx!.fillStyle = 'rgba(255,255,255,0.9)'; ctx!.font = '600 11px Manrope, system-ui, sans-serif'; ctx!.fillText('Lahore', o.x + 8, o.y + 4);
      }
      // destination pins
      for (const pin of pins) {
        const p = project(pin.v, v.lat, v.lon, R, cx, cy);
        if (p.z <= 0.02) continue;
        const isSel = pin.d.id === sel.current; const isHov = pin.d.id === hov.current;
        const pulse = 0.5 + 0.5 * Math.sin(now / 420 + pin.ll[1]);
        const r = (isSel ? 6.5 : isHov ? 6 : 4.5);
        ctx!.fillStyle = isSel ? 'rgba(244,114,182,0.28)' : 'rgba(56,189,248,0.25)';
        ctx!.beginPath(); ctx!.arc(p.x, p.y, r + 5 + pulse * (isSel ? 8 : 5), 0, 7); ctx!.fill();
        ctx!.fillStyle = isSel ? '#f472b6' : '#38bdf8'; ctx!.shadowColor = ctx!.fillStyle; ctx!.shadowBlur = 12;
        ctx!.beginPath(); ctx!.arc(p.x, p.y, r, 0, 7); ctx!.fill(); ctx!.shadowBlur = 0;
        ctx!.strokeStyle = '#fff'; ctx!.lineWidth = 1.2; ctx!.stroke();
        if (isSel || isHov) {
          const label = pin.d.name; ctx!.font = '700 12px Manrope, system-ui, sans-serif';
          const tw = ctx!.measureText(label).width + 16;
          const lx = Math.min(w - tw - 4, Math.max(4, p.x - tw / 2)); const ly = p.y - 30;
          ctx!.fillStyle = 'rgba(15,23,42,0.88)'; ctx!.beginPath(); ctx!.roundRect(lx, ly, tw, 22, 11); ctx!.fill();
          ctx!.fillStyle = '#fff'; ctx!.fillText(label, lx + 8, ly + 15);
        }
      }
      // soft highlight
      const hi = ctx!.createRadialGradient(cx - R * 0.45, cy - R * 0.5, 0, cx - R * 0.45, cy - R * 0.5, R * 0.9);
      hi.addColorStop(0, 'rgba(255,255,255,0.14)'); hi.addColorStop(1, 'rgba(255,255,255,0)');
      ctx!.fillStyle = hi; ctx!.beginPath(); ctx!.arc(cx, cy, R, 0, 7); ctx!.fill();
      loop();
    }

    // pointer handling
    const pos = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const pinAt = (x: number, y: number) => {
      const v = view.current; const R = Math.min(w, h) * 0.42; const cx = w / 2; const cy = h / 2;
      let best: string | null = null; let bd = 20;
      for (const pin of pins) { const p = project(pin.v, v.lat, v.lon, R, cx, cy); if (p.z <= 0.02) continue; const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = pin.d.id; } }
      return best;
    };
    let last = { x: 0, y: 0 };
    const down = (e: PointerEvent) => { const v = view.current; v.dragging = true; v.moved = 0; v.targetLat = null; v.targetLon = null; last = pos(e); canvas.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      const v = view.current; const p = pos(e);
      if (v.dragging) {
        const dx = p.x - last.x; const dy = p.y - last.y; v.moved += Math.abs(dx) + Math.abs(dy);
        v.lon -= dx * 0.4; v.lat = Math.max(-60, Math.min(60, v.lat + dy * 0.3)); v.vLon = -dx * 0.12; v.vLat = dy * 0.08; last = p;
      } else {
        const id = pinAt(p.x, p.y);
        if (id !== hov.current) { hov.current = id; setHoverId(id); canvas.style.cursor = id ? 'pointer' : 'grab'; }
      }
    };
    const up = (e: PointerEvent) => {
      const v = view.current; const wasDrag = v.moved > 6; v.dragging = false;
      if (!wasDrag) { const p = pos(e); const id = pinAt(p.x, p.y); if (id) focus(id); }
    };
    const leave = () => { if (hov.current) { hov.current = null; setHoverId(null); } };
    canvas.style.cursor = 'grab'; canvas.style.touchAction = 'pan-y';
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointerleave', leave);
    loop();
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointerleave', leave);
    };
  }, [pins, dots, focus, reduced]);

  const shown = pins.find((p) => p.d.id === (selectedId || hoverId)) || null;
  const km = shown ? Math.round(kmBetween(ORIGIN, shown.ll) / 10) * 10 : 0;

  return (
    <section className="no-print relative overflow-hidden rounded-3xl border border-sky-900/40 bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 text-white shadow-xl">
      <div className="pointer-events-none absolute -top-24 -left-16 h-64 w-64 rounded-full bg-sky-500/20 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-24 right-0 h-64 w-64 rounded-full bg-fuchsia-500/20 blur-3xl" aria-hidden="true" />
      <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-2 lg:gap-6 items-center p-4 sm:p-6">
        <div className="lg:col-span-7 order-2 lg:order-1">
          <div ref={wrapRef} className="relative mx-auto w-full h-[300px] sm:h-[420px]">
            <canvas ref={canvasRef} className="block mx-auto" role="img" aria-label="Interactive globe of Bahaar Journeys destinations. Drag to rotate and tap a pin to see the journey from Lahore." />
          </div>
          <p className="text-center text-[11px] text-sky-200/70 -mt-1">Drag to spin · tap a glowing pin</p>
        </div>

        <div className="lg:col-span-5 order-1 lg:order-2 space-y-4">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/15 px-3 py-1 text-[11px] font-bold text-sky-200">
              <Compass className="w-3.5 h-3.5" /> Spin the world
            </span>
            <h2 className="mt-2 text-2xl sm:text-3xl font-extrabold tracking-tight">Where will your next journey take you?</h2>
            <p className="text-sm text-sky-100/80 mt-1">Every glowing pin is a Bahaar Journeys destination. Pick one and watch the flight leave Lahore.</p>
          </div>

          <div className="rounded-2xl border border-white/15 bg-white/10 backdrop-blur p-4 min-h-[118px]">
            {shown ? (
              <div className="space-y-1.5">
                <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-300"><MapPin className="w-3.5 h-3.5" /> {shown.d.country}</p>
                <p className="text-lg font-extrabold leading-tight">{shown.d.name}</p>
                <p className="text-xs text-sky-100/80 line-clamp-2">{shown.d.tagline}</p>
                <p className="text-[11px] font-semibold text-sky-200 inline-flex items-center gap-1.5"><Plane className="w-3.5 h-3.5" /> about {km.toLocaleString()} km from Lahore</p>
              </div>
            ) : (
              <p className="text-sm text-sky-100/80">Tap any pin on the globe, or press <b>Surprise me</b> and let us pick for you.</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={surprise} className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-amber-400 via-pink-500 to-fuchsia-600 px-4 py-2.5 text-sm font-extrabold text-white shadow-lg shadow-pink-900/30 hover:scale-[1.03] active:scale-[0.98] transition-transform cursor-pointer">
              <Sparkles className="w-4 h-4" /> Surprise me
            </button>
            {shown && (
              <button type="button" onClick={() => onOpen(shown.d)} className="inline-flex items-center gap-2 rounded-2xl bg-white/15 hover:bg-white/25 border border-white/25 px-4 py-2.5 text-sm font-bold cursor-pointer transition-colors">
                View this journey
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {pins.map((p) => (
              <button key={p.d.id} type="button" onClick={() => focus(p.d.id)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold border cursor-pointer transition-colors ${selectedId === p.d.id ? 'bg-pink-500 border-pink-300 text-white' : 'bg-white/5 border-white/15 text-sky-100 hover:bg-white/15'}`}>
                {p.d.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
