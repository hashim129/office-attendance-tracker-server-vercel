import React,{useRef,useState} from 'react';
import {wardrobe,randomAppearance,exclusiveOwner,roleCanWear,EXCLUSIVE_LABEL} from '../../lib/avatarWardrobe.js';
import {humanCharacter} from '../../lib/universeCharacters.js';
import {GAME_CHARACTERS,GAME_PETS} from '../common/EmployeeIdentity';
import {AvatarStage,type Phase} from './UniverseOffice';

type Key=keyof typeof wardrobe;
const panels:Record<string,{icon:string;keys:Key[]}> = {
  Body:{icon:'🧍',keys:['model','body','skin','face']},
  Face:{icon:'👀',keys:['eyes','iris','brows','nose','mouth','cheeks']},
  Mood:{icon:'😄',keys:['expression']},
  Hair:{icon:'💇',keys:['hairStyle','hairColor','beard']},
  Outfit:{icon:'👕',keys:['top','fabric','pants','shoes']},
  Extras:{icon:'🕶️',keys:['glasses','hat','earrings']},
  Scene:{icon:'🎨',keys:['bg','status']},
};
const looks:Record<string,Record<string,string>>={
  'City bear':{model:'Bear',skin:'#c68b62',hat:'Fedora',glasses:'Sunglasses',top:'Suit',fabric:'#079ba9'},
  'Street ape':{model:'Ape',skin:'#ad7350',hat:'Beanie',glasses:'Sunglasses',mouth:'Grin',top:'Hoodie',fabric:'#ae3351'},
  'Varsity':{model:'Human',hairStyle:'Ponytail',hairColor:'#784329',top:'Varsity',fabric:'#313747',pants:'#5c85a7'},
  'Weekend':{model:'Human',hairStyle:'Quiff',beard:'Full',glasses:'Round',top:'Hoodie',fabric:'#e79a39'},
  'Desi formal':{model:'Human',hairStyle:'Side part',beard:'Stubble',top:'Kurta',fabric:'#e8ded4',pants:'#ffffff',shoes:'#262b33'},
  'Hijab chic':{model:'Human',hat:'Hijab',fabric:'#8656a6',top:'Abaya',earrings:'None',cheeks:'Blush',eyes:'Big',expression:'Happy'},
  'Boss mode':{model:'Human',hairStyle:'Quiff',top:'Blazer',fabric:'#111111',glasses:'Aviator',expression:'Cool',pants:'#30332f'},
  'Gamer':{model:'Human',hairStyle:'Mohawk',hairColor:'#3a5bc7',hat:'Headphones',top:'Jersey',fabric:'#1f7a3d',expression:'Laughing'},
  'Party time':{model:'Human',hat:'Party hat',glasses:'Star shades',top:'Tee',fabric:'#ae3351',expression:'Laughing',bg:'#fff2cc',status:'Celebrating 🎉'},
  'Royal':{model:'Human',hat:'Crown',top:'Suit',fabric:'#c9a227',expression:'Cool',earrings:'Studs',bg:'#e6e0ff'},
};
/** One full outfit per role, made from that role's exclusive items. */
const roleLooks:Record<string,[string,Record<string,string>]>={
  admin:['🛡️ Admin command',{model:'Human',hat:'Admin shield cap',top:'Admin command jacket',glasses:'Aviator',expression:'Cool',pants:'#293446',shoes:'#262b33',bg:'#2b1f4d',status:'Admin on duty 🛡️'}],
  ceo:['👑 CEO royal',{model:'Human',hat:'CEO royal crown',top:'CEO gold sherwani',expression:'Happy',pants:'#ffffff',shoes:'#e2b33c',bg:'#3b2a05',status:'CEO in the house 👑'}],
  accounts:['💼 Accounts pro',{model:'Human',hat:'Accounts visor',top:'Accounts ledger vest',glasses:'Square',expression:'Happy',pants:'#30332f',shoes:'#262b33',bg:'#06352b',status:'Accounts closing books 💼'}],
};
const names:Partial<Record<Key,string>>={iris:'Eye color',brows:'Eyebrows',face:'Face shape',skin:'Skin or fur',hairStyle:'Hairstyle',hairColor:'Hair color',fabric:'Outfit color',pants:'Trouser color',shoes:'Shoe color',beard:'Facial hair',expression:'Expression',cheeks:'Cheeks',hat:'Headwear',earrings:'Earrings',bg:'Background',status:'My status (shown on my desk)',top:'Outfit',model:'Character type',body:'Body shape'};
const poses:[Phase,string][]=[['portrait','🙂 Idle'],['wave','👋 Wave'],['dance','💃 Dance'],['walk','🚶 Walk'],['arriving','💻 Punch-in']];
const SAVED='avatar-saved-looks';
function readSaved():Record<string,string>[]{try{const v=JSON.parse(localStorage.getItem(SAVED)||'[]');return Array.isArray(v)?v.slice(0,3):[];}catch{return [];}}

type Props={id:string;pet:string;value:Record<string,string>;onId:(id:string)=>void;onPet:(id:string)=>void;onChange:(v:Record<string,string>)=>void;role?:string;isSuperAdmin?:boolean};
export function AvatarEditor({id,pet,value,onId,onPet,onChange,role='employee',isSuperAdmin=false}:Props){
  const can=(key:string,option:string)=>roleCanWear(role,key,option,isSuperAdmin);
  const myRoleLook=roleLooks[role]||(isSuperAdmin?roleLooks.admin:undefined);
  const [panel,setPanel]=useState<string>('Body');
  const [angle,setAngle]=useState(0);
  const [close,setClose]=useState(true);
  const [phase,setPhase]=useState<Phase>('portrait');
  const [replay,setReplay]=useState(0);
  const [past,setPast]=useState<Record<string,string>[]>([]);
  const [future,setFuture]=useState<Record<string,string>[]>([]);
  const [saved,setSaved]=useState<Record<string,string>[]>(readSaved);
  const canvasRef=useRef<HTMLCanvasElement|null>(null);
  const preset=humanCharacter(id)||humanCharacter('human-1')!;
  const presetDefaults:Record<string,string>={skin:preset?.skin,hairColor:preset?.hair,fabric:preset?.outfit,hairStyle:wardrobe.hairStyle[preset?.style],glasses:preset?.accessory%3===1?'Round':'None'};
  const change=(next:Record<string,string>)=>{setPast(p=>[...p.slice(-29),value]);setFuture([]);onChange(next);};
  const undo=()=>{if(!past.length)return;setFuture(f=>[value,...f]);onChange(past[past.length-1]);setPast(p=>p.slice(0,-1));};
  const redo=()=>{if(!future.length)return;setPast(p=>[...p,value]);onChange(future[0]);setFuture(f=>f.slice(1));};
  const pick=(key:Key,option:string)=>change({...value,[key]:option});
  const download=()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    try{const a=document.createElement('a');a.href=canvas.toDataURL('image/png');a.download='my-avatar.png';a.click();}catch{/* canvas unavailable */}
  };
  const saveSlot=(i:number)=>{const next=[...saved];next[i]={...value};setSaved(next);try{localStorage.setItem(SAVED,JSON.stringify(next));}catch{/* storage full */}};
  const chooseFace=(key:string)=>{setPanel(key);setClose(!['Outfit','Scene'].includes(key));if(phase!=='portrait'&&phase!=='wave')setPhase('portrait');};
  const office=phase==='arriving';
  const btn='rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold transition hover:bg-indigo-50 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800';
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="text-xl font-bold">Avatar studio ✨</h2><p className="text-xs text-slate-500">Design your 3D look. It walks into the office when you punch in.</p></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} onClick={()=>change(randomAppearance(value))}>🎲 Surprise me</button>
        <button type="button" className={btn} disabled={!past.length} onClick={undo} aria-label="Undo">↩ Undo</button>
        <button type="button" className={btn} disabled={!future.length} onClick={redo} aria-label="Redo">↪ Redo</button>
        <button type="button" className={btn} onClick={()=>change({})}>⟲ Reset</button>
      </div>
    </div>
    <div className="grid gap-6 md:grid-cols-[minmax(220px,.9fr)_1.35fr]">
      <div className="md:sticky md:top-20 md:self-start">
        <div className="relative">
          <AvatarStage key={office?'office-'+replay:'stage'} canvasRef={canvasRef} id={id} appearance={value} animated phase={phase} stage={!office} closeup={close&&phase==='portrait'} angle={office?0:angle*Math.PI/180} label="Your animated 3D preview"/>
          {value.status&&value.status!=='None'&&<span className="absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-white/95 px-3 py-1 text-[11px] font-bold text-slate-800 shadow">{value.status}</span>}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">{poses.map(([p,label])=><button type="button" key={p} aria-pressed={phase===p} onClick={()=>{setPhase(p);if(p==='arriving')setReplay(r=>r+1);}} className={'rounded-full border px-2.5 py-1 text-[11px] font-semibold '+(phase===p?'border-indigo-600 bg-indigo-600 text-white':'border-slate-200 dark:border-slate-700')}>{label}</button>)}</div>
        <div className="my-3 flex flex-wrap items-center gap-3"><label className="text-xs">Rotate <input aria-label="Rotate character" type="range" min="-180" max="180" value={angle} disabled={office} onChange={e=>setAngle(Number(e.target.value))}/></label><button type="button" className={btn} onClick={()=>setClose(!close)}>{close?'Full body':'Face view'}</button><button type="button" className={btn} onClick={download}>⬇ Save picture</button></div>
        <label className="block text-sm">Starting character<select className="mb-3 block w-full rounded-lg border p-2 dark:bg-slate-900" value={id} onChange={e=>{onId(e.target.value);change({});}}>{GAME_CHARACTERS.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="block text-sm">Companion<select className="block w-full rounded-lg border p-2 dark:bg-slate-900" value={pet} onChange={e=>onPet(e.target.value)}>{GAME_PETS.map(p=><option key={p.id} value={p.id}>{p.emoji} {p.name}</option>)}</select></label>
        <fieldset className="mt-4"><legend className="mb-1 text-sm font-semibold">My saved looks</legend><div className="grid grid-cols-3 gap-2">{[0,1,2].map(i=><div key={i} className="rounded-lg border border-dashed border-slate-300 p-2 text-center text-[11px] dark:border-slate-700"><p className="font-semibold">Look {i+1}</p><div className="mt-1 flex justify-center gap-1"><button type="button" className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800" onClick={()=>saveSlot(i)}>Save</button><button type="button" disabled={!saved[i]} className="rounded bg-indigo-100 px-1.5 py-0.5 text-indigo-800 disabled:opacity-40" onClick={()=>saved[i]&&change({...saved[i]})}>Wear</button></div></div>)}</div></fieldset>
      </div>
      <div>
        {myRoleLook&&<div className="mb-4 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-violet-50 p-3 dark:border-amber-900/60 dark:from-amber-950/30 dark:via-slate-900 dark:to-violet-950/30"><p className="text-xs font-black uppercase tracking-wider text-amber-700 dark:text-amber-300">✨ Exclusive to your role</p><p className="mb-2 text-[11px] text-slate-500">Only {role==='ceo'?'the CEO':role==='accounts'?'Accounts':'Admins'} can wear these. Items marked with a star are yours alone.</p><button type="button" className="rounded-xl bg-gradient-to-r from-amber-500 to-violet-600 px-4 py-2 text-xs font-bold text-white shadow-md transition hover:-translate-y-0.5 hover:shadow-lg" onClick={()=>change({...value,...myRoleLook[1]})}>Wear {myRoleLook[0]}</button></div>}
        <fieldset className="mb-4"><legend className="mb-2 text-sm font-semibold">Complete looks</legend><div className="flex flex-wrap gap-2">{Object.entries(looks).map(([name,look])=><button key={name} type="button" className={btn} onClick={()=>change({...look})}>{name}</button>)}</div></fieldset>
        <div className="mb-5 flex flex-wrap gap-2" role="tablist">{Object.entries(panels).map(([key,p])=><button type="button" role="tab" aria-selected={panel===key} key={key} className={'rounded-full border px-3 py-1.5 text-sm '+(key===panel?'border-indigo-700 bg-indigo-700 text-white':'border-slate-200 dark:border-slate-700')} onClick={()=>chooseFace(key)}>{p.icon} {key}</button>)}</div>
        {panels[panel].keys.map(key=><fieldset key={key} className="mb-4"><legend className="mb-1 text-sm font-semibold">{names[key]||key}</legend><div className="flex flex-wrap gap-2">{wardrobe[key].filter(option=>can(key,option)).map(option=>{
          const owner=exclusiveOwner(key,option);
          const selected=option===(value[key]||presetDefaults[key]||wardrobe[key][0]);
          const swatch=option.startsWith('#');
          return <button type="button" key={option} aria-label={(names[key]||key)+' '+option} aria-pressed={selected} title={option} style={swatch?{background:option,color:'#fde68a'}:undefined} className={'border text-xs transition hover:scale-105 '+(swatch?'h-8 w-8 rounded-full border-slate-300':'rounded-lg border-slate-200 px-3 py-2 dark:border-slate-700')+(selected?' ring-2 ring-indigo-500 ring-offset-1':'')} onClick={()=>{pick(key,option);if(key==='expression')setClose(true);}}>{swatch?(owner?'★':''):(owner?<><span className="mr-1 text-amber-500">★</span>{option}<span className="ml-1 rounded bg-amber-100 px-1 text-[9px] font-black uppercase text-amber-800">{EXCLUSIVE_LABEL[owner as keyof typeof EXCLUSIVE_LABEL]}</span></>:option)}</button>;
        })}</div></fieldset>)}
      </div>
    </div>
  </section>;
}
