import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeftRight, Check, Clock, Plus, X } from 'lucide-react';
import type { Employee } from '../../types';
import { crmCall } from '../../crm/crmApi';
import { btnDanger, btnGhost, btnPrimary, cardCls, inputCls, Field, Pill, ErrorNote } from '../../crm/ui';

/**
 * Short leave (coming late / leaving early for a few hours) and shift swaps with a colleague.
 * A swap goes to the colleague first, then to Admin / CEO. Approved requests are a record only:
 * shifts and attendance are not changed.
 */
type Status = 'waiting_peer' | 'pending' | 'approved' | 'declined' | 'peer_declined' | 'cancelled';
type Req = {
  id: string; type: 'short' | 'swap'; when?: 'late' | 'early' | 'other'; date: string; from?: string; to?: string; reason?: string;
  requesterId: string; requesterName: string; peerId?: string; peerName?: string; myShift?: string; peerShift?: string;
  status: Status; peerNote?: string; decidedByName?: string; decisionNote?: string; createdAt: string;
};
type ListData = { today: string; isAdmin: boolean; mine: Req[]; waiting: Req[]; swapsWithMe: Req[]; toApprove: Req[]; decided: Req[]; colleagues: { id: string; name: string }[] };

const STATUS: Record<Status, { label: string; tone: 'blue' | 'green' | 'amber' | 'red' | 'slate' | 'violet' }> = {
  waiting_peer: { label: 'Waiting for colleague', tone: 'violet' },
  pending: { label: 'Waiting for Admin', tone: 'amber' },
  approved: { label: 'Approved', tone: 'green' },
  declined: { label: 'Declined', tone: 'red' },
  peer_declined: { label: 'Colleague declined', tone: 'red' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
};
const WHEN: Record<string, string> = { late: 'Coming late', early: 'Leaving early', other: 'Out for a while' };
const dayText = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const t12 = (t?: string) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '');
  if (!m) return t || '';
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'am' : 'pm'}`;
};
const todayPk = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);

const ReqCard: React.FC<{ r: Req; who?: 'me' | 'other'; children?: React.ReactNode }> = ({ r, who = 'me', children }) => (
  <div className={`${cardCls} p-3 space-y-1.5`} data-slv={r.id}>
    <div className="flex flex-wrap items-center gap-2">
      {r.type === 'swap' ? <ArrowLeftRight className="w-3.5 h-3.5 text-violet-500" /> : <Clock className="w-3.5 h-3.5 text-blue-500" />}
      <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
        {r.type === 'swap' ? 'Shift swap' : WHEN[r.when || 'other']} · {dayText(r.date)}
      </span>
      <span className="ml-auto"><Pill tone={STATUS[r.status]?.tone || 'slate'}>{STATUS[r.status]?.label || r.status}</Pill></span>
    </div>
    {who === 'other' && <p className="text-[11px] text-slate-500">Asked by <b className="text-slate-700 dark:text-slate-300">{r.requesterName}</b></p>}
    {r.type === 'short' ? (
      <p className="text-xs text-slate-700 dark:text-slate-300">{t12(r.from)} – {t12(r.to)}</p>
    ) : (
      <p className="text-xs text-slate-700 dark:text-slate-300">
        {r.requesterName}{r.myShift ? ` (${r.myShift})` : ''} with {r.peerName}{r.peerShift ? ` (${r.peerShift})` : ''}
      </p>
    )}
    {r.reason && <p className="text-[11px] text-slate-500 break-words">Reason: {r.reason}</p>}
    {r.peerNote && <p className="text-[11px] text-slate-500 break-words">{r.peerName}: {r.peerNote}</p>}
    {r.decidedByName && <p className="text-[11px] text-slate-500 break-words">{STATUS[r.status]?.label} by {r.decidedByName}{r.decisionNote ? `: ${r.decisionNote}` : ''}</p>}
    {children && <div className="flex flex-wrap gap-2 pt-1">{children}</div>}
  </div>
);

const Section: React.FC<{ title: string; count?: number; children: React.ReactNode }> = ({ title, count, children }) => (
  <section className="space-y-2">
    <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300">{title}{count ? <span className="ml-1.5 text-slate-400 font-semibold">({count})</span> : null}</h3>
    {children}
  </section>
);

export const ShortLeavePanel: React.FC<{ currentUser: Employee }> = ({ currentUser }) => {
  const [d, setD] = useState<ListData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [form, setForm] = useState<null | { type: 'short' | 'swap'; when: 'late' | 'early' | 'other'; date: string; from: string; to: string; reason: string; peerId: string }>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const r = await crmCall<ListData>('staff_short_list');
      setD(r); setErr('');
    } catch (e) {
      setErr((e as Error)?.message || 'Could not load the requests.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load, currentUser.id]);

  const run = async (key: string, action: string, payload: Record<string, unknown>) => {
    setBusy(key); setErr('');
    try {
      await crmCall(action, payload);
      await load();
      return true;
    } catch (e) {
      setErr((e as Error)?.message || 'Something went wrong. Please try again.');
      return false;
    } finally {
      setBusy('');
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const payload = form.type === 'short'
      ? { type: 'short', when: form.when, date: form.date, from: form.from, to: form.to, reason: form.reason }
      : { type: 'swap', date: form.date, peerId: form.peerId, reason: form.reason };
    if (await run('new', 'staff_short_request', { request: payload })) setForm(null);
  };

  const newForm = (type: 'short' | 'swap') => setForm({ type, when: 'early', date: d?.today || todayPk(), from: '', to: '', reason: '', peerId: '' });
  const noteOf = (rid: string) => notes[rid] || '';
  const tall = 'min-h-10';

  return (
    <div className={`${cardCls} p-4 space-y-4`} data-short-leave-panel>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Short leave & shift swap</h2>
          <p className="text-xs text-slate-500">Ask to come late or leave early for a few hours, or swap your shift with a colleague for a day.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${btnPrimary} ${tall}`} onClick={() => newForm('short')}><Plus className="w-3.5 h-3.5" /> Short leave</button>
          <button type="button" className={`${btnGhost} ${tall}`} onClick={() => newForm('swap')}><ArrowLeftRight className="w-3.5 h-3.5" /> Swap shift</button>
        </div>
      </div>

      <ErrorNote message={err} />

      {form && (
        <form onSubmit={(e) => void submit(e)} className="rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/40 dark:bg-blue-950/20 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-slate-900 dark:text-slate-100">{form.type === 'short' ? 'New short leave' : 'New shift swap'}</p>
            <button type="button" className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer" onClick={() => setForm(null)} aria-label="Close"><X className="w-4 h-4" /></button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {form.type === 'short' && (
              <Field label="What is it">
                <select className={`${inputCls} ${tall}`} value={form.when} onChange={(e) => setForm({ ...form, when: e.target.value as 'late' | 'early' | 'other' })}>
                  <option value="early">Leaving early</option>
                  <option value="late">Coming late</option>
                  <option value="other">Out for a while during the day</option>
                </select>
              </Field>
            )}
            <Field label="Date">
              <input type="date" className={`${inputCls} ${tall}`} required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            {form.type === 'short' ? (
              <>
                <Field label="From"><input type="time" className={`${inputCls} ${tall}`} required value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} /></Field>
                <Field label="To"><input type="time" className={`${inputCls} ${tall}`} required value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} /></Field>
              </>
            ) : (
              <Field label="Swap with" hint="They need to accept first, then Admin approves.">
                <select className={`${inputCls} ${tall}`} required value={form.peerId} onChange={(e) => setForm({ ...form, peerId: e.target.value })}>
                  <option value="">Choose a colleague</option>
                  {(d?.colleagues || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
            )}
          </div>
          <Field label={form.type === 'short' ? 'Reason' : 'Reason (optional)'}>
            <textarea className={inputCls} rows={2} maxLength={500} required={form.type === 'short'} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder={form.type === 'short' ? 'For example: doctor appointment' : 'For example: family event that evening'} />
          </Field>
          <div className="flex flex-wrap gap-2 justify-end">
            <button type="button" className={`${btnGhost} ${tall}`} onClick={() => setForm(null)}>Cancel</button>
            <button type="submit" className={`${btnPrimary} ${tall}`} disabled={busy === 'new'}>{busy === 'new' ? 'Sending…' : 'Send request'}</button>
          </div>
        </form>
      )}

      {loading && !d && <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-16 rounded-xl bg-slate-100 dark:bg-slate-800/60 animate-pulse" />)}</div>}

      {d && (
        <div className="space-y-5">
          {d.waiting.length > 0 && (
            <Section title="Waiting for me" count={d.waiting.length}>
              <div className="grid gap-2 md:grid-cols-2">
                {d.waiting.map((r) => (
                  <ReqCard key={r.id} r={r} who="other">
                    <input className={`${inputCls} ${tall} flex-1 min-w-[10rem]`} placeholder="Note (optional)" maxLength={300} value={noteOf(r.id)} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                    <button className={`${btnPrimary} ${tall}`} disabled={!!busy} onClick={() => void run(r.id, 'staff_short_peer', { id: r.id, accept: true, note: noteOf(r.id) })}><Check className="w-3.5 h-3.5" /> Accept</button>
                    <button className={`${btnDanger} ${tall}`} disabled={!!busy} onClick={() => void run(r.id, 'staff_short_peer', { id: r.id, accept: false, note: noteOf(r.id) })}><X className="w-3.5 h-3.5" /> Decline</button>
                  </ReqCard>
                ))}
              </div>
            </Section>
          )}

          {d.isAdmin && (
            <Section title="To approve" count={d.toApprove.length}>
              {d.toApprove.length === 0 ? (
                <p className="text-xs text-slate-500">Nothing waiting for approval.</p>
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  {d.toApprove.map((r) => (
                    <ReqCard key={r.id} r={r} who="other">
                      <input className={`${inputCls} ${tall} flex-1 min-w-[10rem]`} placeholder="Note (optional)" maxLength={300} value={noteOf(r.id)} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                      <button className={`${btnPrimary} ${tall}`} disabled={!!busy} onClick={() => void run(r.id, 'staff_short_decide', { id: r.id, approve: true, note: noteOf(r.id) })}><Check className="w-3.5 h-3.5" /> Approve</button>
                      <button className={`${btnDanger} ${tall}`} disabled={!!busy} onClick={() => void run(r.id, 'staff_short_decide', { id: r.id, approve: false, note: noteOf(r.id) })}><X className="w-3.5 h-3.5" /> Decline</button>
                    </ReqCard>
                  ))}
                </div>
              )}
            </Section>
          )}

          <Section title="My requests" count={d.mine.length}>
            {d.mine.length === 0 ? (
              <p className="text-xs text-slate-500">You have not asked for a short leave or a shift swap yet.</p>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {d.mine.map((r) => (
                  <ReqCard key={r.id} r={r}>
                    {(r.status === 'waiting_peer' || r.status === 'pending') && (
                      <button className={`${btnGhost} ${tall}`} disabled={!!busy} onClick={() => void run(r.id, 'staff_short_cancel', { id: r.id })}>{busy === r.id ? 'Cancelling…' : 'Cancel request'}</button>
                    )}
                  </ReqCard>
                ))}
              </div>
            )}
          </Section>

          {d.swapsWithMe.length > 0 && (
            <Section title="Swaps I answered">
              <div className="grid gap-2 md:grid-cols-2">{d.swapsWithMe.map((r) => <ReqCard key={r.id} r={r} who="other" />)}</div>
            </Section>
          )}

          {d.isAdmin && d.decided.length > 0 && (
            <Section title="Recently decided">
              <div className="grid gap-2 md:grid-cols-2">{d.decided.slice(0, 12).map((r) => <ReqCard key={r.id} r={r} who="other" />)}</div>
            </Section>
          )}
          <p className="text-[11px] text-slate-500">Approved requests are kept as a record and everyone involved is told. Shift times and attendance stay as they are.</p>
        </div>
      )}
    </div>
  );
};

export default ShortLeavePanel;
