import React, { useEffect, useMemo, useState } from 'react';
import { canEditFinancialRecord } from '../lib/financePermissions.js';
import { Plus, Trash2, FileDown, Share2, Eye, Pencil, ReceiptText, Upload, X } from 'lucide-react';
import { Employee } from '../types';
import { Modal } from '../components/common/Modal';
import { CrmReceipt, RECEIPT_ITEMS, crmCall } from './crmApi';
// The PDF maker is large, so it is only loaded when someone actually downloads or shares a receipt.
const downloadReceiptPdf = async (...a: Parameters<typeof import('./receiptPdf').downloadReceiptPdf>) => (await import('./receiptPdf')).downloadReceiptPdf(...a);
const receiptPdfFile = async (...a: Parameters<typeof import('./receiptPdf').receiptPdfFile>) => (await import('./receiptPdf')).receiptPdfFile(...a);
import { CrmState } from './useCrm';
import { ErrorNote, Field, Pill, btnDanger, btnGhost, btnPrimary, cardCls, inputCls } from './ui';
import { allCurrencies, currencyLabel, fmtAmount } from './currencies';
import { receiptItemsText } from './receiptText';

interface Props {
  crm: CrmState;
  employees: Employee[];
  currentUser: Employee;
}

interface FormState {
  id?: string;
  queryCode: string; clientName: string;
  items: string[]; otherOn: boolean; otherItem: string;
  paymentType: 'full' | 'partial';
  currency: string; amountReceived: string;
  method: 'cash' | 'bank'; bankName: string; referenceNo: string;
  /** new screenshot picked now (compressed data URL) */
  proofImage: string; hadProof: boolean; removeProof: boolean;
  purpose: string;
}

const blankForm = (): FormState => ({
  queryCode: '', clientName: '', items: [], otherOn: false, otherItem: '', paymentType: 'full', currency: 'PKR', amountReceived: '',
  method: 'cash', bankName: '', referenceNo: '', proofImage: '', hadProof: false, removeProof: false, purpose: '',
});
const toForm = (r: CrmReceipt): FormState => ({
  id: r.id, queryCode: r.queryCode, clientName: r.clientName, items: r.items, otherOn: Boolean(r.otherItem), otherItem: r.otherItem, paymentType: r.paymentType, currency: r.currency,
  amountReceived: String(r.amountReceived), method: r.method, bankName: r.bankName, referenceNo: r.referenceNo,
  proofImage: '', hadProof: r.hasProof, removeProof: false, purpose: r.purpose,
});

/** Shrinks a screenshot (JPG / PNG) in the browser so it uploads quickly and stays small in the database. */
async function compressImage(file: File): Promise<string> {
  if (!/^image\/(jpeg|png)$/.test(file.type)) throw new Error('Please choose a JPG, JPEG or PNG image.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('That image could not be read.'));
      i.src = url;
    });
    const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('That image could not be processed.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let out = canvas.toDataURL('image/jpeg', 0.82);
    if (out.length > 1_800_000) out = canvas.toDataURL('image/jpeg', 0.6);
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Like Field, but for groups of radio buttons / buttons (a <label> must not wrap several controls). */
const Group: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div><span className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">{label}</span>{children}</div>
);

const niceDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

export const ReceiptsView: React.FC<Props & { focusId?: string }> = ({ crm, employees, currentUser, focusId }) => {
  const isStaff = currentUser.role === 'admin' || currentUser.role === 'accounts' || currentUser.role === 'ceo';
  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'ceo'; // the CEO has every administrator right here
  const seesAll = isStaff || currentUser.role === 'ceo';
  const { receipts, company } = crm.data;
  const empName = useMemo(() => new Map(employees.map((e) => [e.id, e.name])), [employees]);
  const currencies = useMemo(() => allCurrencies(), []);
  const [form, setForm] = useState<FormState | null>(null);
  const [view, setView] = useState<CrmReceipt | null>(receipts.find((r) => r.id === focusId) || null);
  const [proof, setProof] = useState<{ loading: boolean; image: string | null }>({ loading: false, image: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [canShare, setCanShare] = useState(false);

  useEffect(() => { void crm.refresh(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      setCanShare(Boolean(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.pdf', { type: 'application/pdf' })] })));
    } catch {
      setCanShare(false);
    }
  }, []);
  const hasNew = crm.data.unread.some((u) => u.category === 'receipt');
  useEffect(() => {
    if (!hasNew) return;
    const t = window.setTimeout(() => { void crm.markRead('receipt'); }, 4000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasNew]);

  // the screenshot is only fetched when a receipt is opened (the list stays light)
  useEffect(() => {
    if (!view || !view.hasProof) { setProof({ loading: false, image: null }); return; }
    let live = true;
    setProof({ loading: true, image: null });
    crmCall<{ image: string | null }>('receipt_proof', { id: view.id })
      .then((r) => { if (live) setProof({ loading: false, image: r.image }); })
      .catch(() => { if (live) setProof({ loading: false, image: null }); });
    return () => { live = false; };
  }, [view?.id, view?.hasProof, view?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return receipts.filter((r) => !q || [r.receiptNo, r.clientName, r.queryCode, r.purpose, r.referenceNo, r.bankName, empName.get(r.createdBy) || ''].some((v) => v.toLowerCase().includes(q)));
  }, [receipts, query, empName]);

  const patch = (p: Partial<FormState>) => { setForm((f) => (f ? { ...f, ...p } : f)); setError(''); };
  const canEdit = (r: CrmReceipt) => canEditFinancialRecord(currentUser.role, currentUser.id, r.createdBy, 'receipt');
  const by = (r: CrmReceipt) => empName.get(r.createdBy) || '';

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      patch({ proofImage: await compressImage(file), removeProof: false });
    } catch (e: any) {
      setError(e?.message || 'Could not use that image.');
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await crmCall<{ receipt: CrmReceipt }>('receipt_save', {
        receipt: {
          id: form.id, queryCode: form.queryCode, clientName: form.clientName, items: form.items, otherItem: form.otherOn ? form.otherItem : '',
          paymentType: form.paymentType, currency: form.currency, amountReceived: form.amountReceived,
          method: form.method, bankName: form.bankName, referenceNo: form.referenceNo, purpose: form.purpose,
          ...(form.proofImage ? { proofImage: form.proofImage } : {}), removeProof: form.removeProof && !form.proofImage,
        },
      });
      await crm.refresh();
      setForm(null);
      setView(r.receipt);
    } catch (err: any) {
      setError(err?.message || 'Could not save the receipt.');
    } finally {
      setBusy(false);
    }
  };

  const pdf = async (r: CrmReceipt) => {
    setError('');
    try {
      await downloadReceiptPdf(r, company, by(r));
    } catch (err: any) {
      setError(err?.message || 'Could not create the PDF.');
    }
  };
  const share = async (r: CrmReceipt) => {
    try {
      const file = await receiptPdfFile(r, company, by(r));
      await navigator.share({ files: [file], title: `Receipt ${r.receiptNo}`, text: `Receipt ${r.receiptNo} — ${company.name}` });
    } catch (err: any) {
      if (err?.name !== 'AbortError') setError('Could not share. Download the PDF and send it instead.');
    }
  };
  const remove = async (r: CrmReceipt) => {
    if (!window.confirm(`Delete receipt ${r.receiptNo} permanently?`)) return;
    try {
      await crmCall('receipt_delete', { id: r.id });
      await crm.refresh();
      setView(null);
    } catch (err: any) {
      setError(err?.message || 'Could not delete.');
    }
  };
  const changeReceiptPaymentType = async (r: CrmReceipt, nextType: 'full' | 'partial') => {
    setError('');
    try {
      const res = await crmCall<{ receipt: CrmReceipt }>('receipt_payment_type', {
        id: r.id,
        paymentType: nextType,
      });
      await crm.refresh();
      if (view?.id === r.id) setView(res.receipt);
    } catch (err: any) {
      setError(err?.message || 'Could not update receipt payment status.');
    }
  };

  const balanceOf = (r: CrmReceipt) => Math.max(0, r.totalAmount - r.amountReceived);

  return (
    <div className="space-y-4">
      <div className={`${cardCls} p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3`}>
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2"><ReceiptText className="w-4 h-4 text-blue-600" /> Receipts</h2>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Record money received from a client. Every receipt is sent to the Accounts office for further action, and you can download it as a PDF.</p>
        </div>
        <button className={btnPrimary} onClick={() => { setForm(blankForm()); setError(''); }}><Plus className="w-3.5 h-3.5" /> Add receipt</button>
      </div>

      <div className={`${cardCls} p-4 flex flex-col md:flex-row gap-2 md:items-center justify-between`}>
        <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">{seesAll ? 'All receipts' : 'Your receipts'}: {receipts.length}</p>
        <input className={`${inputCls} md:max-w-xs`} placeholder="Search receipt no., client, query code…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {error && !form && <ErrorNote message={error} />}

      {shown.length === 0 ? (
        <div className={`${cardCls} p-8 text-center text-xs text-slate-500`}>{receipts.length === 0 ? 'No receipts yet. Press “Add receipt” to create the first one.' : 'No receipts match your search.'}</div>
      ) : (
        <div className="space-y-3">
          {shown.map((r) => (
            <div key={r.id} className={`${cardCls} p-4`}>
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-blue-700 dark:text-blue-300">{r.receiptNo}</span>
                    <Pill tone={r.paymentType === 'full' ? 'green' : 'amber'}>{r.paymentType === 'full' ? 'Full payment' : 'Partial payment'}</Pill>
                    <Pill tone="slate">Query {r.queryCode}</Pill>
                    <Pill tone="blue">{r.method === 'bank' ? 'Bank transfer' : 'Cash'}</Pill>
                  </div>
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100 break-words">{r.clientName}</p>
                  {receiptItemsText(r).length > 0 && <p className="text-[11px] text-slate-600 dark:text-slate-300 break-words">{receiptItemsText(r).join(' · ')}</p>}
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{niceDate(r.createdAt)} · created by <b className="text-slate-700 dark:text-slate-200">{by(r) || 'Former employee'}</b></p>
                </div>
                <div className="lg:text-right shrink-0">
                  <p className="text-[11px] text-slate-500">Received <b className="font-mono text-emerald-600">{r.currency} {fmtAmount(r.amountReceived)}</b></p>
                  {r.paymentType === 'partial' && balanceOf(r) > 0 && <p className="text-[11px] text-slate-500">Balance <b className="font-mono text-amber-600">{r.currency} {fmtAmount(balanceOf(r))}</b></p>}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-3">
                <button className={btnGhost} onClick={() => setView(r)}><Eye className="w-3.5 h-3.5" /> View</button>
                <button className={btnPrimary} onClick={() => void pdf(r)}><FileDown className="w-3.5 h-3.5" /> Download PDF</button>
                {canShare && <button className={btnGhost} onClick={() => void share(r)}><Share2 className="w-3.5 h-3.5" /> Share</button>}
                {canEdit(r) && <button className={btnGhost} onClick={() => { setForm(toForm(r)); setError(''); }}><Pencil className="w-3.5 h-3.5" /> Edit</button>}
                {isStaff && (
                  <select
                    aria-label={`Receipt payment status for ${r.receiptNo}`}
                    className={`${inputCls} !w-auto !py-1 !px-2.5 !text-xs font-semibold`}
                    value={r.paymentType}
                    onChange={(e) => void changeReceiptPaymentType(r, e.target.value as 'full' | 'partial')}
                  >
                    <option value="full">Status: Full Payment (Approved)</option>
                    <option value="partial">Status: Partial Payment</option>
                  </select>
                )}
                {isAdmin && <button className={btnDanger} aria-label="Delete receipt" onClick={() => void remove(r)}><Trash2 className="w-3.5 h-3.5" /></button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---------- view */}
      <Modal isOpen={Boolean(view)} onClose={() => setView(null)} title={view ? `Receipt ${view.receiptNo}` : ''} subtitle="Sent to the Accounts office" maxWidth="2xl">
        {view && (
          <div className="space-y-3 text-xs">
            <div className="flex flex-wrap gap-2">
              <button className={btnPrimary} onClick={() => void pdf(view)}><FileDown className="w-3.5 h-3.5" /> Download PDF</button>
              {canShare && <button className={btnGhost} onClick={() => void share(view)}><Share2 className="w-3.5 h-3.5" /> Share</button>}
              {canEdit(view) && <button className={btnGhost} onClick={() => { setForm(toForm(view)); setView(null); }}><Pencil className="w-3.5 h-3.5" /> Edit</button>}
            </div>
            {error && <ErrorNote message={error} />}
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
              {([
                ['Client', view.clientName], ['Query code', view.queryCode],
                ['What was sold', receiptItemsText(view).join(', ') || '—'], ['On account of', view.purpose || '—'],
                ['Payment', view.paymentType === 'partial' ? 'Partial payment' : 'Full payment'],
                ['Amount received', `${view.currency} ${fmtAmount(view.amountReceived)}`], ...(view.paymentType === 'partial' && balanceOf(view) > 0 ? [['Balance remaining', `${view.currency} ${fmtAmount(balanceOf(view))}`]] : []),
                ['Received through', view.method === 'bank' ? 'Bank transfer' : 'Cash'], ...(view.method === 'bank' ? [['Bank', view.bankName || '—']] : []),
                ['Reference No / Transaction ID', view.referenceNo || '—'], ['Created by', `${by(view) || 'Former employee'} · ${niceDate(view.createdAt)}`],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="min-w-0"><dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{k}</dt><dd className="font-semibold text-slate-800 dark:text-slate-100 break-words">{v}</dd></div>
              ))}
            </dl>
            {view.hasProof && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Transaction screenshot</p>
                {proof.loading ? <p className="text-slate-500">Loading screenshot…</p> : proof.image
                  ? <a href={proof.image} target="_blank" rel="noreferrer"><img src={proof.image} alt="Transaction screenshot" className="max-h-96 w-auto max-w-full rounded-lg border border-slate-200 dark:border-slate-700" /></a>
                  : <p className="text-slate-500">The screenshot could not be loaded.</p>}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ---------- form */}
      <Modal isOpen={Boolean(form)} onClose={() => setForm(null)} title={form?.id ? 'Edit receipt' : 'Add receipt'} subtitle="The receipt number is created automatically and the receipt is sent to the Accounts office" maxWidth="3xl">
        {form && (
          <form onSubmit={save} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Query Code *"><input className={inputCls} value={form.queryCode} onChange={(e) => patch({ queryCode: e.target.value })} maxLength={80} required /></Field>
              <Field label="Client Name *"><input className={inputCls} value={form.clientName} onChange={(e) => patch({ clientName: e.target.value })} maxLength={160} required /></Field>
            </div>

            <div>
              <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1.5">What is sold?</p>
              <div className="flex flex-wrap gap-1.5">
                {RECEIPT_ITEMS.map((it) => {
                  const on = form.items.includes(it);
                  return (
                    <button key={it} type="button" aria-pressed={on} onClick={() => patch({ items: on ? form.items.filter((x) => x !== it) : [...form.items, it] })}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border cursor-pointer ${on ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>{on ? '✓ ' : ''}{it}</button>
                  );
                })}
                <button type="button" aria-pressed={form.otherOn} onClick={() => patch({ otherOn: !form.otherOn })}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border cursor-pointer ${form.otherOn ? 'bg-blue-600 text-white border-blue-600' : 'border-blue-300 text-blue-700 dark:text-blue-300'}`}>{form.otherOn ? '✓ ' : ''}Other</button>
              </div>
              {form.otherOn && <input className={`${inputCls} mt-2`} placeholder="What else was sold?" value={form.otherItem} onChange={(e) => patch({ otherItem: e.target.value })} maxLength={120} />}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Group label="Payment">
                <div className="flex gap-4 py-2">
                  {([['full', 'Full payment'], ['partial', 'Partial payment']] as const).map(([v, l]) => (
                    <label key={v} className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-200 cursor-pointer"><input type="radio" name="paytype" checked={form.paymentType === v} onChange={() => patch({ paymentType: v })} /> {l}</label>
                  ))}
                </div>
              </Group>
              <Field label="Currency *">
                <select className={inputCls} value={form.currency} onChange={(e) => patch({ currency: e.target.value })}>
                  {currencies.map((c) => <option key={c.code} value={c.code}>{currencyLabel(c)}</option>)}
                </select>
              </Field>
              <Field label="Amount received *"><input className={inputCls} type="number" inputMode="decimal" step="0.01" min="0" value={form.amountReceived} onChange={(e) => patch({ amountReceived: e.target.value })} required /></Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Group label="Amount received through">
                <div className="flex gap-4 py-2">
                  {([['cash', 'Cash'], ['bank', 'Bank transfer']] as const).map(([v, l]) => (
                    <label key={v} className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-200 cursor-pointer"><input type="radio" name="paymethod" checked={form.method === v} onChange={() => patch({ method: v })} /> {l}</label>
                  ))}
                </div>
              </Group>
              {form.method === 'bank' && <Field label="Bank Name (amount received in bank)"><input className={inputCls} value={form.bankName} onChange={(e) => patch({ bankName: e.target.value })} maxLength={120} /></Field>}
              <Field label="Reference No / Transaction ID"><input className={inputCls} value={form.referenceNo} onChange={(e) => patch({ referenceNo: e.target.value })} maxLength={160} /></Field>
              <Group label="Screenshot of the transaction (JPG, JPEG or PNG)">
                <div className="flex flex-wrap items-center gap-2">
                  <label className={`${btnGhost} cursor-pointer`}>
                    <Upload className="w-3.5 h-3.5" /> {form.proofImage || (form.hadProof && !form.removeProof) ? 'Replace image' : 'Upload image'}
                    <input type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" className="sr-only" onChange={(e) => { void pickImage(e.target.files?.[0]); e.target.value = ''; }} />
                  </label>
                  {form.proofImage && <img src={form.proofImage} alt="Selected screenshot" className="h-12 w-auto rounded border border-slate-300 dark:border-slate-700" />}
                  {!form.proofImage && form.hadProof && !form.removeProof && <span className="text-[11px] text-slate-500">A screenshot is already saved.</span>}
                  {(form.proofImage || (form.hadProof && !form.removeProof)) && (
                    <button type="button" aria-label="Remove screenshot" className="text-slate-400 hover:text-red-600 cursor-pointer" onClick={() => patch({ proofImage: '', removeProof: form.hadProof })}><X className="w-4 h-4" /></button>
                  )}
                </div>
              </Group>
            </div>

            <Field label="On Account Of (purpose)"><textarea className={inputCls} rows={2} value={form.purpose} onChange={(e) => patch({ purpose: e.target.value })} maxLength={400} /></Field>

            {error && <ErrorNote message={error} />}
            <div className="flex justify-end gap-2">
              <button type="button" className={btnGhost} onClick={() => setForm(null)}>Cancel</button>
              <button type="submit" className={btnPrimary} disabled={busy}>{busy ? 'Saving…' : form.id ? 'Save changes' : 'Create receipt'}</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};
