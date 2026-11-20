import React, { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Trash2, Eye, Search, X, UserCheck, Users, CalendarClock, FileText, Building2, Phone, MapPin, History } from 'lucide-react';
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
  const [query, setQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CrmFollowup | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [outcomeFor, setOutcomeFor] = useState<CrmFollowup | null>(null);

  const [outcome, setOutcome] = useState<'completed' | 'not_completed' | 'rescheduled'>('completed');
  const [remarks, setRemarks] = useState('');
  const [newDue, setNewDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const viewing = useMemo(() => (viewingId ? followups.find((f) => f.id === viewingId) || null : null), [followups, viewingId]);

  // Opening this page counts as having seen the new-task notifications.
  const hasNew = unread.some((u) => u.category === 'followup');
  const newIds = useMemo(() => new Set(unread.filter((u) => u.category === 'followup').map((u) => u.refId)), [unread]);
  useEffect(() => {
    if (!hasNew) return;
    const t = window.setTimeout(() => { void crm.markRead('followup'); }, 4000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasNew]);

  const q = query.trim().toLowerCase();

  const rows = useMemo(() => {
    return followups
      .filter((f) => (scope === 'mine' ? f.assignedTo === currentUser.id || f.participantIds.includes(currentUser.id) : scope === 'created' ? f.createdBy === currentUser.id : true))
      .filter((f) => (statusFilter === 'all' ? true : statusFilter === 'open' ? f.status === 'pending' || f.status === 'rescheduled' : f.status === statusFilter))
      .filter((f) => {
        if (!q) return true;
        const c = f.customerId ? customerOf.get(f.customerId) : undefined;
        const assignee = empName.get(f.assignedTo) || '';
        const creator = empName.get(f.createdBy) || '';
        const attendees = f.participantIds.map((id) => empName.get(id) || '').join(' ');
        const kindLabel = KIND_LABEL[f.kind] || f.kind;
        const statusLabel = STATUS_LABEL[f.status] || f.status;
        const haystack = [
          c?.customerName || 'General follow-up',
          c?.companyName || '',
          c?.description || '',
          c?.customerNumber || '',
          ...(c?.destinations || []),
          assignee,
          creator,
          attendees,
          kindLabel,
          statusLabel,
          f.remarks || '',
          f.outcomeRemarks || '',
        ].join(' ').toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => (a.dueAt || a.createdAt).localeCompare(b.dueAt || b.createdAt));
  }, [followups, scope, statusFilter, currentUser.id, q, customerOf, empName]);

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
      if (viewingId === f.id) setViewingId(null);
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
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {statuses.map((s) => <button key={s.id} className={chip(statusFilter === s.id)} onClick={() => setStatusFilter(s.id)}>{s.label}</button>)}
          </div>
          <div className="relative w-full md:max-w-sm">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              className={`${inputCls} pl-8 pr-8`}
              placeholder="Search follow-ups by customer, employee, reason…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search follow-ups"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
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
        <p className={`${cardCls} p-8 text-center text-xs text-slate-500`}>Nothing here. {q ? 'No follow-ups match your search.' : scope === 'mine' ? 'Follow-ups assigned to you will appear in this list.' : 'No follow-ups match these filters.'}</p>
      ) : (
        <div className="space-y-3">
          {rows.map((f) => {
            const c = f.customerId ? customerOf.get(f.customerId) : undefined;
            const isOpen = f.status === 'pending' || f.status === 'rescheduled';
            const canAct = f.assignedTo === currentUser.id || isAdmin;
            const canManage = f.createdBy === currentUser.id || isAdmin;
            const takingName = empName.get(f.assignedTo) || 'Former employee';
            const creatorName = empName.get(f.createdBy) || 'Former employee';
            const attendingNames = f.participantIds.map((id) => empName.get(id) || 'Former employee');

            return (
              <div
                key={f.id}
                onClick={() => setViewingId(f.id)}
                className={`${cardCls} p-4 hover:border-blue-300 dark:hover:border-blue-800 transition-all cursor-pointer`}
              >
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-2.5">
                    {/* Header: Title + Type + Status + Countdown */}
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        {c?.customerName || (f.customerId ? 'Deleted customer' : 'General follow-up')}
                      </h3>
                      {c?.companyName && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                          <Building2 className="w-3 h-3 text-slate-400" />
                          {c.companyName}
                        </span>
                      )}
                      <Pill tone="slate">{KIND_LABEL[f.kind] || f.kind}</Pill>
                      <Pill tone={statusTone(f.status)}>{STATUS_LABEL[f.status] || f.status}</Pill>
                      {isOpen && <Countdown atIso={f.dueAt} kind="due" />}
                      {newIds.has(f.id) && <Pill tone="blue">New</Pill>}
                      {f.assignedTo !== currentUser.id && f.participantIds.includes(currentUser.id) && <Pill tone="violet">Added to this follow-up</Pill>}
                    </div>

                    {/* Key People & Schedule Highlights */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/70 dark:border-blue-900/60">
                        <UserCheck className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                        <div className="min-w-0">
                          <span className="block text-[10px] font-semibold uppercase tracking-wider text-blue-600/80 dark:text-blue-400">Taking follow-up</span>
                          <span className="block text-xs font-bold text-slate-900 dark:text-slate-100 truncate">{takingName}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-violet-50/70 dark:bg-violet-950/30 border border-violet-200/70 dark:border-violet-900/60">
                        <Users className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400 shrink-0" />
                        <div className="min-w-0">
                          <span className="block text-[10px] font-semibold uppercase tracking-wider text-violet-600/80 dark:text-violet-400">Attending</span>
                          <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                            {attendingNames.length > 0 ? attendingNames.join(', ') : 'Only assignee'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                        <CalendarClock className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
                        <div className="min-w-0">
                          <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Due · Created by {creatorName}</span>
                          <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">{fmtDateTime(f.dueAt)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Highlighted Reason / Task Summary */}
                    {(f.remarks || f.outcomeRemarks) && (
                      <div className="px-3 py-2 rounded-lg bg-amber-50/50 dark:bg-slate-800/50 border-l-3 border-blue-500 text-xs space-y-1">
                        {f.remarks && (
                          <div className="text-slate-800 dark:text-slate-200">
                            <span className="font-bold text-slate-600 dark:text-slate-400 mr-1.5">Reason:</span>
                            <span className="line-clamp-2 whitespace-pre-wrap break-words">{f.remarks}</span>
                          </div>
                        )}
                        {f.outcomeRemarks && (
                          <div className="text-slate-600 dark:text-slate-300 pt-0.5 border-t border-slate-200/70 dark:border-slate-700/70">
                            <span className="font-bold text-emerald-700 dark:text-emerald-400 mr-1.5">Latest update:</span>
                            <span className="line-clamp-1 whitespace-pre-wrap break-words">{f.outcomeRemarks}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Action Buttons (stopPropagation so clicking a button doesn't also trigger the card click) */}
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className={btnGhost} onClick={() => setViewingId(f.id)}>
                      <Eye className="w-3.5 h-3.5" /> View
                    </button>
                    {f.dueAt && (
                      <AddToCalendar event={{ title: `${KIND_LABEL[f.kind] || 'Follow-up'}${c ? `: ${c.customerName}` : ''}`, startIso: f.dueAt, description: [f.remarks, `Assigned to: ${takingName}`].filter(Boolean).join('\n') }} />
                    )}
                    {canAct && isOpen && <button type="button" className={btnPrimary} onClick={() => openOutcome(f)}>Update status</button>}
                    {canManage && isOpen && <button type="button" className={btnGhost} onClick={() => { setEditing(f); setFormOpen(true); }} aria-label="Edit follow-up"><Pencil className="w-3.5 h-3.5" /></button>}
                    {canManage && <button type="button" className={btnDanger} onClick={() => remove(f)} aria-label="Delete follow-up"><Trash2 className="w-3.5 h-3.5" /></button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ---------- Detailed View Modal ---------- */}
      <Modal
        isOpen={Boolean(viewing)}
        onClose={() => setViewingId(null)}
        title={viewing ? (viewing.customerId ? customerOf.get(viewing.customerId)?.customerName || 'Follow-up details' : 'General follow-up') : 'Follow-up details'}
        subtitle={viewing ? `${KIND_LABEL[viewing.kind] || viewing.kind} · Created ${fmtDateTime(viewing.createdAt)}` : undefined}
        maxWidth="2xl"
      >
        {viewing && (() => {
          const vc = viewing.customerId ? customerOf.get(viewing.customerId) : undefined;
          const vOpen = viewing.status === 'pending' || viewing.status === 'rescheduled';
          const vCanAct = viewing.assignedTo === currentUser.id || isAdmin;
          const vCanManage = viewing.createdBy === currentUser.id || isAdmin;
          const vTaking = empName.get(viewing.assignedTo) || 'Former employee';
          const vCreator = empName.get(viewing.createdBy) || 'Former employee';
          const vAttending = viewing.participantIds.map((id) => empName.get(id) || 'Former employee');

          return (
            <div className="space-y-4 text-xs">
              {/* Status & Timing Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone="slate">{KIND_LABEL[viewing.kind] || viewing.kind}</Pill>
                  <Pill tone={statusTone(viewing.status)}>{STATUS_LABEL[viewing.status] || viewing.status}</Pill>
                  {vOpen && <Countdown atIso={viewing.dueAt} kind="due" />}
                </div>
                <div className="text-slate-600 dark:text-slate-300 font-semibold">
                  Due: <span className="text-slate-900 dark:text-slate-100">{fmtDateTime(viewing.dueAt)}</span>
                </div>
              </div>

              {/* People Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/60 space-y-1">
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300">
                    <UserCheck className="w-3.5 h-3.5" /> Taking follow-up
                  </span>
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{vTaking}</p>
                </div>

                <div className="p-3 rounded-xl bg-violet-50/70 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-900/60 space-y-1">
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-violet-700 dark:text-violet-300">
                    <Users className="w-3.5 h-3.5" /> Attending / Involved
                  </span>
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {vAttending.length > 0 ? vAttending.join(', ') : 'No extra employees'}
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1">
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <CalendarClock className="w-3.5 h-3.5" /> Assigned / Created by
                  </span>
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{vCreator}</p>
                </div>
              </div>

              {/* Reason / Description */}
              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 space-y-1.5">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <FileText className="w-3.5 h-3.5 text-blue-600" /> Follow-up Reason & Description
                </span>
                <p className="text-xs text-slate-800 dark:text-slate-100 whitespace-pre-wrap break-words leading-relaxed">
                  {viewing.remarks || 'No additional remarks provided.'}
                </p>
              </div>

              {/* Latest Outcome Remarks */}
              {viewing.outcomeRemarks && (
                <div className="p-3.5 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/20 space-y-1">
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                    Latest Status Update
                  </span>
                  <p className="text-xs text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words">
                    {viewing.outcomeRemarks}
                  </p>
                </div>
              )}

              {/* Linked Customer Details */}
              {vc && (
                <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Customer Details
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <span className="text-[10px] text-slate-400 block">Customer Name</span>
                      <span className="font-bold text-slate-900 dark:text-slate-100">{vc.customerName}</span>
                    </div>
                    {vc.companyName && (
                      <div>
                        <span className="text-[10px] text-slate-400 block">Company</span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200 inline-flex items-center gap-1">
                          <Building2 className="w-3 h-3 text-slate-400" /> {vc.companyName}
                        </span>
                      </div>
                    )}
                    {vc.customerNumber && (
                      <div>
                        <span className="text-[10px] text-slate-400 block">Phone / Contact</span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200 inline-flex items-center gap-1">
                          <Phone className="w-3 h-3 text-slate-400" /> {vc.customerNumber}
                        </span>
                      </div>
                    )}
                    {vc.destinations.length > 0 && (
                      <div>
                        <span className="text-[10px] text-slate-400 block mb-0.5">Desired Destinations</span>
                        <div className="flex flex-wrap gap-1">
                          {vc.destinations.map((d) => (
                            <Pill key={d} tone="blue"><MapPin className="w-2.5 h-2.5 mr-0.5" /> {d}</Pill>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  {vc.description && (
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                      <span className="text-[10px] text-slate-400 block mb-0.5">Customer Description</span>
                      <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">{vc.description}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Activity History */}
              {viewing.history.length > 0 && (
                <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <History className="w-3.5 h-3.5" /> Status History ({viewing.history.length})
                  </span>
                  <ul className="space-y-2">
                    {[...viewing.history].reverse().map((h, i) => (
                      <li key={i} className="text-[11px] text-slate-600 dark:text-slate-400 border-l-2 border-slate-300 dark:border-slate-700 pl-2.5">
                        <b>{STATUS_LABEL[h.outcome] || h.outcome}</b> by {empName.get(h.by) || 'Former employee'} · {fmtDateTime(h.at)}
                        {h.outcome === 'rescheduled' && h.dueAt ? ` → New due: ${fmtDateTime(h.dueAt)}` : ''}
                        {h.remarks ? <span className="block text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words mt-0.5">“{h.remarks}”</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Modal Footer Actions */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div className="flex flex-wrap gap-2">
                  {viewing.dueAt && (
                    <AddToCalendar event={{ title: `${KIND_LABEL[viewing.kind] || 'Follow-up'}${vc ? `: ${vc.customerName}` : ''}`, startIso: viewing.dueAt, description: [viewing.remarks, `Assigned to: ${vTaking}`].filter(Boolean).join('\n') }} />
                  )}
                  {vCanManage && vOpen && (
                    <button type="button" className={btnGhost} onClick={() => { setEditing(viewing); setViewingId(null); setFormOpen(true); }}>
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {vCanAct && vOpen && (
                    <button type="button" className={btnPrimary} onClick={() => { const f = viewing; setViewingId(null); openOutcome(f); }}>
                      Update status
                    </button>
                  )}
                  <button type="button" className={btnGhost} onClick={() => setViewingId(null)}>Close</button>
                </div>
              </div>
            </div>
          );
        })()}
      </Modal>

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
