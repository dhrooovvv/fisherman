import * as THREE from 'three';
import {CAUSTIC_GLSL} from './caustics';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { FishingState } from '../../../game/fishing';
const TAU=Math.PI*2;
const random=(n:number)=>{const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x);};
const noise=(x:number,z:number)=>Math.sin(x*.67+Math.cos(z*.93))*Math.sin(z*.72+Math.sin(x*.53));
const baseHeight=(x:number,z:number)=>-2.55+noise(x,z)*.17+Math.sin(x*.22+z*.3)*.32+.65*Math.exp(-Math.pow((z+Math.sin(x*.4)*1.4)/2.5,2))-.38*(1-Math.exp(-(x*x+z*z)/40));
type Placement={x:number;y?:number;z:number;sx:number;sy?:number;sz?:number;ry?:number;rx?:number;rz?:number;color?:THREE.ColorRepresentation};

/** Dense, seeded reef. Caustics use world coordinates on every lit surface; vegetation sways on the GPU. */
export function createReef(scene:THREE.Scene){
 const root=new THREE.Group();root.name='lagoon-reef';scene.add(root);
 const geometries:THREE.BufferGeometry[]=[],materials:THREE.Material[]=[],textures:THREE.Texture[]=[];
 const time={value:0};
 const geometry=<T extends THREE.BufferGeometry>(g:T)=>{geometries.push(g);return g;};
 function surface(color:THREE.ColorRepresentation,wind=false,moss=false){
  const m=new THREE.MeshStandardMaterial({color,roughness:.88,side:wind?THREE.DoubleSide:THREE.FrontSide});materials.push(m);
  m.onBeforeCompile=shader=>{
   shader.uniforms.reefTime=time;
   shader.vertexShader='uniform float reefTime; varying vec3 reefWorld;\n'+shader.vertexShader;
   if(wind)shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
    float phase=0.;vec2 flowPoint=vec2(0.);
    #ifdef USE_INSTANCING
     phase=instanceMatrix[3].x*.8+instanceMatrix[3].z*.56;flowPoint=instanceMatrix[3].xz;
    #endif
    float flow=.045+.018*sin(flowPoint.y*.23+reefTime*.17)+.009*cos(flowPoint.x*.31-reefTime*.11);float tip=max(position.y,0.);transformed.x+=flow*tip*tip*1.4+sin(reefTime*.8+phase+tip*1.4)*tip*tip*.13;transformed.z+=cos(reefTime*.63+phase)*tip*tip*.065;
   `);
   shader.vertexShader=shader.vertexShader.replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
    vec4 reefP=vec4(transformed,1.);
    #ifdef USE_INSTANCING
     reefP=instanceMatrix*reefP;
    #endif
    reefWorld=(modelMatrix*reefP).xyz;
   `);
   shader.fragmentShader=`uniform float reefTime;varying vec3 reefWorld;
    float reefHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float reefNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(reefHash(i),reefHash(i+vec2(1,0)),f.x),mix(reefHash(i+vec2(0,1)),reefHash(i+vec2(1,1)),f.x),f.y);}
    ${CAUSTIC_GLSL}
   `+shader.fragmentShader;
   if(moss)shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
    float mottle=reefNoise(reefWorld.xz*3.1)+reefNoise(reefWorld.xz*11.)*.23;
    diffuseColor.rgb*=mix(vec3(.78,.83,.81),vec3(1.16,1.15,1.10),smoothstep(.25,.86,mottle));
    diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.85,1.01,.92),smoothstep(.58,.79,mottle)*.28);
   `);
   shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`float reefGlow=underwaterCaustic(reefWorld,reefTime)*.48;outgoingLight+=diffuseColor.rgb*vec3(.92,1.03,1.12)*reefGlow;#include <opaque_fragment>` .replace(';#include',';\n#include'));
  };
  m.customProgramCacheKey=()=>`reef-${wind}-${moss}`;
  return m;
 }
 const sand=surface('#fff8e9');
 // Broad mineral beds and fine meadow patches break up the bright sand floor.
 const sandCompile=sand.onBeforeCompile;
 sand.onBeforeCompile=(shader,renderer)=>{
  sandCompile.call(sand,shader,renderer);
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
   float meadow=reefNoise(reefWorld.xz*.95+vec2(reefNoise(reefWorld.xz*2.4)));
   float grains=reefNoise(reefWorld.xz*7.);
   vec3 bed=mix(vec3(.15,.31,.23),vec3(.85,.89,.73),smoothstep(.26,.76,meadow));
   diffuseColor.rgb*=bed*(.8+grains*.3);
  `);
 };
 sand.customProgramCacheKey=()=> 'sunny-mineral-seabed-v2';
 const sandCanvas=document.createElement('canvas');sandCanvas.width=sandCanvas.height=512;const context=sandCanvas.getContext('2d')!;
 context.fillStyle='#e6ddc8';context.fillRect(0,0,512,512);
 for(let i=0;i<18000;i++){context.fillStyle=i%3?'rgba(126,117,100,.07)':'rgba(255,246,207,.42)';const r=random(i+1);context.fillRect(r*512,random(i+230)*512,random(i+30)*1.8+.5,.7);}
 for(let y=0;y<512;y+=12){context.beginPath();for(let x=0;x<=512;x+=4){const py=y+Math.sin(x*.025+y*.018)*3; if(x===0)context.moveTo(x,py);else context.lineTo(x,py);}context.strokeStyle='rgba(153,139,116,.055)';context.lineWidth=1.7;context.stroke();}
 const sandTexture=new THREE.CanvasTexture(sandCanvas);sandTexture.colorSpace=THREE.SRGBColorSpace;sandTexture.wrapS=sandTexture.wrapT=THREE.RepeatWrapping;sandTexture.repeat.set(18,18);textures.push(sandTexture);sand.map=sandTexture;
 const floorGeo=geometry(new THREE.PlaneGeometry(90,90,80,80));floorGeo.rotateX(-Math.PI/2);const fp=floorGeo.attributes.position;
 for(let i=0;i<fp.count;i++){const x=fp.getX(i),z=fp.getZ(i);fp.setY(i,baseHeight(x,z));}floorGeo.computeVertexNormals();
 const floor=new THREE.Mesh(floorGeo,sand);floor.receiveShadow=true;root.add(floor);
 function instances(g:THREE.BufferGeometry,m:THREE.Material,places:Placement[],shadow=false){const inst=new THREE.InstancedMesh(g,m,places.length);inst.userData.underwater=true;const dummy=new THREE.Object3D();places.forEach((p,i)=>{dummy.position.set(p.x,p.y??baseHeight(p.x,p.z),p.z);dummy.rotation.set(p.rx??0,p.ry??0,p.rz??0);dummy.scale.set(p.sx,p.sy??p.sx,p.sz??p.sx);dummy.updateMatrix();inst.setMatrixAt(i,dummy.matrix);if(p.color)inst.setColorAt(i,new THREE.Color(p.color));});inst.instanceMatrix.needsUpdate=true;inst.castShadow=shadow;inst.receiveShadow=true;root.add(inst);return inst;}
 // Irregular rounded rock families with smooth normals and mottled olive/mint lichen.
 const rockMaterial=surface('#ece7dc',false,true);
 const rockCenters:Placement[]=[];
 for(let i=0;i<48;i++){let x=(random(i+5)-.5)*27,z=(random(i+210)-.5)*23;const clear=Math.abs(z+Math.sin(x*.35)*1.7)<1.2&&Math.abs(x)<5;if(clear)z+=z>0?2:-2;const s=.45+Math.pow(random(i+143),1.7)*1.5;rockCenters.push({x,z,sx:s,sy:s*(.45+random(i+90)*.28),sz:s*(.7+random(i+291)*.36),ry:random(i+420)*TAU,color:['#cbc5b5','#b9c6c8','#d1c5ac','#a5b8b2'][i%4]});}
 for(let j=0;j<5;j++){const g=geometry(mergeVertices(new THREE.IcosahedronGeometry(1,3)));const p=g.attributes.position;for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),n=1+.13*Math.sin(x*4.7+j)*Math.cos(z*5.3-j)*Math.sin(y*3.8+2);p.setXYZ(i,x*n,y*n+.1*Math.sin(x*2.8+z*3.1),z*n);}g.computeVertexNormals();instances(g,rockMaterial,rockCenters.filter((_,i)=>i%5===j),true);}
 // Soft, shallow contact occlusion anchors every boulder without a per-object shadow pass.
 const shadowCanvas=document.createElement('canvas');shadowCanvas.width=shadowCanvas.height=64;const shadowCtx=shadowCanvas.getContext('2d')!;
 const falloff=shadowCtx.createRadialGradient(32,32,3,32,32,32);falloff.addColorStop(0,'rgba(19,60,45,.42)');falloff.addColorStop(.5,'rgba(19,60,45,.24)');falloff.addColorStop(1,'rgba(19,60,45,0)');shadowCtx.fillStyle=falloff;shadowCtx.fillRect(0,0,64,64);
 const shadowTexture=new THREE.CanvasTexture(shadowCanvas);textures.push(shadowTexture);
 const contactMat=new THREE.MeshBasicMaterial({map:shadowTexture,transparent:true,depthWrite:false,opacity:.65});materials.push(contactMat);
 const contactGeo=geometry(new THREE.PlaneGeometry(2,2));contactGeo.rotateX(-Math.PI/2);
 instances(contactGeo,contactMat,rockCenters.map(r=>({x:r.x,z:r.z,y:baseHeight(r.x,r.z)+.035,sx:r.sx*1.15,sy:1,sz:(r.sz??r.sx)*1.15})));
 const pebbles:Placement[]=Array.from({length:240},(_,i)=>{const cluster=rockCenters[i%rockCenters.length],angle=random(i+850)*TAU,r=cluster.sx*(.7+random(i+440)*1.4);return{x:cluster.x+Math.cos(angle)*r,z:cluster.z+Math.sin(angle)*r,sx:.035+random(i+800)*.17,sy:.025+random(i+300)*.075,sz:.05+random(i+70)*.12,ry:random(i)*TAU,color:['#98a68c','#b8bea2','#6d927d','#c5c7a9'][i%4]};});
 instances(geometry(new THREE.IcosahedronGeometry(1,1)),rockMaterial,pebbles);
 // Curved leaf blades have actual volume and a central ridge to catch raking sunlight.
 function leafGeometry(width:number,bend:number){const positions:number[]=[],uvs:number[]=[],indices:number[]=[];const rows=10;
  for(let i=0;i<=rows;i++){const t=i/rows,w=width*Math.pow(Math.sin(Math.PI*t),.7);for(let j=0;j<3;j++){positions.push((j-1)*w+bend*t*t,t,(j===1?.025:0)*Math.sin(Math.PI*t));uvs.push(j/2,t);}}
  for(let i=0;i<rows;i++)for(let j=0;j<2;j++){const a=i*3+j;indices.push(a,a+3,a+1,a+1,a+3,a+4);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);g.computeVertexNormals();return geometry(g);
 }
 const grassMaterial=surface('#e3e7ce',true),broadMaterial=surface('#dfebc1',true);
 const grass:Placement[]=[],broad:Placement[]=[],rosettes:Placement[]=[];
 const grassColors=['#4c9275','#6aab87','#8db68c','#91b987','#3c8e73','#b0c18b'];
 for(let i=0;i<160;i++){const rock=rockCenters[i%rockCenters.length],angle=random(i+560)*TAU;const cx=rock.x+Math.cos(angle)*(rock.sx+.3),cz=rock.z+Math.sin(angle)*(rock.sx+.3);const patch=.4+random(i+99)*.65;
  for(let j=0;j<18;j++){const id=i*18+j,a=random(id+2000)*TAU,r=Math.sqrt(random(id+903))*patch;grass.push({x:cx+Math.cos(a)*r,z:cz+Math.sin(a)*r,sx:.55+random(id+822)*.55,sy:.28+random(id+1420)*.78,sz:.8,ry:random(id+241)*TAU,rx:(random(id+199)-.5)*.6,rz:(random(id+698)-.5)*.5,color:grassColors[id%grassColors.length]});}
  if(i%2===0)for(let j=0;j<7;j++){const id=i*7+j,a=j*2.399;rosettes.push({x:cx+Math.cos(a)*.13,z:cz+Math.sin(a)*.13,sx:.65,sy:.4+random(id+817)*.6,sz:1,ry:a,rz:-.45-random(id+700)*.55,color:['#6da58c','#91b78b','#b3bd8a'][j%3]});}
  if(i%3===0)for(let j=0;j<5;j++){const id=i*5+j;broad.push({x:cx+(random(id+78)-.5)*.25,z:cz+(random(id+922)-.5)*.25,sx:.6+random(id+510)*.7,sy:.75+random(id+241)*.75,sz:1,ry:j*2.399+i,rz:(random(id+341)-.5)*.3,color:['#80ae88','#4d9b7e','#a0ba86','#6b9e80'][j%4]});}
 }
 instances(leafGeometry(.043,.14),grassMaterial,grass);instances(leafGeometry(.17,.3),broadMaterial,broad);instances(leafGeometry(.13,.28),broadMaterial,rosettes);
 // Fine, branching eelgrass gives the beds a soft silhouette between broad leaves.
 // A shared frond mesh keeps the richer planting to one additional instanced draw.
 const frondParts:THREE.BufferGeometry[]=[];
 for(let j=0;j<8;j++)for(const side of [-1,1]){
  const leaf=leafGeometry(.045,.18).clone();
  leaf.scale(.65,.2+(1-j/8)*.24,.65);
  leaf.rotateZ(side*(.8-j*.045));leaf.translate(0,.12+j*.095,0);
  frondParts.push(leaf);
 }
 const stem=new THREE.CylinderGeometry(.009,.015,.88,4);stem.translate(0,.44,0);frondParts.push(stem);
 const frondGeo=geometry(mergeGeometries(frondParts)!);frondParts.forEach(g=>g.dispose());
 const fronds:Placement[]=Array.from({length:140},(_,i)=>{
  const r=rockCenters[(i*11+3)%rockCenters.length],a=random(i+9101)*TAU;
  const x=r.x+Math.cos(a)*(r.sx+.45),z=r.z+Math.sin(a)*(r.sx+.45);
  return{x,z,sx:.65+random(i+9201)*.5,sy:.7+random(i+9301)*.65,sz:1,ry:a,rz:(random(i+9401)-.5)*.25,color:['#76ac8f','#8dbda0','#b5c59a'][i%3]};
 });
 instances(frondGeo,grassMaterial,fronds);
 // Rounded fan coral, little sponges and anemones form sparse color accents among green beds.
 const coralMat=surface('#e8d0c8',false,false);
 function branchGeometry(){const parts:THREE.BufferGeometry[]=[];for(let j=0;j<7;j++){const a=j*2.399,h=.3+random(j+149)*.45,tip=new THREE.Vector3(Math.cos(a)*.25,h,Math.sin(a)*.25),mid=tip.clone().multiplyScalar(.48);const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(),mid,tip]);parts.push(new THREE.TubeGeometry(curve,8,.04,5,false));const cap=new THREE.SphereGeometry(.044,6,5);cap.translate(tip.x,tip.y,tip.z);parts.push(cap);}const g=mergeGeometries(parts)!;parts.forEach(p=>p.dispose());return geometry(g);}
 const corals:Placement[]=Array.from({length:26},(_,i)=>{const r=rockCenters[(i*7+2)%48];return{x:r.x+r.sx*.8,z:r.z-r.sx*.7,sx:.65+random(i+770)*.8,ry:i*2.4,color:['#c59f9c','#b0a0bd','#d0b18b','#9cb4a1'][i%4]};});instances(branchGeometry(),coralMat,corals);
 const spongeGeo=geometry(new THREE.CylinderGeometry(.14,.2,.45,12,3,true));const spongeMat=surface('#b9b5a0');const sponges:Placement[]=[];for(let i=0;i<14;i++){const r=rockCenters[(i*5+9)%48];for(let j=0;j<3;j++)sponges.push({x:r.x+Math.sin(j*2.4)*.17,z:r.z+Math.cos(j*2.4)*.17,y:baseHeight(r.x,r.z)+.2,sx:.6+random(i*3+j)*.5,sy:.8+random(i+j+99)*.7,ry:i,color:['#b4b5ab','#b6a1b4','#b5b79b'][i%3]});}instances(spongeGeo,spongeMat,sponges);
 // Scallop shells and five-armed starfish are actual small meshes, never floating decals.
 const shellPositions:number[]=[],shellIndices:number[]=[];for(let row=0;row<=8;row++)for(let col=0;col<=16;col++){const r=row/8,a=-Math.PI*.46+col/16*Math.PI*.92;const scallop=1+.035*Math.cos(col*Math.PI);shellPositions.push(Math.sin(a)*r*.22*scallop,Math.sin(r*Math.PI)*.055+Math.cos(col*Math.PI)*.006*r,Math.cos(a)*r*.24);}
 for(let row=0;row<8;row++)for(let col=0;col<16;col++){const a=row*17+col;shellIndices.push(a,a+17,a+1,a+1,a+17,a+18);}const shellGeo=new THREE.BufferGeometry();shellGeo.setAttribute('position',new THREE.Float32BufferAttribute(shellPositions,3));shellGeo.setIndex(shellIndices);shellGeo.computeVertexNormals();geometry(shellGeo);const shellMat=surface('#d7c9ab');shellMat.side=THREE.DoubleSide;
 instances(shellGeo,shellMat,Array.from({length:28},(_,i)=>({x:(random(i+1700)-.5)*21,z:(random(i+2600)-.5)*17,y:undefined,sx:.5+random(i+317)*.8,ry:random(i+985)*TAU,color:['#e0c9b3','#c6bbb4','#d6cba8','#b1c2b0'][i%4]})));
 const starShape=new THREE.Shape();for(let i=0;i<20;i++){const a=i*TAU/20,r=i%4===0?.24:i%2===0?.09:.115;const x=Math.cos(a)*r,y=Math.sin(a)*r;i?starShape.lineTo(x,y):starShape.moveTo(x,y);}starShape.closePath();const starGeo=geometry(new THREE.ExtrudeGeometry(starShape,{depth:.025,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.02,bevelThickness:.02,curveSegments:4}));starGeo.rotateX(-Math.PI/2);
 instances(starGeo,surface('#dca879'),Array.from({length:9},(_,i)=>({x:(random(i+2001)-.5)*19,z:(random(i+899)-.5)*16,sx:.7+random(i+70)*.6,ry:i*2.4,color:['#daa67a','#bf9b8d','#d1b48b'][i%3]})));
 function update(t:number,_state?:FishingState){time.value=t;}
 function dispose(){scene.remove(root);geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());root.clear();}
 return {update,dispose,heightAt:baseHeight};
}
