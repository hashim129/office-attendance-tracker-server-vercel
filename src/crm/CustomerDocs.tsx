import React, { useEffect, useState } from 'react';
import { FileText, Paperclip, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { crmCall } from './crmApi';
import { btnDanger, btnGhost, btnPrimary, cardCls, inputCls } from './ui';

/** Passport, visa, CNIC, ticket and other documents of one customer, with expiry badges and an optional picture or PDF. */
export type DocType = 'passport' | 'visa' | 'cnic' | 'ticket' | 'other';
export interface CustomerDoc {
  id: string; customerId: string; type: DocType; typeLabel: string; number: string; expiry: string | null; notes: string;
  hasFile: boolean; fileType: string; fileName: string; createdBy: string | null; createdByName: string; createdAt: string; updatedAt: string;
}
const TYPES: { id: DocType; label: string }[] = [
  { id: 'passport', label: 'Passport' }, { id: 'visa', label: 'Visa' }, { id: 'cnic', label: 'CNIC' }, { id: 'ticket', label: 'Ticket' }, { id: 'other', label: 'Other' },
];
type Form = { id?: string; type: DocType; number: string; expiry: string; notes: string; file: string; fileName: string; hadFile: boolean; removeFile: boolean };
const EMPTY: Form = { type: 'passport', number: '', expiry: '', notes: '', file: '', fileName: '', hadFile: false, removeFile: false };
const DAY = 86400000;
const todayPkt = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
const daysLeft = (d: string, today: string) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
const niceDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Red when expired, amber within 60 days, green otherwise. */
export const ExpiryBadge: React.FC<{ expiry: string | null; today?: string }> = ({ expiry, today = todayPkt() }) => {
  if (!expiry) return <span className="text-[11px] text-slate-400">No expiry</span>;
  const left = daysLeft(expiry, today);
  const cls = left < 0 ? 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300'
    : left <= 60 ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
      : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300';
  const text = left < 0 ? `Expired ${niceDate(expiry)}` : left === 0 ? 'Expires today' : left <= 60 ? `Expires in ${left} day${left === 1 ? '' : 's'}` : `Valid till ${niceDate(expiry)}`;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${cls}`}>{text}</span>;
};

/** Pictures are shrunk in the browser (like receipt screenshots) to about 600 KB; PDFs are sent as they are (max about 1.8 MB). */
async function readFile(file: File): Promise<{ data: string; name: string }> {
  const name = file.name.slice(0, 100);
  if (file.type === 'application/pdf') {
    if (file.size > 1_800_000) throw new Error('This PDF is too large. Please choose one under 1.8 MB.');
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('That file could not be read.'));
      r.readAsDataURL(file);
    });
    return { data, name };
  }
  if (!/^image\/(jpeg|png)$/.test(file.type)) throw new Error('Please choose a JPG, PNG or PDF file.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('That picture could not be read.'));
      i.src = url;
    });
    let side = 1600;
    let out = '';
    for (let step = 0; step < 6; step++) {
      const scale = Math.min(1, side / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('That picture could not be processed.');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      out = canvas.toDataURL('image/jpeg', step < 2 ? 0.82 : 0.7);
      if (out.length < 800_000) break; // about 600 KB once decoded
      side = Math.round(side * 0.8);
    }
    return { data: out, name: name.replace(/\.(png|jpe?g)$/i, '') + '.jpg' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function openFile(data: string, fileName: string) {
  // data: URLs cannot be opened directly in a new tab in most browsers, so use a blob
  const [head, b64] = data.split(',');
  const mime = /data:([^;]+)/.exec(head)?.[1] || 'application/octet-stream';
  const bin = atob(b64 || '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const w = window.open(url, '_blank');
  if (!w) { const a = document.createElement('a'); a.href = url; a.download = fileName || 'document'; a.click(); }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const CustomerDocs: React.FC<{ customerId: string; customerName: string }> = ({ customerId, customerName }) => {
  const [docs, setDocs] = useState<CustomerDoc[] | null>(null);
  const [today, setToday] = useState(todayPkt());
  const [err, setErr] = useState('');
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState('');

  const load = () => crmCall<{ docs: CustomerDoc[]; today: string }>('people_docs_list', { customerId })
    .then((r) => { setDocs(r.docs); setToday(r.today || todayPkt()); setErr(''); })
    .catch((e) => { setDocs([]); setErr(e?.message || 'Could not load the documents.'); });
  useEffect(() => { setDocs(null); setForm(null); void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [customerId]);

  const patch = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f));
  const pick = async (file?: File | null) => {
    if (!file) return;
    try { const r = await readFile(file); patch({ file: r.data, fileName: r.name, removeFile: false }); setErr(''); } catch (e: any) { setErr(e?.message || 'That file could not be used.'); }
  };
  const submit = async () => {
    if (!form) return;
    setBusy(true);
    try {
      await crmCall('people_doc_save', {
        doc: {
          id: form.id, customerId, type: form.type, number: form.number, expiry: form.expiry || '', notes: form.notes,
          ...(form.file ? { file: form.file, fileName: form.fileName } : {}), removeFile: form.removeFile && !form.file,
        },
      });
      setForm(null); setErr('');
      await load();
    } catch (e: any) { setErr(e?.message || 'Could not save the document.'); } finally { setBusy(false); }
  };
  const remove = async (d: CustomerDoc) => {
    if (!window.confirm(`Delete this ${d.typeLabel.toLowerCase()}${d.number ? ` (${d.number})` : ''}?`)) return;
    try { await crmCall('people_doc_delete', { id: d.id }); await load(); } catch (e: any) { setErr(e?.message || 'Could not delete it.'); }
  };
  const view = async (d: CustomerDoc) => {
    setOpening(d.id);
    try {
      const r = await crmCall<{ file: string | null; fileName: string }>('people_doc_file', { id: d.id });
      if (r.file) openFile(r.file, r.fileName); else setErr('No file is attached to this document.');
    } catch (e: any) { setErr(e?.message || 'Could not open the file.'); } finally { setOpening(''); }
  };
  const edit = (d: CustomerDoc) => setForm({ id: d.id, type: d.type, number: d.number, expiry: d.expiry || '', notes: d.notes, file: '', fileName: '', hadFile: d.hasFile, removeFile: false });

  return (
    <div className={`${cardCls} p-3 sm:p-4 space-y-3`} data-customer-docs>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 inline-flex items-center gap-1.5"><FileText className="w-4 h-4 text-blue-600" /> Documents</h3>
          <p className="text-[11px] text-slate-500 truncate">Passport, visa, CNIC and tickets for {customerName}</p>
        </div>
        {!form && <button className={`${btnPrimary} min-h-10 sm:min-h-0 shrink-0`} onClick={() => setForm({ ...EMPTY })}><Plus className="w-3.5 h-3.5" /> Add</button>}
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}

      {form && (
        <div className="rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50/40 dark:bg-blue-950/20 p-3 space-y-2.5">
          <div className="flex flex-wrap gap-1.5">
            {TYPES.map((t) => (
              <button key={t.id} type="button" onClick={() => patch({ type: t.id })}
                className={`px-3 min-h-10 sm:min-h-0 sm:py-1 rounded-full text-[11px] font-semibold border cursor-pointer ${form.type === t.id ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>{t.label}</button>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="block"><span className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Number (optional)</span>
              <input className={inputCls} value={form.number} maxLength={60} onChange={(e) => patch({ number: e.target.value })} placeholder={form.type === 'cnic' ? '35202-1234567-1' : 'e.g. AB1234567'} /></label>
            <label className="block"><span className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Expiry date (optional)</span>
              <input type="date" className={inputCls} value={form.expiry} onChange={(e) => patch({ expiry: e.target.value })} /></label>
          </div>
          <label className="block"><span className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Notes</span>
            <textarea className={inputCls} rows={2} maxLength={600} value={form.notes} onChange={(e) => patch({ notes: e.target.value })} placeholder="Anything the team should know" /></label>
          <div className="flex flex-wrap items-center gap-2">
            <label className={`${btnGhost} min-h-10 sm:min-h-0`}>
              <Upload className="w-3.5 h-3.5" /> {form.file || (form.hadFile && !form.removeFile) ? 'Replace picture or PDF' : 'Attach picture or PDF'}
              <input type="file" accept="image/jpeg,image/png,application/pdf" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            {form.file && <span className="text-[11px] text-emerald-700 dark:text-emerald-400 truncate max-w-[12rem]">{form.fileName || 'File ready'}</span>}
            {!form.file && form.hadFile && !form.removeFile && <button type="button" className="text-[11px] text-red-600 underline min-h-10 sm:min-h-0" onClick={() => patch({ removeFile: true })}>Remove attached file</button>}
            {form.removeFile && !form.file && <span className="text-[11px] text-slate-500">The attached file will be removed. <button type="button" className="underline" onClick={() => patch({ removeFile: false })}>Keep it</button></span>}
          </div>
          <div className="flex gap-2 justify-end">
            <button className={`${btnGhost} min-h-10 sm:min-h-0`} onClick={() => setForm(null)} disabled={busy}>Cancel</button>
            <button className={`${btnPrimary} min-h-10 sm:min-h-0`} onClick={() => void submit()} disabled={busy}>{busy ? 'Saving…' : form.id ? 'Save changes' : 'Save document'}</button>
          </div>
        </div>
      )}

      {docs === null ? (
        <div className="space-y-2" aria-label="Loading">{[0, 1].map((i) => <div key={i} className="h-14 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />)}</div>
      ) : docs.length === 0 ? (
        !form && <p className="text-xs text-slate-500 text-center py-4">No documents yet. Add the passport first so you get a reminder before it expires.</p>
      ) : (
        <ul className="space-y-2">
          {docs.map((d) => (
            <li key={d.id} className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5 flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">{d.typeLabel}</span>
                  {d.number && <span className="text-xs font-mono text-slate-600 dark:text-slate-300 break-all">{d.number}</span>}
                  <ExpiryBadge expiry={d.expiry} today={today} />
                </div>
                {d.notes && <p className="text-[11px] text-slate-500 mt-0.5 break-words">{d.notes}</p>}
                {d.createdByName && <p className="text-[10px] text-slate-400 mt-0.5">Added by {d.createdByName}</p>}
              </div>
              <div className="flex gap-1.5 shrink-0">
                {d.hasFile && <button className={`${btnGhost} min-h-10 sm:min-h-0`} onClick={() => void view(d)} disabled={opening === d.id}><Paperclip className="w-3.5 h-3.5" /> {opening === d.id ? 'Opening…' : d.fileType === 'application/pdf' ? 'PDF' : 'Picture'}</button>}
                <button className={`${btnGhost} min-h-10 sm:min-h-0`} onClick={() => edit(d)} aria-label="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                <button className={`${btnDanger} min-h-10 sm:min-h-0`} onClick={() => void remove(d)} aria-label="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default CustomerDocs;
