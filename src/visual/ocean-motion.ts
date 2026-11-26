/** One sea, one clock. Pure metre/second wave functions shared by floats and GLSL. */
export const WAVES = [
  { amplitude:.046, kx:.71, kz:.36, speed:1.13, phase:.43 },
  { amplitude:.026, kx:-.47, kz:1.27, speed:1.61, phase:2.17 },
  { amplitude:.014, kx:1.83, kz:-.79, speed:2.03, phase:4.61 },
  { amplitude:.008, kx:2.39, kz:1.71, speed:2.71, phase:1.29 },
] as const;
export function heightAt(x:number,z:number,time:number):number {
  return WAVES.reduce((h,w)=>h+w.amplitude*Math.sin(w.kx*x+w.kz*z-w.speed*time+w.phase),0);
}
/** Exact spatial derivative of heightAt; useful for bobber tilt and verification. */
export function surfaceSlope(x:number,z:number,time:number):{x:number;z:number} {
  let sx=0,sz=0;for(const w of WAVES){const a=w.amplitude*Math.cos(w.kx*x+w.kz*z-w.speed*time+w.phase);sx+=a*w.kx;sz+=a*w.kz;}return{x:sx,z:sz};
}
export interface RaftMotionState {boat?:{x:number;z:number;vx?:number;vz?:number;heading?:number};phase?:string;phaseFrame?:number;tension?:number;fishPull?:number}
/** Four-corner support averages high-frequency chop before it reaches the raft.
 * Phase impulses start at zero so transitions never teleport the player/rod. */
export function raftPose(time:number,state:RaftMotionState={}) {
  const x=.042*Math.sin(time*.47+.6)+.009*Math.sin(time*.83+2.3);
  const z=.035*Math.sin(time*.39+1.2)+.008*Math.sin(time*.71);
  const bx=x+(state.boat?.x??0),bz=z+(state.boat?.z??0),heading=state.boat?.heading??0;
  const sample=(dx:number,dz:number)=>heightAt(bx+dx*Math.cos(heading)+dz*Math.sin(heading),bz-dx*Math.sin(heading)+dz*Math.cos(heading),time);
  const a=sample(-1.4,-1.05),b=sample(1.4,-1.05),c=sample(-1.4,1.05),d=sample(1.4,1.05);
  const age=Math.max(0,(state.phaseFrame??0)/60),tension=Math.max(0,Math.min(1,state.tension??0));
  const impulse=(frequency:number,decay:number)=>Math.sin(age*frequency)*Math.exp(-age*decay);
  const action=state.phase==='casting'?.012*impulse(5.2,2):state.phase==='caught'?.014*impulse(6,2.1):state.phase==='reeling'?.006*Math.sin(age*2.7)*(1-Math.exp(-age*4))*tension:0;
  return{x,y:(a+b+c+d)*.25+action*.35,z,
    pitch:-Math.atan(((c+d)-(a+b))/4.2)+action,
    roll:Math.atan(((b+d)-(a+c))/5.6)-action*.75,
    yaw:.006*Math.sin(time*.23+.8)+.003*Math.sin(time*.61+1.7)};
}
const gl=(n:number)=>Number.isInteger(n)?`${n}.0`:String(n);
export const OCEAN_WAVE_GLSL = `
float oceanHeight(vec2 p,float t){return ${WAVES.map(w=>`${gl(w.amplitude)}*sin(dot(p,vec2(${gl(w.kx)},${gl(w.kz)}))-${gl(w.speed)}*t+${gl(w.phase)})`).join('+')};}
vec2 oceanSlope(vec2 p,float t){return ${WAVES.map(w=>`vec2(${gl(w.kx)},${gl(w.kz)})*${gl(w.amplitude)}*cos(dot(p,vec2(${gl(w.kx)},${gl(w.kz)}))-${gl(w.speed)}*t+${gl(w.phase)})`).join('+')};}
`;
/** Slow nonuniform cove current for kelp and swimming paths; no per-frame noise. */
export function currentAt(x:number,z:number,time:number):{x:number;z:number}{
 return{x:.045+.018*Math.sin(z*.23+time*.17)+.009*Math.cos(x*.31-time*.11),z:.018*Math.sin(x*.19-time*.13)+.008*Math.cos(z*.37+time*.09)};
}
