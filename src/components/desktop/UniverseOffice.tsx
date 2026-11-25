import React, {useEffect, useMemo, useRef, useState} from 'react';
import type {Employee, AttendanceRecord, OfficeSettings} from '../../types';
import {deriveLiveAttendanceState, getTodayDateString} from '../../lib/attendanceCalculations';
import {studio, pose, paint, ARRIVE_MS, CLOSE_MS, LEAVE_MS, officeSky} from '../../lib/universeScene.js';
import {getSessionToken} from '../../lib/storage';
import {GAME_PETS} from '../common/EmployeeIdentity';

export type Phase = 'portrait'|'arriving'|'working'|'sleeping'|'coffee'|'closing'|'leaving'|'away'|'wave'|'dance'|'walk';
type StageProps = {id:string;phase?:Phase;animated?:boolean;label?:string;appearance?:Record<string,string>;angle?:number;closeup?:boolean;stage?:boolean;hd?:boolean;canvasRef?:React.RefObject<HTMLCanvasElement|null>};
export function AvatarStage({id,phase='portrait',animated=false,label=id,appearance,angle=0,closeup=false,stage,hd=false,canvasRef}: StageProps){
  const own=useRef<HTMLCanvasElement>(null);
  const ref=canvasRef||own;
  // "stage" = studio framing without the desk (avatar editor, profile pictures).
  const portrait=stage ?? phase==='portrait';
  const appearanceKey=JSON.stringify(appearance||{});
  const rig=useMemo(()=>studio(id,portrait,appearance),[id,portrait,appearanceKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{
    const canvas=ref.current;
    if(!canvas) return;
    const start=performance.now(), reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let timer=0,visible=false;
    function draw(){
      if(!canvas||!visible||document.hidden) return;
      const t=reduce?(phase==='arriving'?2.95:1.65):(performance.now()-start)/1000;
      pose(rig,phase,t);
      if(portrait){rig.body.rotation.y+=angle;rig.closeup=closeup;rig.camera.lookAt(0,closeup?1.94:1.23,0);}
      paint(canvas,rig);
      if(animated&&!reduce&&phase!=='away') timer=window.setTimeout(draw,canvas.hidden?220:66);
    }
    function refresh(){window.clearTimeout(timer);draw();}
    const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;refresh();});
    observer.observe(canvas.parentElement!); document.addEventListener('visibilitychange',refresh);
    return ()=>{observer.disconnect();window.clearTimeout(timer);document.removeEventListener('visibilitychange',refresh);canvas.parentElement?.querySelector('svg')?.remove();canvas.hidden=false;};
  },[phase,rig,animated,angle,closeup,portrait,ref]);
  const w=portrait?(animated?480:112):hd?840:420, h=portrait?(animated?400:112):hd?488:244;
  return <span className="block overflow-hidden rounded-xl" role="img" aria-label={label}><canvas ref={ref} width={w} height={h} className="w-full"/></span>;
}

type Worker={e:Employee;live:string};
const labels:Record<Phase,string>={portrait:'Avatar',arriving:'Arriving',working:'Working',sleeping:'Connection lost',coffee:'On a break',closing:'Closing laptop',leaving:'Heading out',away:'Away',wave:'Waving',dance:'Dancing',walk:'Walking'};
function greeting(){
  let h=12; try{h=Number(new Intl.DateTimeFormat('en-GB',{hour:'numeric',hour12:false,timeZone:'Asia/Karachi'}).format(new Date()));}catch{/* default */}
  return h<12?'Good morning! ☀️':h<17?'Hello, team! 👋':'Good evening! 🌙';
}
function bubbleFor(phase:Phase,status?:string){
  if(phase==='arriving') return greeting();
  if(phase==='leaving'||phase==='closing') return 'See you tomorrow! 👋';
  if(phase==='coffee') return 'Coffee time ☕';
  if(phase==='sleeping') return 'Zzz… reconnecting';
  if(phase==='working'&&status&&status!=='None') return status;
  return '';
}
/** Remembers per browser tab whether we already showed this person walking in today. */
function seenState(id:string){
  const key='universe-desk:'+id+':'+getTodayDateString();
  return {get:()=>{try{return sessionStorage.getItem(key);}catch{return null;}},set:(v:string)=>{try{sessionStorage.setItem(key,v);}catch{/* private mode */}}};
}
function Desk({worker,hd=false,onWave,waved}:{worker:Worker;hd?:boolean;onWave?:()=>void;waved?:boolean}){
  const {e,live}=worker;
  const active=['in','break','no_internet'].includes(live);
  const settled:Phase=live==='break'?'coffee':live==='no_internet'?'sleeping':active?'working':'away';
  const [transition,setTransition]=useState<Phase|null>(null);
  const previous=useRef<boolean|null>(null);
  useEffect(()=>{
    const memory=seenState(e.id);
    const was=previous.current===null?memory.get()==='in':previous.current;
    const firstRun=previous.current===null;
    previous.current=active; memory.set(active?'in':'out');
    const timers:number[]=[];
    if(active&&!was){setTransition('arriving');timers.push(window.setTimeout(()=>setTransition(null),ARRIVE_MS));}
    else if(!active&&was&&!firstRun){setTransition('closing');timers.push(window.setTimeout(()=>setTransition('leaving'),CLOSE_MS),window.setTimeout(()=>setTransition(null),CLOSE_MS+LEAVE_MS));}
    else setTransition(null);
    return ()=>timers.forEach(clearTimeout);
  },[active,e.id]);
  const phase=transition||settled, pet=GAME_PETS.find(p=>p.id===e.gamePetId&&p.id!=='none');
  const id=e.gameCharacterId||'human-'+(1+[...e.id].reduce((n,c)=>n+c.charCodeAt(0),0)%54);
  const status=e.avatarAppearance?.status;
  const bubble=bubbleFor(phase,status);
  return <article data-phase={phase} className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:bg-slate-900 dark:border-slate-700">
    <AvatarStage id={id} appearance={e.avatarAppearance} phase={phase} animated hd={hd} label={e.name+' · '+labels[phase]}/>
    {bubble&&<span key={bubble} className="universe-bubble absolute left-1/2 top-2 max-w-[85%] -translate-x-1/2 truncate rounded-full bg-white/95 px-3 py-1 text-[11px] font-bold text-slate-800 shadow-md ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700">{bubble}</span>}
    {active&&pet&&<span className="absolute right-3 bottom-11 text-xl" title={pet.name}>{pet.emoji}</span>}
    {onWave&&<button type="button" onClick={onWave} disabled={waved} className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-1 text-xs font-bold text-violet-700 opacity-0 shadow ring-1 ring-violet-200 transition group-hover:opacity-100 focus:opacity-100 disabled:opacity-100" aria-label={'Wave at '+e.name}>{waved?'👋 Sent':'👋 Wave'}</button>}
    <div className="flex justify-between items-center gap-2 p-2 text-xs"><b className="truncate">{e.name}</b><span className={'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold '+(phase==='working'?'bg-emerald-50 text-emerald-700':phase==='coffee'?'bg-amber-50 text-amber-700':phase==='sleeping'?'bg-rose-50 text-rose-700':'bg-slate-100 text-slate-600')}>{status&&status!=='None'&&active?status:labels[phase]}</span></div>
  </article>;
}
type Filter='all'|'working'|'break'|'away';
export function UniverseOffice({workers,viewerId}:{workers:Worker[];viewerId?:string}){
  const [online,setOnline]=useState<Set<string>|null>(null);
  const [filter,setFilter]=useState<Filter>('all');
  const [waved,setWaved]=useState<Set<string>>(new Set());
  const [toast,setToast]=useState('');
  useEffect(()=>{
    let mounted=true, busy=false;
    const poll=async()=>{
      const token=getSessionToken();
      if(!token||document.hidden||busy)return;
      busy=true;
      try{
        const res=await fetch('/api/universe?view=presence',{headers:{'x-session-token':token},signal:AbortSignal.timeout(10000)});
        if(res.ok){const data=await res.json();if(mounted&&Array.isArray(data.online))setOnline(new Set(data.online));}
      }catch {if(mounted)setOnline(null);}finally{busy=false;}
    };
    void poll();const timer=setInterval(poll,10000);
    return ()=>{mounted=false;clearInterval(timer);};
  },[viewerId]);
  const list=useMemo(()=>workers.map(worker=>worker.e.id!==viewerId && online && worker.live==='in' && !online.has(worker.e.id)?{...worker,live:'no_internet'}:worker),[workers,online,viewerId]);
  const group=(w:Worker):Filter=>w.live==='break'?'break':['in','no_internet'].includes(w.live)?'working':'away';
  const counts={all:list.length,working:list.filter(w=>group(w)==='working').length,break:list.filter(w=>group(w)==='break').length,away:list.filter(w=>group(w)==='away').length};
  const order:Record<Filter,number>={working:0,break:1,away:2,all:3};
  const shown=list.filter(w=>filter==='all'||group(w)===filter).sort((a,b)=>order[group(a)]-order[group(b)]||a.e.name.localeCompare(b.e.name));
  const night=officeSky()==='#2a3654';
  const wave=async(person:Employee)=>{
    const token=getSessionToken(); if(!token) return;
    setWaved(s=>new Set(s).add(person.id));
    try{
      const res=await fetch('/api/universe',{method:'POST',headers:{'Content-Type':'application/json','x-session-token':token},body:JSON.stringify({action:'message',message:'👋 Waved at you from the Live Office!',mentionIds:[person.id]})});
      const data=await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(data.error||'Wave could not be sent.');
      setToast('Wave sent to '+person.name+' 👋');
    }catch(err){setWaved(s=>{const n=new Set(s);n.delete(person.id);return n;});setToast(err instanceof Error?err.message:'Wave could not be sent.');}
    window.setTimeout(()=>setToast(''),3000);
  };
  const chips:[Filter,string][]=[['all','Everyone'],['working','💻 Working'],['break','☕ Break'],['away','🌙 Away']];
  return <section className={'rounded-3xl border p-4 '+(night?'border-indigo-900 bg-gradient-to-br from-slate-900 to-indigo-950 text-white':'border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-sky-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-900')}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="font-bold">Employee Universe · Live office {night?'🌙':'☀️'}</h2><p className={'text-[11px] '+(night?'text-indigo-200':'text-slate-500')}>{counts.working} working · {counts.break} on break · {counts.away} away. Hover a desk to wave.</p></div>
      <div className="flex flex-wrap gap-1.5">{chips.map(([key,label])=><button key={key} type="button" aria-pressed={filter===key} onClick={()=>setFilter(key)} className={'rounded-full border px-3 py-1 text-xs font-semibold transition '+(filter===key?'border-indigo-600 bg-indigo-600 text-white':night?'border-indigo-700 text-indigo-100 hover:bg-indigo-800':'border-slate-200 bg-white text-slate-700 hover:bg-indigo-50 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700')}>{label} <span className="opacity-70">{counts[key]}</span></button>)}</div>
    </div>
    {toast&&<p role="status" className="mb-2 rounded-xl bg-violet-600 px-3 py-2 text-xs font-semibold text-white">{toast}</p>}
    {shown.length===0?<p className="py-8 text-center text-sm opacity-70">Nobody here right now.</p>:
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">{shown.map(worker=><Desk key={worker.e.id} worker={worker} waved={waved.has(worker.e.id)} onWave={worker.e.id!==viewerId?()=>void wave(worker.e):undefined}/>)}</div>}
  </section>;
}
export function PersonalDesk({employee,record,settings,online}:{employee:Employee;record?:AttendanceRecord;settings:OfficeSettings;online:boolean}){
  const live=deriveLiveAttendanceState({record,settings,todayStr:getTodayDateString(),isCurrentUserOffline:!online,isCurrentUserConnected:online});
  const active=['in','break','no_internet'].includes(live);
  const first=employee.name.split(' ')[0]||employee.name;
  return <section className="mb-4 overflow-hidden rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-fuchsia-50 p-3 shadow-sm dark:border-slate-800 dark:from-slate-900 dark:via-slate-900 dark:to-slate-900">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1"><h2 className="text-sm font-black text-indigo-900 dark:text-indigo-200">My Universe desk</h2><span className="text-[11px] text-slate-500">{active?`You're in, ${first}. Have a great shift! 🚀`:`Punch in and watch ${first} walk in to work 👇`}</span></div>
    <div className="mx-auto max-w-2xl"><Desk hd worker={{e:employee,live}}/></div>
  </section>;
}
