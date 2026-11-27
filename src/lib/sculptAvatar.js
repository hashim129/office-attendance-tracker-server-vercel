// The facial features follow the head joint. The wardrobe follows the torso.
import * as T from 'three';
const sphere=new T.SphereGeometry(1,32,24);
const cylinder=new T.CylinderGeometry(1,1,1,36);
const cone=new T.ConeGeometry(1,1,28);
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
const mixCache=new Map();
function mix(a,b,t){
  const key=a+b+t;
  if(!mixCache.has(key))mixCache.set(key,'#'+new T.Color(a).lerp(new T.Color(b),t).getHexString());
  return mixCache.get(key);
}
const GOLD='#e2b33c';
const LONG_SLEEVES=['Hoodie','Varsity','Suit','Kurta','Blazer','Sweater','Abaya','Admin command jacket','CEO gold sherwani'];
export const hasLongSleeves=(top)=>LONG_SLEEVES.includes(top);

export function sculpt(head,torso,v){
  const skin=v.skin,hair=v.hairColor,ink='#282029',cloth=v.fabric,animal=v.model!=='Human';
  const covered=v.hat==='Hijab', wrapped=v.hat==='Turban';
  const ex=v.expression||'Happy';
  const faceScale={Round:[1.17,1.02],Angular:[1.05,1.11],Heart:[1.1,1.0],Long:[.98,1.15]}[v.face]||[1.05,1.02];
  head.scale.set(faceScale[0],faceScale[1],1.07);
  oval(head,skin,0,.12,0,.32,.39,.29);
  if(v.face==='Heart')oval(head,skin,0,-.1,.1,.17,.14,.17);
  for(const s of [-1,1]){
    const earY=v.model==='Bear'?.44:.11;
    if(!covered){
      oval(head,skin,s*.31,earY,0,animal?.105:.068,animal?.111:.092,.063);
      oval(head,'#b97d62',s*.324,earY,.049,animal?.063:.032,.054,.018);
      if(!animal&&v.earrings&&v.earrings!=='None'){
        if(v.earrings==='Studs')oval(head,GOLD,s*.33,.035,.03,.016,.016,.016);
        else if(v.earrings==='Hoops')part(head,ring,GOLD,s*.335,.0,.02,.035,.035,.035);
        else {oval(head,GOLD,s*.33,.03,.03,.012,.012,.012);oval(head,'#3aa6b9',s*.33,-.02,.03,.018,.03,.018);}
      }
    }
    // Eyes. Expressions replace or modify the base eye shape.
    const eyeY=.162;
    const baseH=v.eyes==='Round'?.065:v.eyes==='Narrow'?.041:v.eyes==='Big'?.078:v.eyes==='Sleepy'?.034:.054;
    const eyeH=ex==='Surprised'?baseH*1.3:baseH;
    const eyeW=(v.eyes==='Big'?.09:.078)*(ex==='Surprised'?1.12:1);
    const closed=(ex==='Wink'&&s===1)||ex==='Laughing';
    if(closed){
      stroke(head,ink,[[s*.075,eyeY-.005,.29],[s*.126,eyeY+.03,.305],[s*.177,eyeY-.005,.29]],.011);
    }else{
      oval(head,'#fff7ec',s*.129,eyeY,.255,eyeW,eyeH,.043,-s*.05);
      const iris=ex==='Love'?'#e2457a':v.iris;
      oval(head,iris,s*.126,eyeY,.292,ex==='Love'?.05:.043,eyeH*.84,.018);
      oval(head,ink,s*.126,eyeY,.307,.022,Math.min(.032,eyeH*.6),.009);
      oval(head,'#ffffff',s*.126-.012,eyeY+.015,.316,.010,.011,.004);
      if(ex==='Sleepy'||v.eyes==='Sleepy')oval(head,mix(skin,'#000000',.08),s*.129,eyeY+eyeH*.45,.27,eyeW*1.06,eyeH*.62,.05,-s*.05);
      // Lashes give the "sticker" look most avatar apps have.
      stroke(head,ink,[[s*.06,eyeY+eyeH*.55,.275],[s*.129,eyeY+eyeH*.95,.29],[s*.2,eyeY+eyeH*.5,.268]],.007);
    }
    const browLift=ex==='Surprised'?.03:(ex==='Cool'&&s===1)?.022:0;
    const angry=v.brows==='Angry';
    const browW=v.brows==='Thick'?.025:v.brows==='Thin'?.011:.018;
    stroke(head,hair,[[s*.052,.243+browLift-(angry?.02:0),.272],[s*.13,(v.brows==='Straight'||angry?.252:.275)+browLift,.25],[s*.212,.245+browLift+(angry?.02:0),.205]],browW);
    if(v.cheeks==='Blush'||v.cheeks==='Blush + freckles'||ex==='Love'||ex==='Laughing')oval(head,'#f08a9a',s*.19,.045,.245,.06,.032,.02);
    if(v.cheeks==='Freckles'||v.cheeks==='Blush + freckles')for(const [dx,dy] of [[.15,.08],[.18,.06],[.2,.085],[.165,.05]])oval(head,mix(skin,'#5a3420',.45),s*dx,dy,.275,.008,.008,.004);
  }
  if(animal)oval(head,'#e2b481',0,.026,.24,.20,.13,.092);
  const noseW=v.nose==='Wide'?.078:v.nose==='Narrow'?.043:v.nose==='Pointed'?.05:.061;
  oval(head,animal?ink:skin,0,.079,v.nose==='Pointed'?.29:.277,noseW,.063,v.nose==='Pointed'?.09:.068);
  // Mouth: big expressions override the everyday mouth choice.
  const mouth=ex==='Surprised'?'O':ex==='Laughing'?'Open':ex==='Cool'?'Smirk':v.mouth;
  if(mouth==='O'){oval(head,'#5b2630',0,-.035,.29,.035,.045,.02);}
  else if(mouth==='Open'){oval(head,'#5b2630',0,-.035,.288,.08,.045,.02);oval(head,'#fff3df',0,-.012,.302,.065,.014,.008);oval(head,'#e2697a',0,-.058,.299,.045,.016,.008);}
  else if(mouth==='Smirk'){stroke(head,'#814f4c',[[-.08,-.03,.285],[0,-.04,.302],[.095,-.005,.28]],.012);}
  else {
    stroke(head,'#814f4c',[[-.092,-.016,.282],[0,mouth==='Relaxed'?-.024:-.055,.302],[.092,-.016,.282]],.012);
    if(mouth==='Grin')oval(head,'#fff3df',0,-.027,.301,.071,.018,.008);
  }
  if(v.beard==='Stubble')oval(head,mix(skin,hair,.28),0,-.11,.14,.24,.13,.16);
  if(v.beard==='Full'||v.beard==='Goatee'){
    oval(head,hair,0,-.131,.17,v.beard==='Full'?.211:.099,.101,.10);
    if(v.beard==='Full')for(const s of [-1,1]) oval(head,hair,s*.204,-.043,.139,.065,.14,.079,-s*.51);
  }
  if(v.beard==='Full'||v.beard==='Goatee'||v.beard==='Moustache')for(const s of [-1,1]) oval(head,hair,s*.052,.007,.295,.065,.018,.018,-s*.2);
  const showHair=!animal&&v.hairStyle!=='Bald'&&!covered&&!wrapped;
  if(showHair){
    const style=v.hairStyle;
    if(style==='Afro'){
      oval(head,hair,0,.39,-.06,.47,.36,.42);
      for(let i=0;i<14;i++){const a=i/14*Math.PI*2;oval(head,hair,.42*Math.cos(a),.39+.26*Math.sin(a),-.08,.13,.13,.13);}
    }else if(style==='Mohawk'){
      oval(head,mix(skin,hair,.35),0,.36,-.04,.325,.14,.28);
      for(let i=0;i<7;i++){const t=i/6;oval(head,hair,0,.47+.06*Math.sin(t*Math.PI),.2-.45*t,.05,.12,.07);}
    }else{
      oval(head,hair,0,.381,-.043,.329,style==='Buzz'?.13:.174,.279);
      if(style==='Side part'){oval(head,hair,-.08,.43,.13,.26,.11,.15,.35);oval(head,hair,.2,.36,.13,.1,.1,.12,-.4);}
      else if(style==='Bun'){oval(head,hair,0,.6,-.08,.13,.12,.12);}
      else if(style==='Bob'){for(const s of [-1,1])oval(head,hair,s*.285,.13,.0,.1,.3,.2,-s*.08);oval(head,hair,0,.37,.17,.3,.1,.12);}
      else if(style==='Braids'){for(const s of [-1,1])for(let k=0;k<5;k++)oval(head,hair,s*.26,.12-k*.1,-.06,.055,.06,.055);}
      else if(style!=='Buzz'){
        const curls=style==='Curls',count=curls?17:8;
        for(let i=0;i<count;i++){
          const t=i/(count-1),x=(t-.5)*.51;
          oval(head,hair,x,.407+.067*Math.sin(t*Math.PI),.125+.052*Math.sin(t*Math.PI),
            curls?.076:.096,curls?.085:.137,curls?.09:.114,curls?0:style==='Waves'?.47:-.69);
        }
      }
      if(style==='Ponytail'||style==='Long'){
        oval(head,hair,0,.13,-.23,.29,.37,.14);
        if(style==='Ponytail')oval(head,hair,0,.17,-.37,.14,.35,.12);
        else for(const s of [-1,1])oval(head,hair,s*.264,.12,.046,.085,.29,.10,-s*.12);
      }
    }
  }
  const glasses=v.glasses!=='None'?v.glasses:(ex==='Cool'?'Sunglasses':'None');
  if(glasses!=='None'){
    for(const s of [-1,1]){
      if(glasses==='Square')stroke(head,ink,[[s*.026,.206,.305],[s*.206,.21,.293],[s*.211,.117,.297],[s*.048,.103,.314],[s*.026,.206,.305]],.012);
      else if(glasses==='Aviator'){part(head,ring,GOLD,s*.131,.15,.315,.105,.095,.078);oval(head,'#5a4a3a',s*.131,.15,.304,.1,.09,.014);}
      else if(glasses==='Star shades'){part(head,ring,'#ff4fa3',s*.131,.158,.315,.115,.1,.078);oval(head,'#ffd23f',s*.131,.158,.304,.105,.09,.014);}
      else part(head,ring,ink,s*.131,.158,.315,.101,.082,.078);
      if(glasses==='Sunglasses')oval(head,'#384354',s*.131,.158,.304,.099,.081,.014);
    }
    stroke(head,glasses==='Aviator'?GOLD:ink,[[-.031,.171,.316],[0,.184,.327],[.031,.171,.316]],.01);
  }
  if(v.hat!=='None'){
    const hat=v.hat==='Fedora'?'#70479a':cloth;
    if(covered){
      // Hijab: frames the face, covers hair, ears and neck.
      oval(head,hat,0,.15,-.07,.37,.44,.34);
      stroke(head,mix(hat,'#ffffff',.18),[[-.27,-.05,.2],[-.3,.2,.2],[-.18,.42,.2],[0,.47,.21],[.18,.42,.2],[.3,.2,.2],[.27,-.05,.2]],.03);
      oval(head,hat,0,-.24,-.01,.34,.2,.29);
    }else if(wrapped){
      oval(head,hat,0,.36,-.02,.37,.22,.34);
      for(const y of [.3,.38,.46])stroke(head,mix(hat,'#000000',.15),[[-.34,y-.03,.08],[0,y+.03,.33],[.34,y-.03,.08]],.014);
      oval(head,GOLD,0,.38,.33,.04,.05,.02);
    }else if(v.hat==='Headphones'){
      stroke(head,ink,[[-.34,.1,0],[-.31,.42,0],[0,.57,0],[.31,.42,0],[.34,.1,0]],.026);
      for(const s of [-1,1])oval(head,'#ff4f6d',s*.34,.1,0,.06,.1,.09);
    }else if(v.hat==='Crown'){
      part(head,cylinder,GOLD,0,.52,0,.24,.08,.24);
      for(let i=0;i<6;i++){const a=i/6*Math.PI*2;part(head,cone,GOLD,.22*Math.cos(a),.6,.22*Math.sin(a),.04,.1,.04);}
      oval(head,'#d23c5a',0,.53,.24,.03,.03,.02);
    }else if(v.hat==='CEO royal crown'){
      // Taller crown with a velvet cap and three jewels: CEO only.
      oval(head,'#7a1f3d',0,.5,0,.22,.12,.22);
      part(head,cylinder,GOLD,0,.5,0,.27,.1,.27);
      for(let i=0;i<8;i++){const a=i/8*Math.PI*2;part(head,cone,GOLD,.25*Math.cos(a),.62,.25*Math.sin(a),.045,.16,.045);oval(head,'#fff3b0',.25*Math.cos(a),.71,.25*Math.sin(a),.022,.022,.022);}
      oval(head,'#2f6fe0',-.12,.5,.235,.03,.03,.02);oval(head,'#d23c5a',0,.5,.27,.04,.04,.025);oval(head,'#1fa36b',.12,.5,.235,.03,.03,.02);
      oval(head,GOLD,0,.68,0,.045,.045,.045);
    }else if(v.hat==='Admin shield cap'){
      // Navy cap with a glowing shield badge: Admin only.
      oval(head,'#1e2a5a',0,.429,-.019,.354,.194,.32);
      oval(head,'#1e2a5a',0,.385,.238,.289,.032,.203);
      oval(head,'#8b5cf6',0,.47,.3,.075,.085,.025);
      oval(head,'#e9d5ff',0,.475,.318,.035,.042,.012);
    }else if(v.hat==='Accounts visor'){
      // Green banker's visor with a gold band: Accounts only.
      part(head,cylinder,'#0f7a55',0,.36,0,.36,.06,.33);
      oval(head,'#16a36f',0,.36,.25,.3,.025,.2);
      part(head,cylinder,GOLD,0,.395,0,.362,.015,.332);
    }else if(v.hat==='Party hat'){
      const c=part(head,cone,'#ff4fa3',.03,.67,0,.17,.36,.17,-.12);
      oval(head,'#ffd23f',.07,.86,0,.05,.05,.05); void c;
    }else{
      oval(head,hat,0,.429,-.019,.354,.194,.32);
      if(v.hat==='Fedora') {oval(head,hat,0,.365,0,.427,.034,.371);part(head,cylinder,ink,0,.403,-.015,.337,.048,.294);}
      else if(v.hat==='Cap')oval(head,hat,0,.385,.238,.289,.032,.203);
      else oval(head,hat,0,.375,-.01,.358,.075,.321);
    }
  }
  oval(torso,covered?cloth:skin,0,.654,0,.12,.135,.121);
  const top=v.top;
  if(top==='Hoodie'){
    oval(torso,cloth,0,.57,-.083,.278,.154,.207);
    for(const s of [-1,1])stroke(torso,'#efe9df',[[s*.105,.558,.151],[s*.086,.473,.197],[s*.093,.386,.215]],.009);
    oval(torso,cloth,0,.13,.174,.193,.084,.052);
  }else if(top==='Varsity'||top==='Suit'||top==='Polo'||top==='Blazer'){
    if(top==='Blazer')part(torso,cube,'#f5f1ea',0,.42,.18,.12,.24,.02);
    for(const s of [-1,1])oval(torso,top==='Varsity'?'#eee3c7':top==='Suit'?'#4c515f':top==='Blazer'?mix(cloth,'#000000',.25):cloth,s*.089,.494,.153,.065,.122,.048,-s*.52);
    if(top==='Varsity')part(torso,cube,'#efda9e',-.173,.36,.177,.063,.08,.014);
    stroke(torso,'#d9cdbd',[[0,.47,.176],[0,.31,.215],[0,.035,.18]],.007);
  }else if(top==='Kurta'||top==='Abaya'){
    oval(torso,cloth,0,top==='Abaya'?-.28:0,0,.34,top==='Abaya'?.72:.4,.23);
    stroke(torso,top==='Kurta'?GOLD:mix(cloth,'#ffffff',.2),[[0,.6,.13],[0,.44,.205],[0,.26,.22]],.009);
    if(top==='Kurta')for(const y of [.52,.44,.36])oval(torso,GOLD,0,y,.215,.01,.01,.01);
  }else if(top==='Sweater'){
    oval(torso,mix(cloth,'#000000',.2),0,.02,0,.33,.06,.22);
    oval(torso,mix(cloth,'#000000',.2),0,.64,0,.15,.04,.14);
  }else if(top==='Admin command jacket'){
    // Deep purple jacket, silver zip and a shield badge: Admin only.
    oval(torso,'#2e1f5e',0,.29,0,.335,.5,.22);
    stroke(torso,'#c7c9d9',[[0,.6,.17],[0,.38,.222],[0,.05,.19]],.011);
    oval(torso,'#8b5cf6',-.17,.42,.205,.055,.065,.02);oval(torso,'#ede9fe',-.17,.425,.222,.025,.03,.008);
    for(const s of [-1,1])oval(torso,'#3d2a7a',s*.089,.53,.15,.07,.07,.05);
  }else if(top==='CEO gold sherwani'){
    // Long gold sherwani with buttons and a pocket square: CEO only.
    oval(torso,'#b8892b',0,.05,0,.345,.62,.235);
    stroke(torso,'#fff1c1',[[0,.62,.15],[0,.4,.225],[0,.0,.235],[0,-.3,.2]],.009);
    for(const y of [.55,.45,.35,.25,.15])oval(torso,'#fff7d6',0,y,.228,.013,.013,.013);
    oval(torso,'#7a1f3d',-.17,.44,.205,.045,.03,.02);
    part(torso,cylinder,'#8a6418',0,.64,0,.135,.05,.13);
  }else if(top==='Accounts ledger vest'){
    // Shirt with a dark green waistcoat and a gold coin pin: Accounts only.
    oval(torso,'#f4f1ea',0,.29,0,.325,.49,.215);
    for(const s of [-1,1])oval(torso,'#0f5a40',s*.15,.27,.05,.19,.44,.18);
    for(const y of [.4,.3,.2])oval(torso,GOLD,0,y,.218,.012,.012,.012);
    oval(torso,GOLD,.17,.44,.2,.035,.035,.015);
  }else if(top==='Jersey'){
    for(const y of [.42,.3])oval(torso,'#ffffff',0,y,0,.325,.025,.215);
  }
}
