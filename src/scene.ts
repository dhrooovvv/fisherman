import * as THREE from 'three';
import {createWater} from './visual/water';
import {createReef} from './visual/reef';
import {createRaft} from './visual/raft';
import {createFishLife} from './visual/fish';
import {heightAt,surfaceSlope} from './visual/ocean-motion';
import type { FishingState } from '../../game/fishing';

const TAU = Math.PI * 2;
const rnd = (n:number) => { const s=Math.sin(n*127.1+311.7)*43758.5453; return s-Math.floor(s); };
const v = (x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const palette = { wood:0xb68349, edge:0x765337, rope:0xcbbb8d, shirt:0xeee6cd, pants:0x47677d, skin:0xe6ba8f };

/** All rendering is disposable and independent of the deterministic fishing rules. */
export function createScene(canvas:HTMLCanvasElement) {
 const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
 renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
 renderer.info.autoReset=false;
 renderer.shadowMap.autoUpdate=false;
 renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFShadowMap;
 renderer.outputColorSpace=THREE.SRGBColorSpace; renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.16;
 const scene=new THREE.Scene(); scene.background=new THREE.Color('#5ab5e5'); scene.fog=new THREE.Fog('#83c7eb',38,70);
 const camera=new THREE.PerspectiveCamera(26,1280/720,.1,100); camera.position.set(9,13,16); camera.lookAt(0,-.3,0);
 const hemi=new THREE.HemisphereLight(0xd8efff,0x9b9981,1.5); scene.add(hemi);
 const sun=new THREE.DirectionalLight(0xfff0d7,3.9); sun.position.set(-7,11,-12); sun.castShadow=true;
 sun.shadow.mapSize.set(2048,2048); Object.assign(sun.shadow.camera,{left:-11,right:11,top:11,bottom:-11,near:.5,far:45}); sun.shadow.radius=3.5; sun.shadow.blurSamples=6; sun.shadow.bias=-.0002; sun.shadow.normalBias=.018; scene.add(sun);
 const fill=new THREE.DirectionalLight(0xffe9cc,1.15); fill.position.set(7,10,12); scene.add(fill);
 const materials:THREE.Material[]=[]; const geometries:THREE.BufferGeometry[]=[];
 const mat=(c:THREE.ColorRepresentation,roughness=.75)=>{const m=new THREE.MeshStandardMaterial({color:c,roughness}); materials.push(m); return m;};
 const geom=<T extends THREE.BufferGeometry>(g:T)=>{geometries.push(g);return g;};
 const ball=geom(new THREE.SphereGeometry(1,20,14)),box=geom(new THREE.BoxGeometry(1,1,1));
 const cyl=geom(new THREE.CylinderGeometry(1,1,1,32)),cone=geom(new THREE.ConeGeometry(1,1,16));
 const material={wood:mat(palette.wood),edge:mat(palette.edge),rope:mat(palette.rope),shirt:mat(palette.shirt),pants:mat(palette.pants),skin:mat(palette.skin),hat:mat(0xd9bd78),band:mat(0xa66c43),dark:mat(0x37413b),white:mat(0xf1edd9)};
 function mesh(parent:THREE.Object3D,g:THREE.BufferGeometry,m:THREE.Material,p:THREE.Vector3,s= v(1,1,1),shadow=true){const o=new THREE.Mesh(g,m);o.position.copy(p);o.scale.copy(s);o.castShadow=shadow;o.receiveShadow=true;parent.add(o);return o;}
 const sphere=(p:THREE.Object3D,m:THREE.Material,pos:THREE.Vector3,s:THREE.Vector3)=>mesh(p,ball,m,pos,s);
 function tube(parent:THREE.Object3D,points:THREE.Vector3[],radius:number,m:THREE.Material){const g=geom(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),20,radius,6,false));return mesh(parent,g,m,v());}
 const reef=createReef(scene);
 const raftRig=createRaft(scene),raft=raftRig.group;
 const fishLife=createFishLife(scene);
 const water=createWater(scene,camera,sun);
 const reefRoot=scene.getObjectByName('lagoon-reef')!,fishRoot=scene.getObjectByName('reef-fish-life')!;
 const bobber=new THREE.Group();scene.add(bobber);sphere(bobber,mat('#e86c47',.35),v(0,.04,0),v(.095,.13,.095));sphere(bobber,material.white,v(0,-.055,0),v(.095,.055,.095));mesh(bobber,cyl,material.edge,v(0,.19,0),v(.012,.16,.012));
 const aim=mesh(scene,geom(new THREE.RingGeometry(.27,.3,48)),new THREE.MeshBasicMaterial({color:0xf4edc9,transparent:true,opacity:.7,side:THREE.DoubleSide,depthWrite:false}),v(),v(1,1,1),false);aim.rotation.x=-Math.PI/2;materials.push(aim.material as THREE.Material);
 const lineGeo=geom(new THREE.BufferGeometry().setFromPoints(Array.from({length:25},()=>v())));const lineMat=new THREE.LineBasicMaterial({color:0xf0e8ca,transparent:true,opacity:.8});materials.push(lineMat);const line=new THREE.Line(lineGeo,lineMat);line.frustumCulled=false;scene.add(line);
 const rodGeo=geom(new THREE.BufferGeometry());const rodVertices=new Float32Array(21*7*3),rodIndices:number[]=[];
 for(let i=0;i<20;i++)for(let j=0;j<6;j++){const a=i*7+j,b=a+7;rodIndices.push(a,b,a+1,b,b+1,a+1);}
 rodGeo.setAttribute('position',new THREE.BufferAttribute(rodVertices,3));rodGeo.setIndex(rodIndices);
 const rodMat=mat('#6f4828',.58),rod=new THREE.Mesh(rodGeo,rodMat);rod.frustumCulled=false;scene.add(rod);
 const dropMat=mat('#d9fff1',.2);const drops=Array.from({length:26},()=>{const d=sphere(scene,dropMat,v(),v(.035,.055,.035));d.visible=false;return d;});
 let eventFrame=-1000,eventPosition=v(),eventKind='';
 const bubbleMat=new THREE.MeshBasicMaterial({color:0xc6eee2,transparent:true,opacity:.45});materials.push(bubbleMat);
 const bubbles=Array.from({length:12},(_,i)=>mesh(scene,ball,bubbleMat,v(),v(.02+(i%3)*.012,.02+(i%3)*.012,.02+(i%3)*.012),false));
 const moteGeo=geom(new THREE.IcosahedronGeometry(1,0)),moteMat=new THREE.MeshBasicMaterial({color:0xc4eee4,transparent:true,opacity:.19,depthWrite:false});materials.push(moteMat);
 const motes=new THREE.InstancedMesh(moteGeo,moteMat,32);motes.userData.underwater=true;scene.add(motes);const moteDummy=new THREE.Object3D();
 function resize(){const width=Math.min(window.innerWidth,window.innerHeight*16/9),height=width*9/16;canvas.style.position='absolute';canvas.style.width=width+'px';canvas.style.height=height+'px';canvas.style.left=(window.innerWidth-width)/2+'px';canvas.style.top=(window.innerHeight-height)/2+'px';renderer.setSize(Math.round(width),Math.round(height),false);camera.aspect=1280/720;camera.updateProjectionMatrix();}
 resize();
 function render(s:FishingState,frame:number,events:{type:string;frame:number}[]=[],visualSeconds=frame/60){const t=visualSeconds;
  renderer.info.reset();
  reef.update(t,s);
  bubbles.forEach((b,i)=>{const p=(t*.065+i*.173)%1;b.position.set(-5+i*.87+Math.sin(t*.3+i)*.08,-2.1+p*2.1,2.7+Math.sin(i*3)*2);b.visible=p<.96;});
  for(let i=0;i<32;i++){moteDummy.position.set((rnd(i+91)-.5)*13+Math.sin(t*.17+i)*.12,-.45-rnd(i+433)*1.65,(rnd(i+841)-.5)*9+Math.cos(t*.13+i)*.10);moteDummy.scale.setScalar(.006+rnd(i+744)*.007);moteDummy.updateMatrix();motes.setMatrixAt(i,moteDummy.matrix);}motes.instanceMatrix.needsUpdate=true;
  const {grip:start,tip,rodControl1,rodControl2,rowing}=raftRig.update(t,s);
  rod.visible=!rowing;
  const rodPos=rodGeo.attributes.position as THREE.BufferAttribute;
  const rodCurve=new THREE.CubicBezierCurve3(start,rodControl1,rodControl2,tip);
  const center=v(),tangent=v(),side=v(),other=v(),axis=v(0,1,0);
  for(let i=0;i<=20;i++){
   const p=i/20;rodCurve.getPoint(p,center);rodCurve.getTangent(p,tangent);
   // Each tube ring follows the local curve tangent, avoiding pinching at the tip.
   axis.set(Math.abs(tangent.y)>.95?1:0,Math.abs(tangent.y)>.95?0:1,0);
   side.crossVectors(tangent,axis).normalize();other.crossVectors(tangent,side).normalize();
   const radius=.021*(1-p)+.006*p;
   for(let j=0;j<=6;j++){const q=j/6*Math.PI*2,c=Math.cos(q)*radius,d=Math.sin(q)*radius;
    rodPos.setXYZ(i*7+j,center.x+side.x*c+other.x*d,center.y+side.y*c+other.y*d,center.z+side.z*c+other.z*d);
   }
  }
  rodPos.needsUpdate=true;rodGeo.computeVertexNormals();
  let bx=s.target.x,bz=s.target.z,by=.025+heightAt(bx,bz,t);
  if(s.phase==='casting'){const p=Math.min(1,s.phaseFrame/48);bx=THREE.MathUtils.lerp(tip.x,s.target.x,p);bz=THREE.MathUtils.lerp(tip.z,s.target.z,p);by=THREE.MathUtils.lerp(tip.y,heightAt(bx,bz,t),p)+Math.sin(p*Math.PI)*2;}
  if(s.phase==='bite')by-=.16+Math.sin(t*22)*.06;
  if(s.phase==='waiting'&&s.phaseFrame>s.waitFrames-50)by+=Math.sin(t*17)*.035;
  if(s.phase==='reeling'){bx=s.boat.x+(bx-s.boat.x)*(1-s.progress*.6);bz=s.boat.z+(bz-s.boat.z)*(1-s.progress*.6);bx+=Math.sin(t*7)*s.fishPull*.23;by-=.03;}
  bobber.position.set(bx,by,bz);const slope=surfaceSlope(bx,bz,t);bobber.rotation.x=slope.z;bobber.rotation.z=-slope.x+(s.phase==='bite'?.55:0);bobber.visible=!['aim','caught','escaped'].includes(s.phase);
  aim.visible=s.phase==='aim';const mark=rowing?s.boat.destination:s.target;aim.position.set(mark.x,.04+heightAt(mark.x,mark.z,t),mark.z);aim.scale.setScalar(1+Math.sin(t*3)*.045);
  fishLife.update(t,s,bobber.position);
  const mouth=fishLife.hookPosition(),lineEnd=mouth??bobber.position;
  line.visible=!rowing&&(bobber.visible||(s.phase==='caught'&&!!mouth));
  const lp=lineGeo.attributes.position as THREE.BufferAttribute;
  const taut=['reeling','caught','bite'].includes(s.phase);
  for(let i=0;i<25;i++){const p=i/24;lp.setXYZ(i,THREE.MathUtils.lerp(tip.x,lineEnd.x,p),THREE.MathUtils.lerp(tip.y,lineEnd.y,p)-Math.sin(Math.PI*p)*(taut?.025:.26),THREE.MathUtils.lerp(tip.z,lineEnd.z,p));}lp.needsUpdate=true;
  const latest=events.filter(e=>['splash','hook','catch','bite','nibble'].includes(e.type)).at(-1);
  const cue=latest?.type??s.event;
  if(cue&&(latest?.frame??frame)!==eventFrame&&['splash','hook','catch','bite','nibble'].includes(cue)){eventFrame=latest?.frame??frame;eventPosition.set(bx,0,bz);eventKind=cue;}
  const age=(frame-eventFrame)/60;
  drops.forEach((d,i)=>{const p=age;d.visible=p>=0&&p<.85&&eventKind!=='nibble';const a=i*2.399;const speed=.4+rnd(i)*1.25;d.position.set(eventPosition.x+Math.cos(a)*speed*p,eventPosition.y+.06+(1.8+rnd(i+1)*1.5)*p-4.5*p*p,eventPosition.z+Math.sin(a)*speed*p);d.visible=d.visible&&d.position.y>0;});
  water.update(t,s,bobber.position,events);
  renderer.shadowMap.needsUpdate=true;
  water.beforeRender(renderer);
  // The opaque water already contains submerged colour/depth. Avoid drawing it twice.
  // Shadow maps were updated with all geometry in the refraction pass above.
  const composited:THREE.Object3D[]=[];
  const hide=(o:THREE.Object3D)=>{if(o.visible){o.visible=false;composited.push(o);}};
  hide(reefRoot);hide(motes);
  for(const f of fishRoot.children)if(f instanceof THREE.Group&&f.position.y<-.10)hide(f);
  for(const b of bubbles)if(b.position.y<0)hide(b);
  try{renderer.render(scene,camera);}finally{for(const o of composited)o.visible=true;}

 }
 function dispose(){geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());water.dispose();reef.dispose();raftRig.dispose();fishLife.dispose();renderer.dispose();}
 return {render,resize,dispose,stats:()=>({calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,textures:renderer.info.memory.textures,geometries:renderer.info.memory.geometries,motion:{height:raft.position.y,roll:raft.rotation.z,pitch:raft.rotation.x,bobberHeight:bobber.position.y}})};
}
