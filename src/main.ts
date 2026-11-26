import './style.css';
import { createRuntime } from './runtime';
import { createScene } from './scene';
import { controls, demoInput, initial, DAY_FRAMES, type FishingInput, type FishingState, type Species } from './game/fishing';
import { sound } from './audio';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = el<HTMLCanvasElement>('scene'), audio = sound();
const params = new URLSearchParams(location.search);
// Dev/preview helpers: ?demo plays itself, ?golden starts in golden light.
const demo = params.has('demo');
const seedState: FishingState = params.has('golden') ? { ...initial, clock: Math.round(DAY_FRAMES * .5) } : initial;
const runtime = createRuntime(seedState);
let scene: ReturnType<typeof createScene>, started = false, paused = false, raf = 0;
let visualSeconds = 0, lastVisualTime: number | null = null;
const keys = new Set<string>();
let pointerDown = false, aimPoint: { x: number; z: number } | undefined;
let singleClick: ReturnType<typeof setTimeout> | undefined, lastTap = 0, lastTapX = 0, lastTapY = 0, moveId = 0;
let moveCommand: { x: number; z: number; id: number } | undefined, castQueued = false;

const FISH_COLORS: Record<Species['id'], [string, string]> = { perch: ['#a8cc52', '#3e6b2a'], koi: ['#f07326', '#fbf3e6'], bream: ['#b5c7a3', '#5e7a5c'], carp: ['#f0b84a', '#c98a26'] };
const fishIcon = (id: Species['id'], stroke = '#1f3d2b') => {
  const [fill, mark] = FISH_COLORS[id];
  return `<svg viewBox="0 0 64 36" aria-hidden="true"><path d="M6 18c8-12 26-15 40-6l12-8-3 14 3 14-12-8C32 33 14 30 6 18z" fill="${fill}" stroke="${stroke}" stroke-width="3.2" stroke-linejoin="round"/><path d="M26 10c-3 5-3 11 0 16M34 9c-3 6-3 12 0 18" fill="none" stroke="${mark}" stroke-width="2.4" stroke-linecap="round" opacity=".7"/><circle cx="15" cy="16" r="2.4" fill="${stroke}"/></svg>`;
};

const resetInput = () => { keys.clear(); pointerDown = false; if (singleClick) clearTimeout(singleClick); singleClick = undefined; lastTap = 0; castQueued = false; moveCommand = undefined; };
const input = (): FishingInput => ({ keys: castQueued ? [...keys, ' '] : [...keys], pointer: { x: 0, y: 0, down: pointerDown }, move: moveCommand, aim: aimPoint, live: true });

canvas.addEventListener('pointerdown', e => {
  if (!started || !e.isPrimary) return; e.preventDefault(); canvas.focus(); canvas.setPointerCapture(e.pointerId);
  const phase = runtime.state.phase, point = scene.pick(e.clientX, e.clientY);
  if (phase !== 'aim') { pointerDown = true; return; }
  if (!point) return;
  const now = performance.now(), near = Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 36;
  if (lastTap && now - lastTap < 320 && near) {
    if (singleClick) clearTimeout(singleClick); singleClick = undefined; lastTap = 0;
    aimPoint = point; castQueued = true; moveCommand = undefined;
  } else {
    lastTap = now; lastTapX = e.clientX; lastTapY = e.clientY; if (singleClick) clearTimeout(singleClick);
    singleClick = setTimeout(() => { if (runtime.state.phase === 'aim') moveCommand = { ...point, id: ++moveId }; singleClick = undefined; lastTap = 0; }, 320);
  }
});
canvas.addEventListener('pointermove', e => { if (!started || runtime.state.phase !== 'aim') return; const p = scene.pick(e.clientX, e.clientY); if (p) aimPoint = p; });
canvas.addEventListener('pointerup', () => { pointerDown = false; });
canvas.addEventListener('pointercancel', resetInput);
canvas.addEventListener('lostpointercapture', () => { pointerDown = false; });
window.addEventListener('keydown', e => { if ([' ', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && started) { if ((e.target as HTMLElement).tagName === 'BUTTON') return; e.preventDefault(); keys.add(e.key); } });
window.addEventListener('keyup', e => keys.delete(e.key));
const action = el<HTMLButtonElement>('action');
action.addEventListener('pointerdown', e => { e.preventDefault(); action.setPointerCapture(e.pointerId); keys.add(' '); });
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) action.addEventListener(type, () => keys.delete(' '));
el('mute').addEventListener('click', () => { el('mute').textContent = audio.toggle() ? 'sound on' : 'sound off'; });
el('start').addEventListener('click', start);
function start() {
  if (started) return; started = true; el('welcome').classList.add('gone'); setTimeout(() => el('welcome').hidden = true, 900);
  for (const id of ['counter', 'hint', 'mute']) el(id).hidden = false; action.hidden = false;
  if (!audio.enabled) audio.toggle(); el('mute').textContent = audio.enabled ? 'sound on' : 'sound off';
  runtime.setHidden(false); canvas.focus();
}

const coarse = matchMedia('(pointer: coarse)').matches;
let shownCaught = -1, lastCount = -1, hintTimer = 0;
let lastGold = -1;
function hud(s: FishingState) {
  const g = Math.round(scene.golden(s) * 100) / 100; if (g !== lastGold) { lastGold = g; document.documentElement.style.setProperty('--golden', String(g)); }
  if (s.caughtCount !== lastCount) {
    lastCount = s.caughtCount;
    el('counter-fish').innerHTML = (s.log.length ? s.log.slice(-4) : ['perch' as const]).map(id => fishIcon(id)).join('');
    el('counter-fish').style.opacity = s.log.length ? '1' : '.45';
    el('counter-n').textContent = String(s.caughtCount);
    const c = el('counter'); c.classList.remove('bump'); void c.offsetWidth; if (s.caughtCount) c.classList.add('bump');
  }
  const card = el('catch');
  if (s.phase === 'caught' && s.phaseFrame > 28 && s.phaseFrame < 215) {
    if (shownCaught !== s.castCount) {
      shownCaught = s.castCount;
      card.querySelector('.card-icon')!.innerHTML = fishIcon(s.species.id);
      el('catch-size').textContent = `${s.species.lengthCm} cm`; el('catch-name').textContent = s.species.name; el('catch-note').textContent = s.species.note;
      card.classList.remove('out'); card.hidden = false;
    }
  } else if (!card.hidden && !card.classList.contains('out')) { card.classList.add('out'); setTimeout(() => { if (card.classList.contains('out')) card.hidden = true; }, 350); }
  el('tension').hidden = s.phase !== 'reeling';
  if (s.phase === 'reeling') { const st = el('strain'); st.style.width = `${Math.min(100, s.tension * 100)}%`; st.classList.toggle('hot', s.tension > .75); el('landed').style.left = `calc(${s.progress * 100}% - 1px)`; }
  let hint = controls(s); if (coarse) hint = hint.replace('click the water to row · double-click or space to cast', 'tap the water to row · double-tap to cast').replace('click or space', 'tap');
  if (el('hint').textContent !== hint) el('hint').textContent = hint;
  hintTimer = s.caughtCount >= 2 && s.phase === 'aim' ? hintTimer + 1 : 0; el('hint').style.opacity = hintTimer > 600 ? '0' : '.9';
  action.textContent = s.phase === 'aim' ? 'cast' : s.phase === 'bite' ? 'hook!' : s.phase === 'reeling' ? 'hold to reel' : '…';
  action.disabled = !['aim', 'bite', 'reeling'].includes(s.phase);
}

function pause() {
  lastVisualTime = null; paused = document.hidden; resetInput(); runtime.setHidden(paused || !started);
  if (paused) { audio.pause(); cancelAnimationFrame(raf); } else { audio.resume(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); }
}
function loop(now: number) {
  if (paused) return;
  if (lastVisualTime !== null) visualSeconds += Math.min(.1, Math.max(0, (now - lastVisualTime) / 1000)); lastVisualTime = now;
  const result = runtime.tick(now, demo ? (st, f) => demoInput(st, f) : input());
  if (result.steps > 0) { castQueued = false; moveCommand = undefined; }
  for (const e of result.events) audio.event(e.type);
  const tr = performance.now(); scene.render(result.state, result.frame, result.events, visualSeconds); hud(result.state);
  if (import.meta.env.DEV && performance.now() - tr > 200) console.info('[slackwater] slow frame ms', Math.round(performance.now() - tr), result.frame);
  raf = requestAnimationFrame(loop);
}
try {
  scene = createScene(canvas); canvas.tabIndex = 0; runtime.setHidden(true);
  window.addEventListener('resize', () => scene.resize());
  document.addEventListener('visibilitychange', pause);
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); paused = true; audio.pause(); cancelAnimationFrame(raf); el('error').hidden = false; el('error').textContent = 'graphics paused. reload to return to the lagoon.'; });
  const startButton = el<HTMLButtonElement>('start'); startButton.disabled = true; startButton.textContent = 'filling the lagoon…';
  const tWarm = performance.now();
  scene.warm().finally(() => {
    if (import.meta.env.DEV) console.info('[slackwater] warm ms', Math.round(performance.now() - tWarm));
    startButton.disabled = false; startButton.textContent = 'go fishing';
    if (demo || params.has('play')) start();
    raf = requestAnimationFrame(loop);
  });
} catch (e) { el('error').hidden = false; el('error').textContent = 'this device could not start the 3d lagoon. try a browser with webgl enabled.'; console.error(e); }
// Dev-only: step the real loop with a synthetic clock (for inspection when rAF is throttled).
let fakeNow = 0;
if (import.meta.env.DEV) Object.assign(window, { __tick(frames = 1) { for (let i = 0; i < frames; i++) { fakeNow = Math.max(fakeNow, performance.now()) + 1000 / 60; loop(fakeNow); cancelAnimationFrame(raf); } return runtime.state.phase; } });
// Local diagnostic surface: no identity, persistence, score submission or network calls.
Object.assign(window, { slackwater: { get state() { return runtime.state; }, get frame() { return runtime.frame; }, stats: () => scene.stats() } });
