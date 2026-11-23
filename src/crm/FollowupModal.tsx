import React, { useEffect, useState } from 'react';
import { Employee } from '../types';
import { Modal } from '../components/common/Modal';
import { CrmCustomer, CrmFollowup, FollowupKind, crmCall } from './crmApi';
import { CrmState } from './useCrm';
import { ErrorNote, Field, btnGhost, btnPrimary, fmtDateTime, fromLocalInput, inputCls, toLocalInput } from './ui';

interface Props {
  open: boolean;
  onClose: () => void;
  crm: CrmState;
  employees: Employee[];
  currentUser: Employee;
  customers: CrmCustomer[];
  presetCustomerId?: string;
  editing?: CrmFollowup | null;
}

const KINDS: { id: FollowupKind; label: string; hint: string }[] = [
  { id: 'meeting', label: 'Meeting follow-up', hint: 'A meeting is supposed to be held' },
  { id: 'corporate', label: 'Corporate follow-up', hint: 'Follow-up with the customer’s company' },
  { id: 'internal', label: 'Internal follow-up', hint: 'Work to be done inside the office' },
  { id: 'regular', label: 'Regular customers follow-up', hint: 'Routine contact with existing customers' },
  { id: 'personal', label: 'Personal follow-up', hint: 'Your own reminder, not tied to a customer' },
];

type CustomerMode = 'none' | 'existing' | 'new';

export const FollowupModal: React.FC<Props> = ({ open, onClose, crm, employees, currentUser, customers, presetCustomerId, editing }) => {
  const hasCustomerAccess = true; // everyone can add customers; they only see their own + shared
  const [mode, setMode] = useState<CustomerMode>('existing');
  const [customerId, setCustomerId] = useState('');
  const [newName, setNewName] = useState('');
  const [newCompany, setNewCompany] = useState('');
  const [newNumber, setNewNumber] = useState('');
  const [newDest, setNewDest] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [kind, setKind] = useState<FollowupKind>('meeting');
  const [subject, setSubject] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [participants, setParticipants] = useState<string[]>([]);
  const [dueAt, setDueAt] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');

  const staff = employees.filter((e) => e.isActive !== false);
  const selectedCustomer = customers.find((c) => c.id === customerId);

  useEffect(() => {
    if (!open) return;
    setError('');
    setWarning('');
    setBusy(false);
    setNewName(''); setNewCompany(''); setNewNumber(''); setNewDest(''); setNewDescription('');
    if (editing) {
      setMode(editing.customerId ? 'existing' : 'none');
      setCustomerId(editing.customerId || '');
      setKind(editing.kind);
      setSubject(editing.subject || '');
      setAssignedTo(editing.assignedTo);
      setParticipants(editing.participantIds || []);
      setDueAt(editing.dueAt ? toLocalInput(editing.dueAt) : '');
      setRemarks(editing.remarks);
    } else {
      setMode(presetCustomerId ? 'existing' : 'none');
      setCustomerId(presetCustomerId || '');
      setKind('meeting');
      setSubject('');
      setAssignedTo(currentUser.id);
      setParticipants([]);
      setDueAt('');
      setRemarks('');
    }
  }, [open, editing, presetCustomerId, currentUser.id]);

  // A message about a missing field goes away as soon as the person changes something.
  useEffect(() => { setError(''); }, [mode, remarks, customerId, newName, assignedTo]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!assignedTo) return setError('Choose who will take this follow-up.');
    if (mode === 'existing' && !customerId) return setError('Choose a customer, or switch to “No customer”.');
    if (mode === 'new' && !newName.trim()) return setError('Type the new customer’s name, or switch to “No customer”.');
    if (mode === 'none' && !remarks.trim()) return setError('Without a customer, please type the follow-up remarks.');
    setBusy(true);
    setError('');
    try {
      const followup: Record<string, unknown> = {
        id: editing?.id,
        kind,
        subject: kind === 'internal' ? subject : '',
        assignedTo,
        participantIds: participants.filter((p) => p !== assignedTo),
        remarks,
        dueAt: fromLocalInput(dueAt),
        customerId: mode === 'existing' ? customerId : null,
      };
      if (mode === 'new') {
        followup.newCustomer = {
          customerName: newName,
          companyName: newCompany,
          customerNumber: newNumber,
          description: newDescription,
          destinations: newDest.split(';').map((d) => d.trim()).filter(Boolean),
        };
      }
      const saved: any = await crmCall('followup_save', { followup });
      await crm.refresh();
      const overlaps: { title: string; startAt: string }[] = saved?.overlaps || [];
      if (overlaps.length) {
        // saved, but the CEO is double-booked: tell the person (the CEO and admins were notified by the server)
        setWarning(`Saved, but this time overlaps with: ${overlaps.map((o) => `${o.title} (${fmtDateTime(o.startAt)})`).join('; ')}. The CEO and administrators have been notified.`);
        return;
      }
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not save the follow-up.');
    } finally {
      setBusy(false);
    }
  };

  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 active:scale-[0.97] cursor-pointer ${active ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}`;

  return (
    <Modal isOpen={open} onClose={onClose} title={editing ? 'Edit follow-up' : 'New follow-up'} subtitle="Chosen employees are notified." maxWidth="lg">
      <form onSubmit={submit} className="space-y-4">
        {kind === 'internal' && <Field label="Subject *"><input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={180} required placeholder="What needs to be done?" /></Field>}
        <div>
          <span className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Customer (optional)</span>
          <div className="flex flex-wrap gap-1.5 mb-2">
            <button type="button" className={chip(mode === 'none')} onClick={() => setMode('none')}>No customer</button>
            {(hasCustomerAccess || Boolean(editing?.customerId)) && <button type="button" className={chip(mode === 'existing')} onClick={() => setMode('existing')} disabled={Boolean(editing) && !editing?.customerId}>Existing customer</button>}
            {!editing && hasCustomerAccess && <button type="button" className={chip(mode === 'new')} onClick={() => setMode('new')}>＋ Add new customer</button>}
          </div>
          {mode === 'existing' && (
            <div className="space-y-2">
              <select className={inputCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)} disabled={Boolean(editing)} aria-label="Customer">
                <option value="">Select a customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.customerName}{c.companyName ? ` — ${c.companyName}` : ''}</option>
                ))}
              </select>
              {selectedCustomer?.description && (
                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300">
                  <span className="font-semibold text-slate-700 dark:text-slate-200">Customer description: </span>
                  <span className="whitespace-pre-wrap break-words">{selectedCustomer.description}</span>
                </div>
              )}
            </div>
          )}
          {mode === 'new' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-700">
              <Field label="Customer name"><input className={inputCls} value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={120} /></Field>
              <Field label="Company name (optional)"><input className={inputCls} value={newCompany} onChange={(e) => setNewCompany(e.target.value)} maxLength={160} /></Field>
              <Field label="Customer number (optional)"><input className={inputCls} value={newNumber} onChange={(e) => setNewNumber(e.target.value)} maxLength={60} /></Field>
              <Field label="Desired countries / cities (optional)" hint="Separate several with a semicolon ( ; )"><input className={inputCls} value={newDest} onChange={(e) => setNewDest(e.target.value)} placeholder="Istanbul, Turkey; Dubai, UAE" /></Field>
              <div className="sm:col-span-2">
                <Field label="Customer description (optional)">
                  <textarea className={`${inputCls} min-h-[64px]`} value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Type customer background, requirements or notes…" maxLength={2000} />
                </Field>
              </div>
            </div>
          )}
          {mode === 'none' && <p className="text-[11px] text-slate-400">This follow-up is not linked to a customer.</p>}
        </div>

        <div>
          <span className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Follow-up type</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => setKind(k.id)}
                className={`text-left p-2.5 rounded-lg border text-xs transition-all duration-200 active:scale-[0.98] cursor-pointer ${
                  kind === k.id
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200'
                    : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <span className="font-semibold block">{k.label}</span>
                <span className="text-[10px] opacity-80">{k.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Who takes this follow-up?">
            <select className={inputCls} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
              <option value="">Select an employee…</option>
              {staff.map((e) => (
                <option key={e.id} value={e.id}>{e.name}{e.id === currentUser.id ? ' (me)' : ''}</option>
              ))}
            </select>
          </Field>
          <Field label="Due date & time (optional)">
            <input type="datetime-local" className={inputCls} value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </Field>
        </div>

        <div>
          <span className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Add more employees to this follow-up (optional)</span>
          <div className="max-h-32 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1 p-2 rounded-lg border border-slate-300 dark:border-slate-700">
            {staff.filter((e) => e.id !== assignedTo).map((e) => (
              <label key={e.id} className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input type="checkbox" checked={participants.includes(e.id)} onChange={(ev) => setParticipants((cur) => (ev.target.checked ? [...cur, e.id] : cur.filter((x) => x !== e.id)))} />
                {e.name}
              </label>
            ))}
          </div>
        </div>

        <Field label="Follow-up reason / description">
          <textarea className={`${inputCls} min-h-[90px]`} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Type the reason and details of what has to be followed up…" maxLength={4000} />
        </Field>

        <ErrorNote message={error} />
        {warning && (
          <div role="alert" className="text-xs px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-900 space-y-2">
            <p>⚠ {warning}</p>
            <button type="button" className={btnPrimary} onClick={onClose}>OK, close</button>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
          <button type="submit" className={btnPrimary} disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create follow-up'}</button>
        </div>
      </form>
    </Modal>
  );
};
