import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

/* ------------------------------------------------------------------ *
 * Shared, accurate SVG charts.
 * Every axis, gridline, target line and bar in a chart uses ONE scale
 * function, so what you read on the axis is exactly what is drawn.
 * ------------------------------------------------------------------ */

export type DayStatus = 'on_time' | 'late' | 'absent' | 'leave' | 'off' | 'pending';

const STATUS_COLOR: Record<DayStatus, string> = {
  on_time: '#10b981',
  late: '#8b5cf6',
  absent: '#f43f5e',
  leave: '#0ea5e9',
  off: '#94a3b8',
  pending: '#94a3b8',
};

export function hmToMinutes(t?: string | null): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function fmtHours(mins: number) {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function fmtClock(mins: number) {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}

function fmtClockShort(mins: number) {
  const h24 = ((Math.round(mins / 60) % 24) + 24) % 24;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}${h24 < 12 ? 'a' : 'p'}`;
}

/** Picks a "nice" axis maximum and step so ticks are whole hours and never crowd. */
export function niceHourAxis(maxHours: number) {
  const steps = [1, 2, 3, 4, 6];
  let step = 1;
  for (const s of steps) {
    step = s;
    if (Math.ceil(maxHours / s) <= 6) break;
  }
  const max = Math.max(step * 2, Math.ceil(maxHours / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(v);
  return { max, step, ticks };
}

function useElementWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(240, Math.floor(el.clientWidth)));
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

const HALO = 'stroke-white dark:stroke-slate-900';

/* ------------------------------------------------------------------ *
 * 1. Hours bar chart (regular + overtime stacked, target line)
 * ------------------------------------------------------------------ */
export interface HoursDay {
  key: string;
  weekday: string; // "Mon"
  dateLabel: string; // "11-02"
  regularMin: number;
  overtimeMin: number;
  status: DayStatus;
}

interface HoursBarChartProps {
  days: HoursDay[];
  targetHours?: number;
  activeKey?: string | null;
  onHover?: (key: string | null) => void;
  onSelect?: (key: string) => void;
  height?: number;
  barColors?: { regular: [string, string]; late: [string, string]; overtime: [string, string] };
}

const DEFAULT_BAR_COLORS = {
  regular: ['#2563eb', '#22d3ee'] as [string, string],
  late: ['#7c3aed', '#818cf8'] as [string, string],
  overtime: ['#f59e0b', '#fb923c'] as [string, string],
};

function roundedTopPath(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

export function HoursBarChart({
  days,
  targetHours,
  activeKey,
  onHover,
  onSelect,
  height = 280,
  barColors = DEFAULT_BAR_COLORS,
}: HoursBarChartProps) {
  const uid = useId().replace(/:/g, '');
  const [wrapRef, wrapWidth] = useElementWidth<HTMLDivElement>();
  const M = { l: 44, r: targetHours ? 70 : 16, t: 26, b: 44 };
  const minBand = 26;
  const width = Math.max(wrapWidth, M.l + M.r + days.length * minBand);
  const plotW = width - M.l - M.r;
  const plotH = height - M.t - M.b;
  const band = days.length ? plotW / days.length : plotW;
  const maxTotal = Math.max(0, ...days.map((d) => (d.regularMin + d.overtimeMin) / 60));
  const axis = niceHourAxis(Math.max(maxTotal * 1.08, (targetHours || 0) * 1.2, 4));
  const y = (h: number) => M.t + plotH - (h / axis.max) * plotH;
  const barW = Math.max(8, Math.min(36, band * 0.62));
  const labelEvery = band >= 40 ? 1 : band >= 28 ? 2 : Math.ceil(44 / band);
  const showWeekday = band >= 30;

  return (
    <div ref={wrapRef} className="w-full overflow-x-auto">
      <svg width={width} height={height} role="img" aria-label="Daily worked hours chart" className="block">
        <defs>
          {(['regular', 'late', 'overtime'] as const).map((k) => (
            <linearGradient key={k} id={`${uid}-${k}`} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor={barColors[k][0]} />
              <stop offset="100%" stopColor={barColors[k][1]} />
            </linearGradient>
          ))}
        </defs>

        {/* non-working day shading */}
        {days.map((d, i) =>
          d.status === 'off' ? (
            <rect
              key={`off-${d.key}`}
              x={M.l + i * band}
              y={M.t}
              width={band}
              height={plotH}
              className="fill-slate-200/50 dark:fill-slate-700/25"
            />
          ) : null
        )}

        {/* horizontal grid + hour axis (same scale as bars) */}
        {axis.ticks.map((h) => (
          <g key={`t-${h}`}>
            <line
              x1={M.l}
              x2={M.l + plotW}
              y1={y(h)}
              y2={y(h)}
              className={h === 0 ? 'stroke-slate-300 dark:stroke-slate-600' : 'stroke-slate-200 dark:stroke-slate-800'}
              strokeDasharray={h === 0 ? undefined : '3 4'}
            />
            <text
              x={M.l - 8}
              y={y(h)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-slate-500 dark:fill-slate-400"
              style={{ fontSize: 10, fontWeight: 600 }}
            >
              {h}h
            </text>
          </g>
        ))}

        {/* active band highlight */}
        {days.map((d, i) =>
          activeKey === d.key ? (
            <rect
              key={`hl-${d.key}`}
              x={M.l + i * band + 1}
              y={M.t - 4}
              width={band - 2}
              height={plotH + 8}
              rx={8}
              className="fill-indigo-500/10"
            />
          ) : null
        )}

        {/* bars */}
        {days.map((d, i) => {
          const cx = M.l + i * band + band / 2;
          const total = (d.regularMin + d.overtimeMin) / 60;
          const regH = (d.regularMin / 60 / axis.max) * plotH;
          const otH = (d.overtimeMin / 60 / axis.max) * plotH;
          const x0 = cx - barW / 2;
          const base = y(0);
          const regFill = d.status === 'late' ? `url(#${uid}-late)` : `url(#${uid}-regular)`;
          if (total <= 0) {
            if (d.status === 'off' || d.status === 'pending') return null;
            return (
              <rect
                key={d.key}
                x={cx - Math.min(8, barW / 2)}
                y={base - 4}
                width={Math.min(16, barW)}
                height={4}
                rx={2}
                fill={STATUS_COLOR[d.status]}
                opacity={0.75}
              />
            );
          }
          return (
            <g key={d.key}>
              {otH > 0.5 ? (
                <>
                  <rect x={x0} y={base - regH} width={barW} height={Math.max(regH, 1)} fill={regFill} />
                  <path d={roundedTopPath(x0, base - regH - otH, barW, otH, 6)} fill={`url(#${uid}-overtime)`} />
                </>
              ) : (
                <path d={roundedTopPath(x0, base - regH, barW, Math.max(regH, 2), 6)} fill={regFill} />
              )}
              <text
                x={cx}
                y={base - regH - otH - 6}
                textAnchor="middle"
                className={`${HALO} fill-slate-700 dark:fill-slate-200`}
                strokeWidth={3}
                paintOrder="stroke"
                style={{ fontSize: 10, fontWeight: 700 }}
              >
                {total.toFixed(1)}h
              </text>
            </g>
          );
        })}

        {/* target line, drawn from the SAME y() as the axis */}
        {targetHours ? (
          <g>
            <line
              x1={M.l}
              x2={M.l + plotW}
              y1={y(targetHours)}
              y2={y(targetHours)}
              stroke="#10b981"
              strokeWidth={1.75}
              strokeDasharray="6 4"
            />
            <rect x={M.l + plotW + 6} y={y(targetHours) - 10} width={58} height={20} rx={10} className="fill-emerald-100 dark:fill-emerald-950" />
            <text
              x={M.l + plotW + 35}
              y={y(targetHours)}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-emerald-700 dark:fill-emerald-300"
              style={{ fontSize: 10, fontWeight: 700 }}
            >
              Target {targetHours}h
            </text>
          </g>
        ) : null}

        {/* x labels + status dots */}
        {days.map((d, i) => {
          const cx = M.l + i * band + band / 2;
          const show = i % labelEvery === 0;
          return (
            <g key={`x-${d.key}`}>
              {show && (
                <>
                  {showWeekday && (
                    <text x={cx} y={y(0) + 16} textAnchor="middle" className="fill-slate-600 dark:fill-slate-300" style={{ fontSize: 10, fontWeight: 600 }}>
                      {d.weekday}
                    </text>
                  )}
                  <text
                    x={cx}
                    y={y(0) + (showWeekday ? 29 : 16)}
                    textAnchor="middle"
                    className="fill-slate-400 dark:fill-slate-500"
                    style={{ fontSize: 9 }}
                  >
                    {band >= 44 ? d.dateLabel : d.dateLabel.slice(3)}
                  </text>
                </>
              )}
              {(d.status === 'late' || d.status === 'absent' || d.status === 'leave') && (
                <circle cx={cx} cy={y(0) + (showWeekday ? 38 : 26)} r={2.6} fill={STATUS_COLOR[d.status]} />
              )}
            </g>
          );
        })}

        {/* interaction layer */}
        {days.map((d, i) => (
          <rect
            key={`hit-${d.key}`}
            x={M.l + i * band}
            y={M.t - 6}
            width={band}
            height={plotH + 50}
            fill="transparent"
            style={{ cursor: onSelect ? 'pointer' : 'default' }}
            tabIndex={0}
            role="button"
            aria-label={`${d.weekday} ${d.dateLabel}: ${fmtHours(d.regularMin + d.overtimeMin)}`}
            onMouseEnter={() => onHover?.(d.key)}
            onMouseLeave={() => onHover?.(null)}
            onFocus={() => onHover?.(d.key)}
            onBlur={() => onHover?.(null)}
            onClick={() => onSelect?.(d.key)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect?.(d.key);
              }
            }}
          />
        ))}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 2. Punch timeline: one horizontal bar per day from punch-in to
 *    punch-out on a real clock axis, with shift window + grace zone.
 * ------------------------------------------------------------------ */
export interface TimelineDay {
  key: string;
  weekday: string;
  dateLabel: string;
  status: DayStatus;
  timeIn?: string | null;
  timeOut?: string | null;
  isOpen?: boolean; // still clocked in
  nowMinutes?: number; // minutes-of-day "now" for open shifts
  breaks?: { start?: string; end?: string }[];
}

interface PunchTimelineProps {
  days: TimelineDay[];
  shiftStart?: string;
  shiftEnd?: string;
  graceMinutes?: number;
  activeKey?: string | null;
  onHover?: (key: string | null) => void;
  onSelect?: (key: string) => void;
}

export function PunchTimeline({ days, shiftStart, shiftEnd, graceMinutes = 0, activeKey, onHover, onSelect }: PunchTimelineProps) {
  const [wrapRef, wrapWidth] = useElementWidth<HTMLDivElement>();
  const rowH = days.length > 20 ? 18 : 26;
  const M = { l: 78, r: 16, t: 28, b: 10 };
  const width = Math.max(wrapWidth, 520);
  const height = M.t + days.length * rowH + M.b;
  const plotW = width - M.l - M.r;

  const sStart = hmToMinutes(shiftStart);
  let sEnd = hmToMinutes(shiftEnd);
  if (sStart !== null && sEnd !== null && sEnd <= sStart) sEnd += 1440; // overnight shift

  // normalise each day to absolute minutes (handles punch-out after midnight)
  const rows = days.map((d) => {
    const a = hmToMinutes(d.timeIn);
    let b = hmToMinutes(d.timeOut);
    if (a !== null && b !== null && b < a) b += 1440;
    if (a !== null && b === null && d.isOpen && typeof d.nowMinutes === 'number') b = Math.max(a, d.nowMinutes);
    const brks = (d.breaks || [])
      .map((x) => {
        let s = hmToMinutes(x.start);
        let e = hmToMinutes(x.end);
        if (s !== null && a !== null && s < a) s += 1440;
        if (e !== null && s !== null && e < s) e += 1440;
        return s !== null && e !== null ? { s, e } : null;
      })
      .filter(Boolean) as { s: number; e: number }[];
    return { d, a, b, brks };
  });

  const allMarks: number[] = [];
  rows.forEach((r) => {
    if (r.a !== null) allMarks.push(r.a);
    if (r.b !== null) allMarks.push(r.b);
  });
  if (sStart !== null) allMarks.push(sStart);
  if (sEnd !== null) allMarks.push(sEnd);
  const lo = allMarks.length ? Math.max(0, Math.floor((Math.min(...allMarks) - 45) / 60) * 60) : 8 * 60;
  let hi = allMarks.length ? Math.ceil((Math.max(...allMarks) + 45) / 60) * 60 : 18 * 60;
  hi = Math.min(Math.max(hi, lo + 6 * 60), 48 * 60);
  const x = (m: number) => M.l + ((m - lo) / (hi - lo)) * plotW;
  const hourStep = hi - lo > 14 * 60 ? 2 : 1;
  const hourTicks: number[] = [];
  for (let m = lo; m <= hi; m += 60 * hourStep) hourTicks.push(m);

  return (
    <div ref={wrapRef} className="w-full overflow-x-auto">
      <svg width={width} height={height} role="img" aria-label="Daily punch in and out timeline" className="block">
        {/* shift window + grace */}
        {sStart !== null && sEnd !== null && (
          <g>
            <rect x={x(sStart)} y={M.t - 6} width={Math.max(0, x(sEnd) - x(sStart))} height={height - M.t - M.b + 6} className="fill-emerald-500/[0.07]" />
            {graceMinutes > 0 && (
              <rect x={x(sStart)} y={M.t - 6} width={Math.max(0, x(sStart + graceMinutes) - x(sStart))} height={height - M.t - M.b + 6} className="fill-amber-400/20" />
            )}
            <line x1={x(sStart)} x2={x(sStart)} y1={M.t - 8} y2={height - M.b} stroke="#10b981" strokeWidth={1.5} strokeDasharray="5 3" />
            <line x1={x(sEnd)} x2={x(sEnd)} y1={M.t - 8} y2={height - M.b} stroke="#10b981" strokeWidth={1.5} strokeDasharray="5 3" />
            <text x={x(sStart)} y={M.t - 14} textAnchor="middle" className="fill-emerald-700 dark:fill-emerald-300" style={{ fontSize: 9, fontWeight: 700 }}>
              Shift start
            </text>
            <text x={x(sEnd)} y={M.t - 14} textAnchor="middle" className="fill-emerald-700 dark:fill-emerald-300" style={{ fontSize: 9, fontWeight: 700 }}>
              Shift end
            </text>
          </g>
        )}

        {/* hour grid */}
        {hourTicks.map((m) => (
          <g key={`h-${m}`}>
            <line x1={x(m)} x2={x(m)} y1={M.t - 2} y2={height - M.b} className="stroke-slate-200 dark:stroke-slate-800" strokeDasharray="2 4" />
            <text x={x(m)} y={M.t - 1 - 0} dy={-12 + 0} textAnchor="middle" className="fill-slate-500 dark:fill-slate-400" style={{ fontSize: 10, fontWeight: 600, display: 'none' }}>
              {fmtClockShort(m)}
            </text>
          </g>
        ))}
        {hourTicks.map((m) => (
          <text key={`hl-${m}`} x={x(m)} y={height - 0} dy={-1} textAnchor="middle" className="fill-slate-500 dark:fill-slate-400" style={{ fontSize: 10, fontWeight: 600 }}>
            {fmtClockShort(m)}
          </text>
        ))}

        {rows.map((r, i) => {
          const cy = M.t + i * rowH + rowH / 2;
          const barH = Math.min(14, rowH - 8);
          const isActive = activeKey === r.d.key;
          const color = r.d.status === 'late' ? '#8b5cf6' : '#10b981';
          return (
            <g key={r.d.key}>
              {isActive && <rect x={4} y={cy - rowH / 2} width={width - 8} height={rowH} rx={8} className="fill-indigo-500/10" />}
              {r.d.status === 'off' && <rect x={M.l} y={cy - rowH / 2 + 1} width={plotW} height={rowH - 2} className="fill-slate-200/40 dark:fill-slate-700/20" />}
              <text x={M.l - 10} y={cy} textAnchor="end" dominantBaseline="middle" className="fill-slate-600 dark:fill-slate-300" style={{ fontSize: 10, fontWeight: 600 }}>
                {r.d.weekday} <tspan className="fill-slate-400 dark:fill-slate-500" style={{ fontWeight: 400 }}>{r.d.dateLabel}</tspan>
              </text>
              {r.a !== null && r.b !== null ? (
                <>
                  <rect x={x(r.a)} y={cy - barH / 2} width={Math.max(3, x(r.b) - x(r.a))} height={barH} rx={barH / 2} fill={color} opacity={r.d.isOpen ? 0.55 : 0.92} />
                  {r.brks.map((b, bi) => (
                    <rect key={bi} x={x(b.s)} y={cy - barH / 2} width={Math.max(2, x(b.e) - x(b.s))} height={barH} className="fill-white/80 dark:fill-slate-900/80" />
                  ))}
                  <circle cx={x(r.a)} cy={cy} r={3.2} className="fill-white" stroke={color} strokeWidth={2} />
                  {!r.d.isOpen && <circle cx={x(r.b)} cy={cy} r={3.2} className="fill-white" stroke={color} strokeWidth={2} />}
                </>
              ) : r.d.status === 'absent' ? (
                <text x={M.l + 8} y={cy} dominantBaseline="middle" className="fill-rose-500" style={{ fontSize: 10, fontWeight: 600 }}>
                  Absent
                </text>
              ) : r.d.status === 'leave' ? (
                <text x={M.l + 8} y={cy} dominantBaseline="middle" className="fill-sky-500" style={{ fontSize: 10, fontWeight: 600 }}>
                  On leave
                </text>
              ) : null}
              <rect
                x={0}
                y={cy - rowH / 2}
                width={width}
                height={rowH}
                fill="transparent"
                style={{ cursor: onSelect ? 'pointer' : 'default' }}
                onMouseEnter={() => onHover?.(r.d.key)}
                onMouseLeave={() => onHover?.(null)}
                onClick={() => onSelect?.(r.d.key)}
              >
                {r.a !== null && (
                  <title>
                    {`${r.d.weekday} ${r.d.dateLabel}: in ${fmtClock(r.a)}${r.b !== null && !r.d.isOpen ? ` · out ${fmtClock(r.b)}` : r.d.isOpen ? ' · still in' : ''}`}
                  </title>
                )}
              </rect>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 3. Donut
 * ------------------------------------------------------------------ */
export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

export function DonutChart({
  segments,
  centerTop,
  centerBottom,
  size = 148,
  thickness = 16,
}: {
  segments: DonutSegment[];
  centerTop?: string;
  centerBottom?: string;
  size?: number;
  thickness?: number;
}) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const gap = total > 0 && segments.filter((s) => s.value > 0).length > 1 ? 3 : 0;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Distribution chart" className="block shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={thickness} className="stroke-slate-100 dark:stroke-slate-800" />
      {total > 0 &&
        segments.map((s) => {
          if (s.value <= 0) return null;
          const len = (s.value / total) * c;
          const seg = (
            <circle
              key={s.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeLinecap="butt"
              strokeDasharray={`${Math.max(0, len - gap)} ${c - Math.max(0, len - gap)}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          );
          offset += len;
          return seg;
        })}
      {centerTop && (
        <text x="50%" y={centerBottom ? '47%' : '52%'} textAnchor="middle" dominantBaseline="middle" className="fill-slate-900 dark:fill-slate-100" style={{ fontSize: size * 0.2, fontWeight: 800 }}>
          {centerTop}
        </text>
      )}
      {centerBottom && (
        <text x="50%" y="64%" textAnchor="middle" dominantBaseline="middle" className="fill-slate-400 dark:fill-slate-500" style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.8 }}>
          {centerBottom}
        </text>
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * 4. Sparkline
 * ------------------------------------------------------------------ */
export function Sparkline({ values, color = '#6366f1', width = 96, height = 30 }: { values: number[]; color?: string; width?: number; height?: number }) {
  const uid = useId().replace(/:/g, '');
  if (values.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const pad = 3;
  const pts = values.map((v, i) => [pad + (i / (values.length - 1)) * (width - pad * 2), height - pad - ((v - min) / span) * (height - pad * 2)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${height} L${pts[0][0].toFixed(1)},${height} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} aria-hidden="true" className="block">
      <defs>
        <linearGradient id={`${uid}-sp`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${uid}-sp)`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2.8} fill={color} />
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * 5. Team trend: stacked man-hours bars + present-count line
 * ------------------------------------------------------------------ */
export interface TeamDay {
  key: string;
  weekday: string;
  dateLabel: string;
  regularHours: number;
  overtimeHours: number;
  present: number;
  off?: boolean;
}

export function TeamTrendChart({ days, headcount, height = 280 }: { days: TeamDay[]; headcount: number; height?: number }) {
  const uid = useId().replace(/:/g, '');
  const [wrapRef, wrapWidth] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const M = { l: 48, r: 40, t: 28, b: 44 };
  const width = Math.max(wrapWidth, M.l + M.r + days.length * 26);
  const plotW = width - M.l - M.r;
  const plotH = height - M.t - M.b;
  const band = days.length ? plotW / days.length : plotW;
  const maxH = Math.max(1, ...days.map((d) => d.regularHours + d.overtimeHours));
  const axis = niceHourAxis(maxH * 1.1);
  const y = (h: number) => M.t + plotH - (h / axis.max) * plotH;
  const maxCount = Math.max(headcount, ...days.map((d) => d.present), 1);
  const yc = (c: number) => M.t + plotH - (c / maxCount) * plotH;
  const barW = Math.max(8, Math.min(34, band * 0.6));
  const labelEvery = band >= 40 ? 1 : band >= 28 ? 2 : Math.ceil(44 / band);
  const linePts = days.map((d, i) => `${i ? 'L' : 'M'}${(M.l + i * band + band / 2).toFixed(1)},${yc(d.present).toFixed(1)}`).join(' ');
  const hv = days.find((d) => d.key === hover);

  return (
    <div ref={wrapRef} className="w-full overflow-x-auto">
      <svg width={width} height={height} role="img" aria-label="Team man-hours and attendance trend" className="block">
        <defs>
          <linearGradient id={`${uid}-r`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#4f46e5" />
            <stop offset="100%" stopColor="#60a5fa" />
          </linearGradient>
          <linearGradient id={`${uid}-o`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#fb923c" />
          </linearGradient>
        </defs>
        {days.map((d, i) => d.off && <rect key={`o-${d.key}`} x={M.l + i * band} y={M.t} width={band} height={plotH} className="fill-slate-200/50 dark:fill-slate-700/25" />)}
        {axis.ticks.map((h) => (
          <g key={`t-${h}`}>
            <line x1={M.l} x2={M.l + plotW} y1={y(h)} y2={y(h)} className={h === 0 ? 'stroke-slate-300 dark:stroke-slate-600' : 'stroke-slate-200 dark:stroke-slate-800'} strokeDasharray={h === 0 ? undefined : '3 4'} />
            <text x={M.l - 8} y={y(h)} textAnchor="end" dominantBaseline="middle" className="fill-slate-500 dark:fill-slate-400" style={{ fontSize: 10, fontWeight: 600 }}>
              {h}h
            </text>
          </g>
        ))}
        {/* right axis: people present */}
        {[0, 0.5, 1].map((f) => {
          const v = Math.round(maxCount * f);
          return (
            <text key={`rc-${f}`} x={M.l + plotW + 8} y={yc(maxCount * f)} dominantBaseline="middle" className="fill-emerald-600 dark:fill-emerald-400" style={{ fontSize: 10, fontWeight: 600 }}>
              {v}
            </text>
          );
        })}
        {days.map((d, i) => {
          const cx = M.l + i * band + band / 2;
          const regH = (d.regularHours / axis.max) * plotH;
          const otH = (d.overtimeHours / axis.max) * plotH;
          const base = y(0);
          return (
            <g key={d.key}>
              {hover === d.key && <rect x={M.l + i * band + 1} y={M.t - 4} width={band - 2} height={plotH + 8} rx={8} className="fill-indigo-500/10" />}
              {regH > 0 && <rect x={cx - barW / 2} y={base - regH} width={barW} height={regH} fill={`url(#${uid}-r)`} />}
              {otH > 0 && <path d={roundedTopPath(cx - barW / 2, base - regH - otH, barW, otH, 6)} fill={`url(#${uid}-o)`} />}
              {regH > 0 && otH <= 0 && <rect x={cx - barW / 2} y={base - regH} width={barW} height={2} fill="transparent" />}
              {i % labelEvery === 0 && (
                <>
                  {band >= 30 && (
                    <text x={cx} y={base + 16} textAnchor="middle" className="fill-slate-600 dark:fill-slate-300" style={{ fontSize: 10, fontWeight: 600 }}>
                      {d.weekday}
                    </text>
                  )}
                  <text x={cx} y={base + (band >= 30 ? 29 : 16)} textAnchor="middle" className="fill-slate-400 dark:fill-slate-500" style={{ fontSize: 9 }}>
                    {band >= 44 ? d.dateLabel : d.dateLabel.slice(3)}
                  </text>
                </>
              )}
            </g>
          );
        })}
        {/* present-count line */}
        <path d={linePts} fill="none" stroke="#10b981" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" />
        {days.map((d, i) => (
          <circle key={`p-${d.key}`} cx={M.l + i * band + band / 2} cy={yc(d.present)} r={3.4} className="fill-white dark:fill-slate-900" stroke="#10b981" strokeWidth={2} />
        ))}
        {hv && (
          <g pointerEvents="none">
            {(() => {
              const cx = M.l + days.findIndex((d) => d.key === hv.key) * band + band / 2;
              const tx = Math.min(Math.max(cx, M.l + 70), M.l + plotW - 70);
              return (
                <>
                  <rect x={tx - 68} y={4} width={136} height={22} rx={11} className="fill-slate-900 dark:fill-slate-100" />
                  <text x={tx} y={15} textAnchor="middle" dominantBaseline="middle" className="fill-white dark:fill-slate-900" style={{ fontSize: 10, fontWeight: 700 }}>
                    {hv.dateLabel} · {hv.present} in · {(hv.regularHours + hv.overtimeHours).toFixed(0)}h
                  </text>
                </>
              );
            })()}
          </g>
        )}
        {days.map((d, i) => (
          <rect key={`hit-${d.key}`} x={M.l + i * band} y={M.t - 6} width={band} height={plotH + 50} fill="transparent" onMouseEnter={() => setHover(d.key)} onMouseLeave={() => setHover(null)} />
        ))}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 6. Calendar heat map (weeks as columns, Mon..Sun as rows)
 * ------------------------------------------------------------------ */
export interface HeatCell {
  date: string; // YYYY-MM-DD
  status: DayStatus;
  hours?: number;
  title?: string;
}

export function HeatCalendar({ cells, weeks = 6 }: { cells: HeatCell[]; weeks?: number }) {
  const byDate = new Map(cells.map((c) => [c.date, c]));
  const last = cells.length ? cells.reduce((m, c) => (c.date > m ? c.date : m), cells[0].date) : new Date().toISOString().slice(0, 10);
  const end = new Date(last + 'T00:00:00');
  const endDow = (end.getDay() + 6) % 7; // Mon=0
  const start = new Date(end);
  start.setDate(end.getDate() - endDow - (weeks - 1) * 7);
  const cols: { date: string; cell?: HeatCell; inRange: boolean }[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: { date: string; cell?: HeatCell; inRange: boolean }[] = [];
    for (let d = 0; d < 7; d++) {
      const dt = new Date(start);
      dt.setDate(start.getDate() + w * 7 + d);
      const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      col.push({ date: iso, cell: byDate.get(iso), inRange: iso <= last });
    }
    cols.push(col);
  }
  const cellSize = 22;
  const gap = 4;
  const left = 30;
  const top = 18;
  const w = left + weeks * (cellSize + gap);
  const h = top + 7 * (cellSize + gap);
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const fillFor = (c?: HeatCell): { fill: string; opacity: number } => {
    if (!c) return { fill: '#94a3b8', opacity: 0.12 };
    if (c.status === 'on_time' || c.status === 'late') {
      const base = STATUS_COLOR[c.status];
      const hrs = c.hours ?? 8;
      return { fill: base, opacity: 0.35 + Math.min(1, hrs / 10) * 0.65 };
    }
    if (c.status === 'absent') return { fill: '#f43f5e', opacity: 0.55 };
    if (c.status === 'leave') return { fill: '#0ea5e9', opacity: 0.55 };
    return { fill: '#94a3b8', opacity: 0.14 };
  };
  return (
    <svg width={w} height={h} role="img" aria-label="Attendance calendar" className="block max-w-full">
      {cols.map((col, wi) => {
        const first = col[0];
        const showMonth = wi === 0 || first.date.slice(8) <= '07';
        return (
          showMonth && (
            <text key={`m-${wi}`} x={left + wi * (cellSize + gap)} y={10} className="fill-slate-400 dark:fill-slate-500" style={{ fontSize: 9, fontWeight: 600 }}>
              {new Date(first.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' })}
            </text>
          )
        );
      })}
      {dayNames.map((n, i) => (
        <text key={n} x={0} y={top + i * (cellSize + gap) + cellSize / 2} dominantBaseline="middle" className="fill-slate-400 dark:fill-slate-500" style={{ fontSize: 9, fontWeight: 600 }}>
          {i % 2 === 0 ? n : ''}
        </text>
      ))}
      {cols.map((col, wi) =>
        col.map((c, di) => {
          const f = fillFor(c.inRange ? c.cell : undefined);
          const isToday = c.date === new Date().toISOString().slice(0, 10);
          return (
            <g key={c.date}>
              <rect
                x={left + wi * (cellSize + gap)}
                y={top + di * (cellSize + gap)}
                width={cellSize}
                height={cellSize}
                rx={6}
                fill={c.inRange ? f.fill : 'transparent'}
                opacity={c.inRange ? f.opacity : 1}
                stroke={isToday ? '#6366f1' : 'none'}
                strokeWidth={isToday ? 2 : 0}
              >
                <title>{c.cell?.title || c.date}</title>
              </rect>
              <text
                x={left + wi * (cellSize + gap) + cellSize / 2}
                y={top + di * (cellSize + gap) + cellSize / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-slate-700 dark:fill-slate-100"
                style={{ fontSize: 8, fontWeight: 700, opacity: c.inRange ? 0.7 : 0.2 }}
                pointerEvents="none"
              >
                {Number(c.date.slice(8))}
              </text>
            </g>
          );
        })
      )}
    </svg>
  );
}

export function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
      <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: color }} />
      {label}
    </span>
  );
}

export { STATUS_COLOR, fmtHours, fmtClock };
