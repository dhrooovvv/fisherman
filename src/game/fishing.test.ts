import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {initial,step,demoInput,clampCast,goldenness,CAST_MIN,CAST_MAX,BOUNDS} from './fishing.ts';

test('scripted session lands a reed perch first and is deterministic',()=>{
 const run=()=>{let s=initial;for(let f=0;f<3600;f++)s=step(s,demoInput(s,f),f);return s;};
 const a=run(),b=run();
 assert.deepEqual(a,b);
 assert.ok(a.caughtCount>=3);
 assert.equal(a.log[0],'perch');
});
test('cast target is clamped to the reachable ring',()=>{
 const boat={x:2,z:-1};
 for(const p of [{x:2,z:-1},{x:40,z:9},{x:2.5,z:-1.2}]){
  const t=clampCast(boat,p),d=Math.hypot(t.x-boat.x,t.z-boat.z);
  assert.ok(d>=CAST_MIN-1e-9&&d<=CAST_MAX+1e-9);
 }
});
test('holding the reel without easing snaps the line',()=>{
 let s={...initial,phase:'reeling' as const,phaseFrame:0,tension:.3,progress:.05};
 for(let f=0;f<900&&s.phase==='reeling';f++)s=step(s,{keys:[' ']},f);
 assert.equal(s.phase,'escaped');
});
test('rowing reaches a click destination and respects the lagoon bounds',()=>{
 let s=step(initial,{keys:[],move:{x:6,z:-4,id:1}},0);
 for(let f=0;f<900;f++)s=step(s,{keys:[]},f);
 assert.ok(Math.hypot(s.boat.x-6,s.boat.z+4)<.6);
 s=step(s,{keys:[],move:{x:999,z:0,id:2}},0);
 for(let f=0;f<3000;f++)s=step(s,{keys:[]},f);
 assert.ok(s.boat.x<=BOUNDS);
});
test('golden light is smooth and periodic',()=>{
 assert.ok(goldenness(0)<1e-9);
 for(let c=0;c<20000;c+=7)assert.ok(Math.abs(goldenness(c+1)-goldenness(c))<.002);
});
