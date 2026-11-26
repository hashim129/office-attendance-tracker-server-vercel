import React, { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, Minus, Plus, Users } from 'lucide-react';
import { LinePax, PAX_ROWS, cleanLinePax, nightsBetween, paxShort } from './paxDetails';

/**
 * A small optional picker under an invoice line (like the hotel-site "2 adults · 0 children" dropdown):
 * adults / children / infants with +/- buttons and an optional price each, plus check-in / check-out dates.
 * Closed, it is a single line of text, so the form does not get longer.
 */
export const PaxPicker: React.FC<{
  value?: LinePax;
  onChange: (next: LinePax | undefined) => void;
  currency: string;
  stay: boolean;
  disabled?: boolean;
}> = ({ value, onChange, currency, stay, disabled }) => {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const v = value || {};
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const set = (p: Partial<LinePax>) => onChange(cleanLinePax({ ...v, ...p }));
  const summary = paxShort(value);
  const nights = nightsBetween(v.from, v.to);
  const fieldCls = 'w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100';

  return (
    <div className="relative pl-1" ref={box} data-pax-picker>
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className={`inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-semibold cursor-pointer disabled:opacity-60 ${summary ? 'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200' : 'border-dashed border-slate-300 text-slate-500 dark:border-slate-700 dark:text-slate-400'}`}>
        <Users className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">{summary || `Travellers & ${stay ? 'check-in / out' : 'dates'} (optional)`}</span>
        <ChevronDown className="w-3 h-3 shrink-0" />
      </button>
      {open && (
        <div className="absolute left-1 top-full z-30 mt-1 w-[min(92vw,22rem)] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 shadow-xl space-y-2.5" role="dialog" aria-label="Travellers and dates">
          {PAX_ROWS.map((r) => {
            const n = Number(v[r.key] || 0);
            return (
              <div key={r.key} className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1">
                <div>
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{r.many}</p>
                  <p className="text-[10px] text-slate-500">{r.hint}</p>
                </div>
                <div className="inline-flex items-center rounded-lg border border-blue-400 dark:border-blue-700">
                  <button type="button" aria-label={`Fewer ${r.many.toLowerCase()}`} disabled={n <= 0} onClick={() => set({ [r.key]: n - 1 } as Partial<LinePax>)} className="px-2 py-1 text-blue-700 dark:text-blue-300 disabled:text-slate-300 cursor-pointer"><Minus className="w-3.5 h-3.5" /></button>
                  <span className="w-7 text-center text-xs font-bold tabular-nums" data-pax-count={r.key}>{n}</span>
                  <button type="button" aria-label={`More ${r.many.toLowerCase()}`} onClick={() => set({ [r.key]: n + 1 } as Partial<LinePax>)} className="px-2 py-1 text-blue-700 dark:text-blue-300 cursor-pointer"><Plus className="w-3.5 h-3.5" /></button>
                </div>
                {n > 0 && (
                  <label className="col-span-2 flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                    <span className="shrink-0">Price per {r.one.toLowerCase()} ({currency})</span>
                    <input className={fieldCls} type="number" inputMode="decimal" min="0" step="0.01" placeholder="optional" value={v[r.price] ?? ''} onChange={(e) => set({ [r.price]: e.target.value === '' ? undefined : Number(e.target.value) } as Partial<LinePax>)} data-pax-price={r.key} />
                  </label>
                )}
              </div>
            );
          })}
          <div className="border-t border-slate-200 dark:border-slate-700 pt-2 grid grid-cols-2 gap-2">
            <label className="text-[11px] text-slate-600 dark:text-slate-300 space-y-0.5">
              <span className="inline-flex items-center gap-1"><CalendarDays className="w-3 h-3" /> {stay ? 'Check-in' : 'From'}</span>
              <input className={fieldCls} type="date" value={v.from || ''} onChange={(e) => set({ from: e.target.value || undefined })} data-pax-from />
            </label>
            <label className="text-[11px] text-slate-600 dark:text-slate-300 space-y-0.5">
              <span className="inline-flex items-center gap-1"><CalendarDays className="w-3 h-3" /> {stay ? 'Check-out' : 'To'}</span>
              <input className={fieldCls} type="date" min={v.from || undefined} value={v.to || ''} onChange={(e) => set({ to: e.target.value || undefined })} data-pax-to />
            </label>
          </div>
          {nights > 0 && <p className="text-[11px] text-slate-500">{nights} night{nights === 1 ? '' : 's'}</p>}
          <p className="text-[10px] text-slate-500">All optional. Prices per person fill the line's price and units for you. Anything left at 0 or empty is not shown on the invoice.</p>
          <div className="flex justify-between gap-2">
            {value && <button type="button" className="text-[11px] font-semibold text-slate-500 hover:text-red-600 cursor-pointer" onClick={() => onChange(undefined)}>Clear</button>}
            <button type="button" className="ml-auto rounded-lg border border-blue-500 px-4 py-1.5 text-xs font-bold text-blue-700 dark:text-blue-300 cursor-pointer" onClick={() => setOpen(false)} data-pax-done>Done</button>
          </div>
        </div>
      )}
    </div>
  );
};
