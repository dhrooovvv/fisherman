import { initial, step } from '../../game/fishing.ts';
import type { FishingEvent, FishingInput, FishingState } from '../../game/fishing.ts';

export const FIXED_SECONDS = 1 / 60;
export const MAX_DELTA_SECONDS = .1;
export const MAX_STEPS = 6;
export interface RuntimeEvent { frame: number; type: Exclude<FishingEvent, null>; state: FishingState }
export interface RuntimeFrame { state: FishingState; frame: number; steps: number; events: RuntimeEvent[]; alpha: number }
export type RuntimeInput = FishingInput | ((state: FishingState, frame: number) => FishingInput);
const held = (i: FishingInput) => !!i.pointer?.down || i.keys.some(k => k===' ' || k==='Space' || k==='Enter');
const copy = (s: FishingState): FishingState => ({...s,boat:{...s.boat,destination:{...s.boat.destination}},target:{...s.target},species:{...s.species}});

/** Fixed-clock bridge only: no DOM, render dependencies, timers or backend. */
export function createRuntime(seed: FishingState = initial) {
  let state=copy(seed), frame=0, accumulator=0, hidden=false;
  let timestamp: number | null=null;
  let sampledHeld=false, pendingPress: FishingInput | null=null;
  const result = (steps=0, events:RuntimeEvent[]=[]):RuntimeFrame => ({state,frame,steps,events,alpha:accumulator/FIXED_SECONDS});
  function advance(deltaSeconds: number,input: RuntimeInput): RuntimeFrame {
    if(hidden) return result();
    if(typeof input!=='function') {
      const down=held(input);
      // Preserve a press sampled between simulation ticks on 90/120/144 Hz displays.
      if(down&&!sampledHeld) pendingPress={...input,keys:[...input.keys],pointer:input.pointer?{...input.pointer}:undefined};
      sampledHeld=down;
    }
    const dt=Number.isFinite(deltaSeconds)?Math.max(0,Math.min(MAX_DELTA_SECONDS,deltaSeconds)):0;
    accumulator+=dt;
    const events:RuntimeEvent[]=[];
    let count=0;
    while(accumulator+1e-10>=FIXED_SECONDS && count<MAX_STEPS) {
      let command=typeof input==='function'?input(state,frame):input;
      if(pendingPress) { command=pendingPress; pendingPress=null; }
      state=step(state,command,frame);
      if(state.event) events.push({frame,type:state.event,state});
      frame++;count++;accumulator=Math.max(0,accumulator-FIXED_SECONDS);
    }
    // Drop excessive debt, never fast-forward an absent player's bite/tension window.
    if(count===MAX_STEPS && accumulator>=FIXED_SECONDS) accumulator%=FIXED_SECONDS;
    return result(count,events);
  }
  function tick(nowMs:number,input:RuntimeInput):RuntimeFrame {
    if(!Number.isFinite(nowMs)) return result();
    if(hidden) { timestamp=null;return result(); }
    if(timestamp===null) { timestamp=nowMs;return advance(0,input); }
    const dt=(nowMs-timestamp)/1000;timestamp=nowMs;
    return advance(dt,input);
  }
  function setHidden(value:boolean) {
    if(value===hidden)return;
    hidden=value;timestamp=null;accumulator=0;pendingPress=null;sampledHeld=false;
  }
  function reset(next: FishingState=initial) {
    state=copy(next);frame=0;accumulator=0;timestamp=null;pendingPress=null;sampledHeld=false;
  }
  return {get state(){return state;},get frame(){return frame;},advance,tick,setHidden,reset};
}
export type FishingRuntime=ReturnType<typeof createRuntime>;
