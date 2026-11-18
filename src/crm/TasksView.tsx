import React, { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { Employee } from '../types';
import { Modal } from '../components/common/Modal';
import { CrmFollowup, FollowupStatus, crmCall } from './crmApi';
import { CrmState } from './useCrm';
import { FollowupModal } from './FollowupModal';
import { AddToCalendar, Countdown, ErrorNote, StatBar, Field, KIND_LABEL, Pill, STATUS_LABEL, btnDanger, btnGhost, btnPrimary, cardCls, fmtDateTime, fromLocalInput, inputCls, toLocalInput } from './ui';

interface Props {
  crm: CrmState;
  employees: Employee[];
  currentUser: Employee;
}

type Scope = 'mine' | 'created' | 'all';
type StatusFilter = 'open' | 'all' | FollowupStatus;

const statusTone = (s: FollowupStatus) => (s === 'completed' ? 'green' : s === 'not_completed' ? 'red' : s === 'rescheduled' ? 'violet' : 'amber');

export const TasksView: React.FC<Props> = ({ crm, employees, currentUser }) => {
  const isAdmin = currentUser.role === 'admin';
  const { customers, followups, unread } = crm.data;
  const empName = useMemo(() => new Map(employees.map((e) => [e.id, e.name])), [employees]);
  const customerOf = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const [scope, setScope] = useState<Scope>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CrmFollowup | null>(null);
  const [outcomeFor, setOutcomeFor] = useState<CrmFollowup | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [outcome, setOutcome] = useState<'completed' | 'not_completed' | 'rescheduled'>('completed');
  const [remarks, setRemarks] = useState('');
  const [newDue, setNewDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Opening this page counts as having seen the new-task notifications.
  const hasNew = unread.some((u) => u.category === 'followup');
  const newIds = useMemo(() => new Set(unread.filter((u) => u.category === 'followup').map((u) => u.refId)), [unread]);
  useEffect(() => {
    if (!hasNew) return;
    const t = window.setTimeout(() => { void crm.markRead('followup'); }, 4000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasNew]);

  const rows = useMemo(() => {
    return followups
      .filter((f) => (scope === 'mine' ? f.assignedTo === currentUser.id || f.participantIds.includes(currentUser.id) : scope === 'created' ? f.createdBy === currentUser.id : true))
      .filter((f) => (statusFilter === 'all' ? true : statusFilter === 'open' ? f.status === 'pending' || f.status === 'rescheduled' : f.status === statusFilter))
      .sort((a, b) => (a.dueAt || a.createdAt).localeCompare(b.dueAt || b.createdAt));
  }, [followups, scope, statusFilter, currentUser.id]);

  const scoped = useMemo(
    () => followups.filter((f) => (scope === 'mine' ? f.assignedTo === currentUser.id || f.participantIds.includes(currentUser.id) : scope === 'created' ? f.createdBy === currentUser.id : true)),
    [followups, scope, currentUser.id]
  );
  const statusCounts = useMemo(() => ({
    pending: scoped.filter((f) => f.status === 'pending').length,
    rescheduled: scoped.filter((f) => f.status === 'rescheduled').length,
    completed: scoped.filter((f) => f.status === 'completed').length,
    not_completed: scoped.filter((f) => f.status === 'not_completed').length,
  }), [scoped]);

  const openOutcome = (f: CrmFollowup) => {
    setOutcomeFor(f);
    setOutcome('completed');
    setRemarks('');
    setNewDue(toLocalInput(new Date(Date.now() + 24 * 3600 * 1000).toISOString()));
    setError('');
  };

  const saveOutcome = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!outcomeFor || busy) return;
    if (outcome === 'rescheduled' && !newDue) return setError('Choose the new date and time.');
    setBusy(true);
    setError('');
    try {
      await crmCall('followup_outcome', { id: outcomeFor.id, outcome, remarks, newDueAt: outcome === 'rescheduled' ? fromLocalInput(newDue) : undefined });
      await crm.refresh();
      setOutcomeFor(null);
    } catch (err: any) {
      setError(err?.message || 'Could not update the follow-up.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (f: CrmFollowup) => {
    if (!window.confirm('Delete this follow-up?')) return;
    try {
      await crmCall('followup_delete', { id: f.id });
      await crm.refresh();
    } catch (err: any) {
      window.alert(err?.message || 'Could not delete the follow-up.');
    }
  };

  const scopes: { id: Scope; label: string }[] = [
    { id: 'all', label: isAdmin ? 'Everyone' : 'All (everyone involved)' },
    { id: 'mine', label: 'My follow-ups' },
    { id: 'created', label: 'Created by me' },
  ];
  const statuses: { id: StatusFilter; label: string }[] = [
    { id: 'open', label: 'Open' },
    { id: 'completed', label: 'Completed' },
    { id: 'not_completed', label: 'Not completed' },
    { id: 'rescheduled', label: 'Rescheduled' },
    { id: 'all', label: 'All' },
  ];
  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 active:scale-[0.97] cursor-pointer ${active ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}`;

  return (
    <div className="space-y-4">
      <div className={`${cardCls} p-4 space-y-3`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {scopes.map((s) => <button key={s.id} className={chip(scope === s.id)} onClick={() => setScope(s.id)}>{s.label}</button>)}
          </div>
          <button className={btnPrimary} onClick={() => { setEditing(null); setFormOpen(true); }}><Plus className="w-4 h-4" /> New follow-up</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {statuses.map((s) => <button key={s.id} className={chip(statusFilter === s.id)} onClick={() => setStatusFilter(s.id)}>{s.label}</button>)}
        </div>
      </div>

      <StatBar
        title="Follow-up status"
        segments={[
          { label: 'Pending', count: statusCounts.pending, tone: 'amber' },
          { label: 'Rescheduled', count: statusCounts.rescheduled, tone: 'violet' },
          { label: 'Completed', count: statusCounts.completed, tone: 'green' },
          { label: 'Not completed', count: statusCounts.not_completed, tone: 'red' },
        ]}
      />

      <ErrorNote message={crm.error} />

      {crm.loading && !followups.length ? (
        <p className={`${cardCls} p-8 text-center text-xs text-slate-500`}>Loading follow-ups…</p>
      ) : rows.length === 0 ? (
        <p className={`${cardCls} p-8 text-center text-xs text-slate-500`}>Nothing here. {scope === 'mine' ? 'Follow-ups assigned to you will appear in this list.' : 'No follow-ups match these filters.'}</p>
      ) : (
        <div className="space-y-3">
          {rows.map((f) => {
            const c = f.customerId ? customerOf.get(f.customerId) : undefined;
            const isOpen = f.status === 'pending' || f.status === 'rescheduled';
            const canAct = f.assignedTo === currentUser.id || isAdmin;
            const canManage = f.createdBy === currentUser.id || isAdmin;
            return (
              <div key={f.id} className={`${cardCls} p-4`}>
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{c?.customerName || (f.customerId ? 'Deleted customer' : 'General follow-up')}</h3>
                      {c?.companyName && <span className="text-xs text-slate-500">{c.companyName}</span>}
                      {newIds.has(f.id) && <Pill tone="blue">New</Pill>}
                      {f.assignedTo !== currentUser.id && f.participantIds.includes(currentUser.id) && <Pill tone="violet">Added to this follow-up</Pill>}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Pill tone="slate">{KIND_LABEL[f.kind] || f.kind}</Pill>
                      <Pill tone={statusTone(f.status)}>{STATUS_LABEL[f.status] || f.status}</Pill>
                      {isOpen && <Countdown atIso={f.dueAt} kind="due" />}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      For <b className="text-slate-700 dark:text-slate-200">{empName.get(f.assignedTo) || 'Former employee'}</b> · created by {empName.get(f.createdBy) || 'Former employee'} · due {fmtDateTime(f.dueAt)}
                    </p>
                    {f.participantIds.length > 0 && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">Also on this follow-up: {f.participantIds.map((id) => empName.get(id) || 'Former employee').join(', ')}</p>
                    )}
                    {f.remarks && <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">{f.remarks}</p>}
                    {f.outcomeRemarks && (
                      <p className="text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap break-words border-l-2 border-slate-300 dark:border-slate-700 pl-2">
                        <b>Latest update:</b> {f.outcomeRemarks}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap md:flex-col lg:flex-row gap-1.5 shrink-0">
                    {f.dueAt && f.status !== 'cancelled' && (
                      <AddToCalendar event={{ title: `${KIND_LABEL[f.kind] || 'Follow-up'}${c ? `: ${c.customerName}` : ''}`, startIso: f.dueAt, description: [f.remarks, `Assigned to: ${empName.get(f.assignedTo) || ''}`].filter(Boolean).join('\n') }} />
                    )}
                    {canAct && isOpen && <button className={btnPrimary} onClick={() => openOutcome(f)}>Update status</button>}
                    {canManage && isOpen && <button className={btnGhost} onClick={() => { setEditing(f); setFormOpen(true); }} aria-label="Edit follow-up"><Pencil className="w-3.5 h-3.5" /></button>}
                    {canManage && <button className={btnDanger} onClick={() => remove(f)} aria-label="Delete follow-up"><Trash2 className="w-3.5 h-3.5" /></button>}
                  </div>
                </div>
                {f.history.length > 0 && (
                  <div className="mt-3">
                    <button className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 cursor-pointer" onClick={() => setExpanded(expanded === f.id ? null : f.id)}>
                      {expanded === f.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />} History ({f.history.length})
                    </button>
                    {expanded === f.id && (
                      <ul className="mt-2 space-y-1.5">
                        {[...f.history].reverse().map((h, i) => (
                          <li key={i} className="text-[11px] text-slate-600 dark:text-slate-400">
                            <b>{STATUS_LABEL[h.outcome] || h.outcome}</b> by {empName.get(h.by) || 'Former employee'} · {fmtDateTime(h.at)}
                            {h.outcome === 'rescheduled' && h.dueAt ? ` → ${fmtDateTime(h.dueAt)}` : ''}
                            {h.remarks ? <span className="block whitespace-pre-wrap break-words">“{h.remarks}”</span> : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <FollowupModal open={formOpen} onClose={() => setFormOpen(false)} crm={crm} employees={employees} currentUser={currentUser} customers={customers} editing={editing} />

      <Modal isOpen={Boolean(outcomeFor)} onClose={() => setOutcomeFor(null)} title="Update follow-up" subtitle={outcomeFor?.customerId ? customerOf.get(outcomeFor.customerId)?.customerName : undefined} maxWidth="md">
        <form onSubmit={saveOutcome} className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {([['completed', 'Completed'], ['not_completed', 'Not completed'], ['rescheduled', 'Rescheduled']] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setOutcome(id)}
                className={`px-2 py-2.5 rounded-lg border text-xs font-semibold transition-all duration-200 active:scale-[0.97] cursor-pointer ${
                  outcome === id ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200' : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {outcome === 'rescheduled' && (
            <Field label="New date & time"><input type="datetime-local" className={inputCls} value={newDue} onChange={(e) => setNewDue(e.target.value)} /></Field>
          )}
          <Field label="Remarks (optional)">
            <textarea className={`${inputCls} min-h-[90px]`} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="What happened? Add any details…" maxLength={4000} />
          </Field>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-2">
            <button type="button" className={btnGhost} onClick={() => setOutcomeFor(null)}>Cancel</button>
            <button type="submit" className={btnPrimary} disabled={busy}>{busy ? 'Saving…' : 'Save update'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
