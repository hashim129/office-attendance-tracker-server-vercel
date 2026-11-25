// All dimensions are in scene units. The avatar faces local +Z.
import * as T from 'three';
import { sculpt, hasLongSleeves } from './sculptAvatar.js';
import { wardrobe } from './avatarWardrobe.js';
import { SVGRenderer } from 'three/addons/renderers/SVGRenderer.js';
import { HUMAN_CHARACTERS, LEGACY_CHARACTER_IDS, humanCharacter } from './universeCharacters.js';

// Animation lengths (ms) shared with the React components that switch phases.
export const ARRIVE_MS = 3000;
export const CLOSE_MS = 760;
export const LEAVE_MS = 2600;

const sphere = new T.SphereGeometry(1, 16, 12), box = new T.BoxGeometry(1,1,1);
const glasses=new T.TorusGeometry(1,.14,5,20), cup=new T.CylinderGeometry(1,.83,1,16), pot=new T.CylinderGeometry(1,.75,1,16);
const colors = new Map();
function mesh(parent, shape, color, x,y,z,w,h,d) {
  if (!colors.has(color)) colors.set(color, new T.MeshStandardMaterial({color, roughness:.62}));
  const m = new T.Mesh(shape,colors.get(color)); parent.add(m); m.position.set(x,y,z); m.scale.set(w,h,d); return m;
}
function group(parent,x=0,y=0,z=0) {
  const g = new T.Group(); parent.add(g); g.position.set(x,y,z); return g;
}
const oval=(p,c,...v)=>mesh(p,sphere,c,...v);
const block=(p,c,...v)=>mesh(p,box,c,...v);
const fur={fox:'#e98740', tiger:'#e9aa42', panda:'#ecebea', dragon:'#59aa76', koala:'#aab3bd', unicorn:'#f4cfeb'};

/** Sky colour for the live office, following the time of day in Pakistan. */
export function officeSky(date = new Date()) {
  let hour = 12;
  try { hour = Number(new Intl.DateTimeFormat('en-GB',{hour:'numeric',hour12:false,timeZone:'Asia/Karachi'}).format(date)); } catch { /* keep midday */ }
  if (hour >= 6 && hour < 9) return '#f7d9c4';
  if (hour >= 9 && hour < 17) return '#c5d7ed';
  if (hour >= 17 && hour < 20) return '#f2b991';
  return '#2a3654';
}

export function studio(id, portrait=false, appearance={}) {
  const legacy=LEGACY_CHARACTER_IDS.indexOf(id);
  const a=humanCharacter(id)||HUMAN_CHARACTERS[Math.max(0,legacy)*3];
  const v={...Object.fromEntries(Object.entries(wardrobe).map(([key,values])=>[key,values[0]])),skin:a.skin,hairColor:a.hair,fabric:a.outfit,hairStyle:wardrobe.hairStyle[a.style],glasses:a.accessory%3===1?'Round':'None',...(appearance||{})};
  const custom=!fur[id] || !!appearance?.model;
  const skin=custom?v.skin:fur[id], hair=v.hairColor, navy=v.pants, ink='#282533';
  const scene=new T.Scene();
  const sky=portrait?v.bg:officeSky();
  scene.background=new T.Color(sky);
  const night=!portrait&&sky==='#2a3654';
  scene.add(new T.HemisphereLight(0xfff6ec,0xaab5d4,night?1.3:2.0));
  const sun=new T.DirectionalLight(night?0xbfd0ff:0xfff0dd,night?1.2:2.1); sun.position.set(-3,6,5); scene.add(sun);
  const camera=new T.OrthographicCamera(-2.7,2.7,1.65,-1.65,.1,50);
  camera.position.set(3,2.65,6); camera.lookAt(0,1.25,0);
  const body=group(scene), torso=group(body), head=group(torso,0,.89,0);
  oval(torso,v.fabric,0,.29,0,.32,.49,.21);
  if(custom) sculpt(head,torso,v);
  else {
    block(torso,'#fcf5ea',0,.54,.17,.11,.18,.035);
    oval(head,skin,0,.12,0,.32,.385,.3);
    for(const s of [-1,1]){
      oval(head,skin,s*.31,.10,0,.065,.095,.06);
      oval(head,'#fff8ed',s*.125,.155,.262,.071,.058,.033);
      oval(head,ink,s*.125,.154,.29,.034,.042,.017);
      oval(head,'#ffffff',s*.125-.009,.17,.307,.011,.012,.006);
      oval(head,hair,s*.13,.25,.253,.078,.017,.023).rotation.z=s*.09;
    }
    oval(head,skin,0,.074,.294,.06,.05,.051);
    oval(head,'#995e58',0,-.034,.276,.067,.013,.011);
    if(fur[id]){
      for(const s of [-1,1]) oval(head,id==='panda'?ink:skin,s*.244,.44,0,.102,id==='koala'?.1:.155,.082);
      oval(head,'#fff3df',0,.035,.275,.13,.09,.055);
      oval(head,ink,0,.09,.324,.051,.036,.025);
    }else{
      oval(head,hair,0,.365,-.035,.332,.19,.295);
      for(let n=0;n<4+a.style;n++){
        const angle=n*.68; oval(head,hair,.24*Math.cos(angle),.36+.048*Math.sin(angle*2),.20*Math.sin(angle),.116,.12+a.style*.009,.108);
      }
      if(a.style%2) oval(head,hair,0,.17,-.24,.255,.30,.14);
      if(a.accessory%3===1) for(const s of [-1,1]) {
        const ring=mesh(head,glasses,'#363342',s*.125,.153,.314,.079,.067,.028); ring.rotation.z=s*.04;
      }
    }
  }
  const bodyScale={Broad:[1.15,1],Slender:[.88,1],Petite:[.92,.9],Tall:[.96,1.08]}[v.body]||[1,1];
  torso.scale.set(bodyScale[0],bodyScale[1],1);
  const legs=[],arms=[];
  const longSleeve=hasLongSleeves(v.top);
  for(const s of [-1,1]){
    const hip=group(body,s*.147,-.09,0), knee=group(hip,0,-.41,0);
    oval(hip,navy,0,-.20,0,.135,.25,.135); oval(knee,navy,0,-.19,0,.106,.23,.105);
    oval(knee,v.shoes,0,-.39,.055,.129,.086,.203); legs.push([hip,knee]);
    const shoulder=group(torso,s*.302,.52,0), elbow=group(shoulder,0,-.295,0);
    const sleeve=v.top==='Varsity'?'#ece2cd':v.fabric;
    oval(shoulder,sleeve,0,-.13,0,.106,.19,.108); oval(elbow,longSleeve?sleeve:skin,0,-.13,0,.078,.164,.081);
    oval(elbow,skin,0,-.28,0,.081,.092,.073); arms.push([shoulder,elbow]);
  }
  const mug=group(arms[1][1],0,-.31,.05);
  mesh(mug,cup,'#e69a54',0,.035,0,.081,.14,.081);
  oval(mug,'#603f32',0,.108,0,.067,.008,.067);
  mesh(mug,glasses,'#e69a54',.088,.04,0,.041,.049,.04);
  const desk=group(scene,0,0,.68), lid=group(desk,0,.88,.18);
  block(desk,'#b57d55',0,.80,0,1.5,.085,.68);
  for(const x of [-.63,.63]) for(const z of [-.23,.23]) block(desk,navy,x,.39,z,.07,.78,.07);
  block(desk,'#8796ad',0,.855,0,.54,.03,.36);
  // Desk props: a plant and a cup, so the desk feels like someone's own.
  const plant=group(desk,-.55,.84,-.05);
  mesh(plant,pot,'#d9734e',0,.07,0,.08,.14,.08);
  for(let i=0;i<5;i++){const a=i/5*Math.PI*2;oval(plant,'#3f9a5b',.05*Math.cos(a),.2+.03*(i%2),.05*Math.sin(a),.04,.09,.04);}
  const deskMug=group(desk,.55,.84,.05);
  mesh(deskMug,cup,'#4f7fd6',0,.06,0,.06,.11,.06);
  block(lid,'#59667f',0,.185,0,.54,.37,.028);
  const screenMat=new T.MeshStandardMaterial({color:'#92c6d4',emissive:new T.Color('#000000'),roughness:.4});
  const screen=new T.Mesh(box,screenMat); screen.position.set(0,.19,-.019); screen.scale.set(.49,.31,.009); lid.add(screen);
  const chair=group(scene); block(chair,'#506683',0,.50,-.045,.57,.09,.49);
  block(chair,'#506683',0,.82,-.27,.57,.65,.09); block(chair,navy,0,.24,-.04,.11,.48,.11);
  block(scene,night?'#8a97ad':'#c2cfe0',0,-.068,0,5.8,.13,2.5);
  block(scene,'#84c3d0',0,-.035,1.22,5.8,.06,.03);
  if(portrait){desk.visible=chair.visible=false; camera.position.set(.68,2.12,5);camera.lookAt(0,1.23,0);}
  return {scene,camera,body,torso,head,legs,arms,mug,lid,chair,screen,screenMat,portrait,closeup:false};
}
const clamp=x=>Math.max(0,Math.min(1,x));
const ease=x=>x<.5?2*x*x:1-Math.pow(-2*x+2,2)/2;
/**
 * Poses the rig for a phase at time t (seconds since the phase started).
 * Phases: portrait, arriving, working, typing, sleeping, coffee, closing, leaving, away, wave, dance, walk.
 */
export function pose(r,phase,t){
  const arrive=phase==='arriving', leave=phase==='leaving', closing=phase==='closing';
  const sleep=phase==='sleeping', coffee=phase==='coffee', dance=phase==='dance', waving=phase==='wave';
  const working=phase==='working'||phase==='typing';
  let x=0, seat=r.portrait?0:1, facing=0, walking=false, wave=0;
  if(arrive){
    // Walk in from the left (0–2s), wave hello (2–2.5s), sit down (2.5–2.9s).
    const p=ease(clamp(t/2.0)); x=-3.4*(1-p); walking=t<2.0;
    facing=walking?1.4:1.4*(1-clamp((t-2.0)/.25));
    wave=t>=2.0&&t<2.55?Math.sin(clamp((t-2.0)/.55)*Math.PI):0;
    seat=clamp((t-2.5)/.4);
  }else if(leave){
    // Stand (0–.35s), wave goodbye (.35–.85s), walk out to the right (.85–2.5s).
    seat=1-clamp(t/.35);
    wave=t>=.35&&t<.9?Math.sin(clamp((t-.35)/.55)*Math.PI):0;
    const p=ease(clamp((t-.85)/1.65)); x=3.7*p; walking=t>=.85;
    facing=walking?-1.4*clamp((t-.85)/.2):0;
  }else if(phase==='walk'){
    seat=0; walking=true; facing=r.portrait?.9:1.4;
  }else if(waving||dance){
    seat=0; wave=waving?1:0;
  }
  if(r.chair) r.chair.visible=!r.portrait;
  const stride=walking?Math.sin(t*10):0;
  const bounce=dance?Math.abs(Math.sin(t*6))*.08:0;
  r.body.visible=phase!=='away';
  r.body.position.set(x,.96-.32*seat+.044*Math.abs(stride)+bounce,0);
  r.body.rotation.y=dance?.5*Math.sin(t*3):r.portrait&&!walking?.27*Math.sin(t*.8)+facing:facing;
  r.body.rotation.z=dance?.08*Math.sin(t*6):0;
  r.torso.rotation.x=sleep?.74+.025*Math.sin(t*1.4):closing?.24:working?.06+.01*Math.sin(t*2):.035*Math.sin(t*1.6);
  r.head.rotation.x=sleep?.58:coffee?-.12:working?.05+.03*Math.sin(t*.7):.035*Math.cos(t*2);
  r.head.rotation.z=dance?.12*Math.sin(t*6+1):waving||wave>0?.08:0;
  r.legs.forEach(([hip,knee],i)=>{const s=i?1:-1;
    const kick=dance?Math.max(0,Math.sin(t*6+(i?Math.PI:0)))*.5:0;
    hip.rotation.x=-1.44*seat+s*.65*stride-kick; knee.rotation.x=1.46*seat+Math.max(0,-s*stride)*.78+kick*1.2;});
  r.arms.forEach(([shoulder,elbow],i)=>{const s=i?1:-1;
    shoulder.rotation.z=0; elbow.rotation.z=0;
    shoulder.rotation.x=coffee&&i?-.80:-(sleep?.65:.56)*seat-s*.52*stride;
    elbow.rotation.x=coffee&&i?-1.70+.13*Math.cos(t*2):-.22-(sleep?.30:.85)*seat+.065*Math.sin(t*5+s);
    if(working&&seat>.9) elbow.rotation.x+=.09*Math.sin(t*16+(i?Math.PI:0)); // typing
    if(dance){shoulder.rotation.z=s*(1.2+.9*Math.sin(t*6+(i?Math.PI:0)));elbow.rotation.z=s*.6;shoulder.rotation.x=0;}
    if(i&&wave>0){shoulder.rotation.x*=1-wave;shoulder.rotation.z=2.55*wave;elbow.rotation.x=0;elbow.rotation.z=(.5+.45*Math.sin(t*16))*wave;}
  });
  r.mug.visible=coffee;
  r.lid.rotation.x=phase==='away'||leave?-1.52:closing?-1.52*clamp(t/.75):arrive?-1.52*(1-seat):-.09;
  if(r.screenMat){
    const on=working||coffee||(arrive&&seat>.5);
    r.screenMat.emissive.set(on?'#3a7fa0':'#000000');
    r.screenMat.emissiveIntensity=on?.6+.15*Math.sin(t*3):0;
    r.screenMat.color.set(sleep?'#3b4a63':'#92c6d4');
  }
}
let renderer;
export function paint(canvas,rig){
  if(!renderer){
    try {renderer=new T.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});}
    catch {renderer=new SVGRenderer();renderer.setQuality('low');}
  }
  const w=canvas.width,h=canvas.height;
  const half=rig.closeup?.62:rig.portrait?1.29:1.43;
  rig.camera.top=half;rig.camera.bottom=-half;rig.camera.left=-half*w/h;rig.camera.right=half*w/h;rig.camera.updateProjectionMatrix();
  renderer.setSize(w,h,false); renderer.render(rig.scene,rig.camera);
  if(renderer.domElement instanceof HTMLCanvasElement) canvas.getContext('2d').drawImage(renderer.domElement,0,0);
  else {canvas.hidden=true; const parent=canvas.parentElement; const svg=renderer.domElement.cloneNode(true);svg.style.cssText='width:100%;height:auto;display:block';parent.querySelector('svg')?.remove();parent.appendChild(svg);}
}
const snapshots=new Map();
/** A still, face-first picture of an avatar (PNG data URL), cached so chat lists stay fast. */
export function snapshot(id, appearance={}, size=96){
  const key=id+'|'+size+'|'+JSON.stringify(appearance||{});
  if(snapshots.has(key)) return snapshots.get(key);
  let url='';
  try{
    const rig=studio(id,true,appearance||{});
    pose(rig,'portrait',1.65); rig.body.rotation.y=.18; rig.closeup=true; rig.camera.lookAt(0,1.94,0);
    const canvas=document.createElement('canvas'); canvas.width=canvas.height=size;
    // Snapshots need a real canvas in the DOM tree only for the SVG fallback; WebGL draws straight in.
    const holder=document.createElement('span'); holder.appendChild(canvas);
    paint(canvas,rig);
    url=canvas.hidden?'':canvas.toDataURL('image/png');
  }catch{ url=''; }
  if(snapshots.size>200) snapshots.clear();
  snapshots.set(key,url);
  return url;
}
