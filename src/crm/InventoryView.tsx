import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Employee } from '../types';
import { Modal } from '../components/common/Modal';
import { CrmInventoryRequest, InventoryStatus, crmCall } from './crmApi';
import { CrmState } from './useCrm';
import { ErrorNote, Field, Pill, btnDanger, btnGhost, btnPrimary, cardCls, fmtDateTime, inputCls } from './ui';

interface Props {
  crm: CrmState;
  employees: Employee[];
  currentUser: Employee;
}

const STATUS_LABEL: Record<InventoryStatus, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', delivered: 'Delivered' };
const statusTone = (s: InventoryStatus) => (s === 'delivered' ? 'green' : s === 'approved' ? 'blue' : s === 'rejected' ? 'red' : 'amber');

export const InventoryView: React.FC<Props> = ({ crm, employees, currentUser }) => {
  const isAdmin = currentUser.role === 'admin';
  const canReview = isAdmin || currentUser.role === 'accounts';
  const { inventory, inventoryItems, unread } = crm.data;
  const empName = useMemo(() => new Map(employees.map((e) => [e.id, e.name])), [employees]);
  const approvers = employees.filter((e) => e.isActive !== false && (e.role === 'accounts' || e.role === 'admin'));

  const [tab, setTab] = useState<'all' | 'mine' | 'assigned'>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [assignee, setAssignee] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [deciding, setDeciding] = useState<{ r: CrmInventoryRequest; status: InventoryStatus } | null>(null);
  const [remarks, setRemarks] = useState('');

  const hasNew = unread.some((u) => u.category === 'inventory');
  const newIds = useMemo(() => new Set(unread.filter((u) => u.category === 'inventory').map((u) => u.refId)), [unread]);
  useEffect(() => {
    if (!hasNew) return;
    const t = window.setTimeout(() => { void crm.markRead('inventory'); }, 4000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasNew]);

  useEffect(() => { setError(''); }, [qty, assignee]);

  const openForm = () => {
    setQty({});
    setNote('');
    setAssignee('');
    setError('');
    setFormOpen(true);
  };

  const chosen = inventoryItems.map((item) => ({ item, qty: Math.floor(Number(qty[item] || 0)) })).filter((l) => l.qty > 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!chosen.length) return setError('Enter a quantity for at least one item.');
    if (chosen.some((l) => l.qty > 999)) return setError('The largest quantity per item is 999.');
    if (!assignee) return setError('Choose the Accounts or Admin employee this request is for.');
    setBusy(true);
    setError('');
    try {
      await crmCall('inventory_save', { request: { items: chosen, assignedTo: assignee, note } });
      await crm.refresh();
      setFormOpen(false);
      setTab('all');
    } catch (err: any) {
      setError(err?.message || 'Could not send the request.');
    } finally {
      setBusy(false);
    }
  };

  const decide = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deciding || busy) return;
    setBusy(true);
    setError('');
    try {
      await crmCall('inventory_decide', { id: deciding.r.id, status: deciding.status, remarks });
      await crm.refresh();
      setDeciding(null);
    } catch (err: any) {
      setError(err?.message || 'Could not save the update.');
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (r: CrmInventoryRequest) => {
    if (!window.confirm('Withdraw this inventory request?')) return;
    try {
      await crmCall('inventory_delete', { id: r.id });
      await crm.refresh();
    } catch (err: any) {
      window.alert(err?.message || 'Could not withdraw the request.');
    }
  };

  const rows = inventory.filter((r) => (tab === 'all' ? true : tab === 'mine' ? r.requestedBy === currentUser.id : r.assignedTo === currentUser.id));
  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 active:scale-[0.97] cursor-pointer ${active ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}`;

  return (
    <div className="space-y-4">
      <div className={`${cardCls} p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3`}>
        <div className="flex flex-wrap gap-1.5">
          <button className={chip(tab === 'all')} onClick={() => setTab('all')}>{isAdmin ? 'All requests (everyone)' : 'All'}</button>
          <button className={chip(tab === 'mine')} onClick={() => setTab('mine')}>Requested by me</button>
          {canReview && <button className={chip(tab === 'assigned')} onClick={() => setTab('assigned')}>Assigned to me</button>}
        </div>
        <button className={btnPrimary} onClick={openForm}><Plus className="w-4 h-4" /> New inventory request</button>
      </div>

      <ErrorNote message={crm.error} />

      {crm.loading && !inventory.length ? (
        <p className={`${cardCls} p-8 text-center text-xs text-slate-500`}>Loading requests…</p>
      ) : rows.length === 0 ? (
        <p className={`${cardCls} p-8 text-center text-xs text-slate-500`}>{tab === 'assigned' ? 'No requests assigned to you.' : tab === 'mine' ? 'You have not made any inventory requests yet.' : 'No inventory requests yet.'}</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const canAct = (isAdmin || r.assignedTo === currentUser.id) && (r.status === 'pending' || r.status === 'approved');
            const canWithdraw = isAdmin || (r.requestedBy === currentUser.id && r.status === 'pending');
            return (
              <div key={r.id} className={`${cardCls} p-4`}>
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone={statusTone(r.status)}>{STATUS_LABEL[r.status]}</Pill>
                      {newIds.has(r.id) && <Pill tone="blue">New</Pill>}
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">{fmtDateTime(r.createdAt)}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {r.items.map((l) => <Pill key={l.item} tone="slate">{l.qty} × {l.item}</Pill>)}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Requested by <b className="text-slate-700 dark:text-slate-200">{empName.get(r.requestedBy) || 'Former employee'}</b> · for {empName.get(r.assignedTo) || 'Former employee'}
                    </p>
                    {r.note && <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">{r.note}</p>}
                    {r.decisionRemarks && (
                      <p className="text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap break-words border-l-2 border-slate-300 dark:border-slate-700 pl-2">
                        <b>{empName.get(r.decidedBy || '') || 'Reviewer'}:</b> {r.decisionRemarks}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 shrink-0">
                    {canAct && r.status === 'pending' && <button className={btnPrimary} onClick={() => { setDeciding({ r, status: 'approved' }); setRemarks(''); setError(''); }}>Approve</button>}
                    {canAct && <button className={btnPrimary} onClick={() => { setDeciding({ r, status: 'delivered' }); setRemarks(''); setError(''); }}>Mark delivered</button>}
                    {canAct && <button className={btnDanger} onClick={() => { setDeciding({ r, status: 'rejected' }); setRemarks(''); setError(''); }}>Reject</button>}
                    {canWithdraw && <button className={btnGhost} onClick={() => withdraw(r)} aria-label="Withdraw request"><Trash2 className="w-3.5 h-3.5" /></button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal isOpen={formOpen} onClose={() => setFormOpen(false)} title="New inventory request" subtitle="Choose from the list and enter how many you need." maxWidth="lg">
        <form onSubmit={submit} className="space-y-4">
          <div className="rounded-lg border border-slate-300 dark:border-slate-700 divide-y divide-slate-200 dark:divide-slate-800">
            {inventoryItems.map((item) => (
              <div key={item} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">{item}</span>
                <input
                  type="number"
                  min={0}
                  max={999}
                  inputMode="numeric"
                  placeholder="0"
                  value={qty[item] ?? ''}
                  onChange={(e) => setQty((q) => ({ ...q, [item]: e.target.value }))}
                  className={`${inputCls} !w-24 text-center`}
                  aria-label={`${item} quantity`}
                />
              </div>
            ))}
          </div>
          <Field label="Assign to (Accounts or Admin)">
            <select className={inputCls} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Select an employee…</option>
              {approvers.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.role === 'admin' ? 'Admin' : 'Accounts'})</option>)}
            </select>
          </Field>
          <Field label="Note (optional)"><textarea className={`${inputCls} min-h-[60px]`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></Field>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-2">
            <button type="button" className={btnGhost} onClick={() => setFormOpen(false)}>Cancel</button>
            <button type="submit" className={btnPrimary} disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={Boolean(deciding)} onClose={() => setDeciding(null)} title={deciding ? `${{ approved: 'Approve', rejected: 'Reject', delivered: 'Mark as delivered:' }[deciding.status]} request` : ''} subtitle={deciding ? deciding.r.items.map((l) => `${l.qty} × ${l.item}`).join(', ') : undefined} maxWidth="md">
        <form onSubmit={decide} className="space-y-4">
          <Field label="Remarks (optional)"><textarea className={`${inputCls} min-h-[70px]`} value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={1000} /></Field>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-2">
            <button type="button" className={btnGhost} onClick={() => setDeciding(null)}>Cancel</button>
            <button type="submit" className={deciding?.status === 'rejected' ? btnDanger : btnPrimary} disabled={busy}>{busy ? 'Saving…' : 'Confirm'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
