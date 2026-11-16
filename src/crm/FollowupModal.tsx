import React, { useEffect, useState } from 'react';
import { Employee } from '../types';
import { Modal } from '../components/common/Modal';
import { CrmCustomer, CrmFollowup, FollowupKind, crmCall } from './crmApi';
import { CrmState } from './useCrm';
import { ErrorNote, Field, btnGhost, btnPrimary, fromLocalInput, inputCls, toLocalInput } from './ui';

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
];

export const FollowupModal: React.FC<Props> = ({ open, onClose, crm, employees, currentUser, customers, presetCustomerId, editing }) => {
  const [customerId, setCustomerId] = useState('');
  const [kind, setKind] = useState<FollowupKind>('meeting');
  const [assignedTo, setAssignedTo] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const staff = employees.filter((e) => e.isActive !== false);

  useEffect(() => {
    if (!open) return;
    setError('');
    setBusy(false);
    if (editing) {
      setCustomerId(editing.customerId);
      setKind(editing.kind);
      setAssignedTo(editing.assignedTo);
      setDueAt(editing.dueAt ? toLocalInput(editing.dueAt) : '');
      setRemarks(editing.remarks);
    } else {
      setCustomerId(presetCustomerId || '');
      setKind('meeting');
      setAssignedTo(currentUser.id);
      setDueAt('');
      setRemarks('');
    }
  }, [open, editing, presetCustomerId, currentUser.id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!customerId) return setError('Choose a customer.');
    if (!assignedTo) return setError('Choose who will take this follow-up.');
    setBusy(true);
    setError('');
    try {
      await crmCall('followup_save', {
        followup: { id: editing?.id, customerId, kind, assignedTo, remarks, dueAt: fromLocalInput(dueAt) },
      });
      await crm.refresh();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not save the follow-up.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title={editing ? 'Edit follow-up' : 'New follow-up'} subtitle="The chosen employee is notified and sees it under Follow-ups & Tasks." maxWidth="lg">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Customer">
          <select className={inputCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)} disabled={Boolean(editing)}>
            <option value="">Select a customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.customerName}{c.companyName ? ` — ${c.companyName}` : ''}
              </option>
            ))}
          </select>
        </Field>

        <div>
          <span className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Follow-up type</span>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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

        <Field label="Follow-up remarks">
          <textarea className={`${inputCls} min-h-[96px]`} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Type the details of what has to be followed up…" maxLength={4000} />
        </Field>

        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
          <button type="submit" className={btnPrimary} disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create follow-up'}</button>
        </div>
      </form>
    </Modal>
  );
};
