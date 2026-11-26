import * as THREE from 'three';
import {CAUSTIC_GLSL} from './caustics';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {currentAt} from './ocean-motion';
import type {FishingState} from '../../../game/fishing';

const TAU=Math.PI*2;
const mix=THREE.MathUtils.lerp;
const clamp=THREE.MathUtils.clamp;
const palettes=[
 {side:'#c0bc60',back:'#567752',belly:'#eee2ad',fin:'#d9aa59',band:'#516344'},
 {side:'#61bdb1',back:'#397e89',belly:'#dbdfb1',fin:'#82c7b4',band:'#8575a2'},
 {side:'#e88f77',back:'#a25260',belly:'#f4d3ac',fin:'#cd6a62',band:'#af5558'},
 {side:'#ef852f',back:'#cb5b25',belly:'#f8ba72',fin:'#dc6c27',band:'#fff4dc'}, // clownfish
 {side:'#f2d235',back:'#d2a932',belly:'#f5e56a',fin:'#f4d447',band:'#d7a82b'}, // yellow tang
 {side:'#347bd2',back:'#253d80',belly:'#67b5d2',fin:'#f0d25c',band:'#183553'}, // blue tang
 {side:'#60b99d',back:'#3c8f96',belly:'#b5d2a9',fin:'#c486a1',band:'#cbbd94'}, // parrotfish
 {side:'#efe5a3',back:'#e4bf4a',belly:'#fff0c4',fin:'#dfad39',band:'#253c45'}, // butterflyfish
 {side:'#b8d3cb',back:'#477d95',belly:'#e6eee2',fin:'#7ca6a7',band:'#548c9c'}, // sardine
 {side:'#e1cc86',back:'#b9a06d',belly:'#eee2b1',fin:'#bfaa77',band:'#344349'}, // angelfish
 {side:'#bbaa68',back:'#817d4a',belly:'#ece0b1',fin:'#9aa36e',band:'#555941'}, // pufferfish

];

/** Reusable, shared-geometry reef fish; forward is +x, y is up. */
export function createFishLife(scene:THREE.Scene) {
 const root=new THREE.Group();root.name='reef-fish-life';scene.add(root);
 const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();
 const geometry=<T extends THREE.BufferGeometry>(g:T)=>{geometries.add(g);return g;};
 const material=(options:THREE.MeshStandardMaterialParameters)=>{const m=new THREE.MeshStandardMaterial(options);materials.add(m);return m;};
 const sphere=geometry(new THREE.SphereGeometry(1,10,8));
 // Static details are vertex-painted and merged into one shared draw per species.
 function bake(g:THREE.BufferGeometry,color?:THREE.ColorRepresentation,position=new THREE.Vector3(),scale=new THREE.Vector3(1,1,1)){
  const out=g.index?g.toNonIndexed():g.clone();
  for(const key of Object.keys(out.attributes))if(!['position','normal','color'].includes(key))out.deleteAttribute(key);
  out.scale(scale.x,scale.y,scale.z);out.translate(position.x,position.y,position.z);
  if(color!==undefined){const c=new THREE.Color(color),count=out.attributes.position.count,colors=new Float32Array(count*3);for(let i=0;i<count;i++){colors[i*3]=c.r;colors[i*3+1]=c.g;colors[i*3+2]=c.b;}out.setAttribute('color',new THREE.BufferAttribute(colors,3));}
  return out;
 }
 function shape(points:number[][]) {
  const s=new THREE.Shape();points.forEach(([x,y],i)=>i?s.lineTo(x,y):s.moveTo(x,y));s.closePath();
  return geometry(new THREE.ShapeGeometry(s,6));
 }
 const dorsal=shape([[-.33,.1],[-.26,.21],[-.21,.2],[-.16,.29],[-.10,.25],[-.04,.32],[.02,.27],[.1,.28],[.21,.19],[.28,.11]]);
 const ventral=shape([[-.3,-.08],[-.27,-.23],[-.11,-.21],[.05,-.1]]);
 const pectoral=shape([[.2,0],[.02,-.21],[-.11,-.12],[.1,.05]]);
 const tailGeo=shape([[0,0],[-.23,.18],[-.2,.055],[-.24,-.17],[0,-.035]]);
 const timeUniform={value:0};
 const proportions=[ [1,1,1],[1,.9,1],[1,1.1,1],[.85,1.15,1],[.78,1.65,.8],[.87,1.45,.8],[1.12,1.1,1],[.76,1.65,.8],[1.16,.7,.72],[.73,1.65,.75],[.77,1.65,1.7] ];
 const styles=palettes.map((p,id)=>{
  const base=new THREE.Color(p.side),back=new THREE.Color(p.back),belly=new THREE.Color(p.belly),band=new THREE.Color(p.band);
  const positions:number[]=[],colors:number[]=[],indices:number[]=[],n=24,rings=22;
  for(let j=0;j<=rings;j++){
   const u=j/rings,x=-.43+u*.94;
   const profile=Math.pow(Math.sin(u*Math.PI),.72)*(.84+.24*u);
   for(let k=0;k<=n;k++){
    const a=k/n*TAU,up=Math.cos(a),side=Math.sin(a);
    positions.push(x*proportions[id][0],up*.205*profile*proportions[id][1],side*.123*profile*proportions[id][2]);
    const c=base.clone();if(up>.15)c.lerp(back,Math.pow((up-.15)/.85,1.5)*.83);else if(up<-.25)c.lerp(belly,(-up-.25)/.75*.95);
    if(id===0){const stripe=Math.pow(Math.max(0,Math.cos((x+.34)*39)),12);c.lerp(band,stripe*.55*Math.max(0,1+up*.4));}
    if(id===1){const stripe=Math.pow(Math.max(0,Math.sin(up*14+x*7)),18);c.lerp(band,stripe*.27);}
    if(id===2){const fleck=Math.pow(Math.max(0,Math.sin(x*91+up*35)),26);c.lerp(belly,fleck*.23);}
    if(id===3){const d=Math.min(Math.abs(x+.25),Math.abs(x-.025),Math.abs(x-.30));if(d<.075)c.lerp(new THREE.Color('#293c38'),.92);if(d<.052)c.copy(band);}
    if(id===5){const mark=Math.exp(-Math.pow((up-.25-Math.sin(x*6)*.25)*7,2));c.lerp(band,mark*.95);}
    if(id===6){const scales=Math.pow(Math.max(0,Math.cos(x*90+Math.sin(a*9)*.8)),12);c.lerp(band,scales*.24);if(x>.27)c.lerp(new THREE.Color('#b28ba6'),.5);}
    if(id===7){if(Math.abs(x-.30)<.038||x<-.3)c.lerp(band,.9);if(Math.pow(x+.15,2)*8+Math.pow(up-.42,2)<.055)c.lerp(band,.85);}
    if(id===8){c.lerp(band,Math.exp(-Math.pow((up-.1)*7,2))*.45);}
    if(id===9){if(Math.sin((x+.05)*26)>.58)c.lerp(band,.9);}
    if(id===10){const spot=Math.sin(x*75+Math.sin(a*3)*4)*Math.cos(a*12);if(spot>.74&&up>-.5)c.lerp(band,.85);}
    colors.push(c.r,c.g,c.b);
   }
  }
  for(let j=0;j<rings;j++)for(let k=0;k<n;k++){const a=j*(n+1)+k,b=a+n+1;indices.push(a,a+1,b,b,a+1,b+1);}
  const g=geometry(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();
  const finScale=id===9?new THREE.Vector3(.85,2.6,1):id===10?new THREE.Vector3(.6,.6,1):new THREE.Vector3(proportions[id][0],Math.max(1,proportions[id][1]),1);
  const parts=[bake(g),bake(dorsal,p.fin,new THREE.Vector3(),finScale),bake(ventral,p.fin,new THREE.Vector3(),finScale)];
  for(const sign of [-1,1]){
   parts.push(bake(sphere,'#e7d694',new THREE.Vector3(.333*proportions[id][0],.035,sign*.091*proportions[id][2]),new THREE.Vector3(.044,.046,.019)));
   parts.push(bake(sphere,'#142d2d',new THREE.Vector3(.342*proportions[id][0],.039,sign*.106*proportions[id][2]),new THREE.Vector3(.026,.03,.012)));
   parts.push(bake(sphere,'#faf8dc',new THREE.Vector3(.349*proportions[id][0],.05,sign*.115*proportions[id][2]),new THREE.Vector3(.008,.009,.005)));
  }
  const merged=geometry(mergeGeometries(parts,false)!);parts.forEach(part=>part.dispose());
  const skin=material({vertexColors:true,roughness:id===8?.32:.48,metalness:id===8?.12:.025,side:THREE.DoubleSide});
  skin.onBeforeCompile=shader=>{
   shader.uniforms.fishTime=timeUniform;
   shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 reefFishWorld;').replace('#include <begin_vertex>','#include <begin_vertex>\nreefFishWorld=(modelMatrix*vec4(position,1.)).xyz;');
   shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 reefFishWorld;uniform float fishTime;\n'+CAUSTIC_GLSL).replace('#include <color_fragment>',`#include <color_fragment>
    float wet=1.-smoothstep(-.08,.05,reefFishWorld.y);
    diffuseColor.rgb*=1.+underwaterCaustic(reefFishWorld,fishTime)*.18*wet;
    diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.83,.96,1.),wet*clamp(-reefFishWorld.y*.12,0.,.25));`);
  };
  return {body:merged,skin,fin:material({color:p.fin,roughness:.63,side:THREE.DoubleSide,transparent:true,opacity:.9})};
 });
 function mesh(parent:THREE.Object3D,g:THREE.BufferGeometry,m:THREE.Material,x=0,y=0,z=0,sx=1,sy=1,sz=1){const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.scale.set(sx,sy,sz);parent.add(o);return o;}
 function makeFish(id:number,size:number){
  const group=new THREE.Group(),body=new THREE.Group(),tail=new THREE.Group();group.add(body);root.add(group);
  // All species bodies and finish materials are shared by their school.
  const style=styles[id];mesh(body,style.body,style.skin);
  tail.position.set(-.39*proportions[id][0],0,0);body.add(tail);const tailMesh=mesh(tail,tailGeo,style.fin);tailMesh.scale.setScalar(id===10?.55:id===8?.8:1);
  const fins:THREE.Mesh[]=[];
  for(const sign of [-1,1]){
   const fin=mesh(body,pectoral,style.fin,.09,-.015,sign*.105);fin.rotation.y=sign*.45;fins.push(fin);
  }
  group.scale.setScalar(size);return {group,body,tail,fins,id,size};
 }
 // Two small schools per reef species, plus twelve permanent catchable residents.
 const school=Array.from({length:48},(_,i)=>{const id=3+Math.floor(i/3)%8;return makeFish(id,(id===8?.43:id===10?.57:.61)+(i%3)*.055);});
 const residents=Array.from({length:12},(_,i)=>makeFish(i%3,.84+[.72,1.34,2.18][i%3]*.11));
 const hash=(n:number)=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v);};
 // Seeded, wide grazing routes cross the cove. Nothing is parameterized around
 // the raft: fish can pass underneath it and turn naturally between feeding spots.
 const routes=Array.from({length:20},(_,family)=>{
  const points=Array.from({length:9},(_,j)=>new THREE.Vector3(
   (hash(family*29+j*7+8)-.5)*15,
   -.58-hash(family*17+j+391)*.7,
   (hash(family*31+j*13+782)-.5)*10));
  const curve=new THREE.CatmullRomCurve3(points,true,'centripetal');
  curve.arcLengthDivisions=240;curve.updateArcLengths();return curve;
 });
 const positions=[new THREE.Vector3(),new THREE.Vector3()];
 const path=(time:number,i:number,out:THREE.Vector3)=>{
  const family=Math.floor(i/3),slot=i%3,route=routes[family];
  const speed=.34+hash(family+38)*.24;
  // Arc-length sampling maintains speed through bends; followers trail rather
  // than rotating in a rigid formation. Slow bursts alternate with gliding.
  const distance=time*speed+.15*Math.sin(time*.65+family)-slot*.38;
  const u=((distance/route.getLength()+hash(family+82))%1+1)%1;
  route.getPointAt(u,out);
  out.x+=Math.sin(time*.23+i*2.4)*.10;out.z+=Math.cos(time*.19+i*2.1)*.12;
  out.y-=slot*.09;
  const flow=currentAt(out.x,out.z,time);out.x+=flow.x;out.z+=flow.z;
  return out;
 };
 function animate(f:ReturnType<typeof makeFish>,time:number,frequency:number,effort=1){
  const wave=Math.sin(time*frequency+f.id*.8);
  f.tail.rotation.y=wave*.32*effort;f.body.rotation.y=wave*.025*effort;
  f.fins.forEach((fin,j)=>{fin.rotation.y=(j?1:-1)*(.42+Math.sin(time*frequency*.55+j)*.17);});
 }
 const all=[...school,...residents];
 all.forEach((f,i)=>path(0,i,f.group.position));
 let selected:typeof residents[number]|undefined,lastCast=-1,lastPhase='',lastTime:number|undefined;
 const approachStart=new THREE.Vector3(),phaseStart=new THREE.Vector3(),previous=new THREE.Vector3();
 const hookPoint=new THREE.Vector3(),mouthLocal=new THREE.Vector3(),catchOutward=new THREE.Vector3(1,0,0);
 const avoidance=all.map(()=>new THREE.Vector3()),swimPhase=all.map((_,i)=>i*2.399);
 let catchHeading=0,catchPitch=0,hookedVisible=false;
 const ease=(p:number)=>{p=clamp(p,0,1);return p*p*(3-2*p);};
 const returnOffsets=new Map<typeof residents[number],{offset:THREE.Vector3;time:number}>();
 function release(time:number){
  if(!selected)return;
  path(time,48+residents.indexOf(selected),positions[0]);
  returnOffsets.set(selected,{offset:selected.group.position.clone().sub(positions[0]),time});
  selected=undefined;
 }
 function update(time:number,state:FishingState,bobberPosition:THREE.Vector3){
  timeUniform.value=time;hookedVisible=false;
  const boat=state.boat,boatX=boat?.x??0,boatZ=boat?.z??0;
  const boatSpeed=Math.hypot(boat?.vx??0,boat?.vz??0);
  const dt=lastTime===undefined?1/60:clamp(time-lastTime,0,.1);lastTime=time;
  if(state.castCount!==lastCast){
   release(time);lastCast=state.castCount;
   if(state.phase!=='aim'){
    const id=state.species.id==='snapper'?2:state.species.id==='wrasse'?1:0;
    selected=residents.filter(f=>f.id===id).sort((a,b)=>
     Math.hypot(a.group.position.x-state.target.x,a.group.position.z-state.target.z)-
     Math.hypot(b.group.position.x-state.target.x,b.group.position.z-state.target.z))[0];
    returnOffsets.delete(selected);approachStart.copy(selected.group.position);
   }
  }
  if(state.phase!==lastPhase){
   if(selected){
    phaseStart.copy(selected.group.position);
    if(state.phase==='waiting')approachStart.copy(selected.group.position);
    if(state.phase==='caught'){
     catchHeading=selected.group.rotation.y;catchPitch=selected.group.rotation.z;
     catchOutward.set(state.target.x-boatX,0,state.target.z-boatZ);
     if(catchOutward.lengthSq()<.01)catchOutward.set(1,0,0);catchOutward.normalize();
    }
   }
   if(state.phase==='escaped'||state.phase==='aim')release(time);
   lastPhase=state.phase;
  }
  const disturbance=state.phase==='waiting'?Math.sin(clamp(state.phaseFrame/70,0,1)*Math.PI)*.55:0;
  all.forEach((f,i)=>{
   if(f===selected&&['waiting','bite','reeling','caught'].includes(state.phase))return;
   previous.copy(f.group.position);path(time,i,positions[0]);
   const ret=returnOffsets.get(f);
   if(ret){positions[0].addScaledVector(ret.offset,Math.exp(-(time-ret.time)*.8));if(time-ret.time>12)returnOffsets.delete(f);}
   const ax=positions[0].x-state.target.x,az=positions[0].z-state.target.z,d=Math.hypot(ax,az);
   if(disturbance&&d>.01){const reach=Math.max(0,1-d/2.8);positions[0].x+=ax/d*reach*disturbance;positions[0].z+=az/d*reach*disturbance;}
   // Fish ease aside and dive below an approaching hull. The avoidance field
   // follows the moving boat; it never creates a circular orbit around it.
   const rx=positions[0].x-(boatX+(boat?.vx??0)*.65),rz=positions[0].z-(boatZ+(boat?.vz??0)*.65),range=Math.hypot(rx,rz);
   const influence=1-ease((range-1.0)/2.0),moving=clamp(boatSpeed/.65,0,1);
   const away=positions[1].set(rx,0,rz);if(range<.01)away.set(1,0,0);away.normalize().multiplyScalar(influence*moving*.8);
   away.y=-influence*(.22+moving*.24);
   avoidance[i].lerp(away,1-Math.exp(-dt*2.5));positions[0].add(avoidance[i]);
   f.group.position.copy(positions[0]);
   const dx=positions[0].x-previous.x,dz=positions[0].z-previous.z;
   const speed=dt>0?Math.hypot(dx,dz)/dt:0;
   const heading=speed>.01?Math.atan2(-dz,dx):f.group.rotation.y;
   const difference=Math.atan2(Math.sin(heading-f.group.rotation.y),Math.cos(heading-f.group.rotation.y));
   f.group.rotation.y+=difference*(1-Math.exp(-dt*3.2));
   const bank=clamp(-difference*.07,-.10,.10),rise=clamp((positions[0].y-previous.y)/Math.max(.001,Math.hypot(dx,dz)),-.18,.18);
   f.group.rotation.x=mix(f.group.rotation.x,bank,1-Math.exp(-dt*4));
   f.group.rotation.z=mix(f.group.rotation.z,rise,1-Math.exp(-dt*3));
   swimPhase[i]+=dt*(4+clamp(speed,0,1.2)*5);
   animate(f,swimPhase[i],1,.35+clamp(speed,0,1)*.45);
  });
  const f=selected;if(!f)return;
  previous.copy(f.group.position);
  const mouthDistance=.48*proportions[f.id][0]*f.size;
  if(state.phase==='waiting'){
   const p=clamp(state.phaseFrame/state.waitFrames,0,1),blend=ease(p);
   const approachHeading=Math.atan2(approachStart.z-bobberPosition.z,bobberPosition.x-approachStart.x);
   positions[0].copy(bobberPosition).add(new THREE.Vector3(-Math.cos(approachHeading)*mouthDistance,-.16,Math.sin(approachHeading)*mouthDistance));
   f.group.position.copy(approachStart).lerp(positions[0],blend);
   f.group.position.z+=Math.sin(p*Math.PI)*.28;
  }else if(state.phase==='bite'||state.phase==='reeling'){
   // The mouth, not the fish's middle, meets the line. Fish face the pull
   // direction while the tail makes small lateral kicks below the surface.
   const heading=state.phase==='reeling'?Math.atan2(bobberPosition.z-boatZ,boatX-bobberPosition.x):f.group.rotation.y;
   const turn=Math.atan2(Math.sin(heading-f.group.rotation.y),Math.cos(heading-f.group.rotation.y));
   f.group.rotation.y+=turn*(1-Math.exp(-dt*4));
   f.group.rotation.z=mix(f.group.rotation.z,.16,1-Math.exp(-dt*4));
   f.group.rotation.x*=Math.exp(-dt*4);
   mouthLocal.set(mouthDistance,0,0).applyEuler(f.group.rotation);
   positions[0].copy(bobberPosition).add(new THREE.Vector3(0,-.13,0)).sub(mouthLocal);
   f.group.position.copy(phaseStart).lerp(positions[0],ease(state.phaseFrame/12));
   hookedVisible=true;
  }else if(state.phase==='caught'){
   const age=state.phaseFrame;
   const lift=ease(age/40),lower=ease((age-80)/42);
   const landing=new THREE.Vector3(boatX+catchOutward.x*1.85,.78,boatZ+catchOutward.z*1.85);
   f.group.position.copy(phaseStart).lerp(landing,lift);
   if(age>80)f.group.position.lerp(new THREE.Vector3(boatX+catchOutward.x*2.55,-.82,boatZ+catchOutward.z*2.55),lower);
   // Preserve yaw for the entire lift; only a gentle nose-up hang and pendulum
   // motion remain. No trajectory-derived heading reversal at the arc apex.
   f.group.rotation.y=catchHeading;
   f.group.rotation.x*=Math.exp(-dt*5);
   f.group.rotation.z=mix(catchPitch,.92,lift)*(1-lower)+Math.sin(age*.09)*.025*lift*(1-lower);
   hookedVisible=age<82;
   animate(f,time,7,.22);
   if(age>=122){release(time);return;}
  }else return;
  if(state.phase==='waiting'){
   const dx=f.group.position.x-previous.x,dz=f.group.position.z-previous.z;
   const heading=Math.hypot(dx,dz)>.00001?Math.atan2(-dz,dx):f.group.rotation.y;
   const difference=Math.atan2(Math.sin(heading-f.group.rotation.y),Math.cos(heading-f.group.rotation.y));
   f.group.rotation.y+=difference*(1-Math.exp(-dt*5));
   f.group.rotation.z=mix(f.group.rotation.z,.04,1-Math.exp(-dt*4));
  }
  if(state.phase!=='caught')animate(f,time,state.phase==='reeling'?11:7,state.phase==='reeling'?.85:.65);
  // Shared by the scene's line renderer; an explicit endpoint prevents the
  // line from slipping off the mouth as the body pitches during the lift.
  mouthLocal.set(mouthDistance,0,0).applyEuler(f.group.rotation);
  hookPoint.copy(f.group.position).add(mouthLocal);
 }
 function dispose(){scene.remove(root);geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}
 return {update,dispose,hookPosition:()=>hookedVisible?hookPoint:null};
}
