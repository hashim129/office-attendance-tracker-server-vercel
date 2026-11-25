// The facial features follow the head joint. The wardrobe follows the torso.
import * as T from 'three';
const sphere=new T.SphereGeometry(1,32,24);
const cylinder=new T.CylinderGeometry(1,1,1,36);
const cube=new T.BoxGeometry(1,1,1);
const ring=new T.TorusGeometry(1,.1,8,48);
const shapes=new Map(), materials=new Map();
function part(parent,shape,color,x,y,z,w,h,d,angle=0){
  if(!materials.has(color))materials.set(color,new T.MeshStandardMaterial({color,roughness:.62}));
  const m=new T.Mesh(shape,materials.get(color)); m.position.set(x,y,z);m.scale.set(w,h,d);m.rotation.z=angle;parent.add(m);return m;
}
const oval=(p,...args)=>part(p,sphere,...args);
function stroke(parent,color,points,width){
  const key=JSON.stringify([points,width]);
  if(!shapes.has(key))shapes.set(key,new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),18,width,8,false));
  return part(parent,shapes.get(key),color,0,0,0,1,1,1);
}
export function sculpt(head,torso,v){
  const skin=v.skin,hair=v.hairColor,ink='#282029',cloth=v.fabric,animal=v.model!=='Human';
  head.scale.set(v.face==='Round'?1.17:1.05,v.face==='Angular'?1.11:1.02,1.07);
  oval(head,skin,0,.12,0,.32,.39,.29);
  for(const s of [-1,1]){
    const earY=v.model==='Bear'?.44:.11;
    oval(head,skin,s*.31,earY,0,animal?.105:.068,animal?.111:.092,.063);
    oval(head,'#b97d62',s*.324,earY,.049,animal?.063:.032,.054,.018);
    const eyeY=.162, eyeH=v.eyes==='Round'?.065:v.eyes==='Narrow'?.041:.054;
    oval(head,'#fff7ec',s*.129,eyeY,.255,.078,eyeH,.043,-s*.05);
    oval(head,v.iris,s*.126,eyeY,.292,.043,eyeH*.84,.018);
    oval(head,ink,s*.126,eyeY,.307,.022,.032,.009);
    oval(head,'#ffffff',s*.126-.012,eyeY+.015,.316,.010,.011,.004);
    stroke(head,hair,[[s*.052,.243,.272],[s*.13,v.brows==='Straight'?.252:.275,.25],[s*.212,.245,.205]],v.brows==='Thick'?.025:.018);
  }
  if(animal)oval(head,'#e2b481',0,.026,.24,.20,.13,.092);
  oval(head,animal?ink:skin,0,.079,.277,v.nose==='Wide'?.078:v.nose==='Narrow'?.043:.061,.063,.068);
  stroke(head,'#814f4c',[[-.092,-.016,.282],[0,v.mouth==='Relaxed'?-.024:-.055,.302],[.092,-.016,.282]],.012);
  if(v.mouth==='Grin')oval(head,'#fff3df',0,-.027,.301,.071,.018,.008);
  if(v.beard==='Full'||v.beard==='Goatee'){
    oval(head,hair,0,-.131,.17,v.beard==='Full'?.211:.099,.101,.10);
    if(v.beard==='Full')for(const s of [-1,1]) oval(head,hair,s*.204,-.043,.139,.065,.14,.079,-s*.51);
  }
  if(v.beard!=='None')for(const s of [-1,1]) oval(head,hair,s*.052,.007,.295,.065,.018,.018,-s*.2);
  if(v.hairStyle!=='Bald'&&!animal){
    oval(head,hair,0,.381,-.043,.329,v.hairStyle==='Buzz'?.13:.174,.279);
    if(v.hairStyle!=='Buzz'){
      const curls=v.hairStyle==='Curls',count=curls?17:8;
      for(let i=0;i<count;i++){
        const t=i/(count-1),x=(t-.5)*.51;
        oval(head,hair,x,.407+.067*Math.sin(t*Math.PI),.125+.052*Math.sin(t*Math.PI),
          curls?.076:.096,curls?.085:.137,curls?.09:.114,curls?0:v.hairStyle==='Waves'?.47:-.69);
      }
    }
    if(v.hairStyle==='Ponytail'||v.hairStyle==='Long'){
      oval(head,hair,0,.13,-.23,.29,.37,.14);
      if(v.hairStyle==='Ponytail')oval(head,hair,0,.17,-.37,.14,.35,.12);
      else for(const s of [-1,1])oval(head,hair,s*.264,.12,.046,.085,.29,.10,-s*.12);
    }
  }
  if(v.glasses!=='None'){
    for(const s of [-1,1]){
      if(v.glasses==='Square')stroke(head,ink,[[s*.026,.206,.305],[s*.206,.21,.293],[s*.211,.117,.297],[s*.048,.103,.314],[s*.026,.206,.305]],.012);
      else part(head,ring,ink,s*.131,.158,.315,.101,.082,.078);
      if(v.glasses==='Sunglasses')oval(head,'#384354',s*.131,.158,.304,.099,.081,.014);
    }
    stroke(head,ink,[[-.031,.171,.316],[0,.184,.327],[.031,.171,.316]],.01);
  }
  if(v.hat!=='None'){
    const hat=v.hat==='Fedora'?'#70479a':cloth;
    oval(head,hat,0,.429,-.019,.354,.194,.32);
    if(v.hat==='Fedora') {oval(head,hat,0,.365,0,.427,.034,.371);part(head,cylinder,ink,0,.403,-.015,.337,.048,.294);}
    else if(v.hat==='Cap')oval(head,hat,0,.385,.238,.289,.032,.203);
    else oval(head,hat,0,.375,-.01,.358,.075,.321);
  }
  oval(torso,skin,0,.654,0,.12,.135,.121);
  if(v.top==='Hoodie'){
    oval(torso,cloth,0,.57,-.083,.278,.154,.207);
    for(const s of [-1,1])stroke(torso,'#efe9df',[[s*.105,.558,.151],[s*.086,.473,.197],[s*.093,.386,.215]],.009);
    oval(torso,cloth,0,.13,.174,.193,.084,.052);
  }else if(v.top==='Varsity'||v.top==='Suit'||v.top==='Polo'){
    for(const s of [-1,1])oval(torso,v.top==='Varsity'?'#eee3c7':v.top==='Suit'?'#4c515f':cloth,s*.089,.494,.153,.065,.122,.048,-s*.52);
    if(v.top==='Varsity')part(torso,cube,'#efda9e',-.173,.36,.177,.063,.08,.014);
    stroke(torso,'#d9cdbd',[[0,.47,.176],[0,.31,.215],[0,.035,.18]],.007);
  }
}
