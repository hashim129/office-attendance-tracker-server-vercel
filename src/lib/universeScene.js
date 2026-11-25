// All dimensions are in scene units. The avatar faces local +Z.
import * as T from 'three';
import { sculpt } from './sculptAvatar.js';
import { wardrobe } from './avatarWardrobe.js';
import { SVGRenderer } from 'three/addons/renderers/SVGRenderer.js';
import { HUMAN_CHARACTERS, LEGACY_CHARACTER_IDS, humanCharacter } from './universeCharacters.js';

const sphere = new T.SphereGeometry(1, 16, 12), box = new T.BoxGeometry(1,1,1);
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
export function studio(id, portrait=false, appearance={}) {
  const legacy=LEGACY_CHARACTER_IDS.indexOf(id);
  const a=humanCharacter(id)||HUMAN_CHARACTERS[Math.max(0,legacy)*3];
  const v={...Object.fromEntries(Object.entries(wardrobe).map(([key,values])=>[key,values[0]])),skin:a.skin,hairColor:a.hair,fabric:a.outfit,hairStyle:wardrobe.hairStyle[a.style],glasses:a.accessory%3===1?'Round':'None',...appearance};
  const custom=!fur[id] || !!appearance?.model;
  const skin=custom?v.skin:fur[id], hair=v.hairColor, navy=v.pants, ink='#282533';
  const scene=new T.Scene(); scene.background=new T.Color(portrait?'#e3e8fa':'#c5d7ed');
  scene.add(new T.HemisphereLight(0xfff6ec,0xaab5d4,2.0));
  const sun=new T.DirectionalLight(0xfff0dd,2.1); sun.position.set(-3,6,5); scene.add(sun);
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
  torso.scale.x=v.body==='Broad'?1.15:v.body==='Slender'?.88:1;
  const legs=[],arms=[];
  for(const s of [-1,1]){
    const hip=group(body,s*.147,-.09,0), knee=group(hip,0,-.41,0);
    oval(hip,navy,0,-.20,0,.135,.25,.135); oval(knee,navy,0,-.19,0,.106,.23,.105);
    oval(knee,v.shoes,0,-.39,.055,.129,.086,.203); legs.push([hip,knee]);
    const shoulder=group(torso,s*.302,.52,0), elbow=group(shoulder,0,-.295,0);
    oval(shoulder,v.top==='Varsity'?'#ece2cd':v.fabric,0,-.13,0,.106,.19,.108); oval(elbow,['Hoodie','Varsity','Suit'].includes(v.top)?(v.top==='Varsity'?'#ece2cd':v.fabric):skin,0,-.13,0,.078,.164,.081);
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
  block(lid,'#59667f',0,.185,0,.54,.37,.028); block(lid,'#92c6d4',0,.19,-.019,.49,.31,.009);
  const chair=group(scene); block(chair,'#506683',0,.50,-.045,.57,.09,.49);
  block(chair,'#506683',0,.82,-.27,.57,.65,.09); block(chair,navy,0,.24,-.04,.11,.48,.11);
  block(scene,'#c2cfe0',0,-.068,0,5.8,.13,2.5);
  block(scene,'#84c3d0',0,-.035,1.22,5.8,.06,.03);
  if(portrait){desk.visible=chair.visible=false; camera.position.set(.68,2.12,5);camera.lookAt(0,1.23,0);}
  return {scene,camera,body,torso,head,legs,arms,mug,lid,portrait,closeup:false};
}
const glasses=new T.TorusGeometry(1,.14,5,20), cup=new T.CylinderGeometry(1,.83,1,16);
const clamp=x=>Math.max(0,Math.min(1,x));
export function pose(r,phase,t){
  const arrive=phase==='arriving', leave=phase==='leaving', closing=phase==='closing', walk=arrive||leave;
  const p=clamp(t/1.65), seat=r.portrait?0:arrive?clamp((t-1.25)/.4):leave?1-clamp(t/.32):1;
  const stride=walk?Math.sin(t*10)*(1-seat):0, sleep=phase==='sleeping', coffee=phase==='coffee';
  r.body.visible=phase!=='away';
  r.body.position.set(arrive?-3.4*(1-p):leave?3.7*p:0,.96-.32*seat+.044*Math.abs(stride),0);
  r.body.rotation.y=r.portrait?.27*Math.sin(t*.8):walk?(1-seat)*1.34:0;
  r.torso.rotation.x=sleep?.74+.025*Math.sin(t*1.4):closing?.24:.035*Math.sin(t*1.6);
  r.head.rotation.x=sleep?.58:coffee?-.12:.035*Math.cos(t*2);
  r.legs.forEach(([hip,knee],i)=>{const s=i?1:-1;hip.rotation.x=-1.44*seat+s*.65*stride;knee.rotation.x=1.46*seat+Math.max(0,-s*stride)*.78;});
  r.arms.forEach(([shoulder,elbow],i)=>{const s=i?1:-1;
    shoulder.rotation.x=coffee&&i?-.80:-(sleep?.65:.56)*seat-s*.52*stride;
    elbow.rotation.x=coffee&&i?-1.70+.13*Math.cos(t*2):-.22-(sleep?.30:.85)*seat+.065*Math.sin(t*5+s);
  });
  r.mug.visible=coffee;
  r.lid.rotation.x=phase==='away'||leave?-1.52:closing?-1.52*clamp(t/.75):arrive?-1.52*(1-seat):-.09;
}
let renderer;
export function paint(canvas,rig){
  if(!renderer){
    try {renderer=new T.WebGLRenderer({antialias:true,alpha:false});}
    catch {renderer=new SVGRenderer();renderer.setQuality('low');}
  }
  const w=canvas.width,h=canvas.height;
  const half=rig.closeup?.62:rig.portrait?1.29:1.43;
  rig.camera.top=half;rig.camera.bottom=-half;rig.camera.left=-half*w/h;rig.camera.right=half*w/h;rig.camera.updateProjectionMatrix();
  renderer.setSize(w,h,false); renderer.render(rig.scene,rig.camera);
  if(renderer.domElement instanceof HTMLCanvasElement) canvas.getContext('2d').drawImage(renderer.domElement,0,0);
  else {canvas.hidden=true; const parent=canvas.parentElement; const svg=renderer.domElement.cloneNode(true);svg.style.cssText='width:100%;height:auto;display:block';parent.querySelector('svg')?.remove();parent.appendChild(svg);}
}
