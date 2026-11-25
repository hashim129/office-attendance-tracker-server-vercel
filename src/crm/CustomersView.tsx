import React, { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Search, Trash2, X, ClipboardList, Globe } from 'lucide-react';
import { Employee } from '../types';
import { Modal } from '../components/common/Modal';
import { CrmCustomer, CrmPortalQuery, crmCall } from './crmApi';
import { CrmState } from './useCrm';
import { FollowupModal } from './FollowupModal';
import { ErrorNote, Field, Pill, btnDanger, btnGhost, btnPrimary, cardCls, fmtDateTime, inputCls } from './ui';
import { ExportPanel } from './ExportPanel';
import { customerCells, customerColumns, customerSearch } from './exportConfigs';


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
  const portalQueries = crm.data.portalQueries || [];
  // Opening the Customers page clears its "new" badge shortly after (so the person sees what is new first).
  const hasNewCustomers = crm.data.unread.some((u) => u.category === 'customer');
  useEffect(() => {
    if (!hasNewCustomers) return;
    const t = window.setTimeout(() => { void crm.markRead('customer'); }, 4000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasNewCustomers]);
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

  const updatePortalQueryStatus = async (pq: CrmPortalQuery, status: CrmPortalQuery['status']) => {
    try {
      await crmCall('portal_query_status', { id: pq.id, status });
      await crm.refresh();
    } catch (err: any) {
      window.alert(err?.message || 'Could not update portal query status.');
    }
  };

  const removePortalQuery = async (pq: CrmPortalQuery) => {
    if (!window.confirm(`Delete portal quote query ${pq.queryRef} from ${pq.customerName}?`)) return;
    try {
      await crmCall('portal_query_delete', { id: pq.id });
      await crm.refresh();
    } catch (err: any) {
      window.alert(err?.message || 'Could not delete portal query.');
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
        <div className="flex flex-wrap items-center gap-2">
          <ExportPanel
            title="Customers" rows={crm.data.customers} columns={customerColumns()} toCells={(c) => customerCells(c, (id) => empName.get(id) || 'Former employee')}
            getCreatedAt={(c) => c.createdAt} getCreatorId={(c) => c.createdBy} searchFields={customerSearch} searchHint="Customer no., name or destination"
            employees={employees} currentUser={currentUser} companyName={crm.data.company.name} landscape
          />
          <button className={btnPrimary} onClick={() => openForm()}><Plus className="w-4 h-4" /> Add customer</button>
        </div>
      </div>

      <ErrorNote message={crm.error} />

      {/* Live Customers Portal Generated Queries Bar (Admin, or employees an admin allowed) */}
      {(currentUser.role === 'admin' || currentUser.customerPortalAccess) && (
      <div className={`${cardCls} p-4 border-sky-200 dark:border-sky-900/60 bg-gradient-to-r from-sky-50/70 via-white to-indigo-50/50 dark:from-sky-950/30 dark:via-slate-900 dark:to-indigo-950/20 space-y-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-sky-600 text-white shadow-2xs">
              <Globe className="w-4 h-4" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100">
                  Customers Portal Generated Queries Bar
                </h3>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Real-time quote &amp; package inquiries submitted by new or existing customers on the public Customers Page (/customers).
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <Pill tone="amber">New: {portalQueries.filter((x) => x.status === 'new').length}</Pill>
            <Pill tone="blue">Contacted: {portalQueries.filter((x) => x.status === 'contacted').length}</Pill>
            <Pill tone="green">Quoted: {portalQueries.filter((x) => x.status === 'quoted').length}</Pill>
            <Pill tone="green">Won: {portalQueries.filter((x) => x.status === 'won').length}</Pill>
            <Pill tone="red">Lost: {portalQueries.filter((x) => x.status === 'lost').length}</Pill>
            <Pill tone="slate">Total: {portalQueries.length}</Pill>
          </div>
        </div>

        {portalQueries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-sky-200 dark:border-sky-900/50 bg-white/80 dark:bg-slate-900/60 p-3.5 text-xs text-slate-500 flex flex-wrap items-center justify-between gap-2">
            <span>
              No customer portal quote queries yet. When customers click <b>“Get a quote and let our representative contact you”</b> on any package at <code>/customers</code>, their query appears here live.
            </span>
            <a
              href="/customers"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-bold text-sky-700 dark:text-sky-400 hover:underline"
            >
              Open Customers Portal →
            </a>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
            {portalQueries.slice(0, 12).map((pq) => (
              <div
                key={pq.id}
                className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 flex flex-col justify-between gap-2 shadow-2xs"
              >
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-xs font-bold text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/60 px-2 py-0.5 rounded border border-sky-200 dark:border-sky-800">
                        {pq.queryRef}
                      </span>
                      {pq.crmId && (
                        <Pill tone="blue">CRM / Ref: {pq.crmId}</Pill>
                      )}
                      {pq.isExistingCustomer && (
                        <Pill tone="green">Existing Customer</Pill>
                      )}
                    </div>
                    <Pill
                      tone={
                        pq.status === 'quoted' || pq.status === 'won'
                          ? 'green'
                          : pq.status === 'lost'
                            ? 'red'
                          : pq.status === 'contacted'
                            ? 'blue'
                            : pq.status === 'closed'
                              ? 'slate'
                              : 'amber'
                      }
                    >
                      {pq.status === 'new'
                        ? 'New Inquiry'
                        : pq.status === 'contacted'
                          ? 'Contacted'
                          : pq.status === 'quoted'
                            ? 'Quote Sent'
                            : pq.status === 'won'
                              ? 'Won'
                              : pq.status === 'lost'
                                ? 'Lost'
                                : 'Closed'}
                    </Pill>
                  </div>

                  <div>
                    <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      {pq.customerName}{' '}
                      <span className="font-mono font-semibold text-slate-600 dark:text-slate-300">
                        · {pq.mobileNumber}
                      </span>
                    </p>
                    {pq.packageTitle && (
                      <p className="text-[11px] font-semibold text-sky-700 dark:text-sky-300">
                        Package: {pq.packageTitle}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {pq.desiredCountries.map((c) => (
                      <Pill key={c} tone="blue">{c}</Pill>
                    ))}
                    {pq.desiredDays && <Pill tone="slate">{pq.desiredDays}</Pill>}
                  </div>

                  {pq.desiredServices.length > 0 && (
                    <p className="text-[11px] text-slate-600 dark:text-slate-300">
                      Services: <b>{pq.desiredServices.join(' · ')}</b>
                    </p>
                  )}
                  {pq.notes && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 italic break-words">
                      “{pq.notes}”
                    </p>
                  )}
                </div>

                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
                  <span>{fmtDateTime(pq.createdAt)}</span>
                  <div className="flex items-center gap-1.5">
                    <select
                      aria-label={`Status for portal query ${pq.queryRef}`}
                      className={`${inputCls} !w-auto !py-0.5 !px-2 !text-[11px] font-semibold`}
                      value={pq.status}
                      onChange={(e) =>
                        void updatePortalQueryStatus(pq, e.target.value as CrmPortalQuery['status'])
                      }
                    >
                      <option value="new">New Inquiry</option>
                      <option value="contacted">Representative Contacted</option>
                      <option value="quoted">Quote Sent</option>
                      <option value="won">Won (booked)</option>
                      <option value="lost">Lost</option>
                      <option value="closed">Closed</option>
                    </select>
                    {seesAll && (
                      <button
                        type="button"
                        onClick={() => void removePortalQuery(pq)}
                        className="text-slate-400 hover:text-rose-600 cursor-pointer p-1"
                        title={`Delete query ${pq.queryRef}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

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
