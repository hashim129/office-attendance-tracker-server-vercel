import React,{useCallback,useEffect,useState} from 'react';
import {AlertTriangle,ShieldCheck,UserX,RefreshCw} from 'lucide-react';
import type {Role} from '../../types';
import {getSessionToken} from '../../lib/storage';
import {PAGE_ACCESS_OPTIONS} from '../../lib/pageAccess';

type Staff={id:string;employeeCode:string;name:string;email:string;role:Role;isActive:boolean;featureAccess:Record<string,boolean>};
export function SuperAdminTab(){
  const [staff,setStaff]=useState<Staff[]>([]);const [siteDisabled,setSiteDisabled]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const load=useCallback(async()=>{
    setBusy(true);setError('');
    try{const r=await fetch('/api/superadmin',{headers:{'x-session-token':getSessionToken()||''},cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not load controls.');setStaff(d.employees);setSiteDisabled(d.siteDisabled===true);}
    catch(e){setError(e instanceof Error?e.message:'Could not load controls.');}finally{setBusy(false);}
  },[]);
  useEffect(()=>{void load();},[load]);
  const act=async(body:Record<string,unknown>)=>{
    setError('');
    try{const r=await fetch('/api/superadmin',{method:'POST',headers:{'Content-Type':'application/json','x-session-token':getSessionToken()||''},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error||'Change failed.');if(body.action==='site-status'){const disabled=d.siteDisabled===true;if(disabled)localStorage.setItem('office_site_disabled_v1','true');else localStorage.removeItem('office_site_disabled_v1');window.dispatchEvent(new CustomEvent('office-site-status-changed',{detail:disabled}));}await load();}
    catch(e){setError(e instanceof Error?e.message:'Change failed.');}
  };
  return <div className="mx-auto max-w-7xl space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2"><ShieldCheck className="h-6 w-6 text-violet-600"/><h1 className="text-2xl font-black">Super Admin Console</h1></div><p className="mt-1 text-sm text-slate-500">Manage site availability, employee roles and page access.</p></div><button onClick={()=>void load()} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"><RefreshCw className={`h-4 w-4 ${busy?'animate-spin':''}`}/>Refresh</button></header>
    {error&&<p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    <section className={`flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-5 ${siteDisabled?'border-rose-300 bg-rose-50 dark:bg-rose-950/30':'border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20'}`}>
      <div className="flex items-start gap-3"><AlertTriangle className={`mt-0.5 h-5 w-5 ${siteDisabled?'text-rose-600':'text-emerald-600'}`}/><div><h2 className="font-bold">Live website {siteDisabled?'disabled':'available'}</h2><p className="text-sm text-slate-600 dark:text-slate-300">Disabling blocks employee sessions and app APIs. Super Admin sign-in remains available to restore access.</p></div></div>
      <button onClick={()=>void act({action:'site-status',disabled:!siteDisabled})} disabled={busy} className={`rounded-xl px-4 py-2 text-sm font-bold text-white ${siteDisabled?'bg-emerald-700 hover:bg-emerald-800':'bg-rose-700 hover:bg-rose-800'}`}>{siteDisabled?'Restore website':'Disable live website'}</button>
    </section>
    <section className="space-y-4">{staff.map(person=><article key={person.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold">{person.name}</h2><p className="text-xs text-slate-500">{person.employeeCode} · {person.email||'No email'} · {person.isActive?'Active':'Disabled'}</p></div><div className="flex flex-wrap items-center gap-2"><label className="text-xs font-semibold">Role <select value={person.role} onChange={e=>void act({action:'employee-role',employeeId:person.id,role:e.target.value})} className="ml-1 rounded border px-2 py-1 dark:bg-slate-900"><option value="employee">Employee</option><option value="accounts">Accounts</option><option value="admin">Admin</option><option value="ceo">CEO</option></select></label><button onClick={()=>void act({action:'employee-status',employeeId:person.id,enabled:!person.isActive})} className="rounded-lg border px-3 py-1.5 text-xs font-semibold">{person.isActive?'Disable account':'Enable account'}</button><button onClick={()=>{if(window.confirm(`Remove ${person.name} from active employee records? Existing financial and attendance history will be retained.`))void act({action:'employee-remove',employeeId:person.id});}} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700"><UserX className="h-3.5 w-3.5"/>Remove</button></div></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{PAGE_ACCESS_OPTIONS.map(page=><label key={page.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800/70"><span>{page.label}</span><input aria-label={`${page.label} access for ${person.name}`} type="checkbox" checked={person.featureAccess?.[page.id]!==false} onChange={e=>void act({action:'page-access',employeeId:person.id,page:page.id,enabled:e.target.checked})} className="h-4 w-4 accent-violet-600"/></label>)}</div>
    </article>)}</section>
    <p className="text-xs text-slate-500">Removed employee accounts are soft-deleted. Attendance, finance and audit history remains intact.</p>
  </div>;
}
