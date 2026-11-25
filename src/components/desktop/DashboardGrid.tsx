import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Eye, EyeOff, GripVertical, Loader2, MoveVertical, Palette, RotateCcw, Save, SlidersHorizontal, X } from 'lucide-react';
import { DashboardLayout, DashboardWidgetLayout } from '../../crm/crmApi';

/**
 * The Live Dashboard board.
 *
 * Until an Admin / CEO customises it, the boxes sit in a neat 12-column flow (the original design).
 * "Customise dashboard" switches to free placement: every box can be dragged ANYWHERE (left, right, up, down) and stays exactly where it is dropped,
 * resized from its corner, nudged with arrows, coloured, hidden and shown again. "Save for everyone" stores the arrangement once;
 * every other screen picks it up on its next refresh (about 20 seconds).
 */
export const DASH_COLORS = ['blue', 'emerald', 'violet', 'amber', 'rose', 'sky', 'teal', 'slate'] as const;
const SWATCH: Record<string, string> = { blue: '#3b82f6', emerald: '#10b981', violet: '#8b5cf6', amber: '#f59e0b', rose: '#f43f5e', sky: '#0ea5e9', teal: '#14b8a6', slate: '#64748b' };

export interface DashWidgetProps {
  /** a-z, 0-9 and "-" only (stored on the server) */
  id: string;
  /** Name shown while customising */
  label: string;
  /** Width in 12ths of the row when nobody has changed it yet */
  span?: number;
  /** Used for small style hooks, e.g. "stat" */
  kind?: string;
  children?: React.ReactNode;
}
/** Marker component: the grid reads its props and draws the cell itself. */
export const DashWidget: React.FC<DashWidgetProps> = ({ children }) => <>{children}</>;

interface Props {
  layout: DashboardLayout | null | undefined;
  canEdit: boolean;
  onSave: (layout: { items: Record<string, DashboardWidgetLayout> }) => Promise<void>;
  children: React.ReactNode;
}

type Items = Record<string, DashboardWidgetLayout>;
const GAP = 16;
const MIN_H = 80;
const NUDGE_Y = 40;
const DEFAULT_H = 160;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const SIZES: [string, number][] = [['S', 3], ['M', 6], ['L', 9], ['Full', 12]];
const isFree = (i?: DashboardWidgetLayout) => Boolean(i) && Number.isFinite(i!.x) && Number.isFinite(i!.y);

/** The final order / size / colour of every widget: saved values win, new widgets use their defaults. Pure, so it can be tested. */
export function resolveLayout(defs: { id: string; span: number }[], saved: Items | undefined): Items {
  const out: Items = {};
  defs.forEach((d, i) => {
    const s = saved?.[d.id];
    out[d.id] = s
      ? {
        order: Number.isFinite(s.order) ? s.order : i * 10, span: clamp(Math.round(s.span || d.span), 2, 12), h: s.h > 0 ? clamp(Math.round(s.h), MIN_H, 1400) : 0, color: s.color || '', hidden: Boolean(s.hidden),
        ...(isFree(s) ? { x: clamp(Math.round(s.x!), 0, 10), y: Math.max(0, Math.round(s.y!)) } : {}),
      }
      : { order: i * 10, span: d.span, h: 0, color: '', hidden: false };
  });
  return out;
}

export interface Box { id: string; x?: number; y?: number; w: number; h: number }
export interface Placed { x: number; y: number; w: number; h: number }

/**
 * Turns the wanted positions into real ones. Boxes that were placed by hand keep their spot; if two would overlap, the one that is lower
 * (or the one that is not being dragged) is pushed down just enough. Boxes with no position yet are flowed in rows underneath. Pure, so it can be tested.
 */
export function placeBoxes(list: Box[], priority?: string, gap = GAP): Record<string, Placed> {
  const out: Record<string, Placed> = {};
  const placed: Placed[] = [];
  const explicit = list.filter((b) => Number.isFinite(b.x) && Number.isFinite(b.y));
  const auto = list.filter((b) => !(Number.isFinite(b.x) && Number.isFinite(b.y)));
  const sorted = [...explicit].sort((a, b) => (a.id === priority ? -1 : b.id === priority ? 1 : (a.y! - b.y!) || (a.x! - b.x!)));
  for (const b of sorted) {
    const w = clamp(b.w, 2, 12);
    const p: Placed = { x: clamp(b.x!, 0, 12 - w), y: Math.max(0, b.y!), w, h: b.h };
    for (let guard = 0; guard < 200; guard++) {
      const hit = placed.find((o) => p.x < o.x + o.w && o.x < p.x + p.w && p.y < o.y + o.h + gap && o.y < p.y + p.h + gap);
      if (!hit) break;
      p.y = hit.y + hit.h + gap;
    }
    placed.push(p);
    out[b.id] = p;
  }
  let rowY = placed.length ? Math.max(...placed.map((p) => p.y + p.h)) + gap : 0;
  let x = 0;
  let rowH = 0;
  for (const b of auto) {
    const w = clamp(b.w, 2, 12);
    if (x + w > 12) { x = 0; rowY += rowH + gap; rowH = 0; }
    out[b.id] = { x, y: rowY, w, h: b.h };
    rowH = Math.max(rowH, b.h);
    x += w;
  }
  return out;
}

export const DashboardGrid: React.FC<Props> = ({ layout, canEdit, onSave, children }) => {
  const defs = useMemo(() => {
    const out: (DashWidgetProps & { span: number; node: React.ReactNode })[] = [];
    React.Children.forEach(children, (c) => {
      if (React.isValidElement<DashWidgetProps>(c) && c.type === DashWidget) out.push({ ...c.props, span: c.props.span ?? 12, node: c.props.children });
    });
    return out;
  }, [children]);
  const ids = useMemo(() => defs.map((d) => d.id), [defs]);
  const saved = useMemo(() => resolveLayout(defs, layout?.items), [defs, layout]);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Items>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [colourFor, setColourFor] = useState<string | null>(null);
  /** A box that is being dragged or resized right now: its wanted position / size, before it is dropped */
  const [live, setLive] = useState<{ id: string; x?: number; y?: number; w?: number; h?: number } | null>(null);
  const [measured, setMeasured] = useState<Record<string, number>>({});
  const [width, setWidth] = useState(1000);
  const [narrow, setNarrow] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const cells = useRef<Record<string, HTMLDivElement | null>>({});
  const placedRef = useRef<Record<string, Placed>>({});

  const baseItems = editing ? resolveLayout(defs, draft) : saved;
  const ordered = [...defs].sort((a, b) => (baseItems[a.id].order - baseItems[b.id].order) || ids.indexOf(a.id) - ids.indexOf(b.id));
  const visible = ordered.filter((d) => !baseItems[d.id].hidden);
  const hiddenDefs = defs.filter((d) => baseItems[d.id].hidden);

  // Free placement is used while customising, and for everyone once the Admin has placed boxes by hand (not on phones).
  const free = !narrow && (editing || defs.some((d) => isFree(saved[d.id])));

  useEffect(() => { if (!canEdit && editing) setEditing(false); }, [canEdit, editing]);

  useLayoutEffect(() => {
    const g = grid.current;
    if (!g) return undefined;
    const ro = new ResizeObserver(() => { setWidth(g.getBoundingClientRect().width); });
    ro.observe(g);
    setWidth(g.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // Boxes with an automatic height are measured, so the ones below them can be placed correctly.
  const autoIds = visible.filter((d) => !baseItems[d.id].h).map((d) => d.id).join(',');
  useLayoutEffect(() => {
    if (!free) return undefined;
    const ro = new ResizeObserver((entries) => {
      setMeasured((m) => {
        let next = m;
        for (const en of entries) {
          const id = (en.target as HTMLElement).getAttribute('data-dash-id') || '';
          const h = Math.ceil((en.target as HTMLElement).offsetHeight);
          if (id && Math.abs((m[id] || 0) - h) > 1) next = { ...next, [id]: h };
        }
        return next;
      });
    });
    autoIds.split(',').filter(Boolean).forEach((id) => { const el = cells.current[id]; if (el) ro.observe(el); });
    return () => ro.disconnect();
  }, [free, autoIds, width]);

  const step = (width + GAP) / 12;
  const items: Items = live
    ? { ...baseItems, [live.id]: { ...baseItems[live.id], ...(live.w ? { span: live.w } : {}), ...(live.h !== undefined ? { h: live.h } : {}), ...(live.x !== undefined ? { x: live.x, y: live.y } : {}) } }
    : baseItems;
  const placed = useMemo(() => {
    if (!free) return {} as Record<string, Placed>;
    return placeBoxes(visible.map((d) => ({ id: d.id, x: items[d.id].x, y: items[d.id].y, w: items[d.id].span, h: items[d.id].h || measured[d.id] || DEFAULT_H })), live?.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [free, visible.map((d) => d.id).join(','), JSON.stringify(items), measured, live?.id]);
  placedRef.current = placed;
  const bottom = Object.values(placed).reduce((m, p) => Math.max(m, p.y + p.h), 0);

  /** Make the positions shown right now the real, saved ones (including boxes that were pushed aside) */
  const commit = (d: Items): Items => {
    const out: Items = { ...d };
    for (const [id, p] of Object.entries(placedRef.current)) if (out[id]) out[id] = { ...out[id], x: p.x, y: p.y, span: p.w };
    return out;
  };
  const patchItem = (id: string, p: Partial<DashboardWidgetLayout>) => setDraft((d) => { const cur = resolveLayout(defs, d); return { ...cur, [id]: { ...cur[id], ...p } }; });

  /** Change one box and keep every other box where it is, unless they would overlap */
  const change = (id: string, p: Partial<DashboardWidgetLayout>) => {
    const cur = placedRef.current;
    const base = commit(resolveLayout(defs, draft));
    const next: Items = { ...base, [id]: { ...base[id], ...p } };
    const again = placeBoxes(visible.map((d) => ({ id: d.id, x: next[d.id].x, y: next[d.id].y, w: next[d.id].span, h: next[d.id].h || measured[d.id] || cur[d.id]?.h || DEFAULT_H })), id);
    const out: Items = { ...next };
    for (const [bid, b] of Object.entries(again)) out[bid] = { ...out[bid], x: b.x, y: b.y, span: b.w };
    setDraft(out);
  };

  const start = (unhide?: string) => {
    const g = grid.current;
    const snap: Items = { ...saved };
    if (g) {
      const gr = g.getBoundingClientRect();
      const st = (gr.width + GAP) / 12;
      for (const d of defs) {
        const el = cells.current[d.id];
        if (!el || saved[d.id].hidden) continue;
        const r = el.getBoundingClientRect();
        const w = clamp(Math.round((r.width + GAP) / st), 2, 12);
        snap[d.id] = { ...saved[d.id], span: w, x: clamp(Math.round((r.left - gr.left) / st), 0, 12 - w), y: Math.max(0, Math.round(r.top - gr.top)), h: saved[d.id].h || Math.round(r.height) };
      }
    }
    if (unhide && snap[unhide]) {
      const lowest = Object.values(snap).filter((i) => !i.hidden && isFree(i)).reduce((m, i) => Math.max(m, (i.y || 0) + (i.h || DEFAULT_H)), 0);
      snap[unhide] = { ...snap[unhide], hidden: false, x: 0, y: lowest + GAP };
    }
    setDraft(snap);
    setErr('');
    setLive(null);
    setEditing(true);
  };
  const cancel = () => { setEditing(false); setColourFor(null); setErr(''); setLive(null); };
  const reset = () => { setDraft(resolveLayout(defs, undefined)); setColourFor(null); setEditing(true); };
  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      const out: Items = {};
      const final = commit(resolveLayout(defs, draft));
      for (const d of defs) {
        const it = final[d.id];
        out[d.id] = { order: it.order, span: it.span, h: it.h, color: it.color, hidden: it.hidden, ...(isFree(it) ? { x: it.x, y: it.y } : {}) };
      }
      // keep the reading order (used on phones) in line with what is shown: top to bottom, left to right
      Object.entries(out).sort((a, b) => ((a[1].y ?? 1e9) - (b[1].y ?? 1e9)) || ((a[1].x ?? 0) - (b[1].x ?? 0))).forEach(([id], i) => { out[id].order = i * 10; });
      await onSave({ items: out });
      setEditing(false);
      setColourFor(null);
    } catch (e: any) {
      setErr(e?.message || 'Could not save the layout.');
    } finally {
      setBusy(false);
    }
  };

  const nudge = (id: string, dx: number, dy: number) => {
    const p = placedRef.current[id];
    if (!p) return;
    change(id, { x: clamp(p.x + dx, 0, 12 - p.w), y: Math.max(0, p.y + dy) });
  };

  // Drag a box by its handle: it follows the pointer in any direction, snaps to the columns, and stays where it is dropped.
  const startDrag = (e: React.PointerEvent, id: string) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const p = placedRef.current[id];
    if (!p) return;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: PointerEvent) => {
      setLive({ id, x: clamp(Math.round(p.x + (ev.clientX - sx) / step), 0, 12 - p.w), y: Math.max(0, Math.round((p.y + (ev.clientY - sy)) / 8) * 8) });
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      setLive(null);
      setDraft((d) => commit(resolveLayout(defs, d)));
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  // Drag the bottom-right corner to make a box wider or taller: width snaps to the 12 columns, height is free.
  const startResize = (e: React.PointerEvent, id: string) => {
    e.preventDefault();
    const p = placedRef.current[id];
    if (!p) return;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: PointerEvent) => {
      setLive({ id, w: clamp(Math.round((p.w * step + (ev.clientX - sx)) / step), 2, 12 - p.x), h: clamp(Math.round(p.h + (ev.clientY - sy)), MIN_H, 1400) });
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      setLive(null);
      setDraft((d) => {
        const base = commit(resolveLayout(defs, d));
        const l = latestLive.current;
        return l && l.id === id ? { ...base, [id]: { ...base[id], span: l.w ?? base[id].span, h: l.h ?? base[id].h } } : base;
      });
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };
  const latestLive = useRef<typeof live>(null);
  latestLive.current = live;

  const shown = free ? visible : ordered.filter((d) => !baseItems[d.id].hidden);
  const toolsDisabled = busy;

  return (
    <div data-dash-root>
      {canEdit && !narrow && (
        <div className="mb-3 space-y-2" data-dash-toolbar>
          {!editing ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">{layout?.updatedByName ? `Layout last saved by ${layout.updatedByName}.` : 'Everyone sees the same dashboard layout.'}</p>
              <div className="flex flex-wrap items-center gap-2">
                {hiddenDefs.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5" data-dash-hidden>
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Hidden boxes ({hiddenDefs.length}):</span>
                    {hiddenDefs.map((d) => (
                      <button key={d.id} type="button" onClick={() => start(d.id)} data-dash-show={d.id} className="inline-flex items-center gap-1 rounded-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                        <Eye className="w-3 h-3" /> Show {d.label}
                      </button>
                    ))}
                  </div>
                )}
                <button type="button" onClick={() => start()} data-dash-edit className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                  <SlidersHorizontal className="w-3.5 h-3.5" /> Customise dashboard
                </button>
              </div>
            </div>
          ) : (
            <div className="w-full rounded-2xl border border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/30 p-3 space-y-2" data-dash-editbar>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold text-blue-900 dark:text-blue-200">Customising: drag a box anywhere by its handle, use the arrows to nudge it up, down, left or right, drag its corner to resize, pick a colour. Saving changes the dashboard for everyone.</p>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={reset} disabled={toolsDisabled} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-800 cursor-pointer"><RotateCcw className="w-3.5 h-3.5" /> Reset to default</button>
                  <button type="button" onClick={cancel} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-800 cursor-pointer"><X className="w-3.5 h-3.5" /> Cancel</button>
                  <button type="button" onClick={() => void save()} disabled={busy} data-dash-save className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-3 py-1.5 text-xs font-bold cursor-pointer">
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save for everyone
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5" data-dash-hidden>
                <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Hidden boxes{hiddenDefs.length ? ` (${hiddenDefs.length})` : ''}:</span>
                {hiddenDefs.length === 0 && <span className="text-[11px] text-slate-500">none. Use the eye on a box to hide it.</span>}
                {hiddenDefs.map((d) => (
                  <button key={d.id} type="button" onClick={() => change(d.id, { hidden: false, x: 0, y: bottom + GAP })} data-dash-show={d.id} className="inline-flex items-center gap-1 rounded-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
                    <Eye className="w-3 h-3" /> Show {d.label}
                  </button>
                ))}
              </div>
              {err && <p role="alert" className="text-xs font-semibold text-rose-600">{err}</p>}
            </div>
          )}
        </div>
      )}

      <div ref={grid} className={`dash-grid ${free ? 'is-free' : ''} ${editing ? 'is-editing' : ''}`} style={free ? { height: bottom + (editing ? 48 : 0) } : undefined} data-dash-grid>
        {shown.map((d) => {
          const it = items[d.id];
          const p = free ? placed[d.id] : undefined;
          const fixedH = !narrow && it.h > 0;
          const style: React.CSSProperties = free && p
            ? { position: 'absolute', left: p.x * step, top: p.y, width: p.w * step - GAP, ...(it.h ? { height: it.h } : {}) }
            : { ['--dash-span' as string]: it.span, ...(fixedH ? { height: it.h } : {}) } as React.CSSProperties;
          const dragging = live?.id === d.id;
          return (
            <div
              key={d.id}
              ref={(el) => { cells.current[d.id] = el; }}
              className={`dash-cell ${editing ? 'is-editing' : ''} ${dragging ? 'is-dragging' : ''}`}
              style={style}
              data-dash-id={d.id}
              data-dash-kind={d.kind || ''}
              data-dash-tone={it.color || undefined}
              data-dash-span={it.span}
              data-dash-x={p ? p.x : undefined}
              data-dash-y={p ? Math.round(p.y) : undefined}
            >
              {editing && (
                <div className="dash-bar" data-dash-bar>
                  <span className="dash-handle" title="Drag to move anywhere" data-dash-handle onPointerDown={(e) => startDrag(e, d.id)}><GripVertical className="w-3.5 h-3.5" /></span>
                  <span className="dash-bar-name" onPointerDown={(e) => startDrag(e, d.id)} style={{ cursor: 'grab', touchAction: 'none' }}>{d.label}</span>
                  <span className="dash-bar-tools">
                    <button type="button" onClick={() => nudge(d.id, 0, -NUDGE_Y)} aria-label={`Move ${d.label} up`} title="Up" data-dash-up><ArrowUp className="w-3.5 h-3.5" /></button>
                    <button type="button" onClick={() => nudge(d.id, 0, NUDGE_Y)} aria-label={`Move ${d.label} down`} title="Down" data-dash-down><ArrowDown className="w-3.5 h-3.5" /></button>
                    <button type="button" onClick={() => nudge(d.id, -1, 0)} aria-label={`Move ${d.label} left`} title="Left" data-dash-left><ArrowLeft className="w-3.5 h-3.5" /></button>
                    <button type="button" onClick={() => nudge(d.id, 1, 0)} aria-label={`Move ${d.label} right`} title="Right" data-dash-right><ArrowRight className="w-3.5 h-3.5" /></button>
                    {SIZES.map(([name, n]) => (
                      <button key={name} type="button" onClick={() => change(d.id, { span: n, x: Math.min(placed[d.id]?.x ?? 0, 12 - n) })} className={it.span === n ? 'is-on' : ''} aria-label={`${d.label} width ${name}`} title={`Width: ${name}`}>{name}</button>
                    ))}
                    {it.h > 0 && <button type="button" onClick={() => change(d.id, { h: 0 })} aria-label={`Automatic height for ${d.label}`} title="Automatic height"><MoveVertical className="w-3.5 h-3.5" /></button>}
                    <button type="button" onClick={() => setColourFor(colourFor === d.id ? null : d.id)} aria-label={`Colour of ${d.label}`} title="Colour" data-dash-colour-open><Palette className="w-3.5 h-3.5" /></button>
                    <button type="button" onClick={() => patchItem(d.id, { hidden: true })} aria-label={`Hide ${d.label}`} title="Hide" data-dash-hide><EyeOff className="w-3.5 h-3.5" /></button>
                  </span>
                  {colourFor === d.id && (
                    <span className="dash-swatches" role="group" aria-label={`Colour for ${d.label}`}>
                      <button type="button" className={`dash-swatch dash-swatch-none ${!it.color ? 'is-on' : ''}`} onClick={() => patchItem(d.id, { color: '' })} aria-label="No colour" title="Default" />
                      {DASH_COLORS.map((c) => (
                        <button key={c} type="button" className={`dash-swatch ${it.color === c ? 'is-on' : ''}`} style={{ background: SWATCH[c] }} onClick={() => patchItem(d.id, { color: c })} aria-label={`Colour ${c}`} title={c} data-dash-colour={c} />
                      ))}
                    </span>
                  )}
                </div>
              )}
              <div className="dash-body">{d.node}</div>
              {editing && <span className="dash-resize" onPointerDown={(e) => startResize(e, d.id)} title="Drag to resize" aria-label={`Resize ${d.label}`} data-dash-resize role="separator" />}
            </div>
          );
        })}
      </div>
    </div>
  );
};
