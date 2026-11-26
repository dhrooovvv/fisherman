import './style.css';
import {createRuntime} from './runtime';
import {createScene} from './scene';
import {controls,demoStep,initial,pointerTarget} from '../../game/fishing';
import {sound} from './audio';
const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const canvas=el<HTMLCanvasElement>('scene'), runtime=createRuntime(),audio=sound();
let scene:ReturnType<typeof createScene>,started=false,paused=false,raf=0;
let visualSeconds=0,lastVisualTime:number|null=null;
const keys=new Set<string>();let pointer:{x:number;y:number;down:boolean}|undefined;
let singleClick:ReturnType<typeof setTimeout>|undefined,lastTap=0,lastTapX=0,lastTapY=0,moveId=0;
let moveCommand:{x:number;z:number;id:number}|undefined,castQueued=false;
const resetInput=()=>{keys.clear();if(pointer)pointer.down=false;if(singleClick)clearTimeout(singleClick);singleClick=undefined;lastTap=0;castQueued=false;moveCommand=undefined;};
const input=()=>({keys:castQueued?[...keys,' ']:[...keys],pointer,move:moveCommand,live:true});
function updatePointer(e:PointerEvent,down?:boolean){const r=canvas.getBoundingClientRect();pointer={x:(e.clientX-r.left)/r.width*1280,y:(e.clientY-r.top)/r.height*720,down:down??pointer?.down??false}}
canvas.addEventListener('pointerdown',e=>{
 if(!started||!e.isPrimary)return;e.preventDefault();canvas.focus();canvas.setPointerCapture(e.pointerId);
 updatePointer(e,runtime.state.phase!=='aim');
 if(runtime.state.phase==='aim'){
  const now=performance.now(),near=Math.hypot(e.clientX-lastTapX,e.clientY-lastTapY)<32;
  if(lastTap&&now-lastTap<300&&near){if(singleClick)clearTimeout(singleClick);singleClick=undefined;moveCommand=undefined;lastTap=0;castQueued=true;}
  else {lastTap=now;lastTapX=e.clientX;lastTapY=e.clientY;if(singleClick)clearTimeout(singleClick);
   const point=pointerTarget(pointer!.x,pointer!.y,{x:0,z:0},0);
   singleClick=setTimeout(()=>{if(runtime.state.phase==='aim')moveCommand={...point,id:++moveId};singleClick=undefined;lastTap=0;},300);
  }
 }
});
canvas.addEventListener('pointermove',e=>updatePointer(e));
canvas.addEventListener('pointerup',e=>updatePointer(e,false));
canvas.addEventListener('pointercancel',resetInput);
canvas.addEventListener('lostpointercapture',()=>{if(pointer)pointer.down=false;});
window.addEventListener('keydown',e=>{if([' ','Enter','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)&&started){if((e.target as HTMLElement).tagName==='BUTTON')return;e.preventDefault();keys.add(e.key)}});
window.addEventListener('keyup',e=>keys.delete(e.key));
const action=el<HTMLButtonElement>('action');
action.addEventListener('pointerdown',e=>{e.preventDefault();action.setPointerCapture(e.pointerId);keys.add(' ')});
for(const type of ['pointerup','pointercancel','lostpointercapture'])action.addEventListener(type,()=>keys.delete(' '));
action.addEventListener('keydown',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();keys.add(' ')}});
action.addEventListener('keyup',()=>keys.delete(' '));
el('mute').addEventListener('click',()=>{el('mute').textContent=audio.toggle()?'sound on':'sound off'});
el('start').addEventListener('click',()=>{started=true;el('welcome').hidden=true;action.hidden=false;if(!audio.enabled)audio.toggle();el('mute').textContent='sound on';runtime.setHidden(false);canvas.focus()});
function hud(){const g=runtime.state;el('counter').textContent=`fish · ${g.caughtCount}`;el('hint').textContent=controls(g);el('tension').hidden=g.phase!=='reeling';el<HTMLMeterElement>('strain').value=g.tension;el('progress').textContent=`landed ${Math.round(g.progress*100)}%`;action.textContent=g.phase==='aim'?'cast':g.phase==='bite'?'hook!':g.phase==='reeling'?'hold to reel':'wait for the dip';action.disabled=!['aim','bite','reeling'].includes(g.phase);el('catch').hidden=g.phase!=='caught';if(g.phase==='caught')el('catch').textContent=`${g.species.name} · ${g.species.weight.toFixed(2)} kg · ${g.species.rarity}`;}
function pause(){lastVisualTime=null;paused=document.hidden||!document.hasFocus();resetInput();runtime.setHidden(paused||!started);if(paused){audio.pause();cancelAnimationFrame(raf)}else{audio.resume();cancelAnimationFrame(raf);raf=requestAnimationFrame(loop)}}
function loop(now:number){if(paused)return;if(lastVisualTime!==null)visualSeconds+=Math.min(.1,Math.max(0,(now-lastVisualTime)/1000));lastVisualTime=now;const result=runtime.tick(now,input());if(result.steps>0){castQueued=false;moveCommand=undefined;}for(const e of result.events)audio.event(e.type);scene.render(result.state,result.frame,result.events,visualSeconds);hud();raf=requestAnimationFrame(loop)}
try{scene=createScene(canvas);canvas.tabIndex=0;runtime.setHidden(true);window.addEventListener('resize',()=>scene.resize());document.addEventListener('visibilitychange',pause);window.addEventListener('blur',pause);window.addEventListener('focus',pause);canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();paused=true;audio.pause();cancelAnimationFrame(raf);el('error').hidden=false;el('error').textContent='graphics paused. reload to return to the lagoon.'});if(import.meta.env.DEV&&new URLSearchParams(location.search).has('inspect')){
 el('welcome').hidden=true;const requested=Number(new URLSearchParams(location.search).get('inspect'))||100;
 let state=initial;for(let i=0;i<requested;i++)state=demoStep(state,{keys:[]},i);
 scene.render(state,requested);el('hint').textContent=controls(state);
 Object.assign(window,{visualCheck:{state,stats:()=>scene.stats(),draw:(frame:number)=>{let s=initial;for(let i=0;i<frame;i++)s=demoStep(s,{keys:[]},i);scene.render(s,frame);return {state:s,stats:scene.stats()}}}});
 }else raf=requestAnimationFrame(loop)}catch(e){el('error').hidden=false;el('error').textContent='this device could not start the 3d lagoon. try a browser with webgl enabled.';console.error(e)}
// Local diagnostic surface: no Reddit identity, persistence, score submission or network calls.
Object.assign(window,{slackwater:{get state(){return runtime.state},get frame(){return runtime.frame},stats:()=>scene.stats()}});
