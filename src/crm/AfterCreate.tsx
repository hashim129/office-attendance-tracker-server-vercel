import React, { useEffect, useRef, useState } from 'react';
import { BellRing, CheckCircle2, Eye, MessageCircle, Send, Share2, X } from 'lucide-react';
import type { ActiveDesktopTab } from '../types';
import { AckKind, AckStatus, CrmData, crmCall } from './crmApi';
import type { CrmState } from './useCrm';
import { playAlertSound } from './sound';
import { Pill, btnGhost, btnPrimary, inputCls } from './ui';

/** Turns what people type ("0300-1234567", "+92 300 1234567", "0092…") into the digits wa.me wants (923001234567). */
export function waNumber(raw: string): string {
  let d = String(raw || '').replace(/\D+/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('03')) d = `92${d.slice(1)}`; // Pakistani mobile written locally
  else if (d.length === 10 && d.startsWith('3')) d = `92${d}`;
  return d.length >= 8 && d.length <= 15 ? d : '';
}

/** The public tracking page for a CRM ID / query code (the customer beta portal). */
export const portalTrackLink = (trackingId: string): string =>
  trackingId ? `${window.location.origin}/customers?q=${encodeURIComponent(trackingId)}` : '';

/** Best known phone for a customer: an invoice with the same CRM ID, else the customer record with the same name. */
export function guessPhone(data: CrmData, name: string, trackingId = ''): string {
  const n = name.trim().toLowerCase();
  const q = trackingId.trim().toLowerCase();
  const inv = (data.invoices || []).find((i) => i.customerPhone && ((q && String(i.crmId || '').toLowerCase() === q) || i.customerName.trim().toLowerCase() === n));
  if (inv) return inv.customerPhone;
  const c = (data.customers || []).find((x) => x.customerName.trim().toLowerCase() === n && x.customerNumber);
  return c?.customerNumber || '';
}

export interface AfterCreateInfo {
  kind: AckKind;
  id: string;
  /** e.g. "Invoice INV-0088763" */
  title: string;
  customerName: string;
  phone?: string;
  /** CRM ID / query code the customer can track on the portal */
  trackingId?: string;
  /** One line such as "Total PKR 120,000 · Balance PKR 20,000" */
  summary?: string;
  /** Builds the customer PDF (invoices, receipts) */
  makePdf?: () => Promise<File>;
  /** false for internal records (vendor payables): only "Send to Accounts" is offered */
  customerFacing?: boolean;
}

const saveFile = (file: File) => {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
};

/**
 * Shown once right after something new is created: share it with the customer on WhatsApp,
 * and/or send it to Accounts (they are reminded until they press "Seen").
 */
export const AfterCreatePrompt: React.FC<{
  info: AfterCreateInfo | null;
  companyName: string;
  portalEnabled: boolean;
  ack?: AckStatus;
  onClose: () => void;
  onSent: () => void;
}> = ({ info, companyName, portalEnabled, ack, onClose, onSent }) => {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { setPhone(info?.phone || ''); setMsg(''); setErr(''); setBusy(''); }, [info?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!info) return null;

  const customerFacing = info.customerFacing !== false;
  const digits = waNumber(phone);
  const link = portalEnabled ? portalTrackLink(info.trackingId || '') : '';
  const text = [
    `Dear ${info.customerName || 'Customer'},`,
    `Your ${info.title}${companyName ? ` from ${companyName}` : ''} is ready.`,
    info.summary || '',
    info.makePdf ? 'The PDF is attached.' : '',
    link ? `Track your booking anytime: ${link}` : '',
    'Thank you!',
  ].filter(Boolean).join('\n');
  const waHref = digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : '';
  const canShareFiles = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';

  const downloadPdf = async () => {
    if (!info.makePdf) return;
    try { saveFile(await info.makePdf()); } catch { setErr('The PDF could not be made. Use Download PDF on the card.'); }
  };
  const sharePdf = async () => {
    if (!info.makePdf) return;
    setBusy('share');
    try {
      const file = await info.makePdf();
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: info.title, text });
      else saveFile(file);
    } catch (e: any) {
      if (e?.name !== 'AbortError') setErr('Could not share the PDF. It can be downloaded from the card.');
    } finally { setBusy(''); }
  };
  const sendToAccounts = async () => {
    setBusy('acc'); setErr('');
    try {
      await crmCall('accounts_ack_request', { kind: info.kind, id: info.id });
      setMsg('Sent to Accounts. They will keep getting a reminder until they press "Seen".');
      onSent();
    } catch (e: any) {
      setErr(e?.message || 'Could not send to Accounts.');
    } finally { setBusy(''); }
  };

  return (
    <div className="fixed inset-0 z-[90] bg-slate-950/50 flex items-end sm:items-center justify-center p-3" role="dialog" aria-modal="true" aria-label={`${info.title} created`} data-after-create>
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-bold text-slate-900 dark:text-slate-100 inline-flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-emerald-600" /> {info.title} created</p>
            <p className="text-[11px] text-slate-500">{info.customerName}{info.summary ? ` · ${info.summary}` : ''}</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="text-slate-400 hover:text-slate-700 cursor-pointer"><X className="w-4 h-4" /></button>
        </div>

        {customerFacing && (
          <section className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/20 p-3 space-y-2">
            <p className="text-xs font-bold text-emerald-900 dark:text-emerald-200 inline-flex items-center gap-1.5"><MessageCircle className="w-4 h-4" /> Share with the customer on WhatsApp</p>
            <input className={inputCls} inputMode="tel" placeholder="Customer WhatsApp number, e.g. 0300 1234567" value={phone} onChange={(e) => setPhone(e.target.value)} data-wa-phone />
            {link && <p className="text-[11px] text-slate-600 dark:text-slate-400 break-all">Tracking link included: {link}</p>}
            <div className="flex flex-wrap gap-2">
              {waHref ? (
                <a href={waHref} target="_blank" rel="noreferrer" onClick={() => void downloadPdf()} data-wa-open
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-2">
                  <MessageCircle className="w-3.5 h-3.5" /> {info.makePdf ? 'Download PDF & open WhatsApp' : 'Open WhatsApp'}
                </a>
              ) : (
                <span className="text-[11px] text-slate-500 self-center">Enter the customer's number to open WhatsApp.</span>
              )}
              {info.makePdf && canShareFiles && (
                <button type="button" className={btnGhost} disabled={busy === 'share'} onClick={() => void sharePdf()}><Share2 className="w-3.5 h-3.5" /> Share PDF file</button>
              )}
            </div>
            {info.makePdf && waHref && <p className="text-[10px] text-slate-500">WhatsApp opens this customer's chat with the message ready. Attach the PDF that was just downloaded (WhatsApp links cannot attach files by themselves).</p>}
          </section>
        )}

        <section className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/60 dark:bg-blue-950/20 p-3 space-y-2">
          <p className="text-xs font-bold text-blue-900 dark:text-blue-200 inline-flex items-center gap-1.5"><Send className="w-4 h-4" /> Send to Accounts</p>
          {ack ? <AckPill ack={ack} /> : msg ? null : <p className="text-[11px] text-slate-600 dark:text-slate-400">Accounts gets a repeating reminder until they confirm they have seen it.</p>}
          {msg && <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">{msg}</p>}
          {!ack && !msg && <button type="button" className={btnPrimary} disabled={busy === 'acc'} onClick={() => void sendToAccounts()} data-send-accounts>{busy === 'acc' ? 'Sending…' : 'Send to Accounts'}</button>}
        </section>

        {err && <p className="text-xs text-red-600">{err}</p>}
        <div className="flex justify-end"><button type="button" className={btnGhost} onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
};

export const AckPill: React.FC<{ ack: AckStatus }> = ({ ack }) => ack.ackAt
  ? <Pill tone="green">✓ Seen by Accounts{ack.ackByName ? ` · ${ack.ackByName}` : ''}</Pill>
  : <Pill tone="amber">Sent to Accounts · waiting</Pill>;

/** On a record card: its Accounts status, or a small "Send to Accounts" button for the creator. */
export const AckBadge: React.FC<{ kind: AckKind; id: string; crm: CrmState; canRequest: boolean }> = ({ kind, id, crm, canRequest }) => {
  const [busy, setBusy] = useState(false);
  const ack = crm.data.acks?.[id];
  if (ack) return <AckPill ack={ack} />;
  if (!canRequest) return null;
  return (
    <button type="button" className={btnGhost} disabled={busy} data-card-send-accounts
      onClick={async () => { setBusy(true); try { await crmCall('accounts_ack_request', { kind, id }); await crm.refresh(); } catch { /* the card stays as it was */ } finally { setBusy(false); } }}>
      <Send className="w-3.5 h-3.5" /> {busy ? 'Sending…' : 'Send to Accounts'}
    </button>
  );
};

const TAB: Record<AckKind, ActiveDesktopTab> = { invoice: 'crm-invoices', receipt: 'crm-receipts', sale: 'crm-sales', purchase: 'crm-purchases' };
const REPEAT_MS = 3 * 60 * 1000;

/**
 * For Accounts officers on every page: what was sent to Accounts and not yet seen. It rings when something new
 * arrives and again every 3 minutes until each item is acknowledged.
 */
export const AccountsAckReminder: React.FC<{ crm: CrmState; onOpen: (tab: ActiveDesktopTab, refId?: string) => void }> = ({ crm, onOpen }) => {
  const pending = crm.badges.ackPending || [];
  const [snoozeUntil, setSnoozeUntil] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [, tick] = useState(0);
  const known = useRef<Set<string>>(new Set());
  const lastRing = useRef(0);
  const shown = pending.filter((p) => !done.has(p.refId));

  useEffect(() => { const t = window.setInterval(() => tick((n) => n + 1), 15000); return () => window.clearInterval(t); }, []);
  // ring for anything new, and again every 3 minutes while something is waiting
  useEffect(() => {
    if (!shown.length) return;
    const fresh = shown.some((p) => !known.current.has(p.refId));
    shown.forEach((p) => known.current.add(p.refId));
    const now = Date.now();
    if (fresh || (now >= snoozeUntil && now - lastRing.current >= REPEAT_MS)) {
      if (fresh) setSnoozeUntil(0);
      lastRing.current = now;
      playAlertSound('warning');
      try {
        if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('Waiting for Accounts', { body: `${shown.length} item(s) need your acknowledgement.` });
      } catch { /* optional */ }
    }
  });

  if (!shown.length || Date.now() < snoozeUntil) return null;
  const seen = async (refId: string) => {
    setBusy(refId);
    try { await crmCall('accounts_ack', { id: refId }); setDone((s) => new Set(s).add(refId)); void crm.refresh(); } catch { /* stays so it can be pressed again */ } finally { setBusy(null); }
  };
  return (
    <div className="fixed bottom-4 left-4 z-[85] w-[min(92vw,24rem)] rounded-2xl border-2 border-amber-400 dark:border-amber-700 bg-white dark:bg-slate-900 shadow-2xl p-3 space-y-2" role="alert" data-ack-reminder>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-black text-amber-800 dark:text-amber-300 inline-flex items-center gap-1.5"><BellRing className="w-4 h-4" /> Sent to Accounts · please acknowledge ({shown.length})</p>
        <button type="button" className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 cursor-pointer" onClick={() => setSnoozeUntil(Date.now() + REPEAT_MS)}>Remind me in 3 min</button>
      </div>
      <ul className="space-y-1.5 max-h-64 overflow-y-auto">
        {shown.slice(0, 8).map((p) => (
          <li key={p.refId} className="rounded-xl border border-slate-200 dark:border-slate-700 p-2 flex items-center gap-2">
            <button type="button" className="flex-1 min-w-0 text-left cursor-pointer" onClick={() => onOpen(TAB[p.kind], p.refId)}>
              <span className="block text-xs font-bold text-slate-900 dark:text-slate-100 truncate">{p.label} {p.no}{p.name ? ` · ${p.name}` : ''}</span>
              <span className="block text-[10px] text-slate-500">from {p.byName || 'a colleague'} · {new Date(p.at).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
            </button>
            <button type="button" className={btnGhost} onClick={() => onOpen(TAB[p.kind], p.refId)} aria-label="Open"><Eye className="w-3.5 h-3.5" /></button>
            <button type="button" disabled={busy === p.refId} onClick={() => void seen(p.refId)} data-ack-seen={p.refId}
              className="shrink-0 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold px-2.5 py-1.5 cursor-pointer disabled:opacity-60">
              {busy === p.refId ? '…' : 'Seen ✓'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
