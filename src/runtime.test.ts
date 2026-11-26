import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createRuntime} from './runtime.ts';
import {initial,demoInput} from './game/fishing.ts';
const empty={keys:[]};
test('fixed clock gives identical catches at 30, 60, 90, 120 and 144 Hz',()=>{
 const states=[30,60,90,120,144].map(hz=>{
  const r=createRuntime();for(let n=0;n<hz*30;n++)r.advance(1/hz,demoInput);
  assert.equal(r.frame,1800);assert.equal(r.state.caughtCount,2);return r.state;
 });
 for(const s of states)assert.deepEqual(s,states[0]);
});
test('long gaps advance at most six steps; hidden time leaves bite window untouched',()=>{
 const r=createRuntime({...initial,phase:'bite',phaseFrame:12});
 assert.equal(r.advance(20,empty).steps,6);assert.equal(r.state.phase,'bite');
 r.setHidden(true);r.advance(200,empty);r.tick(500000,empty);
 assert.equal(r.frame,6);assert.equal(r.state.phaseFrame,18);
 r.setHidden(false);assert.equal(r.tick(600000,empty).steps,0);
 r.tick(600000+1000/60,empty);assert.equal(r.frame,7);assert.equal(r.state.phase,'bite');
});
test('subtick press survives quick release and event batches include early substeps',()=>{
 const r=createRuntime();assert.equal(r.advance(1/120,{keys:[' ']}).steps,0);
 const cast=r.advance(1/120,empty);assert.equal(cast.state.phase,'casting');assert.equal(cast.events[0].type,'cast');
 const a=createRuntime();const batch=a.advance(.1,{keys:[' ']});assert.equal(batch.steps,6);assert.equal(batch.events[0].type,'cast');assert.equal(batch.state.event,null);
});
test('reset anchors timestamps and rejects invalid or negative deltas',()=>{
 const r=createRuntime();r.tick(1000,empty);r.tick(2000,empty);assert.equal(r.frame,6);
 r.reset();assert.equal(r.frame,0);assert.equal(r.tick(9000,empty).steps,0);
 r.advance(NaN,empty);r.advance(Infinity,empty);r.advance(-5,empty);assert.equal(r.frame,0);
 r.advance(1/60,empty);assert.equal(r.frame,1);assert.equal(initial.phaseFrame,0);
});
