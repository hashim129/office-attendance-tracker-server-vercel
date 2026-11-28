import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Calendar, Copy, FileText, Pencil, Plus, Search, Trash2, Users, X } from 'lucide-react';
import type { Employee } from '../types';
import { crmCall } from './crmApi';
import type { CrmCustomer, CrmInvoice } from './crmApi';
import { btnDanger, btnGhost, btnPrimary, cardCls, inputCls } from './ui';

/** Group bookings (e.g. "Umrah Dec batch"): the travellers, their invoices and what is still to be received. */
interface Group { id: string; name: string; travelDate: string | null; notes: string; customerIds: string[]; invoiceIds: string[]; createdBy: string | null; createdByName: string; createdAt: string; updatedAt: string }
interface Member { id: string; name: string; companyName: string; phone: string }
interface GInvoice { id: string; invoiceNo: string; customerName: string; customerPhone: string; currency: string; total: number; received: number; balance: number; status: string; cancelled: boolean; travelDate: string | null }
interface Total { currency: string; total: number; received: number; balance: number; count: number }
interface Detail { group: Group; members: Member[]; invoices: GInvoice[]; totals: Total[] }
type Form = { id?: string; name: string; travelDate: string; notes: string; customerIds: string[]; invoiceIds: string[] };

const money = (c: string, n: number) => `${c} ${Math.round(n).toLocaleString()}`;
const niceDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const todayPkt = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    try {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); const okCopy = document.execCommand('copy'); ta.remove(); return okCopy;
    } catch { return false; }
  }
}
/** Numbers as WhatsApp likes them: 03001234567 -> 923001234567. */
const waNumber = (p: string) => { const d = p.replace(/\D/g, ''); return d.startsWith('00') ? d.slice(2) : d.startsWith('0') ? `92${d.slice(1)}` : d; };

export const GroupsView: React.FC<{ currentUser: Employee }> = ({ currentUser }) => {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const [err, setErr] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  // customers and invoices to pick from (the same list the CRM pages use)
  const [pool, setPool] = useState<{ customers: CrmCustomer[]; invoices: CrmInvoice[] } | null>(null);
  const [custQ, setCustQ] = useState('');
  const [invQ, setInvQ] = useState('');

  const load = () => crmCall<{ groups: Group[]; canCreate: boolean }>('people_group_list')
    .then((r) => { setGroups(r.groups); setCanCreate(r.canCreate); setErr(''); })
    .catch((e) => { setGroups([]); setErr(e?.message || 'Could not load the groups.'); });
  const loadDetail = (gid: string) => crmCall<Detail>('people_group_detail', { id: gid })
    .then((r) => { setDetail(r); setErr(''); })
    .catch((e) => setErr(e?.message || 'Could not open the group.'));
  useEffect(() => { void load(); }, []);
  useEffect(() => { setDetail(null); if (openId) void loadDetail(openId); }, [openId]);

  const startEdit = (g?: Group) => {
    setForm(g ? { id: g.id, name: g.name, travelDate: g.travelDate || '', notes: g.notes, customerIds: [...g.customerIds], invoiceIds: [...g.invoiceIds] } : { name: '', travelDate: '', notes: '', customerIds: [], invoiceIds: [] });
    setCustQ(''); setInvQ('');
    if (!pool) crmCall<{ customers: CrmCustomer[]; invoices: CrmInvoice[] }>('list').then((r) => setPool({ customers: r.customers || [], invoices: (r.invoices || []).filter((i) => i.kind !== 'vendor') })).catch((e) => setErr(e?.message || 'Could not load customers.'));
  };
  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const r = await crmCall<{ group: Group }>('people_group_save', { group: form });
      setForm(null);
      await load();
      setOpenId(r.group.id);
      if (openId === r.group.id) void loadDetail(r.group.id);
    } catch (e: any) { setErr(e?.message || 'Could not save the group.'); } finally { setBusy(false); }
  };
  const remove = async (g: Group) => {
    if (!window.confirm(`Delete the group “${g.name}”? The customers and invoices stay as they are.`)) return;
    try { await crmCall('people_group_delete', { id: g.id }); setOpenId(null); await load(); } catch (e: any) { setErr(e?.message || 'Could not delete the group.'); }
  };
  const copyNumbers = async () => {
    if (!detail) return;
    const nums = [...new Set([...detail.members.map((m) => m.phone), ...detail.invoices.map((i) => i.customerPhone)].map((p) => waNumber(p || '')).filter((p) => p.length >= 10))];
    if (!nums.length) { setNote('No phone numbers saved for these members.'); return; }
    setNote((await copyText(nums.join('\n'))) ? `${nums.length} WhatsApp number${nums.length === 1 ? '' : 's'} copied.` : 'Could not copy. Please try again.');
    window.setTimeout(() => setNote(''), 4000);
  };

  // pickers
  const custById = useMemo(() => new Map((pool?.customers || []).map((c) => [c.id, c])), [pool]);
  const invById = useMemo(() => new Map((pool?.invoices || []).map((i) => [i.id, i])), [pool]);
  const custHits = useMemo(() => {
    const q = custQ.trim().toLowerCase();
    if (!pool || !form || q.length < 2) return [];
    return pool.customers.filter((c) => !form.customerIds.includes(c.id) && `${c.customerName} ${c.companyName} ${c.customerNumber}`.toLowerCase().includes(q)).slice(0, 8);
  }, [custQ, pool, form]);
  const invHits = useMemo(() => {
    const q = invQ.trim().toLowerCase();
    if (!pool || !form || q.length < 2) return [];
    return pool.invoices.filter((i) => i.status !== 'cancelled' && !form.invoiceIds.includes(i.id) && `${i.invoiceNo} ${i.customerName} ${i.customerPhone} ${i.crmId}`.toLowerCase().includes(q)).slice(0, 8);
  }, [invQ, pool, form]);
  const nameOfCust = (cid: string) => custById.get(cid)?.customerName || detail?.members.find((m) => m.id === cid)?.name || 'Customer';
  const labelOfInv = (iid: string) => { const i = invById.get(iid) || detail?.invoices.find((x) => x.id === iid); return i ? `${i.invoiceNo} · ${i.customerName}` : 'Invoice'; };

  const today = todayPkt();
  const open = groups?.find((g) => g.id === openId) || null;

  // ------------------------------------------------------------ form
  if (form) {
    return (
      <div className="space-y-3" data-groups-form>
        <div className={`${cardCls} p-4 space-y-3`}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{form.id ? 'Edit group' : 'New group booking'}</h2>
            <button className={`${btnGhost} min-h-10 sm:min-h-0`} onClick={() => setForm(null)}><X className="w-3.5 h-3.5" /> Close</button>
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="block"><span className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Group name</span>
              <input className={inputCls} value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Umrah Dec batch" /></label>
            <label className="block"><span className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Travel date</span>
              <input type="date" className={inputCls} value={form.travelDate} onChange={(e) => setForm({ ...form, travelDate: e.target.value })} /></label>
          </div>
          <label className="block"><span className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Notes</span>
            <textarea className={inputCls} rows={2} maxLength={1000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Flights, hotel, meeting point …" /></label>

          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">Members ({form.customerIds.length})</p>
            <div className="flex flex-wrap gap-1.5">
              {form.customerIds.map((cid) => (
                <span key={cid} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-blue-50 dark:bg-blue-950/40 text-[11px] text-blue-800 dark:text-blue-200">
                  {nameOfCust(cid)}
                  <button type="button" className="w-7 h-7 inline-flex items-center justify-center rounded-full hover:bg-blue-100 dark:hover:bg-blue-900" aria-label="Remove" onClick={() => setForm({ ...form, customerIds: form.customerIds.filter((x) => x !== cid) })}><X className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input className={`${inputCls} pl-8 min-h-10`} value={custQ} onChange={(e) => setCustQ(e.target.value)} placeholder={pool ? 'Search customers by name or phone to add' : 'Loading customers…'} disabled={!pool} />
            </div>
            {custHits.length > 0 && (
              <ul className="rounded-lg border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                {custHits.map((c) => (
                  <li key={c.id}><button type="button" className="w-full text-left px-3 py-2 min-h-10 text-xs hover:bg-slate-50 dark:hover:bg-slate-800" onClick={() => { setForm({ ...form, customerIds: [...form.customerIds, c.id] }); setCustQ(''); }}>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{c.customerName}</span>{c.companyName && <span className="text-slate-500"> · {c.companyName}</span>}{c.customerNumber && <span className="text-slate-500 font-mono"> · {c.customerNumber}</span>}
                  </button></li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">Invoices ({form.invoiceIds.length})</p>
            <div className="flex flex-wrap gap-1.5">
              {form.invoiceIds.map((iid) => (
                <span key={iid} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-[11px] text-slate-700 dark:text-slate-200">
                  {labelOfInv(iid)}
                  <button type="button" className="w-7 h-7 inline-flex items-center justify-center rounded-full hover:bg-slate-200 dark:hover:bg-slate-700" aria-label="Remove" onClick={() => setForm({ ...form, invoiceIds: form.invoiceIds.filter((x) => x !== iid) })}><X className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input className={`${inputCls} pl-8 min-h-10`} value={invQ} onChange={(e) => setInvQ(e.target.value)} placeholder={pool ? 'Search invoices by number or customer to add' : 'Loading invoices…'} disabled={!pool} />
            </div>
            {invHits.length > 0 && (
              <ul className="rounded-lg border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                {invHits.map((i) => (
                  <li key={i.id}><button type="button" className="w-full text-left px-3 py-2 min-h-10 text-xs hover:bg-slate-50 dark:hover:bg-slate-800" onClick={() => { setForm({ ...form, invoiceIds: [...form.invoiceIds, i.id] }); setInvQ(''); }}>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{i.invoiceNo}</span><span className="text-slate-500"> · {i.customerName} · {money(i.currency, i.total)}</span>
                  </button></li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex gap-2 justify-end">
            <button className={`${btnGhost} min-h-10 sm:min-h-0`} onClick={() => setForm(null)} disabled={busy}>Cancel</button>
            <button className={`${btnPrimary} min-h-10 sm:min-h-0`} onClick={() => void save()} disabled={busy || !form.name.trim()}>{busy ? 'Saving…' : 'Save group'}</button>
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------ detail
  if (openId) {
    return (
      <div className="space-y-3" data-group-detail>
        <div className={`${cardCls} p-4 space-y-3`}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <button className="text-xs text-blue-600 inline-flex items-center gap-1 min-h-10 sm:min-h-0" onClick={() => setOpenId(null)}><ArrowLeft className="w-3.5 h-3.5" /> All groups</button>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 break-words">{detail?.group.name || open?.name || 'Group'}</h2>
              <p className="text-xs text-slate-500">
                {(detail?.group.travelDate || open?.travelDate) ? `Travels ${niceDate((detail?.group.travelDate || open?.travelDate) as string)}` : 'No travel date yet'}
                {detail?.group.createdByName ? ` · made by ${detail.group.createdByName}` : ''}
              </p>
              {detail?.group.notes && <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 whitespace-pre-line break-words">{detail.group.notes}</p>}
            </div>
            {detail && (
              <div className="flex flex-wrap gap-2 shrink-0">
                <button className={`${btnPrimary} min-h-10 sm:min-h-0`} onClick={() => void copyNumbers()}><Copy className="w-3.5 h-3.5" /> Copy WhatsApp numbers</button>
                <button className={`${btnGhost} min-h-10 sm:min-h-0`} onClick={() => startEdit(detail.group)}><Pencil className="w-3.5 h-3.5" /> Edit</button>
                <button className={`${btnDanger} min-h-10 sm:min-h-0`} onClick={() => void remove(detail.group)}><Trash2 className="w-3.5 h-3.5" /> Delete</button>
              </div>
            )}
          </div>
          {note && <p className="text-xs text-emerald-700 dark:text-emerald-400">{note}</p>}
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>

        {!detail ? (
          <div className="space-y-2" aria-label="Loading">{[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />)}</div>
        ) : (
          <>
            {detail.totals.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {detail.totals.map((t) => (
                  <div key={t.currency} className={`${cardCls} p-3`}>
                    <p className="text-[11px] text-slate-500">{t.currency} · {t.count} invoice{t.count === 1 ? '' : 's'}</p>
                    <p className="text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">{money(t.currency, t.total)}</p>
                    <p className="text-[11px] text-slate-500">Received <b className="text-emerald-600 tabular-nums">{money(t.currency, t.received)}</b> · Balance <b className={`tabular-nums ${t.balance > 0 ? 'text-amber-600' : 'text-slate-500'}`}>{money(t.currency, t.balance)}</b></p>
                  </div>
                ))}
              </div>
            )}
            <div className={`${cardCls} p-3 sm:p-4`}>
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-2 inline-flex items-center gap-1.5"><Users className="w-3.5 h-3.5 text-blue-600" /> Members ({detail.members.length})</h3>
              {detail.members.length === 0 ? <p className="text-xs text-slate-500">No members yet. Tap Edit to add customers.</p> : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {detail.members.map((m) => (
                    <li key={m.id} className="py-2 flex items-center justify-between gap-2">
                      <div className="min-w-0"><p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">{m.name}</p>{m.companyName && <p className="text-[11px] text-slate-500 truncate">{m.companyName}</p>}</div>
                      {m.phone ? <a className="text-xs font-mono text-blue-600 shrink-0 min-h-10 sm:min-h-0 inline-flex items-center" href={`https://wa.me/${waNumber(m.phone)}`} target="_blank" rel="noreferrer">{m.phone}</a> : <span className="text-[11px] text-slate-400">No phone</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className={`${cardCls} p-3 sm:p-4`}>
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-2 inline-flex items-center gap-1.5"><FileText className="w-3.5 h-3.5 text-blue-600" /> Invoices ({detail.invoices.length})</h3>
              {detail.invoices.length === 0 ? <p className="text-xs text-slate-500">No invoices yet. Tap Edit to add them.</p> : (
                <ul className="space-y-2">
                  {detail.invoices.map((i) => (
                    <li key={i.id} className={`rounded-lg border border-slate-200 dark:border-slate-800 p-2.5 grid grid-cols-2 sm:grid-cols-5 gap-x-3 gap-y-1 items-center ${i.cancelled ? 'opacity-60' : ''}`}>
                      <div className="col-span-2 sm:col-span-2 min-w-0">
                        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{i.invoiceNo}{i.cancelled && <span className="ml-1.5 text-[10px] text-red-600 font-semibold">Cancelled</span>}</p>
                        <p className="text-[11px] text-slate-500 truncate">{i.customerName}</p>
                      </div>
                      <p className="text-[11px] text-slate-500">Total<br /><b className="text-slate-900 dark:text-slate-100 tabular-nums">{money(i.currency, i.total)}</b></p>
                      <p className="text-[11px] text-slate-500">Received<br /><b className="text-emerald-600 tabular-nums">{money(i.currency, i.received)}</b></p>
                      <p className="text-[11px] text-slate-500">Balance<br /><b className={`tabular-nums ${i.balance > 0 && !i.cancelled ? 'text-amber-600' : 'text-slate-500'}`}>{money(i.currency, i.balance)}</b></p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------ list
  return (
    <div className="space-y-4" data-groups-view>
      <div className={`${cardCls} p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}>
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Group bookings</h2>
          <p className="text-xs text-slate-500">Keep a batch of travellers together: members, their invoices and what is still to be received.</p>
        </div>
        {canCreate && <button className={`${btnPrimary} min-h-10 sm:min-h-0`} onClick={() => startEdit()}><Plus className="w-3.5 h-3.5" /> New group</button>}
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}
      {groups === null ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" aria-label="Loading">{[0, 1, 2].map((i) => <div key={i} className="h-28 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />)}</div>
      ) : groups.length === 0 ? (
        <div className={`${cardCls} p-8 text-center`}>
          <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">No groups yet</p>
          <p className="text-xs text-slate-500 mt-1">{canCreate ? 'Make one for your next Umrah or tour batch.' : 'Groups need sales access. Ask Admin to switch it on for you.'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {groups.map((g) => {
            const past = g.travelDate && g.travelDate < today;
            return (
              <button key={g.id} type="button" onClick={() => setOpenId(g.id)} className={`${cardCls} p-4 text-left hover:border-blue-300 dark:hover:border-blue-800 transition-colors cursor-pointer`}>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 break-words">{g.name}</p>
                <p className={`text-xs mt-1 inline-flex items-center gap-1 ${past ? 'text-slate-400' : 'text-blue-700 dark:text-blue-300'}`}><Calendar className="w-3.5 h-3.5" /> {g.travelDate ? `${past ? 'Travelled' : 'Travels'} ${niceDate(g.travelDate)}` : 'No travel date'}</p>
                <p className="text-[11px] text-slate-500 mt-2">{g.customerIds.length} member{g.customerIds.length === 1 ? '' : 's'} · {g.invoiceIds.length} invoice{g.invoiceIds.length === 1 ? '' : 's'}{g.createdBy !== currentUser.id && g.createdByName ? ` · by ${g.createdByName}` : ''}</p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default GroupsView;
