import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Eye, EyeOff, GripVertical, Loader2, MoveVertical, Palette, RotateCcw, Save, SlidersHorizontal, X } from 'lucide-react';
import { DashboardLayout, DashboardWidgetLayout } from '../../crm/crmApi';

/**
 * A 12-column board for the Live Dashboard. Every box (a "widget") can be moved, made wider / narrower / taller,
 * given a colour or hidden. Only Admin / CEO can change it; when they press "Save for everyone" the arrangement is stored once
 * and every other person's dashboard picks it up on its next refresh (about 20 seconds).
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
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const SIZES: [string, number][] = [['S', 3], ['M', 6], ['L', 9], ['Full', 12]];

/** The final order / size / colour of every widget: saved values win, new widgets use their defaults. Pure, so it can be tested. */
export function resolveLayout(defs: { id: string; span: number }[], saved: Items | undefined): Items {
  const out: Items = {};
  defs.forEach((d, i) => {
    const s = saved?.[d.id];
    out[d.id] = s
      ? { order: Number.isFinite(s.order) ? s.order : i * 10, span: clamp(Math.round(s.span || d.span), 2, 12), h: s.h > 0 ? clamp(Math.round(s.h), 80, 1400) : 0, color: s.color || '', hidden: Boolean(s.hidden) }
      : { order: i * 10, span: d.span, h: 0, color: '', hidden: false };
  });
  return out;
}

/** Move one widget so it sits just before (or after) another one; returns fresh, evenly spaced order numbers. */
export function reorder(items: Items, ids: string[], moving: string, target: string, after = false): Items {
  const sorted = [...ids].sort((a, b) => (items[a].order - items[b].order) || ids.indexOf(a) - ids.indexOf(b)).filter((x) => x !== moving);
  const at = sorted.indexOf(target);
  sorted.splice(at < 0 ? sorted.length : at + (after ? 1 : 0), 0, moving);
  const next: Items = {};
  sorted.forEach((id, i) => { next[id] = { ...items[id], order: i * 10 }; });
  return next;
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
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [colourFor, setColourFor] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const cells = useRef<Record<string, HTMLDivElement | null>>({});

  // Someone who is not editing always sees the latest saved arrangement; an editor keeps their own draft until they save or cancel.
  const items = editing ? resolveLayout(defs, draft) : saved;
  const ordered = [...defs].sort((a, b) => (items[a.id].order - items[b.id].order) || ids.indexOf(a.id) - ids.indexOf(b.id));
  const hiddenDefs = defs.filter((d) => items[d.id].hidden);

  useEffect(() => { if (!canEdit && editing) setEditing(false); }, [canEdit, editing]);

  const start = () => { setDraft(saved); setErr(''); setEditing(true); };
  const cancel = () => { setEditing(false); setColourFor(null); setErr(''); };
  const patchItem = (id: string, p: Partial<DashboardWidgetLayout>) => setDraft((d) => { const cur = resolveLayout(defs, d); return { ...cur, [id]: { ...cur[id], ...p } }; });
  const move = (id: string, dir: -1 | 1) => {
    const vis = ordered.filter((d) => !items[d.id].hidden).map((d) => d.id);
    const i = vis.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= vis.length) return;
    setDraft(reorder(items, ids, id, vis[j], dir === 1));
  };
  const reset = () => { setDraft(resolveLayout(defs, undefined)); setColourFor(null); };
  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      await onSave({ items });
      setEditing(false);
      setColourFor(null);
    } catch (e: any) {
      setErr(e?.message || 'Could not save the layout.');
    } finally {
      setBusy(false);
    }
  };

  // Drag the bottom-right corner to make a box wider or taller: width snaps to the 12 columns.
  const startResize = (e: React.PointerEvent, id: string) => {
    e.preventDefault();
    const cell = cells.current[id];
    const g = grid.current;
    if (!cell || !g) return;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const col = g.getBoundingClientRect().width / 12;
    const move2 = (ev: PointerEvent) => {
      const r = cell.getBoundingClientRect();
      patchItem(id, { span: clamp(Math.round((ev.clientX - r.left) / col), 2, 12), h: clamp(Math.round(ev.clientY - r.top), 80, 1400) });
    };
    const up = () => { target.removeEventListener('pointermove', move2); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up); };
    target.addEventListener('pointermove', move2);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  return (
    <div data-dash-root>
      {canEdit && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2" data-dash-toolbar>
          {!editing ? (
            <>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">{layout?.updatedByName ? `Layout last saved by ${layout.updatedByName}.` : 'Everyone sees the same dashboard layout.'}</p>
              <button type="button" onClick={start} data-dash-edit className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                <SlidersHorizontal className="w-3.5 h-3.5" /> Customise dashboard
              </button>
            </>
          ) : (
            <div className="w-full rounded-2xl border border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/30 p-3 space-y-2" data-dash-editbar>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold text-blue-900 dark:text-blue-200">Customising: drag a box by its handle, drag its corner to resize, pick a colour. Saving changes the dashboard for everyone.</p>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={reset} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-800 cursor-pointer"><RotateCcw className="w-3.5 h-3.5" /> Reset to default</button>
                  <button type="button" onClick={cancel} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-800 cursor-pointer"><X className="w-3.5 h-3.5" /> Cancel</button>
                  <button type="button" onClick={() => void save()} disabled={busy} data-dash-save className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-3 py-1.5 text-xs font-bold cursor-pointer">
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save for everyone
                  </button>
                </div>
              </div>
              {hiddenDefs.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5" data-dash-hidden>
                  <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Hidden boxes:</span>
                  {hiddenDefs.map((d) => (
                    <button key={d.id} type="button" onClick={() => patchItem(d.id, { hidden: false })} className="inline-flex items-center gap-1 rounded-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
                      <Eye className="w-3 h-3" /> Show {d.label}
                    </button>
                  ))}
                </div>
              )}
              {err && <p role="alert" className="text-xs font-semibold text-rose-600">{err}</p>}
            </div>
          )}
        </div>
      )}

      <div ref={grid} className={`dash-grid ${editing ? 'is-editing' : ''}`} data-dash-grid>
        {ordered.filter((d) => editing || !items[d.id].hidden).map((d) => {
          const it = items[d.id];
          const fadeHidden = editing && it.hidden;
          return (
            <div
              key={d.id}
              ref={(el) => { cells.current[d.id] = el; }}
              className={`dash-cell ${editing ? 'is-editing' : ''} ${dragId === d.id ? 'is-dragging' : ''} ${overId === d.id && dragId !== d.id ? 'is-over' : ''} ${fadeHidden ? 'is-hidden-widget' : ''}`}
              style={{ ['--dash-span' as string]: it.span, ...(it.h ? { height: it.h } : {}) } as React.CSSProperties}
              data-dash-id={d.id}
              data-dash-kind={d.kind || ''}
              data-dash-tone={it.color || undefined}
              data-dash-span={it.span}
              onDragOver={editing ? (e) => { if (dragId) { e.preventDefault(); if (overId !== d.id) setOverId(d.id); } } : undefined}
              onDrop={editing ? (e) => {
                e.preventDefault();
                if (dragId && dragId !== d.id) {
                  const r = e.currentTarget.getBoundingClientRect();
                  setDraft(reorder(items, ids, dragId, d.id, e.clientX > r.left + r.width / 2 && e.clientY > r.top));
                }
                setDragId(null);
                setOverId(null);
              } : undefined}
            >
              {editing && (
                <div className="dash-bar" data-dash-bar>
                  <span
                    className="dash-handle"
                    draggable
                    title="Drag to move"
                    data-dash-handle
                    onDragStart={(e) => { setDragId(d.id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', d.id); const c = cells.current[d.id]; if (c) e.dataTransfer.setDragImage(c, 20, 20); } catch { /* some browsers refuse */ } }}
                    onDragEnd={() => { setDragId(null); setOverId(null); }}
                  >
                    <GripVertical className="w-3.5 h-3.5" />
                  </span>
                  <span className="dash-bar-name">{d.label}</span>
                  <span className="dash-bar-tools">
                    <button type="button" onClick={() => move(d.id, -1)} aria-label={`Move ${d.label} earlier`} title="Move earlier"><ArrowLeft className="w-3.5 h-3.5" /></button>
                    <button type="button" onClick={() => move(d.id, 1)} aria-label={`Move ${d.label} later`} title="Move later"><ArrowRight className="w-3.5 h-3.5" /></button>
                    {SIZES.map(([name, n]) => (
                      <button key={name} type="button" onClick={() => patchItem(d.id, { span: n })} className={it.span === n ? 'is-on' : ''} aria-label={`${d.label} width ${name}`} title={`Width: ${name}`}>{name}</button>
                    ))}
                    {it.h > 0 && <button type="button" onClick={() => patchItem(d.id, { h: 0 })} aria-label={`Automatic height for ${d.label}`} title="Automatic height"><MoveVertical className="w-3.5 h-3.5" /></button>}
                    <button type="button" onClick={() => setColourFor(colourFor === d.id ? null : d.id)} aria-label={`Colour of ${d.label}`} title="Colour" data-dash-colour-open><Palette className="w-3.5 h-3.5" /></button>
                    <button type="button" onClick={() => patchItem(d.id, { hidden: !it.hidden })} aria-label={it.hidden ? `Show ${d.label}` : `Hide ${d.label}`} title={it.hidden ? 'Show' : 'Hide'}>{it.hidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}</button>
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
              {editing && !it.hidden && <span className="dash-resize" onPointerDown={(e) => startResize(e, d.id)} title="Drag to resize" aria-label={`Resize ${d.label}`} data-dash-resize role="separator" />}
            </div>
          );
        })}
      </div>
    </div>
  );
};
