import * as THREE from 'three';
import {OCEAN_WAVE_GLSL,raftPose,type RaftMotionState} from './ocean-motion';

export interface WaterState extends RaftMotionState {event?:string|null;castCount?:number;target?:{x:number;z:number}}
export interface WaterDisturbance {type:string;frame:number;x?:number;z?:number;strength?:number}
const RIPPLE_COUNT=12;
const RIPPLE_GLSL=`
uniform vec4 rippleOrigins[12];uniform vec2 rippleShapes[12];
vec2 disturbanceSlope(vec2 p,float t){
 vec2 result=vec2(0.);
 for(int i=0;i<12;i++){
  vec4 wave=rippleOrigins[i];float age=t-wave.z;
  if(age<0.||age>4.||wave.w<.0001)continue;
  vec2 shape=rippleShapes[i],q=(p-wave.xy)*shape;float radius=length(q);
  float front=.12+age*.72,width=.115+age*.035;
  if(abs(radius-front)>width*3.5||radius<.025)continue;
  float angle=atan(q.y,q.x);
  float r=radius+.045*sin(angle*3.+wave.x*1.7)+.018*sin(angle*7.-age);
  float offset=r-front;
  float envelope=exp(-offset*offset/(width*width)-age*1.35)*(1.-exp(-age*12.));
  float phase=offset*18.;
  float slope=wave.w*envelope*(18.*cos(phase)-2.*offset/(width*width)*sin(phase));
  result+=q/radius*shape*slope;
 }
 return result;
}
`;

/** Reduced-resolution colour/depth refraction, physically scaled water absorption,
 * aperiodic wave normals and broken sun facets. No texture downloads required. */
export function createWater(scene:THREE.Scene,camera:THREE.PerspectiveCamera,sun:THREE.DirectionalLight){
 const target=new THREE.WebGLRenderTarget(1280,720,{minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,type:THREE.HalfFloatType,depthBuffer:true,samples:2});
 target.texture.colorSpace=THREE.LinearSRGBColorSpace;
 target.depthTexture=new THREE.DepthTexture(1280,720,THREE.UnsignedIntType);
 const origins=Array.from({length:RIPPLE_COUNT},()=>new THREE.Vector4(0,0,-100,0));
 const shapes=Array.from({length:RIPPLE_COUNT},()=>new THREE.Vector2(1,1));
 const uniforms={rippleOrigins:{value:origins},rippleShapes:{value:shapes},time:{value:0},worldColor:{value:target.texture},worldDepth:{value:target.depthTexture},resolution:{value:new THREE.Vector2(1,1)},eye:{value:camera.position},sunDirection:{value:new THREE.Vector3()},inverseProjection:{value:camera.projectionMatrixInverse.clone()},cameraWorld:{value:camera.matrixWorld.clone()}};
 const geometry=new THREE.PlaneGeometry(110,110,220,220);geometry.rotateX(-Math.PI/2);
 const material=new THREE.ShaderMaterial({uniforms,depthWrite:true,side:THREE.FrontSide,
 vertexShader:`uniform float time;varying vec3 world;${OCEAN_WAVE_GLSL}
void main(){vec3 p=position;p.y+=oceanHeight(p.xz,time);world=(modelMatrix*vec4(p,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(world,1.);}`,
 fragmentShader:`
 ${OCEAN_WAVE_GLSL}
 ${RIPPLE_GLSL}
 uniform sampler2D worldColor,worldDepth;uniform vec2 resolution;uniform float time;uniform vec3 eye,sunDirection;uniform mat4 inverseProjection,cameraWorld;varying vec3 world;
 float waveHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 float waveNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*f*(f*(f*6.-15.)+10.);return mix(mix(waveHash(i),waveHash(i+vec2(1.,0.)),f.x),mix(waveHash(i+vec2(0.,1.)),waveHash(i+vec2(1.)),f.x),f.y);}
 float windHeight(vec2 p,float t){vec2 q=p+vec2(t*.11,-t*.07);return waveNoise(q*2.2)*.04+waveNoise(q*5.7+vec2(t*.13))*.012;}
 vec3 positionAt(vec2 uv,float depth){vec4 p=inverseProjection*vec4(uv*2.-1.,depth*2.-1.,1.);return(cameraWorld*vec4(p.xyz/p.w,1.)).xyz;}
 void main(){
  vec2 p=world.xz,slope=oceanSlope(p,time)+disturbanceSlope(p,time);
  // Incommensurate wind-aligned trains, smoothly phase-modulated by the swell.
  // Only normals make the glints; there is no world-space highlight mask.
  float footprint=max(length(fwidth(p)),.0001);
  for(int i=0;i<9;i++){
   float f=float(i),angle=.58+sin(f*2.39996+.27)*1.4;
   vec2 d=vec2(cos(angle),sin(angle));float k=4.31*pow(1.59,f);
   float keep=clamp(6.28318/k/(footprint*6.)-1.,0.,1.);
   float modulation=1.2*sin(dot(p,vec2(.61,-.37))-time*.31+f);
   float phase=dot(p,d)*k-sqrt(9.8*k)*time*.37+f*1.731+modulation;
   vec2 gradient=d*k+1.2*cos(dot(p,vec2(.61,-.37))-time*.31+f)*vec2(.61,-.37);
   slope+=gradient*(.035*pow(.77,f)/k)*cos(phase)*keep;
  }
  // A smooth advected ripple field breaks the regular wave-train intersections.
  float e=.015;
  slope+=vec2(windHeight(p+vec2(e,0.),time)-windHeight(p-vec2(e,0.),time),windHeight(p+vec2(0.,e),time)-windHeight(p-vec2(0.,e),time))/(2.*e);
  vec3 N=normalize(vec3(-slope.x,1.,-slope.y)),V=normalize(eye-world);
  vec2 uv=gl_FragCoord.xy/resolution;vec3 viewNormal=mat3(viewMatrix)*N;
  vec2 ruv=clamp(uv+viewNormal.xy*.009,vec2(.001),vec2(.999));
  float depth=texture2D(worldDepth,ruv).r;vec3 under=positionAt(ruv,depth);
  // Reject foreground pixels so straw hat and planks never bleed into water.
  if(under.y>.08){ruv=uv;depth=texture2D(worldDepth,uv).r;under=positionAt(uv,depth);}
  float thickness=clamp(length(under-world),0.,14.);
  vec3 bottom=texture2D(worldColor,ruv).rgb;
  vec3 transmission=exp(-vec3(.28,.10,.055)*thickness);
  vec3 body=vec3(.003,.075,.105);
  vec3 water=bottom*vec3(.10,.25,.36)*transmission+body*(1.-transmission);
  float fresnel=.02+.98*pow(1.-clamp(dot(N,V),0.,1.),5.);
  water=mix(water,vec3(.23,.48,.60),fresnel*.85);
  // Anisotropic GGX microfacet BRDF: finite roughness filters the solar reflection.
  // Its location follows the real light/view half-vector, not a painted lane.
  vec3 L=normalize(sunDirection),H=normalize(V+L);
  float NoV=max(dot(N,V),.001),NoL=max(dot(N,L),.001),NoH=max(dot(N,H),0.);
  vec3 wind=normalize(vec3(.84,0.,.54));vec3 T=normalize(wind-N*dot(wind,N));vec3 B=cross(N,T);
  // Finite solar footprint avoids derivative-quad blocks and clipped white tiles.
  float ax=.021,ay=.013;
  float denom=pow(dot(H,T)/ax,2.)+pow(dot(H,B)/ay,2.)+NoH*NoH;
  float D=1./max(3.14159265*ax*ay*denom*denom,.00001);
  float a2=ax*ay;
  float visibility=.5/max(NoL*sqrt(NoV*NoV*(1.-a2)+a2)+NoV*sqrt(NoL*NoL*(1.-a2)+a2),.0001);
  float F=.0204+.9796*pow(1.-max(dot(V,H),0.),5.);
  float sparkle=D*visibility*F*NoL;
  water+=vec3(1.,.97,.86)*(sparkle/(1.+sparkle*.14))*.56;
  gl_FragColor=vec4(water,1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`});
 const surface=new THREE.Mesh(geometry,material);surface.name='crystal-cove-water';surface.frustumCulled=false;scene.add(surface);
 const size=new THREE.Vector2();
 let nextRipple=0,lastRaftBucket=-1,lastBobberBucket=-1,lastStrokeBucket=-1;
 const eventKeys:string[]=[];
 function emit(x:number,z:number,born:number,amplitude:number,axisX=1,axisZ=1){
  const slot=nextRipple++%RIPPLE_COUNT;origins[slot].set(x,z,born,Math.max(0,Math.min(.045,amplitude)));shapes[slot].set(axisX,axisZ);
 }

 return{surface,
 update(time:number,state?:WaterState,bobberPosition?:{x:number;y?:number;z:number},events?:readonly WaterDisturbance[]){
  uniforms.time.value=time;uniforms.sunDirection.value.copy(sun.position).sub(sun.target.position).normalize();uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse);
  const raftBucket=Math.floor(time/1.37);
  if(raftBucket!==lastRaftBucket){lastRaftBucket=raftBucket;const born=raftBucket*1.37,pose=raftPose(born,state);emit(pose.x+(state?.boat?.x??0),pose.z+(state?.boat?.z??0),born,.007,.77,1.04);}
  const boat=state?.boat,speed=Math.hypot(boat?.vx??0,boat?.vz??0),stroke=Math.floor(time/1.2);
  if(boat&&speed>.035&&stroke!==lastStrokeBucket){
   lastStrokeBucket=stroke;const yaw=boat.heading??0;
   for(const side of [-1,1])emit(boat.x+Math.sin(yaw)*side*1.65,boat.z+Math.cos(yaw)*side*1.65,time,.012+speed*.012,.85,1.1);
   emit(boat.x-Math.cos(yaw)*1.45,boat.z+Math.sin(yaw)*1.45,time,.009+speed*.008,.72,1.1);
  }
  const floating=state&&['waiting','bite','reeling'].includes(state.phase??'');
  const bobberBucket=Math.floor(time/.83);
  if(floating&&bobberPosition&&bobberBucket!==lastBobberBucket){lastBobberBucket=bobberBucket;emit(bobberPosition.x,bobberPosition.z,time,state.phase==='reeling'?.014:.006);}
  const all:WaterDisturbance[]=events?.length?[...events]:events===undefined&&state?.event?[{type:state.event,frame:state.phaseFrame??0}]:[];
  for(const event of all){
   if(!['splash','nibble','bite','hook','catch','escape'].includes(event.type))continue;
   const key=`${state?.castCount??0}:${event.type}:${event.frame}`;if(eventKeys.includes(key))continue;
   eventKeys.push(key);if(eventKeys.length>48)eventKeys.shift();
   const at=bobberPosition??state?.target??{x:2.8,z:1.1};
   const strength=event.strength??({splash:.036,nibble:.009,bite:.020,hook:.031,catch:.04,escape:.021}[event.type]??.015);
   emit(event.x??at.x,event.z??at.z,time,strength);
  }
 },
 beforeRender(renderer:THREE.WebGLRenderer){
  renderer.getDrawingBufferSize(size);uniforms.resolution.value.copy(size);
  const width=Math.min(1600,Math.round(size.x)),height=Math.max(1,Math.round(width*size.y/size.x));
  if(target.width!==width||target.height!==height)target.setSize(width,height);
  const previous=renderer.getRenderTarget(),wasVisible=surface.visible;
  // Surface ripples and droplets belong in the final pass, never in refraction.
  const hidden:THREE.Object3D[]=[];const wp=new THREE.Vector3();scene.updateMatrixWorld();scene.traverse(o=>{if(o===surface)return;const mesh=o as THREE.Mesh;if(o.visible&&mesh.material){const mats=Array.isArray(mesh.material)?mesh.material:[mesh.material];if(mats.some(m=>m.transparent)&&!o.userData.underwater&&o.getWorldPosition(wp).y>-.08){o.visible=false;hidden.push(o);}}});
  surface.visible=false;
  const shadowUpdate=renderer.shadowMap.autoUpdate;
  // Targets store linear HDR radiance; tone map only in the final screen pass.
  const toneMapping=renderer.toneMapping;renderer.toneMapping=THREE.NoToneMapping;
  try{renderer.setRenderTarget(target);renderer.clear();renderer.render(scene,camera);}
  finally{surface.visible=wasVisible;hidden.forEach(o=>o.visible=true);renderer.setRenderTarget(previous);renderer.shadowMap.autoUpdate=shadowUpdate;renderer.toneMapping=toneMapping;}
  uniforms.cameraWorld.value.copy(camera.matrixWorld);
 },
 dispose(){surface.removeFromParent();geometry.dispose();material.dispose();target.dispose();},
 };
}
