import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileText, Loader2 } from 'lucide-react';
import { Employee } from '../types';
import { PdfColumn, dayPk, downloadReportPdf, fmtDayText, safeFileName } from '../lib/reportPdf';
import { btnGhost, inputCls } from './ui';

/**
 * "Download PDF" button used in every CRM section.
 * Two choices: "Selected data" (dates, a search by ID / number / name, and the person who created it)
 * or "All collective data" (everything the person is allowed to see).
 */
export interface ExportPanelProps<T> {
  /** Section name, e.g. "Invoices" */
  title: string;
  /** Rows the signed-in person is allowed to see */
  rows: T[];
  columns: PdfColumn[];
  toCells: (row: T) => Record<string, string>;
  getCreatedAt: (row: T) => string;
  getCreatorId: (row: T) => string;
  /** What the search box looks in (CRM ID, invoice number, customer number...) */
  searchFields: { label: string; get: (row: T) => string }[];
  searchHint?: string;
  employees: Employee[];
  currentUser: Employee;
  companyName?: string;
  totalsOf?: (rows: T[]) => Record<string, string> | null;
  summaryOf?: (rows: T[]) => [string, string][];
  landscape?: boolean;
  /** Extra word for the file name */
  fileTag?: string;
  buttonLabel?: string;
}

const todayPk = () => dayPk(new Date().toISOString());
const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** The rows that match the chosen filters. Exported so it can be tested on its own. */
export function filterForExport<T>(
  rows: T[],
  f: { mode: 'selected' | 'all'; from: string; to: string; query: string; creator: string },
  o: { getCreatedAt: (r: T) => string; getCreatorId: (r: T) => string; searchFields: { get: (r: T) => string }[] },
): T[] {
  if (f.mode === 'all') return rows;
  const q = f.query.trim().toLowerCase();
  return rows.filter((r) => {
    const day = dayPk(o.getCreatedAt(r));
    if (f.from && (!day || day < f.from)) return false;
    if (f.to && (!day || day > f.to)) return false;
    if (f.creator !== 'all' && o.getCreatorId(r) !== f.creator) return false;
    if (q && !o.searchFields.some((s) => String(s.get(r) || '').toLowerCase().includes(q))) return false;
    return true;
  });
}

export function ExportPanel<T>(props: ExportPanelProps<T>) {
  const { title, rows, columns, toCells, getCreatedAt, getCreatorId, searchFields, employees, currentUser, companyName, totalsOf, summaryOf, landscape, fileTag } = props;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'selected' | 'all'>('selected');
  const [from, setFrom] = useState(todayPk());
  const [to, setTo] = useState(todayPk());
  const [query, setQuery] = useState('');
  const [creator, setCreator] = useState('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const box = useRef<HTMLDivElement>(null);

  // Opens as a centred popup (a bottom sheet on phones) above the sidebar and every other element.
  // It does not close when tapping outside, so chosen filters are never lost; use Close or Esc.
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);

  const empName = useMemo(() => new Map(employees.map((e) => [e.id, e.name])), [employees]);
  const creators = useMemo(() => {
    const ids = [...new Set(rows.map(getCreatorId).filter(Boolean))];
    return ids.map((id) => ({ id, name: empName.get(id) || 'Former employee' })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, getCreatorId, empName]);

  const matched = useMemo(
    () => filterForExport(rows, { mode, from, to, query, creator }, { getCreatedAt, getCreatorId, searchFields }),
    [rows, mode, from, to, query, creator, getCreatedAt, getCreatorId, searchFields],
  );

  const describe = (): string => {
    if (mode === 'all') return `All collective data: every ${title.toLowerCase()} record you can see (${matched.length}).`;
    const bits: string[] = [];
    if (from && to) bits.push(from === to ? `Created on ${fmtDayText(from)}` : `Created ${fmtDayText(from)} to ${fmtDayText(to)}`);
    else if (from) bits.push(`Created from ${fmtDayText(from)}`);
    else if (to) bits.push(`Created up to ${fmtDayText(to)}`);
    else bits.push('Any creation date');
    if (creator !== 'all') bits.push(`created by ${empName.get(creator) || 'Former employee'}`);
    if (query.trim()) bits.push(`matching "${query.trim()}"`);
    return `Selected data: ${bits.join(', ')} (${matched.length}).`;
  };

  const quick = (a: string, b: string) => { setFrom(a); setTo(b); };

  const download = async () => {
    setBusy(true);
    setError('');
    try {
      const tag = mode === 'all' ? 'all' : [from === to ? from : `${from || 'start'}_to_${to || 'today'}`, creator !== 'all' ? safeFileName(empName.get(creator) || 'creator') : '', query.trim() ? safeFileName(query) : ''].filter(Boolean).join('_');
      await downloadReportPdf({
        title: `${title} report`,
        subtitle: describe(),
        companyName,
        generatedBy: currentUser.name,
        columns,
        rows: matched.map(toCells),
        totals: totalsOf ? totalsOf(matched) : null,
        summary: summaryOf ? summaryOf(matched) : [['Records', String(matched.length)]],
        landscape,
      }, `${safeFileName(title)}${fileTag ? `-${fileTag}` : ''}_${tag}.pdf`);
    } catch (e: any) {
      setError(e?.message || 'The PDF could not be made.');
    } finally {
      setBusy(false);
    }
  };

  const chip = (active: boolean) => `px-2.5 py-1 rounded-full text-[11px] font-semibold border cursor-pointer transition-colors ${active ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`;
  const today = todayPk();

  return (
    <div className="relative inline-block" ref={box} data-export-panel>
      <button type="button" className={btnGhost} onClick={() => setOpen((v) => !v)} aria-expanded={open} data-export-open>
        <Download className="w-3.5 h-3.5" /> {props.buttonLabel || 'Download PDF'}
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-xs p-0 sm:p-4">
        <div role="dialog" aria-modal="true" aria-label={`Download ${title} as PDF`} className="w-full sm:w-[24rem] max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3 text-left">
          <div>
            <p className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5"><FileText className="w-4 h-4 text-blue-600" /> {title} PDF</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Choose what goes into the PDF.</p>
          </div>
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'selected'} data-export-mode="selected" onClick={() => setMode('selected')} className={`py-1.5 rounded-lg text-xs font-bold cursor-pointer ${mode === 'selected' ? 'bg-white dark:bg-slate-900 shadow-xs text-blue-700 dark:text-blue-300' : 'text-slate-500'}`}>Selected data</button>
            <button type="button" role="tab" aria-selected={mode === 'all'} data-export-mode="all" onClick={() => setMode('all')} className={`py-1.5 rounded-lg text-xs font-bold cursor-pointer ${mode === 'all' ? 'bg-white dark:bg-slate-900 shadow-xs text-blue-700 dark:text-blue-300' : 'text-slate-500'}`}>All collective data</button>
          </div>
          {mode === 'selected' ? (
            <div className="space-y-2.5">
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className={chip(from === today && to === today)} onClick={() => quick(today, today)}>Today</button>
                <button type="button" className={chip(from === addDays(today, -1) && to === addDays(today, -1))} onClick={() => quick(addDays(today, -1), addDays(today, -1))}>Yesterday</button>
                <button type="button" className={chip(from === addDays(today, -6) && to === today)} onClick={() => quick(addDays(today, -6), today)}>Last 7 days</button>
                <button type="button" className={chip(from === `${today.slice(0, 8)}01` && to === today)} onClick={() => quick(`${today.slice(0, 8)}01`, today)}>This month</button>
                <button type="button" className={chip(!from && !to)} onClick={() => quick('', '')}>Any date</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Created from<input type="date" className={`${inputCls} mt-0.5`} value={from} onChange={(e) => setFrom(e.target.value)} data-export-from /></label>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Created to<input type="date" className={`${inputCls} mt-0.5`} value={to} onChange={(e) => setTo(e.target.value)} data-export-to /></label>
              </div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">Find by {searchFields.map((s) => s.label).join(' / ')}
                <input className={`${inputCls} mt-0.5 normal-case tracking-normal font-normal`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={props.searchHint || 'Type an ID, number or name'} data-export-query />
              </label>
              {creators.length > 1 || (creators.length === 1 && creators[0].id !== currentUser.id) ? (
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">Created by
                  <select className={`${inputCls} mt-0.5 normal-case tracking-normal font-normal`} value={creator} onChange={(e) => setCreator(e.target.value)} data-export-creator>
                    <option value="all">Everyone</option>
                    {creators.map((c) => <option key={c.id} value={c.id}>{c.name}{c.id === currentUser.id ? ' (me)' : ''}</option>)}
                  </select>
                </label>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-slate-600 dark:text-slate-300 rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3">Every {title.toLowerCase()} record you are allowed to see, from the first one to today, in one PDF.</p>
          )}
          <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300" data-export-count>{matched.length} record{matched.length === 1 ? '' : 's'} will be included.</p>
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className={btnGhost} onClick={() => setOpen(false)}>Close</button>
            <button type="button" disabled={busy || !matched.length} onClick={() => void download()} data-export-go className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Download
            </button>
          </div>
        </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
