import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { FishingState } from '../../../game/fishing';
import { raftPose } from './ocean-motion';
const TAU=Math.PI*2;
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const random=(i:number)=>{const n=Math.sin(i*127.1+313.7)*43758.5453;return n-Math.floor(n);};

/** Handmade assets, isolated from gameplay. All coordinates are metres, y up. */
export function createRaft(scene:THREE.Scene){
 const group=new THREE.Group();group.name='handmade-raft';scene.add(group);
 const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
 const geo=<T extends THREE.BufferGeometry>(g:T)=>{geometries.add(g);return g;};
 const material=(color:THREE.ColorRepresentation,roughness=.8)=>{const m=new THREE.MeshStandardMaterial({color,roughness});materials.add(m);return m;};
 const mesh=(parent:THREE.Object3D,g:THREE.BufferGeometry,m:THREE.Material,p=V(),s=V(1,1,1))=>{const o=new THREE.Mesh(g,m);o.position.copy(p);o.scale.copy(s);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;};
 const ball=geo(new THREE.SphereGeometry(1,20,14));
 const cylinder=geo(new THREE.CylinderGeometry(1,1,1,16));
 const ellipsoid=(parent:THREE.Object3D,m:THREE.Material,p:THREE.Vector3,s:THREE.Vector3)=>mesh(parent,ball,m,p,s);
 const tube=(parent:THREE.Object3D,pts:THREE.Vector3[],radius:number,m:THREE.Material,segments=48)=>mesh(parent,geo(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),segments,radius,6,false)),m);
 function canvasTexture(w:number,h:number,draw:(c:CanvasRenderingContext2D)=>void){const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;draw(canvas.getContext('2d')!);const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;textures.add(t);return t;}
 const woodTexture=canvasTexture(1024,128,c=>{
  c.fillStyle='#c5a26c';c.fillRect(0,0,1024,128);
  for(let i=0;i<110;i++){const y=random(i)*128;c.strokeStyle=`rgba(${i%3?65:246},${i%3?44:218},${i%3?25:164},${.04+random(i+71)*.11})`;c.lineWidth=.3+random(i+193)*1.8;c.beginPath();c.moveTo(0,y);for(let x=0;x<=1024;x+=12)c.lineTo(x,y+Math.sin(x*.015+i)*1.2+Math.sin(x*.002+i)*3);c.stroke();}
  for(let i=0;i<12;i++){const x=random(i+98)*1024,y=random(i+530)*128;c.strokeStyle='rgba(67,45,23,.18)';c.lineWidth=.7;c.beginPath();c.ellipse(x,y,7+random(i)*9,1.8,0,0,TAU);c.stroke();}
  c.fillStyle='rgba(50,38,24,.18)';for(let i=0;i<1700;i++)c.fillRect(random(i+300)*1024,random(i+3101)*128,.8,.7);
 });
 const woodMats=['#d4b080','#be945f','#d1ab73','#c8a370'].map(color=>{const m=material(color,.85);m.map=woodTexture;m.bumpMap=woodTexture;m.bumpScale=.014;return m;});
 const endMat=material('#8a6744'),ropeMat=material('#c1b087'),ropeShade=material('#8c805f');
 const ropeTex=canvasTexture(128,128,c=>{c.fillStyle='#bfae84';c.fillRect(0,0,128,128);c.strokeStyle='#8e8162';c.lineWidth=2;for(let x=-128;x<256;x+=12){c.beginPath();c.moveTo(x,0);c.lineTo(x+128,128);c.stroke();}});ropeMat.map=ropeTex;ropeMat.bumpMap=ropeTex;ropeMat.bumpScale=.008;
 const board=geo(new RoundedBoxGeometry(3.1,.18,.265,3,.036));
 for(let i=0;i<9;i++){
  const z=(i-4)*.283,plank=mesh(group,board,woodMats[i%4],V((random(i+3)-.5)*.13,.18+(random(i+78)-.5)*.014,z));plank.rotation.y=(random(i+10)-.5)*.014;
  for(const x of [-1.38,1.38]){const nail=mesh(plank,cylinder,endMat,V(x,.096,0),V(.013,.008,.013));nail.rotation.y=i;}
 }
 const beam=geo(new RoundedBoxGeometry(.19,.19,2.62,3,.04));
 for(const x of [-1.08,1.08]){
  mesh(group,beam,endMat,V(x,.015,0));
  // Hemp is tied around both support and all the deck timbers in three close turns.
  for(let j=0;j<3;j++){const xx=x+(j-1)*.048;const pts=[V(xx,.31,-1.26),V(xx,.30,1.25),V(xx,.22,1.33),V(xx,-.065,1.28),V(xx,-.10,-1.25),V(xx,.1,-1.33),V(xx,.31,-1.26)];tube(group,pts,.021,ropeMat,80);}
  const knot=ellipsoid(group,ropeMat,V(x,.34,.88),V(.10,.045,.07));knot.rotation.y=.4;
  tube(group,[V(x,.35,.85),V(x+.12,.32,1.05),V(x+.15,.27,1.35),V(x+.18,.06,1.43)],.017,ropeMat);
 }
 // A single continuous loose coil with one end slipping over the timber.
 const coil=Array.from({length:210},(_,i)=>{const a=i/209*TAU*4.5,r=.075+i*.0008;return V(-1.07+Math.cos(a)*r,.29+Math.sin(a*.3)*.009,.55+Math.sin(a)*r);});tube(group,coil,.018,ropeMat,160);
 tube(group,[coil[209],V(-1.34,.29,.76),V(-1.54,.18,.83),V(-1.55,-.02,.86)],.018,ropeMat);
 // Quiet deck props: wicker creel and an old enamel bait tin.
 const wicker=material('#9a8255');const creel=new THREE.Group();creel.position.set(-1.03,.28,-.58);group.add(creel);
 mesh(creel,geo(new RoundedBoxGeometry(.40,.32,.43,3,.09)),wicker,V(0,.16,0));
 for(let j=0;j<7;j++){const y=.03+j*.045;tube(creel,[V(-.18,y,-.18),V(.18,y,-.18),V(.19,y,.16),V(-.17,y,.20),V(-.18,y,-.18)],.006,ropeShade,36);}
 tube(creel,[V(0,.30,-.16),V(0,.55,-.13),V(0,.57,.12),V(0,.30,.16)],.016,ropeMat);
 const tin=material('#718d82',.45);mesh(group,cylinder,tin,V(-.63,.36,-.9),V(.11,.16,.11));mesh(group,cylinder,material('#c2c9b9',.35),V(-.63,.445,-.9),V(.115,.018,.115));
 // A small, friendly stick figure: simple face, slender charcoal limbs, sun hat.
 const cream=material('#e4ad73'),denim=material('#719891'),darkDenim=material('#34484a'),skin=material('#35494a'),boot=material('#304144'),hair=material('#35494a'),eye=material('#34484a');
 const person=new THREE.Group();person.position.set(-.15,.29,0);group.add(person);
 const crateMat=woodMats[1];mesh(person,geo(new RoundedBoxGeometry(.51,.30,.54,3,.035)),crateMat,V(-.18,.15,0));
 const cushion=material('#d99176');mesh(person,geo(new RoundedBoxGeometry(.56,.09,.58,4,.04)),cushion,V(-.18,.335,0));
 const torso=new THREE.Group();torso.position.set(-.12,.73,0);person.add(torso);
 ellipsoid(torso,denim,V(0,0,0),V(.13,.31,.18));
 // A simple ochre scarf, with one short loose end, warms up the silhouette.
 mesh(torso,cylinder,cream,V(0,.27,0),V(.115,.09,.135));
 mesh(torso,geo(new RoundedBoxGeometry(.035,.19,.07,3,.015)),cream,V(.135,.16,.07));
 for(const z of [-.14,.14]){
  tube(person,[V(-.10,.37,z),V(.30,.28,z),V(.43,.02,z)],.048,darkDenim,20);
  ellipsoid(person,boot,V(.48,.015,z),V(.14,.055,.075));
 }
 const head=new THREE.Group();head.position.set(-.06,1.14,0);person.add(head);
 ellipsoid(head,material('#f1dfbd'),V(0,0,0),V(.23,.245,.225));
 for(const z of [-.09,.09])ellipsoid(head,eye,V(.209,.015,z),V(.015,.024,.016));
 tube(head,[V(.218,-.062,-.045),V(.228,-.08,0),V(.218,-.062,.045)],.007,hair,12);
 const straw=material('#d6bd78');const strawTex=canvasTexture(256,256,c=>{c.fillStyle='#d2b66e';c.fillRect(0,0,256,256);for(let i=0;i<100;i++){const a=random(i)*TAU;c.strokeStyle=i%2?'#bda05d':'#e0ca8b';c.lineWidth=.6;c.beginPath();c.moveTo(128,128);c.lineTo(128+Math.cos(a)*200,128+Math.sin(a)*200);c.stroke();}});straw.map=strawTex;straw.bumpMap=strawTex;straw.bumpScale=.007;
 const hat=new THREE.Group();hat.position.set(-.03,.22,0);hat.rotation.z=.07;head.add(hat);
 ellipsoid(hat,straw,V(),V(.55,.042,.50));
 ellipsoid(hat,straw,V(-.015,.09,0),V(.30,.20,.28));
 const band=material('#a2784c');mesh(hat,cylinder,band,V(-.015,.07,0),V(.300,.046,.281));
 for(let i=0;i<5;i++){const ring=mesh(hat,geo(new THREE.TorusGeometry(.32+i*.042,.003,4,64)),ropeMat,V(0,.039,0));ring.rotation.x=Math.PI/2;ring.scale.y=.91;}
 // Arms are an explicit two-segment rig: hand positions are solved from the actual rod grip.
 const armRigs=[-1,1].map(sign=>{
  const shoulder=V(.015,.88,sign*.18);
  const sleeve=mesh(person,cylinder,denim);const upper=mesh(person,cylinder,skin);const lower=mesh(person,cylinder,skin);
  const elbow=ellipsoid(person,skin,V(),V(.045,.045,.045));const hand=ellipsoid(person,skin,V(),V(.052,.052,.052));
  return {sign,shoulder,sleeve,upper,lower,elbow,hand};
 });
 // Two light wooden oars; shafts, blades and hands share the same stroke endpoints.
 const oars=[-1,1].map(sign=>{
  const shaft=mesh(person,cylinder,woodMats[0]);
  const blade=mesh(person,geo(new RoundedBoxGeometry(.23,.64,.065,3,.03)),woodMats[2]);
  const collar=ellipsoid(person,ropeMat,V(),V(.07,.06,.06));
  return {sign,shaft,blade,collar};
 });
 // A little enamel thermos and rolled picnic mat stay clear of the working deck.
 const flask=material('#c97759',.4),flaskLid=material('#f2dfb4',.35);
 mesh(group,cylinder,flask,V(.97,.47,-.82),V(.10,.37,.10));
 mesh(group,cylinder,flaskLid,V(.97,.675,-.82),V(.105,.06,.105));
 mesh(group,geo(new RoundedBoxGeometry(.5,.07,.68,3,.02)),material('#cdd6af'),V(-.91,.29,.12));
 // Batch only rigid pieces, baking their transforms into one draw per material.
 // The torso, head and articulated arms keep their independent animation transforms.
 function batchRigid(root:THREE.Object3D,exclude=new Set<THREE.Object3D>()){
  root.updateWorldMatrix(true,true);
  const inverse=root.matrixWorld.clone().invert();
  const batches=new Map<THREE.Material,THREE.Mesh[]>();
  function collect(object:THREE.Object3D){
   if(exclude.has(object))return;
   if(object instanceof THREE.Mesh&&!Array.isArray(object.material)){
    const list=batches.get(object.material)??[];list.push(object);batches.set(object.material,list);
   }
   for(const child of object.children)collect(child);
  }
  for(const child of root.children)collect(child);
  for(const [mat,list] of batches){
   if(list.length<2)continue;
   const baked=list.map(object=>{
    const g=object.geometry.index?object.geometry.toNonIndexed():object.geometry.clone();
    g.clearGroups();g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,object.matrixWorld));return g;
   });
   const combined=mergeGeometries(baked,false);baked.forEach(g=>g.dispose());
   if(!combined)continue;
   for(const object of list)object.removeFromParent();
   const merged=mesh(root,geo(combined),mat);merged.name='rigid-batch';
  }
 }
 batchRigid(group,new Set([person]));
 const articulated=new Set<THREE.Object3D>([torso,head]);
 for(const oar of oars)for(const part of [oar.shaft,oar.blade,oar.collar])articulated.add(part);
 for(const arm of armRigs)for(const part of [arm.sleeve,arm.upper,arm.lower,arm.elbow,arm.hand])articulated.add(part);
 batchRigid(person,articulated);batchRigid(torso);batchRigid(head);
 const up=V(0,1,0),delta=V();
 function segment(o:THREE.Mesh,a:THREE.Vector3,b:THREE.Vector3,r1:number,r2=r1){delta.subVectors(b,a);o.position.copy(a).add(b).multiplyScalar(.5);o.quaternion.setFromUnitVectors(up,delta.clone().normalize());o.scale.set(r1,delta.length(),r2);}
 const grip=V(),tip=V(),rodControl1=V(),rodControl2=V();
 let rodLoad=0,rodTime:number|undefined;
 function update(time:number,state:FishingState){
  const motion=raftPose(time,state);
  const boat=state.boat;
  const speed=Math.hypot(boat.vx,boat.vz),rowing=state.phase==='aim'&&speed>.025;
  const stroke=time*3.1;
  const effort=Math.min(1,speed/.45);
  group.position.set(boat.x+motion.x,motion.y-.045,boat.z+motion.z);group.rotation.set(motion.pitch,motion.yaw+boat.heading,motion.roll);
  // Aim rotates the seated body, while planted hips and boots still read as weight on the raft.
  const yaw=-Math.atan2(state.target.z-boat.z,state.target.x-boat.x);person.rotation.y=rowing?0:yaw-boat.heading;
  const reel=state.phase==='reeling',cast=state.phase==='casting';
  const castP=cast?Math.min(1,state.phaseFrame/48):1;
  const castLift=cast?Math.sin(castP*Math.PI):0;
  const enter=Math.min(1,state.phaseFrame/20),smoothEnter=enter*enter*(3-2*enter);
  const reelWeight=reel?smoothEnter:(state.phase==='caught'||state.phase==='escaped'?Math.exp(-state.phaseFrame/14):0);
  torso.rotation.z=rowing?Math.sin(stroke)*.10*effort:(-.045-state.tension*.045)*reelWeight+Math.sin(time*1.4)*.009;
  head.rotation.z=-.06-.025*reelWeight;
  const localGrip=V(.45,.80+castLift*.19,0);
  for(const a of armRigs){
   const handPoint=rowing?V(.27+Math.sin(stroke)*.24*effort,.78+Math.cos(stroke)*.055,a.sign*.28):localGrip.clone().add(V(a.sign*.042,a.sign*.015,a.sign*.034));
   const elbowPoint=rowing?V(.03+Math.sin(stroke)*.12,.67,a.sign*.35):V(.17,.62+castLift*.10,a.sign*.25);
   const upperEnd=a.shoulder.clone().lerp(elbowPoint,.64);
   segment(a.sleeve,a.shoulder,upperEnd,.067);segment(a.upper,upperEnd,elbowPoint,.043);segment(a.lower,elbowPoint,handPoint,.041);
   a.elbow.position.copy(elbowPoint);a.hand.position.copy(handPoint);a.hand.rotation.z=-.4;
  }
  for(const oar of oars){
   oar.shaft.visible=oar.blade.visible=oar.collar.visible=rowing;
   const handle=V(.27+Math.sin(stroke)*.24*effort,.78+Math.cos(stroke)*.055,oar.sign*.28);
   const bladePoint=V(.10-Math.sin(stroke)*.65*effort,-.28+Math.max(0,Math.cos(stroke))*.35,oar.sign*1.95);
   segment(oar.shaft,handle,bladePoint,.024);
   oar.blade.position.copy(bladePoint);oar.blade.quaternion.copy(oar.shaft.quaternion);
   oar.collar.position.copy(handle).lerp(bladePoint,.64);
  }
  group.updateMatrixWorld(true);
  grip.copy(localGrip);person.localToWorld(grip);
  // The handle stays firm in both hands. Load bends the upper blank and
  // turns its tip toward the water, rather than translating a straight stick.
  const desiredLoad=reel?Math.min(1,.22+state.tension*.72+state.fishPull*.18):state.phase==='bite'?.24:0;
  const dt=rodTime===undefined?0:Math.max(0,Math.min(.1,time-rodTime));
  rodLoad=rodTime===undefined?desiredLoad:rodLoad+(desiredLoad-rodLoad)*(1-Math.exp(-dt*8));rodTime=time;
  const neutralTip=V(1.84-castLift*.9,1.76+castLift*.9+Math.sin(time*2.4)*.018,0);
  const handleDirection=neutralTip.clone().sub(localGrip).normalize();
  rodControl1.copy(localGrip).addScaledVector(handleDirection,.52);
  rodControl2.copy(localGrip).lerp(neutralTip,.72);
  rodControl2.y+=rodLoad*.62+(cast?Math.sin(castP*Math.PI*2)*.10:0);
  tip.copy(neutralTip);tip.x-=rodLoad*.10;tip.y-=rodLoad*.94;
  person.localToWorld(rodControl1);person.localToWorld(rodControl2);person.localToWorld(tip);
  return {grip,tip,rodControl1,rodControl2,rowing};
 }
 function dispose(){scene.remove(group);geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());}
 return {group,update,dispose};
}
