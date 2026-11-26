/**
 * Pure, deterministic fishing rules. No DOM, no rendering, no timers.
 * One step is one fixed 1/60 s tick. World units are metres on the water plane (x, z).
 */
export type Phase = 'aim' | 'casting' | 'waiting' | 'bite' | 'reeling' | 'caught' | 'escaped';
export type FishingEvent = 'cast' | 'splash' | 'nibble' | 'bite' | 'hook' | 'catch' | 'escape' | 'snap' | null;

export interface Species {
  id: 'perch' | 'koi' | 'bream' | 'carp';
  name: string;
  note: string;
  minCm: number;
  maxCm: number;
  /** 0..1, how hard the fish pulls while reeling. */
  strength: number;
  /** Only bites during golden light. */
  golden?: boolean;
}

export const SPECIES: readonly Species[] = [
  { id: 'perch', name: 'Reed Perch', note: 'waits under the weed', minCm: 28, maxCm: 52, strength: .45 },
  { id: 'koi', name: 'Copper Koi', note: 'follows the boat for crumbs', minCm: 35, maxCm: 64, strength: .55 },
  { id: 'bream', name: 'Moss Bream', note: 'grazes the stones at noon', minCm: 30, maxCm: 48, strength: .4 },
  { id: 'carp', name: 'Lantern Carp', note: 'rises when the light goes gold', minCm: 62, maxCm: 86, strength: .72, golden: true },
];

export interface Vec2 { x: number; z: number }
export interface Boat extends Vec2 { vx: number; vz: number; heading: number; destination: Vec2 }
export interface Catch { id: Species['id']; name: string; note: string; lengthCm: number }

export interface FishingState {
  phase: Phase;
  phaseFrame: number;
  /** Simulation frames since the session began; drives the day/golden-hour cycle. */
  clock: number;
  boat: Boat;
  target: Vec2;
  tension: number;
  progress: number;
  fishPull: number;
  waitFrames: number;
  castCount: number;
  caughtCount: number;
  species: Catch;
  /** Species ids landed so far, in order. */
  log: Species['id'][];
  event: FishingEvent;
  seed: number;
  moveId: number;
  /** Button state on the previous step, for edge-triggered actions. */
  held: boolean;
}

export interface FishingInput {
  keys: string[];
  pointer?: { x: number; y: number; down: boolean };
  /** World-space row destination; applied once per distinct id. */
  move?: { x: number; z: number; id: number };
  /** World-space aim point for the next cast. */
  aim?: Vec2;
  live?: boolean;
}

export const BOUNDS = 24;
export const CAST_MIN = 2.6;
export const CAST_MAX = 7.5;
export const DAY_FRAMES = 60 * 150;
const CAST_FRAMES = 48;
const BITE_FRAMES = 54;
const CAUGHT_FRAMES = 230;
const ESCAPED_FRAMES = 100;

/** 0 at bright noon, 1 at the deepest gold. Smooth, periodic. */
export function goldenness(clock: number): number {
  const p = (clock / DAY_FRAMES) % 1;
  const raw = .5 - .5 * Math.cos(p * Math.PI * 2);
  return raw * raw * (3 - 2 * raw);
}
export const isGolden = (clock: number) => goldenness(clock) > .55;

/** Small deterministic hash RNG (mulberry-style), stable across platforms. */
export function rand(seed: number, salt: number): number {
  let t = (seed * 0x9e3779b1 + salt * 0x85ebca6b) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const species0 = SPECIES[0];
export const initial: FishingState = Object.freeze({
  phase: 'aim',
  phaseFrame: 0,
  clock: 0,
  boat: { x: 0, z: 0, vx: 0, vz: 0, heading: .35, destination: { x: 0, z: 0 } },
  target: { x: 3.6, z: 1.6 },
  tension: 0,
  progress: 0,
  fishPull: 0,
  waitFrames: 200,
  castCount: 0,
  caughtCount: 0,
  species: { id: species0.id, name: species0.name, note: species0.note, lengthCm: 40 },
  log: [],
  event: null,
  seed: 7,
  moveId: 0,
  held: false,
}) as FishingState;

const held = (i: FishingInput) => !!i.pointer?.down || i.keys.some(k => k === ' ' || k === 'Space' || k === 'Enter');
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Keep the cast target inside the reachable ring around the boat. */
export function clampCast(boat: Vec2, p: Vec2): Vec2 {
  let dx = p.x - boat.x, dz = p.z - boat.z;
  let d = Math.hypot(dx, dz);
  if (d < 1e-4) { dx = 1; dz = 0; d = 1; }
  const r = clamp(d, CAST_MIN, CAST_MAX);
  return { x: clamp(boat.x + dx / d * r, -BOUNDS - 6, BOUNDS + 6), z: clamp(boat.z + dz / d * r, -BOUNDS - 6, BOUNDS + 6) };
}

function pickSpecies(s: FishingState): Catch {
  const golden = isGolden(s.clock);
  const r = rand(s.seed, s.castCount * 3 + 1);
  let pool = SPECIES.filter(sp => !sp.golden);
  if (golden) pool = [...pool, SPECIES[3], SPECIES[3]];
  // The first fish of a session is always the patient perch under the weed.
  const sp = s.castCount <= 1 && !golden ? SPECIES[0] : pool[Math.floor(r * pool.length) % pool.length];
  const len = sp.minCm + (sp.maxCm - sp.minCm) * rand(s.seed, s.castCount * 3 + 2);
  return { id: sp.id, name: sp.name, note: sp.note, lengthCm: Math.round(len) };
}
const strengthOf = (id: Species['id']) => SPECIES.find(s => s.id === id)?.strength ?? .5;

function moveBoat(s: FishingState, input: FishingInput): Boat {
  const b = s.boat;
  let destination = b.destination;
  if (input.move && input.move.id !== s.moveId && s.phase === 'aim') {
    destination = { x: clamp(input.move.x, -BOUNDS, BOUNDS), z: clamp(input.move.z, -BOUNDS, BOUNDS) };
  }
  // Arrow keys nudge the boat directly while aiming.
  let kx = 0, kz = 0;
  if (s.phase === 'aim') {
    if (input.keys.includes('ArrowLeft')) kx -= 1;
    if (input.keys.includes('ArrowRight')) kx += 1;
    if (input.keys.includes('ArrowUp')) kz -= 1;
    if (input.keys.includes('ArrowDown')) kz += 1;
  }
  if (kx || kz) destination = { x: clamp(b.x + kx * 2.2, -BOUNDS, BOUNDS), z: clamp(b.z + kz * 2.2, -BOUNDS, BOUNDS) };
  const dt = 1 / 60;
  const dx = destination.x - b.x, dz = destination.z - b.z, d = Math.hypot(dx, dz);
  const rowing = s.phase === 'aim' && d > .35;
  const maxSpeed = 1.55;
  let ax = 0, az = 0;
  if (rowing) {
    const want = Math.min(maxSpeed, d * .9);
    ax = (dx / d * want - b.vx) * 1.4;
    az = (dz / d * want - b.vz) * 1.4;
  }
  // Water drag; boats glide and settle rather than stopping dead.
  const drag = rowing ? .0 : .9;
  let vx = b.vx + (ax - b.vx * drag) * dt, vz = b.vz + (az - b.vz * drag) * dt;
  if (Math.hypot(vx, vz) < .002) { vx = 0; vz = 0; }
  const x = clamp(b.x + vx * dt, -BOUNDS, BOUNDS), z = clamp(b.z + vz * dt, -BOUNDS, BOUNDS);
  let heading = b.heading;
  const speed = Math.hypot(vx, vz);
  if (speed > .05) {
    const want = Math.atan2(-vz, vx);
    const diff = Math.atan2(Math.sin(want - heading), Math.cos(want - heading));
    heading += diff * Math.min(1, dt * 1.6 * Math.min(1, speed / .5));
  }
  return { x, z, vx, vz, heading, destination };
}

export function step(prev: FishingState, input: FishingInput, _frame = 0): FishingState {
  const s: FishingState = { ...prev, boat: moveBoat(prev, input), target: { ...prev.target }, event: null, clock: prev.clock + 1, phaseFrame: prev.phaseFrame + 1 };
  if (input.move && prev.phase === 'aim') s.moveId = input.move.id;
  const down = held(input), press = down && !prev.held;
  s.held = down;
  const go = (phase: Phase, event: FishingEvent = null) => { s.phase = phase; s.phaseFrame = 0; s.event = event; };
  switch (prev.phase) {
    case 'aim': {
      if (input.aim) s.target = clampCast(s.boat, input.aim);
      else s.target = clampCast(s.boat, s.target);
      if (press) {
        s.castCount = prev.castCount + 1;
        s.species = pickSpecies(s);
        s.waitFrames = 150 + Math.floor(rand(s.seed, s.castCount * 5 + 4) * 190);
        s.tension = 0; s.progress = 0; s.fishPull = 0;
        s.boat = { ...s.boat, destination: { x: s.boat.x + s.boat.vx * .6, z: s.boat.z + s.boat.vz * .6 } };
        go('casting', 'cast');
      }
      break;
    }
    case 'casting':
      if (s.phaseFrame >= CAST_FRAMES) go('waiting', 'splash');
      break;
    case 'waiting': {
      const f = s.phaseFrame, n1 = Math.floor(s.waitFrames * .45), n2 = Math.floor(s.waitFrames * .75);
      if (f === n1 || f === n2) s.event = 'nibble';
      if (f >= s.waitFrames) go('bite', 'bite');
      break;
    }
    case 'bite':
      if (press && s.phaseFrame > 2) { s.tension = .25; s.progress = .04; go('reeling', 'hook'); }
      else if (s.phaseFrame >= BITE_FRAMES) go('escaped', 'escape');
      break;
    case 'reeling': {
      const strength = strengthOf(s.species.id);
      const t = s.phaseFrame / 60;
      s.fishPull = clamp(.5 + .5 * Math.sin(t * 2.3 + s.castCount) * Math.sin(t * .9 + 1.3), 0, 1) * strength;
      if (down) {
        s.tension = clamp(prev.tension + (.0042 + s.fishPull * .0075), 0, 1.2);
        s.progress = clamp(prev.progress + .0068 * (1.15 - strength * .5) * (1 - s.fishPull * .35), 0, 1);
      } else {
        s.tension = clamp(prev.tension - .011, 0, 1.2);
        s.progress = clamp(prev.progress - .0008 * s.fishPull, 0, 1);
      }
      if (s.tension >= 1) go('escaped', 'snap');
      else if (s.progress >= 1) {
        s.caughtCount = prev.caughtCount + 1;
        s.log = [...prev.log, s.species.id];
        go('caught', 'catch');
      }
      break;
    }
    case 'caught':
      if (s.phaseFrame >= CAUGHT_FRAMES || (press && s.phaseFrame > 90)) { s.tension = 0; s.progress = 0; go('aim'); }
      break;
    case 'escaped':
      if (s.phaseFrame >= ESCAPED_FRAMES) { s.tension = 0; s.progress = 0; go('aim'); }
      break;
  }
  return s;
}

/** Hint line shown under the scene. */
export function controls(s: FishingState): string {
  switch (s.phase) {
    case 'aim': return 'click the water to row · double-click or space to cast';
    case 'casting': return 'the line sails out…';
    case 'waiting': return 'wait for the float to dip';
    case 'bite': return 'now! click or space to hook';
    case 'reeling': return s.tension > .78 ? 'ease off — the line is singing' : 'hold to reel, release to ease';
    case 'caught': return `${s.species.name} · ${s.species.lengthCm} cm`;
    case 'escaped': return 'it slipped away. the lagoon keeps its secrets';
  }
}

/** Scripted player for tests and inspection: casts, hooks quickly, pulses the reel. */
export function demoInput(s: FishingState, _frame: number): FishingInput {
  if (s.phase === 'aim' && s.phaseFrame > 40) return { keys: [' '] };
  if (s.phase === 'bite' && s.phaseFrame > 8) return { keys: [' '] };
  if (s.phase === 'reeling') return { keys: s.tension < .55 ? [' '] : [] };
  return { keys: [] };
}
export function demoStep(s: FishingState, input: FishingInput, frame: number): FishingState {
  const auto = demoInput(s, frame);
  return step(s, { ...input, keys: [...input.keys, ...auto.keys] }, frame);
}
