import React,{useState} from 'react';
import {KeyRound,ShieldCheck,UserRound,Image as ImageIcon,Sparkles,Save} from 'lucide-react';
import {Employee} from '../../types';
import {getSessionToken} from '../../lib/storage';
import {AvatarEditor} from "./AvatarEditor";
import {ProfilePicturePicker} from "../../lib/profilePictures";
import {EmployeeAvatar} from '../common/EmployeeIdentity';
import {roleCanWear} from '../../lib/avatarWardrobe.js';

const ROLE_LABEL:Record<string,string>={admin:'Admin',ceo:'CEO',accounts:'Accounts Officer',employee:'Employee'};
const ROLE_TINT:Record<string,string>={admin:'from-violet-600 via-indigo-600 to-blue-600',ceo:'from-amber-500 via-orange-500 to-rose-500',accounts:'from-emerald-600 via-teal-600 to-cyan-600',employee:'from-blue-600 via-indigo-600 to-violet-600'};

/** Drops any role-only item this person may no longer wear (for example after a role change). */
function allowedLook(look:Record<string,string>,role:string,superAdmin:boolean){
  return Object.fromEntries(Object.entries(look).filter(([k,v])=>roleCanWear(role,k,v,superAdmin)));
}

export function EmployeeProfileTab({employee,onSaved,beta,onOpenChangePassword}:{beta:boolean;employee:Employee;onSaved:(profile:Partial<Employee>)=>void;onOpenChangePassword?:()=>void}){
  const role=employee.role||'employee', superAdmin=employee.isSuperAdmin===true;
  const [form,setForm]=useState({name:employee.name,email:employee.email,phone:employee.phone,department:employee.department,designation:employee.designation});
  const [characterId,setCharacterId]=useState(employee.gameCharacterId||'human-1');
  const [petId,setPetId]=useState(employee.gamePetId||'none');
  const [appearance,setAppearance]=useState<Record<string,string>>(allowedLook(employee.avatarAppearance||{},role,superAdmin));
  const [photo,setPhoto]=useState<string>(()=>{const p=employee.avatarAppearance?.photo||'None';return roleCanWear(role,'photo',p,superAdmin)?p:'None';});
  const [busy,setBusy]=useState(false);const [notice,setNotice]=useState('');const [error,setError]=useState('');
  const save=async(e:React.FormEvent)=>{
    e.preventDefault();setBusy(true);setNotice('');setError('');
    try{
      const look=allowedLook({...appearance,photo},role,superAdmin);
      const response=await fetch('/api/universe',{method:'POST',headers:{'Content-Type':'application/json','x-session-token':getSessionToken()||''},body:JSON.stringify({action:'profile',photo,...(beta?{characterId,petId,appearance:look}:{}),profile:form})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Profile could not be saved.');
      onSaved({...form,avatarAppearance:{...(beta?look:(employee.avatarAppearance||{})),photo},...(beta?{gameCharacterId:characterId,gamePetId:petId==='none'?undefined:petId}:{})});setNotice('Profile saved ✓');
    }catch(err){setError(err instanceof Error?err.message:'Profile could not be saved.');}finally{setBusy(false);}
  };
  const field=(key:keyof typeof form,label:string,type='text')=><label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">{label}<input type={type} maxLength={key==='email'?254:100} value={form[key]} onChange={e=>setForm(v=>({...v,[key]:e.target.value}))} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm text-slate-900 transition focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/15 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100" /></label>;
  const card='profile-rise rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900';
  const previewLook={...appearance,photo};
  return <form onSubmit={save} className="mx-auto max-w-5xl space-y-4 sm:space-y-5 pb-20">
    {/* Compact identity hero */}
    <header className={`profile-rise relative overflow-hidden rounded-2xl bg-gradient-to-r ${ROLE_TINT[role]||ROLE_TINT.employee} p-5 text-white shadow-md`}>
      <div className="pointer-events-none absolute -right-10 -top-12 h-44 w-44 rounded-full bg-white/10 blur-sm" aria-hidden/>
      <div className="relative flex flex-wrap items-center gap-4">
        <div className="profile-float"><EmployeeAvatar characterId={characterId} petId={petId} appearance={previewLook} name={form.name} size="lg"/></div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/75">My profile</p>
          <h1 className="truncate text-2xl font-black leading-tight">{form.name||employee.name}</h1>
          <p className="mt-0.5 text-xs text-white/85">{form.designation||'Team member'} · {form.department} · {employee.employeeCode}</p>
        </div>
        <span className="rounded-full border border-white/30 bg-white/15 px-3 py-1 text-[11px] font-black uppercase tracking-wider">{ROLE_LABEL[role]||role}{superAdmin?' · Super Admin':''}</span>
      </div>
    </header>

    <div className="grid gap-4 sm:gap-5 lg:grid-cols-[1.4fr_1fr]">
      <section className={card}>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold"><UserRound className="h-4 w-4 text-blue-600"/>Contact details</h2>
        <div className="grid content-start gap-3 sm:grid-cols-2">{field('name','Full name')}{field('email','Email','email')}{field('phone','Phone')}{field('department','Department')}{field('designation','Job title')}</div>
      </section>
      {/* Password lives here now, together with the rest of the profile. */}
      <section className={card}>
        <h2 className="mb-1 flex items-center gap-2 text-sm font-bold"><ShieldCheck className="h-4 w-4 text-emerald-600"/>Login & security</h2>
        <p className="mb-4 text-xs text-slate-500">Keep your account safe. Change your password or PIN any time.</p>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-800/50">
          <div className="flex justify-between"><span className="text-slate-500">Employee code</span><span className="font-mono font-bold">{employee.employeeCode}</span></div>
          <div className="mt-1.5 flex justify-between"><span className="text-slate-500">Password</span><span className="font-mono tracking-widest">••••••••</span></div>
        </div>
        {onOpenChangePassword&&<button type="button" onClick={onOpenChangePassword} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md active:scale-[.98]"><KeyRound className="h-4 w-4"/>Change password</button>}
      </section>
    </div>

    <section className={card}><h2 className="flex items-center gap-2 text-sm font-bold"><ImageIcon className="h-4 w-4 text-pink-600"/>Profile picture</h2><p className="mb-4 mt-1 text-xs text-slate-500">Shown next to your name across the app.</p><ProfilePicturePicker value={photo} onChange={setPhoto} role={role} isSuperAdmin={superAdmin}/></section>
    {beta && <div className="profile-rise"><AvatarEditor id={characterId} pet={petId} value={appearance} onChange={setAppearance} onId={setCharacterId} onPet={setPetId} role={role} isSuperAdmin={superAdmin}/></div>}
    {!beta && <p className="flex items-center gap-2 text-xs text-slate-500"><Sparkles className="h-3.5 w-3.5"/>The 3D avatar studio appears when Employee Universe is switched on.</p>}

    {/* Sticky save bar so Save is always in reach on phones */}
    <div className="sticky bottom-3 z-20 flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
      <span role="status" className={`text-sm font-semibold ${error?'text-rose-600':'text-emerald-700 dark:text-emerald-400'}`}>{notice||error||<span className="font-normal text-slate-500">Changes save when you tap Save.</span>}</span>
      <button disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-blue-700 disabled:opacity-60"><Save className="h-4 w-4"/>{busy?'Saving…':'Save profile'}</button>
    </div>
  </form>;
}
