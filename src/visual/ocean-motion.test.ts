import {test} from 'node:test';
import assert from 'node:assert/strict';
import {heightAt,surfaceSlope,raftPose,WAVES} from './ocean-motion.ts';

test('wave field and four-point raft support remain finite and bounded over a long session',()=>{
 const bound=WAVES.reduce((a,w)=>a+w.amplitude,0);
 for(let t=0;t<600;t+=.173){
  for(const [x,z] of [[0,0],[3.8,-1.9],[-17,11]])assert.ok(Math.abs(heightAt(x,z,t))<=bound+1e-12);
  const p=raftPose(t,{phase:'reeling',phaseFrame:Math.round(t*60),tension:.8});
  Object.values(p).forEach(v=>assert.ok(Number.isFinite(v)));
  assert.ok(Math.abs(p.y)<.09);assert.ok(Math.abs(p.roll)<.07);assert.ok(Math.abs(p.pitch)<.07);
 }
});
test('sample is deterministic, spatially coherent, and analytic gradient matches finite differences',()=>{
 for(const t of [0,.17,3.8,27,101])for(const [x,z] of [[0,0],[2.2,-1.1],[-4.8,3.7]]){
  assert.equal(heightAt(x,z,t),heightAt(x,z,t));
  const h=1e-5,s=surfaceSlope(x,z,t);
  assert.ok(Math.abs(s.x-(heightAt(x+h,z,t)-heightAt(x-h,z,t))/(2*h))<1e-8);
  assert.ok(Math.abs(s.z-(heightAt(x,z+h,t)-heightAt(x,z-h,t))/(2*h))<1e-8);
 }
});
test('raft does not freeze or lurch and phase impulses start continuously',()=>{
 let movement=0;
 for(let t=0;t<45;t+=1/60){const p=raftPose(t),q=raftPose(t+1/60);movement+=Math.abs(p.y-q.y);assert.ok(Math.abs(p.y-q.y)<.003);assert.ok(Math.abs(p.pitch-q.pitch)<.003);assert.ok(Math.abs(p.roll-q.roll)<.003);}
 assert.ok(movement>.3);
 for(const phase of ['casting','caught','reeling'])assert.deepEqual(raftPose(4,{phase,phaseFrame:0,tension:.8}),raftPose(4));
});
