import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Check, Pencil, Plus, X } from 'lucide-react';
import { Employee } from '../types';
import { Modal } from '../components/common/Modal';
import { CrmMeeting, crmCall } from './crmApi';
import { CrmState } from './useCrm';
import { AddToCalendar, Countdown, ErrorNote, Field, Pill, btnDanger, btnGhost, btnPrimary, cardCls, fmtDateTime, fmtDay, fmtTime, fromLocalInput, inputCls, toLocalInput } from './ui';

interface Props {
  crm: CrmState;
  employees: Employee[];
  currentUser: Employee;
}

const DAY_START = 8; // availability strip covers 8:00 - 20:00
const DAY_END = 20;

const nextHour = (): Date => {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
};
const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export const MeetingsView: React.FC<Props> = ({ crm, employees, currentUser }) => {
  const isAdmin = currentUser.role === 'admin';
  const { meetings, customers, unread } = crm.data;
  const empName = useMemo(() => new Map(employees.map((e) => [e.id, e.name])), [employees]);
  const customerOf = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const staff = employees.filter((e) => e.isActive !== false);

  const [day, setDay] = useState<Date>(() => startOfDay(new Date()));
  const [showPast, setShowPast] = useState(false);

  // meeting form
  const [formMode, setFormMode] = useState<null | 'admin' | 'request'>(null);
  const [editing, setEditing] = useState<CrmMeeting | null>(null);
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [attendees, setAttendees] = useState<string[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [external, setExternal] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // decision modal (admin)
  const [deciding, setDeciding] = useState<{ m: CrmMeeting; approve: boolean } | null>(null);
  const [decisionNote, setDecisionNote] = useState('');

  const hasNew = unread.some((u) => u.category === 'meeting');
  const newIds = useMemo(() => new Set(unread.filter((u) => u.category === 'meeting').map((u) => u.refId)), [unread]);
  useEffect(() => {
    if (!hasNew) return;
    const t = window.setTimeout(() => { void crm.markRead('meeting'); }, 4000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasNew]);

  const openForm = (mode: 'admin' | 'request', m?: CrmMeeting) => {
    const s = nextHour();
    const e = new Date(s.getTime() + 3600 * 1000);
    setFormMode(mode);
    setEditing(m || null);
    setTitle(m?.title || '');
    setStart(toLocalInput(m?.startAt || s.toISOString()));
    setEnd(toLocalInput(m?.endAt || e.toISOString()));
    setAttendees(m?.attendeeIds || []);
    setCustomerId(m?.customerId || '');
    setExternal(m?.externalName || '');
    setLocation(m?.location || '');
    setNotes(m?.notes || '');
    setError('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !formMode) return;
    const startAt = fromLocalInput(start);
    const endAt = fromLocalInput(end);
    if (!title.trim()) return setError('Enter a meeting title.');
    if (!startAt || !endAt) return setError('Choose the start and end time.');
    if (Date.parse(endAt) <= Date.parse(startAt)) return setError('The end time must be after the start time.');
    setBusy(true);
    setError('');
    try {
      if (formMode === 'admin') {
        await crmCall('meeting_save', { meeting: { id: editing?.id, title, startAt, endAt, attendeeIds: attendees, customerId: customerId || null, externalName: external, location, notes } });
      } else {
        await crmCall('meeting_request', { meeting: { title, startAt, endAt, location, notes } });
      }
      await crm.refresh();
      setDay(startOfDay(new Date(startAt)));
      setFormMode(null);
    } catch (err: any) {
      setError(err?.message || 'Could not save the meeting.');
    } finally {
      setBusy(false);
    }
  };

  const act = async (action: string, id: string, extra: Record<string, unknown> = {}) => {
    try {
      await crmCall(action, { id, ...extra });
      await crm.refresh();
    } catch (err: any) {
      window.alert(err?.message || 'That did not work.');
    }
  };

  const decide = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deciding || busy) return;
    setBusy(true);
    setError('');
    try {
      await crmCall('meeting_decide', { id: deciding.m.id, approve: deciding.approve, note: decisionNote });
      await crm.refresh();
      setDeciding(null);
    } catch (err: any) {
      setError(err?.message || 'Could not save the decision.');
    } finally {
      setBusy(false);
    }
  };

  // ---- availability for the chosen day
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(startOfDay(new Date()).getTime() + i * 86400000)), []);
  const dayStart = day.getTime();
  const dayEnd = dayStart + 86400000;
  const busyToday = useMemo(
    () => meetings.filter((m) => m.status === 'scheduled' && Date.parse(m.startAt) < dayEnd && Date.parse(m.endAt) > dayStart).sort((a, b) => a.startAt.localeCompare(b.startAt)),
    [meetings, dayStart, dayEnd]
  );
  const winStart = dayStart + DAY_START * 3600000;
  const winLen = (DAY_END - DAY_START) * 3600000;

  // ---- lists
  const now = Date.now();
  const pending = meetings.filter((m) => m.status === 'pending_approval').sort((a, b) => a.startAt.localeCompare(b.startAt));
  const myRejected = meetings.filter((m) => m.status === 'rejected' && m.requestedBy === currentUser.id && Date.parse(m.endAt) >= now - 7 * 86400000);
  const upcoming = meetings.filter((m) => m.status === 'scheduled' && Date.parse(m.endAt) >= now).sort((a, b) => a.startAt.localeCompare(b.startAt));
  const past = meetings.filter((m) => (m.status === 'scheduled' && Date.parse(m.endAt) < now) || m.status === 'completed' || m.status === 'cancelled').sort((a, b) => b.startAt.localeCompare(a.startAt));

  const card = (m: CrmMeeting) => {
    const mine = m.attendeeIds.includes(currentUser.id) || m.requestedBy === currentUser.id;
    const cust = m.customerId ? customerOf.get(m.customerId) : undefined;
    const who = [
      ...m.attendeeIds.map((id) => empName.get(id) || 'Former employee'),
      ...(cust ? [`${cust.customerName}${cust.companyName ? ` (${cust.companyName})` : ''}`] : []),
      ...(m.externalName ? [m.externalName] : []),
    ];
    const tone = m.status === 'scheduled' ? 'green' : m.status === 'pending_approval' ? 'amber' : m.status === 'completed' ? 'blue' : 'red';
    const label = { scheduled: 'Scheduled', pending_approval: 'Waiting for approval', rejected: 'Not approved', cancelled: 'Cancelled', completed: 'Done' }[m.status];
    const canCancel = (isAdmin || m.requestedBy === currentUser.id) && (m.status === 'scheduled' || m.status === 'pending_approval');
    return (
      <div key={m.id} className={`${cardCls} p-4`}>
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 break-words">{m.title}</h3>
              <Pill tone={tone}>{label}</Pill>
              {m.status === 'scheduled' && <Countdown atIso={m.startAt} endIso={m.endAt} kind="start" />}
              {mine && <Pill tone="violet">Mine</Pill>}
              {newIds.has(m.id) && <Pill tone="blue">New</Pill>}
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300">{fmtDay(m.startAt)} · {fmtTime(m.startAt)} – {fmtTime(m.endAt)}{m.location ? ` · ${m.location}` : ''}</p>
            {who.length > 0 && <p className="text-[11px] text-slate-500 dark:text-slate-400">With: {who.join(', ')}</p>}
            {m.requestedBy && <p className="text-[11px] text-slate-500 dark:text-slate-400">Requested by {empName.get(m.requestedBy) || 'Former employee'}</p>}
            {m.notes && <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">{m.notes}</p>}
            {m.decisionNote && <p className="text-xs text-slate-600 dark:text-slate-400 border-l-2 border-slate-300 dark:border-slate-700 pl-2">Admin note: {m.decisionNote}</p>}
          </div>
          <div className="flex flex-wrap gap-1.5 shrink-0">
            {(m.status === 'scheduled' || m.status === 'pending_approval' || m.status === 'completed') && (
              <AddToCalendar event={{ title: `CEO meeting: ${m.title}`, startIso: m.startAt, endIso: m.endAt, location: m.location, description: [m.notes, who.length ? `With: ${who.join(', ')}` : ''].filter(Boolean).join('\n') }} />
            )}
            {isAdmin && m.status === 'pending_approval' && (
              <>
                <button className={btnPrimary} onClick={() => { setDeciding({ m, approve: true }); setDecisionNote(''); setError(''); }}><Check className="w-3.5 h-3.5" /> Approve</button>
                <button className={btnDanger} onClick={() => { setDeciding({ m, approve: false }); setDecisionNote(''); setError(''); }}><X className="w-3.5 h-3.5" /> Reject</button>
              </>
            )}
            {isAdmin && m.status === 'scheduled' && (
              <>
                <button className={btnGhost} onClick={() => openForm('admin', m)} aria-label="Edit meeting"><Pencil className="w-3.5 h-3.5" /></button>
                <button className={btnGhost} onClick={() => act('meeting_complete', m.id)}>Mark done</button>
              </>
            )}
            {canCancel && <button className={btnDanger} onClick={() => { if (window.confirm('Cancel this meeting?')) void act('meeting_cancel', m.id); }}>Cancel</button>}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className={`${cardCls} p-4 space-y-4`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2"><CalendarClock className="w-4 h-4 text-blue-600" /> CEO availability</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Blue blocks are times the CEO is already booked. Pick a free time to request your own meeting.</p>
          </div>
          <div className="flex gap-2">
            {isAdmin && <button className={btnPrimary} onClick={() => openForm('admin')}><Plus className="w-4 h-4" /> Schedule CEO meeting</button>}
            {!isAdmin && <button className={btnPrimary} onClick={() => openForm('request')}><Plus className="w-4 h-4" /> Request a meeting</button>}
          </div>
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {days.map((d) => {
            const active = d.getTime() === dayStart;
            const count = meetings.filter((m) => m.status === 'scheduled' && Date.parse(m.startAt) < d.getTime() + 86400000 && Date.parse(m.endAt) > d.getTime()).length;
            return (
              <button
                key={d.getTime()}
                onClick={() => setDay(d)}
                className={`shrink-0 px-3 py-2 rounded-lg border text-xs transition-all duration-200 active:scale-[0.97] cursor-pointer ${active ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
              >
                <span className="block font-semibold">{d.toLocaleDateString([], { weekday: 'short' })}</span>
                <span className="block text-[10px] opacity-80">{d.toLocaleDateString([], { day: 'numeric', month: 'short' })}</span>
                <span className="block text-[10px] opacity-80">{count ? `${count} booked` : 'Free'}</span>
              </button>
            );
          })}
        </div>

        <div>
          <div className="relative h-9 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 overflow-hidden">
            {busyToday.map((m) => {
              const l = Math.max(0, (Date.parse(m.startAt) - winStart) / winLen) * 100;
              const r = Math.min(1, (Date.parse(m.endAt) - winStart) / winLen) * 100;
              if (r <= 0 || l >= 100) return null;
              return <div key={m.id} className="absolute top-0 bottom-0 bg-blue-500/80 border-x border-blue-700" style={{ left: `${l}%`, width: `${Math.max(1, r - l)}%` }} title={`${fmtTime(m.startAt)} – ${fmtTime(m.endAt)}`} />;
            })}
          </div>
          <div className="flex justify-between text-[10px] text-slate-400 mt-1 px-0.5">
            {[8, 10, 12, 14, 16, 18, 20].map((h) => <span key={h}>{h > 12 ? h - 12 : h}{h >= 12 ? 'pm' : 'am'}</span>)}
          </div>
          <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-2">
            {busyToday.length ? <>Booked: {busyToday.map((m) => `${fmtTime(m.startAt)}–${fmtTime(m.endAt)}`).join(', ')}</> : 'The CEO is free all day.'}
          </p>
        </div>
      </div>

      <ErrorNote message={crm.error} />

      {(isAdmin ? pending.length > 0 : pending.some((m) => m.requestedBy === currentUser.id) || myRejected.length > 0) && (
        <section className="space-y-3">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{isAdmin ? 'Requests waiting for your approval' : 'My requests'}</h3>
          {(isAdmin ? pending : pending.filter((m) => m.requestedBy === currentUser.id)).map(card)}
          {!isAdmin && myRejected.map(card)}
        </section>
      )}

      <section className="space-y-3">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Upcoming CEO meetings</h3>
        {crm.loading && !meetings.length ? <p className={`${cardCls} p-6 text-center text-xs text-slate-500`}>Loading meetings…</p>
          : upcoming.length ? upcoming.map(card) : <p className={`${cardCls} p-6 text-center text-xs text-slate-500`}>No upcoming CEO meetings.</p>}
      </section>

      {past.length > 0 && (
        <section className="space-y-3">
          <button className="text-[11px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 cursor-pointer" onClick={() => setShowPast((s) => !s)}>
            {showPast ? 'Hide' : 'Show'} earlier meetings ({past.length})
          </button>
          {showPast && past.map(card)}
        </section>
      )}

      <Modal isOpen={formMode !== null} onClose={() => setFormMode(null)} title={formMode === 'request' ? 'Request a CEO meeting' : editing ? 'Edit CEO meeting' : 'Schedule CEO meeting'} subtitle={formMode === 'request' ? 'The administrator will approve or reject your request.' : 'Chosen employees are notified in their Meetings section.'} maxWidth="lg">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Meeting title"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} autoFocus /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Starts"><input type="datetime-local" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
            <Field label="Ends"><input type="datetime-local" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          </div>
          {formMode === 'admin' && (
            <>
              <div>
                <span className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Internal employees attending</span>
                <div className="max-h-36 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1 p-2 rounded-lg border border-slate-300 dark:border-slate-700">
                  {staff.map((e) => (
                    <label key={e.id} className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input type="checkbox" checked={attendees.includes(e.id)} onChange={(ev) => setAttendees((cur) => (ev.target.checked ? [...cur, e.id] : cur.filter((x) => x !== e.id)))} />
                      {e.name}
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Customer (optional)">
                  <select className={inputCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                    <option value="">None</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.customerName}{c.companyName ? ` — ${c.companyName}` : ''}</option>)}
                  </select>
                </Field>
                <Field label="Other outside person / company (optional)"><input className={inputCls} value={external} onChange={(e) => setExternal(e.target.value)} maxLength={160} /></Field>
              </div>
            </>
          )}
          <Field label="Location or meeting link (optional)"><input className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} /></Field>
          <Field label="Notes (optional)"><textarea className={`${inputCls} min-h-[70px]`} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} /></Field>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-2">
            <button type="button" className={btnGhost} onClick={() => setFormMode(null)}>Cancel</button>
            <button type="submit" className={btnPrimary} disabled={busy}>{busy ? 'Saving…' : formMode === 'request' ? 'Send request' : editing ? 'Save changes' : 'Schedule meeting'}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={Boolean(deciding)} onClose={() => setDeciding(null)} title={deciding?.approve ? 'Approve meeting request' : 'Reject meeting request'} subtitle={deciding ? `${deciding.m.title} · ${fmtDateTime(deciding.m.startAt)}` : undefined} maxWidth="md">
        <form onSubmit={decide} className="space-y-4">
          <Field label="Note for the employee (optional)"><textarea className={`${inputCls} min-h-[70px]`} value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} maxLength={1000} /></Field>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-2">
            <button type="button" className={btnGhost} onClick={() => setDeciding(null)}>Cancel</button>
            <button type="submit" className={deciding?.approve ? btnPrimary : btnDanger} disabled={busy}>{busy ? 'Saving…' : deciding?.approve ? 'Approve' : 'Reject'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
