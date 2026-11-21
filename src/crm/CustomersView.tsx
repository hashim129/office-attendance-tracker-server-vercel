import React, { useMemo, useState } from 'react';
import { Pencil, Plus, Search, Trash2, X, ClipboardList } from 'lucide-react';
import { Employee } from '../types';
import { Modal } from '../components/common/Modal';
import { CrmCustomer, crmCall } from './crmApi';
import { CrmState } from './useCrm';
import { FollowupModal } from './FollowupModal';
import { ErrorNote, Field, Pill, btnDanger, btnGhost, btnPrimary, cardCls, fmtDateTime, inputCls } from './ui';

interface Props {
  crm: CrmState;
  employees: Employee[];
  currentUser: Employee;
}

export const CustomersView: React.FC<Props> = ({ crm, employees, currentUser }) => {
  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'ceo'; // the CEO has every administrator right here
  const seesAll = ['admin', 'ceo', 'accounts'].includes(currentUser.role);
  const canChange = (c: CrmCustomer) => seesAll || c.createdBy === currentUser.id;
  const { customers, followups } = crm.data;
  const empName = useMemo(() => new Map(employees.map((e) => [e.id, e.name])), [employees]);
  const [query, setQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CrmCustomer | null>(null);
  const [fuCustomer, setFuCustomer] = useState<string | undefined>();
  const [fuOpen, setFuOpen] = useState(false);

  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [description, setDescription] = useState('');
  const [number, setNumber] = useState('');
  const [through, setThrough] = useState('');
  const [by, setBy] = useState('');
  const [dest, setDest] = useState('');
  const [dests, setDests] = useState<string[]>([]);
  const [shared, setShared] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const openForm = (c?: CrmCustomer) => {
    setEditing(c || null);
    setName(c?.customerName || '');
    setCompany(c?.companyName || '');
    setDescription(c?.description || '');
    setNumber(c?.customerNumber || '');
    setThrough(c?.acquiredThrough || '');
    setBy(c?.acquiredBy || '');
    setDests(c?.destinations || []);
    setShared(c?.sharedWith || []);
    setDest('');
    setError('');
    setFormOpen(true);
  };

  const addDest = () => {
    const parts = dest.split(';').map((d) => d.trim()).filter(Boolean);
    if (!parts.length) return;
    setDests((cur) => [...cur, ...parts.filter((p) => !cur.some((c) => c.toLowerCase() === p.toLowerCase()))]);
    setDest('');
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) return setError('Customer name is required.');
    setBusy(true);
    setError('');
    const pending = dest.split(';').map((d) => d.trim()).filter(Boolean);
    const destinations = [...dests, ...pending.filter((p) => !dests.some((c) => c.toLowerCase() === p.toLowerCase()))];
    try {
      await crmCall('customer_save', { customer: { id: editing?.id, customerName: name, companyName: company, description, customerNumber: number, acquiredThrough: through, acquiredBy: by, destinations, sharedWith: shared } });
      await crm.refresh();
      setFormOpen(false);
    } catch (err: any) {
      setError(err?.message || 'Could not save the customer.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: CrmCustomer) => {
    if (!window.confirm(`Delete customer "${c.customerName}"? This hides them from the list.`)) return;
    try {
      await crmCall('customer_delete', { id: c.id });
      await crm.refresh();
    } catch (err: any) {
      window.alert(err?.message || 'Could not delete the customer.');
    }
  };

  const q = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      customers
        .filter((c) => !q || [c.customerName, c.companyName, c.description || '', c.customerNumber, c.acquiredThrough, empName.get(c.acquiredBy) || c.acquiredBy, ...c.destinations].join(' ').toLowerCase().includes(q))
        .sort((a, b) => a.customerName.localeCompare(b.customerName)),
    [customers, q, empName]
  );
  const openCount = (id: string) => followups.filter((f) => f.customerId === id && (f.status === 'pending' || f.status === 'rescheduled')).length;

  return (
    <div className="space-y-4">
      <div className={`${cardCls} p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3`}>
        <div className="relative flex-1 max-w-xl">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={`${inputCls} pl-9`} placeholder="Search by customer, company, country or city…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search customers" />
        </div>
        <button className={btnPrimary} onClick={() => openForm()}><Plus className="w-4 h-4" /> Add customer</button>
      </div>

      <ErrorNote message={crm.error} />

      <div className={`${cardCls} overflow-hidden`}>
        {crm.loading && !customers.length ? (
          <p className="p-8 text-center text-xs text-slate-500">Loading customers…</p>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-xs text-slate-500">{customers.length ? 'No customer matches your search.' : 'No customers yet. Use “Add customer” to enter the first one.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50">
                  <th className="px-4 py-2.5 font-bold">Customer</th>
                  <th className="px-4 py-2.5 font-bold">Company</th>
                  <th className="px-4 py-2.5 font-bold">Number</th>
                  <th className="px-4 py-2.5 font-bold">Desired destinations</th>
                  <th className="px-4 py-2.5 font-bold">Acquired through / by</th>
                  <th className="px-4 py-2.5 font-bold">Added by</th>
                  <th className="px-4 py-2.5 font-bold">Open follow-ups</th>
                  <th className="px-4 py-2.5 font-bold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">{c.customerName}</div>
                      {c.description && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 max-w-xs whitespace-pre-wrap break-words">{c.description}</p>}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{c.companyName || '—'}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">{c.customerNumber || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1 max-w-xs">
                        {c.destinations.length ? c.destinations.map((d) => <Pill key={d} tone="blue">{d}</Pill>) : <span className="text-slate-400">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {c.acquiredThrough || c.acquiredBy ? (
                        <>
                          {c.acquiredThrough || '—'}
                          <span className="block text-[10px] text-slate-400">{c.acquiredBy ? `by ${empName.get(c.acquiredBy) || c.acquiredBy}` : ''}</span>
                        </>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {empName.get(c.createdBy) || 'Former employee'}{c.createdBy === currentUser.id ? ' (you)' : ''}
                      <span className="block text-[10px] text-slate-400">{fmtDateTime(c.createdAt)}</span>
                      {c.createdBy !== currentUser.id && !seesAll && <span className="block text-[10px] text-violet-600 dark:text-violet-400">Shared with you</span>}
                      {c.sharedWith.length > 0 && canChange(c) && <span className="block text-[10px] text-violet-600 dark:text-violet-400">Shared with {c.sharedWith.map((x) => empName.get(x) || '').filter(Boolean).join(', ')}</span>}
                    </td>
                    <td className="px-4 py-3">{openCount(c.id) ? <Pill tone="amber">{openCount(c.id)} open</Pill> : <span className="text-slate-400">None</span>}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <button className={btnGhost} onClick={() => { setFuCustomer(c.id); setFuOpen(true); }} title="Create a follow-up for this customer"><ClipboardList className="w-3.5 h-3.5" /> Follow-up</button>
                        {canChange(c) && <button className={btnGhost} onClick={() => openForm(c)} title="Edit customer" aria-label={`Edit ${c.customerName}`}><Pencil className="w-3.5 h-3.5" /></button>}
                        {isAdmin && <button className={btnDanger} onClick={() => remove(c)} title="Delete customer" aria-label={`Delete ${c.customerName}`}><Trash2 className="w-3.5 h-3.5" /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal isOpen={formOpen} onClose={() => setFormOpen(false)} title={editing ? 'Edit customer' : 'Add customer'} subtitle="Type the countries and cities the customer wants to travel to." maxWidth="lg">
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Customer name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus /></Field>
            <Field label="Company name"><input className={inputCls} value={company} onChange={(e) => setCompany(e.target.value)} maxLength={160} /></Field>
          </div>
          <Field label="Customer description (optional)">
            <textarea className={`${inputCls} min-h-[68px]`} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Type customer background, preferences, travel requirements or notes…" maxLength={2000} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Customer number (optional)"><input className={inputCls} value={number} onChange={(e) => setNumber(e.target.value)} maxLength={60} inputMode="tel" /></Field>
            <Field label="Customer acquired through (optional)"><input className={inputCls} value={through} onChange={(e) => setThrough(e.target.value)} maxLength={120} placeholder="e.g. Facebook, referral" /></Field>
            <Field label="Customer acquired by (optional)">
              <select className={inputCls} value={by} onChange={(e) => setBy(e.target.value)}>
                <option value="">Not set</option>
                {by && !employees.some((x) => x.id === by) && <option value={by}>{by}</option>}
                {employees.filter((x) => x.isActive !== false || x.id === by).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Desired countries / cities" hint="Type a city and/or country (for example Istanbul, Turkey) and press Enter to add it. Add as many as needed.">
            <div className="flex gap-2">
              <input
                className={inputCls}
                value={dest}
                onChange={(e) => setDest(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDest(); } }}
                placeholder="e.g. Turkey, Istanbul"
                maxLength={100}
              />
              <button type="button" className={btnGhost} onClick={addDest}>Add</button>
            </div>
          </Field>
          {dests.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {dests.map((d) => (
                <span key={d} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full text-[11px] font-semibold bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-900">
                  {d}
                  <button type="button" onClick={() => setDests((cur) => cur.filter((x) => x !== d))} className="p-0.5 rounded-full hover:bg-blue-200/60 dark:hover:bg-blue-800/60 cursor-pointer" aria-label={`Remove ${d}`}><X className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
          )}
          <Field label="Let these employees see this customer (optional)" hint="Only you, Admin, CEO and Accounts see this customer unless you choose colleagues here.">
            <div className="max-h-36 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 p-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
              {employees.filter((x) => x.isActive !== false && x.id !== currentUser.id && x.id !== editing?.createdBy && x.id !== 'emp-101').map((x) => (
                <label key={x.id} className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={shared.includes(x.id)} onChange={(e) => setShared((cur) => (e.target.checked ? [...cur, x.id] : cur.filter((i) => i !== x.id)))} />
                  {x.name}
                </label>
              ))}
            </div>
          </Field>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-2">
            <button type="button" className={btnGhost} onClick={() => setFormOpen(false)}>Cancel</button>
            <button type="submit" className={btnPrimary} disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Save customer'}</button>
          </div>
        </form>
      </Modal>

      <FollowupModal open={fuOpen} onClose={() => setFuOpen(false)} crm={crm} employees={employees} currentUser={currentUser} customers={customers} presetCustomerId={fuCustomer} />
    </div>
  );
};
