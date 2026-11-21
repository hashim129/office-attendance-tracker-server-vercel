import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Compass, Plane, ShieldCheck } from 'lucide-react';

export interface PlaneAnimationProps {
  statusLabel?: string;
  destinationHint?: string;
  visaStatus?: 'not_started' | 'in_progress' | 'issued' | null;
  isVisaActive?: boolean;
}

const FLIGHT_PATH = 'M 88 208 C 280 55, 640 48, 868 156';

interface Waypoint {
  id: string;
  label: string;
  x: number;
  y: number;
  labelYOffset: number;
}

const WAYPOINTS: Waypoint[] = [
  { id: 'origin', label: 'Origin Hub', x: 88, y: 208, labelYOffset: 24 },
  { id: 'visa', label: 'Visa & Docs', x: 322, y: 103, labelYOffset: -18 },
  { id: 'transit', label: 'Transit Corridor', x: 610, y: 88, labelYOffset: -18 },
  { id: 'destination', label: 'Destination', x: 868, y: 156, labelYOffset: 24 },
];

export default function PlaneAnimation({
  statusLabel,
  destinationHint,
  visaStatus = null,
  isVisaActive = false,
}: PlaneAnimationProps) {
  const prefersReducedMotion = useReducedMotion();
  const stageContainerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = stageContainerRef.current;
    if (!el) return;

    const updateScale = () => {
      const width = el.clientWidth;
      if (width > 0) {
        setScale(width / 960);
      }
    };

    updateScale();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => updateScale());
      observer.observe(el);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  const activeWaypointId =
    visaStatus === 'issued'
      ? 'destination'
      : visaStatus === 'in_progress'
        ? 'visa'
        : isVisaActive
          ? 'visa'
          : 'transit';

  const visaTelemetryText =
    visaStatus === 'issued'
      ? 'Visa Cleared'
      : visaStatus === 'in_progress'
        ? 'Visa In Progress'
        : visaStatus === 'not_started'
          ? 'Visa Queued'
          : isVisaActive
            ? 'Visa File Active'
            : null;

  return (
    <div className="relative rounded-3xl border border-sky-200/80 bg-gradient-to-br from-sky-50 via-white to-indigo-50/75 shadow-sm overflow-hidden">
      {/* Telemetry header bar */}
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 pt-4 pb-1">
        <div className="inline-flex items-center gap-2 rounded-full bg-white/90 border border-sky-200/90 px-3 py-1 text-xs font-semibold text-slate-700 shadow-2xs">
          <span className="relative flex h-2 w-2">
            {!prefersReducedMotion && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
            )}
            <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-600" />
          </span>
          <Plane className="w-3.5 h-3.5 text-sky-600" />
          <span>{statusLabel || 'Live Flight Corridor · Bahaar Global Desk'}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {destinationHint && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-100/80 border border-sky-200 px-3 py-1 text-xs font-medium text-sky-900">
              <Compass className="w-3.5 h-3.5 text-sky-700" />
              <span>{destinationHint}</span>
            </span>
          )}
          {visaTelemetryText && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${
                visaStatus === 'issued'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : visaStatus === 'in_progress'
                    ? 'bg-amber-50 border-amber-200 text-amber-800'
                    : 'bg-slate-100 border-slate-200 text-slate-700'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{visaTelemetryText}</span>
            </span>
          )}
        </div>
      </div>

      {/* Synchronized 960x280 panoramic stage scaled cleanly to container width */}
      <div
        ref={stageContainerRef}
        className="relative w-full overflow-hidden select-none"
        style={{ height: `${Math.max(115, Math.round(280 * scale))}px` }}
        aria-hidden="true"
      >
        <div
          className="absolute top-0 left-0"
          style={{
            width: '960px',
            height: '280px',
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          <svg
            width="960"
            height="280"
            viewBox="0 0 960 280"
            fill="none"
            className="block"
          >
            <defs>
              <pattern
                id="bahaar-sky-dots"
                x="0"
                y="0"
                width="24"
                height="24"
                patternUnits="userSpaceOnUse"
              >
                <circle cx="2" cy="2" r="1.15" fill="#94a3b8" fillOpacity="0.24" />
              </pattern>

              <linearGradient id="bahaar-contrail-grad" x1="88" y1="208" x2="868" y2="156" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.35" />
                <stop offset="48%" stopColor="#0284c7" stopOpacity="0.95" />
                <stop offset="82%" stopColor="#2563eb" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.85" />
              </linearGradient>

              <filter id="bahaar-contrail-glow" x="-15%" y="-30%" width="130%" height="160%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Subtle latitude/longitude dot-grid */}
            <rect width="960" height="280" fill="url(#bahaar-sky-dots)" />

            {/* Subtle horizon arcs */}
            <path
              d="M 40 246 Q 480 184 920 246"
              stroke="#cbd5e1"
              strokeOpacity="0.45"
              strokeWidth="1"
              strokeDasharray="3 6"
            />
            <path
              d="M 120 264 Q 480 218 840 264"
              stroke="#cbd5e1"
              strokeOpacity="0.35"
              strokeWidth="1"
            />

            {/* Stylized soft inline world-continent silhouettes */}
            <g fill="#bae6fd" fillOpacity="0.48">
              {/* Americas silhouette */}
              <path d="M 54 78 C 76 62, 118 66, 134 86 C 148 104, 136 128, 120 142 C 110 152, 116 170, 134 184 C 148 196, 146 226, 124 242 C 106 254, 96 232, 92 208 C 88 184, 72 164, 58 144 C 44 122, 36 92, 54 78 Z" />
              {/* Europe & Africa silhouette */}
              <path d="M 382 48 C 414 38, 466 42, 488 62 C 498 72, 486 92, 470 98 C 482 114, 502 128, 496 156 C 488 186, 466 228, 444 236 C 424 242, 412 206, 404 176 C 398 152, 378 134, 384 110 C 388 94, 366 60, 382 48 Z" />
              {/* Middle East & Central Asia silhouette */}
              <path d="M 506 66 C 546 52, 608 54, 636 78 C 652 92, 646 122, 620 134 C 594 146, 560 154, 536 142 C 514 130, 492 84, 506 66 Z" />
              {/* East / Southeast Asia & Oceania silhouette */}
              <path d="M 656 64 C 712 48, 792 58, 834 88 C 858 104, 850 138, 822 150 C 794 162, 742 168, 706 152 C 674 138, 634 78, 656 64 Z" />
              <path d="M 792 186 C 824 178, 868 186, 882 208 C 892 224, 874 244, 844 242 C 814 240, 774 202, 792 186 Z" />
            </g>

            {/* Base dotted flight route guide */}
            <path
              d={FLIGHT_PATH}
              stroke="#cbd5e1"
              strokeWidth="2.5"
              strokeDasharray="4 7"
              strokeLinecap="round"
            />

            {/* Glowing gradient contrail */}
            <path
              d={FLIGHT_PATH}
              stroke="url(#bahaar-contrail-grad)"
              strokeWidth="3.5"
              strokeDasharray="10 14"
              strokeLinecap="round"
              filter="url(#bahaar-contrail-glow)"
              className="bahaar-contrail-flow"
            />

            {/* Flight waypoints */}
            {WAYPOINTS.map((wp) => {
              const isActive = wp.id === activeWaypointId;
              return (
                <g key={wp.id}>
                  {!prefersReducedMotion && (
                    <circle
                      cx={wp.x}
                      cy={wp.y}
                      r={isActive ? 11 : 8}
                      fill={isActive ? '#0284c7' : '#38bdf8'}
                      fillOpacity={isActive ? 0.35 : 0.22}
                      className="bahaar-pulse-ring"
                    />
                  )}
                  <circle
                    cx={wp.x}
                    cy={wp.y}
                    r={isActive ? 6 : 4.5}
                    fill={isActive ? '#0284c7' : '#ffffff'}
                    stroke={isActive ? '#ffffff' : '#0284c7'}
                    strokeWidth="2.2"
                  />
                  <g transform={`translate(${wp.x}, ${wp.y + wp.labelYOffset})`}>
                    <rect
                      x="-54"
                      y="-11"
                      width="108"
                      height="22"
                      rx="11"
                      fill={isActive ? '#0f172a' : '#ffffff'}
                      fillOpacity={isActive ? 0.92 : 0.94}
                      stroke={isActive ? '#0f172a' : '#bae6fd'}
                      strokeWidth="1"
                    />
                    <text
                      x="0"
                      y="3.5"
                      textAnchor="middle"
                      fontSize="10.5"
                      fontWeight="600"
                      fill={isActive ? '#ffffff' : '#334155'}
                      fontFamily="Manrope, system-ui, sans-serif"
                    >
                      {wp.label}
                    </text>
                  </g>
                </g>
              );
            })}
          </svg>

          {/* Animated airplane gliding along exact 960x280 Bezier path */}
          <motion.div
            className="pointer-events-none absolute top-0 left-0 flex items-center justify-center"
            style={{
              width: 38,
              height: 38,
              offsetPath: `path('${FLIGHT_PATH}')`,
              offsetRotate: 'auto',
              offsetAnchor: 'center',
            }}
            initial={{ offsetDistance: prefersReducedMotion ? '62%' : '0%' }}
            animate={
              prefersReducedMotion
                ? { offsetDistance: '62%' }
                : { offsetDistance: ['0%', '100%'] }
            }
            transition={
              prefersReducedMotion
                ? undefined
                : {
                    duration: 11,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }
            }
          >
            <svg
              width="36"
              height="36"
              viewBox="0 0 36 36"
              fill="none"
              className="drop-shadow-md"
            >
              {/* Soft air wake */}
              <path
                d="M 2 18 L 10 18"
                stroke="#38bdf8"
                strokeOpacity="0.65"
                strokeWidth="2"
                strokeLinecap="round"
              />
              {/* Custom jet silhouette pointing right (+X) for offset-rotate: auto */}
              <path
                d="M 32 18 C 32 19.3 29.8 20.4 26.8 20.6 L 21.2 20.8 L 14.5 31 L 11.4 31 L 15.2 20.8 L 9.5 20.5 L 6.3 25 L 4 25 L 5.8 18 L 4 11 L 6.3 11 L 9.5 15.5 L 15.2 15.2 L 11.4 5 L 14.5 5 L 21.2 15.2 L 26.8 15.4 C 29.8 15.6 32 16.7 32 18 Z"
                fill="#0284c7"
                stroke="#ffffff"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
              <path
                d="M 26.5 17.2 C 28.4 17.3 29.7 17.7 30.1 18 C 29.7 18.3 28.4 18.7 26.5 18.8 L 24 18.8 L 24 17.2 Z"
                fill="#e0f2fe"
              />
            </svg>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
