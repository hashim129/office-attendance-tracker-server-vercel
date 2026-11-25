import React, {useEffect, useRef, useState} from 'react';
import type {Employee, AttendanceRecord, OfficeSettings} from '../../types';
import {deriveLiveAttendanceState, getTodayDateString} from '../../lib/attendanceCalculations';
import {studio, pose, paint} from '../../lib/universeScene.js';
import {getSessionToken} from '../../lib/storage';
import {GAME_PETS} from '../common/EmployeeIdentity';

type Phase = 'portrait'|'arriving'|'working'|'sleeping'|'coffee'|'closing'|'leaving'|'away';
export function AvatarStage({id,phase='portrait',animated=false,label=id}: {id:string;phase?:Phase;animated?:boolean;label?:string}){
  const ref=useRef<HTMLCanvasElement>(null);
  const portrait=phase==='portrait';
  const rig=React.useMemo(()=>studio(id,portrait),[id,portrait]);
  useEffect(()=>{
    const canvas=ref.current!;
    if(!canvas) return;
    const start=performance.now(), reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let timer=0,visible=false;
    function draw(){
      if(!visible||document.hidden) return;
      pose(rig,phase,reduce?1.65:(performance.now()-start)/1000);
      paint(canvas,rig);
      if(animated&&!reduce&&phase!=='away') timer=window.setTimeout(draw,canvas.hidden?220:66);
    }
    function refresh(){window.clearTimeout(timer);draw();}
    const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;refresh();});
    observer.observe(canvas.parentElement!); document.addEventListener('visibilitychange',refresh);
    return ()=>{observer.disconnect();window.clearTimeout(timer);document.removeEventListener('visibilitychange',refresh);canvas.parentElement?.querySelector('svg')?.remove();canvas.hidden=false;};
  },[phase,rig,animated]);
  return <span className="block overflow-hidden rounded-xl" role="img" aria-label={label}><canvas ref={ref} width={portrait?(animated?300:112):420} height={portrait?(animated?240:112):244} className="w-full"/></span>;
}
type Worker={e:Employee;live:string};
const labels:Record<Phase,string>={portrait:'Avatar',arriving:'Arriving',working:'Working',sleeping:'Sleeping at laptop',coffee:'Coffee break',closing:'Closing laptop',leaving:'Heading out',away:'Away'};
function Desk({worker}:{worker:Worker}){
  const {e,live}=worker;
  const active=['in','break','no_internet'].includes(live);
  const settled:Phase=live==='break'?'coffee':live==='no_internet'?'sleeping':active?'working':'away';
  const [transition,setTransition]=useState<Phase|null>(null);
  const previous=useRef(false);
  useEffect(()=>{
    const was=previous.current; previous.current=active;
    const timers:number[]=[];
    if(active){setTransition('arriving');timers.push(window.setTimeout(()=>setTransition(null),1650));}
    else if(was){setTransition('closing');timers.push(window.setTimeout(()=>setTransition('leaving'),760),window.setTimeout(()=>setTransition(null),2410));}
    else setTransition(null);
    return ()=>timers.forEach(clearTimeout);
  },[active]);
  const phase=transition||settled, pet=GAME_PETS.find(p=>p.id===e.gamePetId&&p.id!=='none');
  const id=e.gameCharacterId||'human-'+(1+[...e.id].reduce((n,c)=>n+c.charCodeAt(0),0)%54);
  return <article data-phase={phase} className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-700"><AvatarStage id={id} phase={phase} animated label={e.name+' · '+labels[phase]}/>{active&&pet&&<span className="absolute right-3 bottom-11 text-xl" title={pet.name}>{pet.emoji}</span>}<div className="flex justify-between items-center gap-2 p-2 text-xs"><b className="truncate">{e.name}</b><span>{labels[phase]}</span></div></article>;
}
export function UniverseOffice({workers,viewerId}:{workers:Worker[];viewerId?:string}){
  const [online,setOnline]=useState<Set<string>|null>(null);
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
  return <section className="rounded-3xl border border-indigo-200 bg-indigo-50 p-4 dark:bg-slate-900"><h2 className="mb-3 font-bold">Employee Universe · Live office</h2><div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">{workers.map(worker=><Desk key={worker.e.id} worker={worker.e.id!==viewerId && online && worker.live==='in' && !online.has(worker.e.id)?{...worker,live:'no_internet'}:worker}/>)}</div></section>;
}
export function PersonalDesk({employee,record,settings,online}:{employee:Employee;record?:AttendanceRecord;settings:OfficeSettings;online:boolean}){
  const live=deriveLiveAttendanceState({record,settings,todayStr:getTodayDateString(),isCurrentUserOffline:!online,isCurrentUserConnected:online});
  return <div className="mt-4 max-w-md"><h2 className="mb-2 text-sm font-bold">My Universe desk</h2><Desk worker={{e:employee,live}}/></div>;
}
