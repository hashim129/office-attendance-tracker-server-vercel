import React,{useState} from 'react';
import {Employee} from '../../types';
import {getSessionToken} from '../../lib/storage';
import {GAME_CHARACTERS,GAME_PETS} from '../common/EmployeeIdentity';
import {AvatarStage} from './UniverseOffice';

export function EmployeeProfileTab({employee,onSaved}:{employee:Employee;onSaved:(profile:Partial<Employee>)=>void}){
  const [form,setForm]=useState({name:employee.name,email:employee.email,phone:employee.phone,department:employee.department,designation:employee.designation});
  const [characterId,setCharacterId]=useState(employee.gameCharacterId||'human-1');
  const [petId,setPetId]=useState(employee.gamePetId||'none');
  const [busy,setBusy]=useState(false);const [notice,setNotice]=useState('');const [error,setError]=useState('');
  const save=async(e:React.FormEvent)=>{
    e.preventDefault();setBusy(true);setNotice('');setError('');
    try{
      const response=await fetch('/api/universe',{method:'POST',headers:{'Content-Type':'application/json','x-session-token':getSessionToken()||''},body:JSON.stringify({action:'profile',characterId,petId,profile:form})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Profile could not be saved.');
      onSaved({...form,gameCharacterId:characterId,gamePetId:petId==='none'?undefined:petId});setNotice('Profile saved.');
    }catch(err){setError(err instanceof Error?err.message:'Profile could not be saved.');}finally{setBusy(false);}
  };
  const field=(key:keyof typeof form,label:string,type='text')=><label className="block text-sm font-semibold">{label}<input type={type} maxLength={key==='email'?254:100} value={form[key]} onChange={e=>setForm(v=>({...v,[key]:e.target.value}))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" /></label>;
  return <form onSubmit={save} className="mx-auto max-w-5xl space-y-5">
    <header><h1 className="text-2xl font-black">My Employee Profile</h1><p className="mt-1 text-sm text-slate-500">Update your contact details and Employee Universe character.</p></header>
    <section className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 md:grid-cols-[220px_1fr]">
      <div><AvatarStage id={characterId} animated label="Your 3D avatar preview"/><p className="mt-2 text-center text-sm font-bold">{employee.name}</p><select value={petId} onChange={e=>setPetId(e.target.value)} className="mt-2 w-full rounded-lg border p-2 text-sm dark:bg-slate-900">{GAME_PETS.map(p=><option key={p.id} value={p.id}>{p.emoji} {p.name}</option>)}</select></div>
      <div className="grid content-start gap-3 sm:grid-cols-2">{field('name','Full name')}{field('email','Email','email')}{field('phone','Phone')}{field('department','Department')}{field('designation','Job title')}</div>
    </section>
    <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><h2 className="mb-4 font-bold">Choose your character</h2><div className="grid grid-cols-3 gap-3 sm:grid-cols-5 md:grid-cols-7">{GAME_CHARACTERS.map(c=><button key={c.id} type="button" onClick={()=>setCharacterId(c.id)} className={`rounded-xl border p-2 text-xs ${characterId===c.id?'border-violet-500 bg-violet-50 ring-2 ring-violet-300 dark:bg-violet-950/30':'border-slate-200 dark:border-slate-700'}`}><AvatarStage id={c.id} label={c.name}/><span className="mt-1 block truncate font-bold">{c.name}</span></button>)}</div></section>
    <div className="flex items-center justify-between"><span role="status" className="text-sm text-emerald-700">{notice||error}</span><button disabled={busy} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60">{busy?'Saving…':'Save profile'}</button></div>
  </form>;
}
