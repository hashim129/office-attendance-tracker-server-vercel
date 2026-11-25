import React,{useState} from 'react';
import {wardrobe} from '../../lib/avatarWardrobe.js';
import {humanCharacter} from '../../lib/universeCharacters.js';
import {GAME_CHARACTERS,GAME_PETS} from '../common/EmployeeIdentity';
import {AvatarStage} from './UniverseOffice';

const panels = {
  Character:['model','body','face','skin'],
  Face:['eyes','iris','brows','nose','mouth'],
  Hair:['hairStyle','hairColor','beard'],
  Wardrobe:['top','fabric','pants','shoes','glasses','hat']
} as const;
const looks:Record<string,Record<string,string>>={
  'City bear':{model:'Bear',skin:'#c68b62',hat:'Fedora',glasses:'Sunglasses',top:'Suit',fabric:'#079ba9'},
  'Street ape':{model:'Ape',skin:'#ad7350',hat:'Beanie',glasses:'Sunglasses',mouth:'Grin',top:'Hoodie',fabric:'#ae3351'},
  'Varsity':{model:'Human',hairStyle:'Ponytail',hairColor:'#784329',top:'Varsity',fabric:'#313747',pants:'#5c85a7'},
  'Weekend':{model:'Human',hairStyle:'Quiff',beard:'Full',glasses:'Round',top:'Hoodie',fabric:'#e79a39'}
};
const names:Record<string,string>={iris:'Eye color',brows:'Eyebrows',face:'Face shape',skin:'Skin or fur',hairStyle:'Hairstyle',hairColor:'Hair color',fabric:'Top color',pants:'Trouser color',shoes:'Shoe color',beard:'Facial hair'};
type Props={id:string;pet:string;value:Record<string,string>;onId:(id:string)=>void;onPet:(id:string)=>void;onChange:(v:Record<string,string>)=>void};
export function AvatarEditor({id,pet,value,onId,onPet,onChange}:Props){
  const [panel,setPanel]=useState<keyof typeof panels>('Character');
  const [angle,setAngle]=useState(0);
  const [close,setClose]=useState(true);
  const preset=humanCharacter(id)||humanCharacter('human-1')!;
  const presetDefaults:Record<string,string>={skin:preset?.skin,hairColor:preset?.hair,fabric:preset?.outfit,hairStyle:wardrobe.hairStyle[preset?.style],glasses:preset?.accessory%3===1?'Round':'None'};
  return <section className="rounded-2xl border bg-white p-5 dark:bg-slate-900">
    <h2 className="mb-4 text-xl font-bold">Avatar studio</h2>
    <div className="grid gap-6 md:grid-cols-[minmax(200px,.9fr)_1.35fr]">
      <div><AvatarStage id={id} appearance={value} animated closeup={close} angle={angle*Math.PI/180} label="Your animated 3D preview"/>
        <div className="my-3 flex items-center gap-3"><label className="text-xs">Rotate <input aria-label="Rotate character" type="range" min="-180" max="180" value={angle} onChange={e=>setAngle(Number(e.target.value))}/></label><button type="button" className="rounded-lg border px-3 py-2 text-xs" onClick={()=>setClose(!close)}>{close?'Full body':'Face view'}</button></div>
        <label className="block text-sm">Starting character<select className="mb-3 block w-full rounded-lg border p-2 dark:bg-slate-900" value={id} onChange={e=>{onId(e.target.value);onChange({});}}>{GAME_CHARACTERS.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="block text-sm">Companion<select className="block w-full rounded-lg border p-2 dark:bg-slate-900" value={pet} onChange={e=>onPet(e.target.value)}>{GAME_PETS.map(p=><option key={p.id} value={p.id}>{p.emoji} {p.name}</option>)}</select></label>
      </div>
      <div><fieldset className="mb-4"><legend className="mb-2 text-sm font-semibold">Complete looks</legend><div className="flex flex-wrap gap-2">{Object.entries(looks).map(([name,look])=><button key={name} type="button" className="rounded-lg border px-3 py-2 text-xs" onClick={()=>onChange({...look})}>{name}</button>)}</div></fieldset><div className="mb-5 flex flex-wrap gap-2">{(Object.keys(panels) as (keyof typeof panels)[]).map(key=><button type="button" aria-pressed={panel===key} key={key} className={'rounded-full border px-3 py-1.5 text-sm '+(key===panel?'bg-indigo-700 text-white':'')} onClick={()=>{setPanel(key);setClose(key!=='Wardrobe');}}>{key}</button>)}</div>
        {panels[panel].map(key=><fieldset key={key} className="mb-4"><legend className="mb-1 text-sm font-semibold capitalize">{names[key]||key}</legend><div className="flex flex-wrap gap-2">{wardrobe[key].map(option=>{
          const selected=option===(value[key]||presetDefaults[key]||wardrobe[key][0]);
          const swatch=option.startsWith('#');
          return <button type="button" key={option} aria-label={key+' '+option} aria-pressed={selected} title={option} style={swatch?{background:option}:undefined} className={'border text-xs '+(swatch?'h-8 w-8 rounded-full':'rounded-lg px-3 py-2')+(selected?' ring-2 ring-indigo-500 ring-offset-1':'')} onClick={()=>onChange({...value,[key]:option})}>{swatch?'':option}</button>;
        })}</div></fieldset>)}
      </div>
    </div>
  </section>;
}
