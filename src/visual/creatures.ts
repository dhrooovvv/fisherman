import * as THREE from 'three';
import { CAUSTIC_GLSL } from './caustics';
import { OCEAN_WAVE_GLSL, heightAt } from './ocean-motion';
import { EXTENT, NOISE_GLSL } from './lagoon';
import type { FishingState, Species } from '../game/fishing';

const TAU = Math.PI * 2;
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const clamp = THREE.MathUtils.clamp;
const ease = (p: number) => { p = clamp(p, 0, 1); return p * p * (3 - 2 * p); };
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

type Paint = (x: number, up: number, side: number) => THREE.Color;
interface FishLook { width: number; height: number; tail: number; fin: THREE.ColorRepresentation; paint: Paint; pectoral?: number; dorsal?: number }

/** Unit-length stylized fish, nose +x. Vertex colours carry the pattern. */
function fishGeometry(look: FishLook) {
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const rings = 20, seg = 14;
  for (let j = 0; j <= rings; j++) {
    const u = j / rings, x = -.5 + u;
    const prof = Math.pow(Math.sin(Math.PI * Math.min(.98, u * .92 + .06)), .62) * (u > .85 ? 1 - (u - .85) * 1.2 : 1);
    for (let k = 0; k <= seg; k++) {
      const a = k / seg * TAU, up = Math.cos(a), sd = Math.sin(a);
      pos.push(x, up * look.height * prof * (up < 0 ? .85 : 1), sd * look.width * prof);
      const c = look.paint(x, up, sd); col.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < rings; j++) for (let k = 0; k < seg; k++) { const a = j * (seg + 1) + k, b = a + seg + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const fin = new THREE.Color(look.fin);
  const addTri = (pts: number[][], c = fin) => { const base = pos.length / 3; for (const p of pts) { pos.push(p[0], p[1], p[2]); col.push(c.r, c.g, c.b); } for (let i = 1; i < pts.length - 1; i++) idx.push(base, base + i, base + i + 1); };
  const t = look.tail;
  // Forked, flowing tail (vertical) plus a hint of spread so it reads from above.
  addTri([[-.47, 0, 0], [-.5 - t * .9, t * .55, -.02], [-.5 - t * .55, 0, 0], [-.5 - t * .9, -t * .5, .02]]);
  addTri([[-.47, 0, 0], [-.5 - t * .8, 0, t * .28], [-.5 - t * .8, 0, -t * .28]], fin.clone().multiplyScalar(.95));
  const d = look.dorsal ?? 1;
  addTri([[.15, look.height * .9, 0], [-.05, look.height * (1 + .5 * d), 0], [-.3, look.height * .55, 0]]);
  const pf = look.pectoral ?? 1;
  for (const s of [-1, 1]) addTri([[.18, -look.height * .2, s * look.width * .8], [.0, -look.height * .3, s * (look.width + .16 * pf)], [-.06, -look.height * .25, s * (look.width * .7 + .1 * pf)]]);
  // Eyes
  for (const s of [-1, 1]) { const e = new THREE.Color('#15201f'); const cx = .38, cy = look.height * .25, cz = s * look.width * .62; const b = pos.length / 3; for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; pos.push(cx + Math.cos(a) * .025, cy + Math.sin(a) * .025, cz + s * .006); col.push(e.r, e.g, e.b); } for (let k = 1; k < 5; k++) idx.push(b, b + k, b + k + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

const noise2 = (a: number, b: number) => Math.sin(a * 12.9 + Math.sin(b * 7.1) * 2.3) * Math.cos(b * 9.7 - a * 3.1);
const LOOKS: Record<string, FishLook> = {
  koi: { width: .12, height: .12, tail: .32, fin: '#f59a52', pectoral: 1.3, paint: (x, up, sd) => {
    const white = noise2(x * 1.3 + 2, sd + up * .3) > .45 && x < .35; const c = new THREE.Color(white ? '#fff6ea' : '#ff6a12'); if (up > .4 && !white) c.lerp(new THREE.Color('#e2561c'), .35); if (up < -.3) c.lerp(new THREE.Color('#fde6c8'), .6); return c; } },
  teal: { width: .1, height: .15, tail: .25, fin: '#f2c94c', paint: (x, up) => { const c = new THREE.Color('#38b7b4'); if (up > .3) c.lerp(new THREE.Color('#2a8aa1'), .5); if (up < -.3) c.lerp(new THREE.Color('#d6f2e6'), .6); if (Math.abs(x - .05) < .03) c.lerp(new THREE.Color('#f2c94c'), .7); return c; } },
  perch: { width: .13, height: .2, tail: .26, fin: '#e98a3a', dorsal: 1.4, paint: (x, up) => { const c = new THREE.Color('#a8cc52'); if (up > .3) c.lerp(new THREE.Color('#5f8f37'), .6); if (up < -.35) c.lerp(new THREE.Color('#f3edb8'), .7); if (Math.sin(x * 34) > .55 && up > -.3) c.lerp(new THREE.Color('#3e6b2a'), .75); return c; } },
  carp: { width: .17, height: .22, tail: .3, fin: '#f0b03c', paint: (x, up, sd) => { const c = new THREE.Color('#f0b84a'); if (up > .3) c.lerp(new THREE.Color('#c98a26'), .5); if (up < -.3) c.lerp(new THREE.Color('#fff0bf'), .6); const sc = Math.sin(x * 60 + up * 8) * Math.sin(sd * 9 + x * 30); if (sc > .6) c.lerp(new THREE.Color('#ffe08a'), .5); return c; } },
  bream: { width: .1, height: .22, tail: .26, fin: '#9fb98a', paint: (_x, up) => { const c = new THREE.Color('#b5c7a3'); if (up > .3) c.lerp(new THREE.Color('#5e7a5c'), .55); if (up < -.3) c.lerp(new THREE.Color('#f1f2df'), .6); return c; } },
  puffer: { width: .2, height: .19, tail: .18, fin: '#c8c06a', paint: (x, up, sd) => { const c = new THREE.Color('#c9c766'); if (up < -.2) c.lerp(new THREE.Color('#f4f0cf'), .7); if (Math.sin(x * 50) * Math.sin(sd * 14) > .7) c.lerp(new THREE.Color('#5a5a32'), .7); return c; } },
};

export function createCreatures(scene: THREE.Scene) {
  const root = new THREE.Group(); root.name = 'creatures'; scene.add(root);
  const geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = [];
  const time = { value: 0 };
  const geometry = <T extends THREE.BufferGeometry>(g: T) => { geometries.push(g); return g; };
  function swimMaterial(key: string, opts: { amp?: number; freq?: number; spots?: boolean; color?: THREE.ColorRepresentation; vertexColors?: boolean } = {}) {
    const m = new THREE.MeshStandardMaterial({ vertexColors: opts.vertexColors ?? true, color: opts.color ?? '#ffffff', roughness: .5, side: THREE.DoubleSide });
    const phase = { value: 0 }, effort = { value: 1 };
    m.userData.phase = phase; m.userData.effort = effort;
    m.onBeforeCompile = shader => {
      shader.uniforms.swimTime = time; shader.uniforms.swimPhase = phase; shader.uniforms.swimEffort = effort;
      shader.uniforms.swimFreq = { value: opts.freq ?? 7 }; shader.uniforms.swimAmp = { value: opts.amp ?? .09 }; shader.uniforms.swimSpots = { value: opts.spots ? 1 : 0 };
      shader.vertexShader = 'uniform float swimTime,swimPhase,swimEffort,swimFreq,swimAmp;varying vec3 swWorld;varying vec3 swLocal;\n#ifdef USE_INSTANCING\nattribute float aSwimSeed;\n#endif\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        // A fixed per-fish seed. Deriving it from the moving instance position made
        // the phase jump every frame (scaled by elapsed time), so tails fluttered.
        float seed=swimPhase;
        #ifdef USE_INSTANCING
         seed+=aSwimSeed;
        #endif
        swLocal=position;
        float tailW=smoothstep(.35,-.75,position.x);
        transformed.z+=sin(swimTime*swimFreq*(.8+fract(seed*.37)*.4)+seed-position.x*4.5)*swimAmp*tailW*swimEffort;`)
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 swP=vec4(transformed,1.);
        #ifdef USE_INSTANCING
         swP=instanceMatrix*swP;
        #endif
        swWorld=(modelMatrix*swP).xyz;`);
      shader.fragmentShader = 'uniform float swimTime,swimSpots;varying vec3 swWorld;varying vec3 swLocal;\n' + NOISE_GLSL + CAUSTIC_GLSL + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        if(swimSpots>.5){
        vec2 sp=swLocal.xz*vec2(11.,19.);vec2 ci=floor(sp);vec2 cf=fract(sp)-.5;vec2 jit=(vec2(lgHash(ci),lgHash(ci+3.7))-.5)*.5;
        float spot=(1.-smoothstep(.17,.22,length(cf-jit)*(1.+lgHash(ci+9.)*.9)))*step(.25,lgHash(ci+5.1));
        float topSide=smoothstep(-.02,.06,swLocal.y);
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.86,.92,.96),spot*topSide*.9);}
        float wet=1.-smoothstep(-.08,.04,swWorld.y);
        diffuseColor.rgb*=1.+underwaterCaustic(swWorld,swimTime)*.35*wet;`);
    };
    m.customProgramCacheKey = () => 'swim'; void key;
    materials.push(m); return m;
  }

  // ---- Ambient schools (instanced: one draw per species) ----
  type Swimmer = { route: THREE.CatmullRomCurve3; speed: number; offset: THREE.Vector3; lag: number; depth: number; size: number; inst: THREE.InstancedMesh; index: number; heading: number; pos: THREE.Vector3; avoid: THREE.Vector3; color?: THREE.Color };
  const swimmers: Swimmer[] = [];
  function routeAround(cx: number, cz: number, r: number, salt: number) {
    const pts = Array.from({ length: 7 }, (_, j) => { const a = j / 7 * TAU + hash(salt + j) * .6, rr = r * (.6 + hash(salt * 3 + j) * .7); return V(clamp(cx + Math.cos(a) * rr, -EXTENT, EXTENT), 0, clamp(cz + Math.sin(a) * rr, -EXTENT, EXTENT)); });
    const c = new THREE.CatmullRomCurve3(pts, true, 'centripetal'); c.arcLengthDivisions = 200; c.updateArcLengths(); return c;
  }
  function school(kind: string, schools: number, per: number, size: number, depth: number, speed: number, salt: number, amp = .09) {
    const g = geometry(fishGeometry(LOOKS[kind])); const m = swimMaterial(kind, { amp, freq: 5.5 });
    g.setAttribute('aSwimSeed', new THREE.InstancedBufferAttribute(Float32Array.from({ length: schools * per }, (_, i) => hash(salt * 17 + i) * TAU), 1));
    const inst = new THREE.InstancedMesh(g, m, schools * per); inst.userData.underwater = true; inst.castShadow = true; inst.frustumCulled = false; root.add(inst);
    let n = 0;
    for (let sIdx = 0; sIdx < schools; sIdx++) {
      const cx = (hash(salt + sIdx * 5) - .5) * EXTENT * 1.5, cz = (hash(salt + sIdx * 9 + 1) - .5) * EXTENT * 1.5;
      const route = routeAround(cx, cz, 4 + hash(salt + sIdx) * 7, salt + sIdx * 11);
      for (let k = 0; k < per; k++) swimmers.push({ route, speed: speed * (.85 + hash(salt + sIdx * 2) * .3), offset: V((hash(n + salt) - .5) * 1.1, (hash(n * 3 + salt) - .5) * .25, (hash(n * 7 + salt) - .5) * 1.1), lag: k * .45 + hash(n + 9) * .3, depth, size: size * (.8 + hash(n * 5 + salt) * .4), inst, index: n++, heading: 0, pos: V(), avoid: V() });
    }
    return inst;
  }
  school('koi', 26, 7, .82, -.22, .55, 11, .11);
  school('teal', 12, 4, .45, -.6, .7, 23);
  school('puffer', 4, 1, .5, -.8, .35, 37);
  school('bream', 5, 3, .55, -.75, .5, 51);
  const dummy = new THREE.Object3D();

  // ---- Catchable fish (one visible at a time while hooked / landed) ----
  const catchMeshes: Record<Species['id'], THREE.Mesh> = {} as never;
  for (const id of ['perch', 'koi', 'bream', 'carp'] as const) {
    const g = geometry(fishGeometry(LOOKS[id])); const m = swimMaterial('catch-' + id, { amp: .12, freq: 11 });
    const o = new THREE.Mesh(g, m); o.visible = false; o.castShadow = true; scene.add(o); catchMeshes[id] = o;
  }
  const catchLength: Record<Species['id'], number> = { perch: 1, koi: 1, bream: 1, carp: 1 };

  // ---- Otter: floats on its back, paws folded, drifting near the boat ----
  const otter = new THREE.Group(); otter.name = 'otter'; scene.add(otter);
  {
    const fur = new THREE.MeshStandardMaterial({ color: '#7b4d2e', roughness: .8 }), belly = new THREE.MeshStandardMaterial({ color: '#d9bf98', roughness: .85 }), dark = new THREE.MeshStandardMaterial({ color: '#2a1c14', roughness: .5 });
    materials.push(fur, belly, dark);
    const ball = geometry(new THREE.SphereGeometry(1, 18, 12));
    const add = (m: THREE.Material, p: THREE.Vector3, s: THREE.Vector3, parent: THREE.Object3D = otter) => { const o = new THREE.Mesh(ball, m); o.position.copy(p); o.scale.copy(s); o.castShadow = true; parent.add(o); return o; };
    add(fur, V(0, 0, 0), V(.42, .13, .17));
    add(belly, V(.02, .07, 0), V(.32, .07, .13));
    add(fur, V(.42, .06, 0), V(.13, .11, .12));
    add(belly, V(.47, .1, 0), V(.09, .07, .085));
    add(dark, V(.56, .12, 0), V(.025, .02, .03));
    for (const s of [-1, 1]) { add(fur, V(.38, .1, s * .1), V(.035, .03, .035)); add(dark, V(.5, .17, s * .045), V(.014, .014, .014)); add(fur, V(.22, .14, s * .07), V(.06, .04, .045)); add(fur, V(-.36, .06, s * .08), V(.08, .05, .05)); }
    const tail = add(fur, V(-.56, .02, 0), V(.2, .045, .07)); tail.rotation.z = .1;
    otter.scale.setScalar(1.15);
  }

  // ---- Whale shark: huge, gentle, spotted ----
  const shark = new THREE.Group(); shark.name = 'whale-shark'; scene.add(shark);
  const sharkMat = swimMaterial('shark', { amp: .05, freq: 1.6, spots: true, vertexColors: true });
  {
    const look: FishLook = { width: .14, height: .1, tail: .34, fin: '#3f689c', pectoral: 1.5, dorsal: 1.2, paint: (_x, up) => { const c = new THREE.Color('#4a76aa'); if (up > .2) c.lerp(new THREE.Color('#3d669b'), .4); if (up < -.3) c.lerp(new THREE.Color('#c3d4e0'), .7); return c; } };
    const g = geometry(fishGeometry(look));
    // Flatten and broaden the head: whale sharks have a wide, square mouth.
    const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i); const widen = 1 + smooth01((x - .1) / .4) * .45; p.setZ(i, p.getZ(i) * widen); if (x > .3) p.setY(i, p.getY(i) * .85); } g.computeVertexNormals();
    const body = new THREE.Mesh(g, sharkMat); body.castShadow = true; shark.add(body);
    shark.scale.set(6.2, 5.4, 6.2); shark.userData.underwater = true; body.userData.underwater = true;
  }
  function smooth01(x: number) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
  const sharkRoute = routeAround(1, 3, 9, 701);

  let lastTime: number | undefined, lastPhase = '', phaseStartPos = V(), held: THREE.Mesh | undefined, lastCast = -1;
  const hookPoint = V(), tmp = V(), otterPos = V(6, 0, 3), otterVel = V(), sharkPos = V();
  let sharkHeading = 0, otterHeading = 0;

  function update(t: number, s: FishingState, bobber: THREE.Vector3, hold: THREE.Object3D, focus: THREE.Vector3) {
    const dt = lastTime === undefined ? 1 / 60 : clamp(t - lastTime, 0, .1); lastTime = t; time.value = t;
    const boat = s.boat;
    // Schools follow their routes; fish ease aside and dive below a moving hull.
    for (const f of swimmers) {
      const L = f.route.getLength();
      const u = (((t * f.speed - f.lag) / L) % 1 + 1) % 1;
      f.route.getPointAt(u, tmp);
      const tan = f.route.getTangentAt(u);
      const side = V(-tan.z, 0, tan.x);
      const wander = Math.sin(t * .5 + f.index) * .25;
      const px = tmp.x + side.x * (f.offset.x + wander) + tan.x * f.offset.z, pz = tmp.z + side.z * (f.offset.x + wander) + tan.z * f.offset.z;
      const rx = px - boat.x, rz = pz - boat.z, rr = Math.hypot(rx, rz);
      const push = rr < 2.2 ? (1 - rr / 2.2) : 0;
      f.avoid.lerp(V(rx / (rr + 1e-3) * push * 1.2, -push * .4, rz / (rr + 1e-3) * push * 1.2), 1 - Math.exp(-dt * 2.5));
      const nx = px + f.avoid.x, nz = pz + f.avoid.z, ny = f.depth + f.offset.y + f.avoid.y + Math.sin(t * .7 + f.index) * .05;
      const dx = nx - f.pos.x, dz = nz - f.pos.z;
      if (Math.hypot(dx, dz) > 1e-4) { const want = Math.atan2(-dz, dx); const diff = Math.atan2(Math.sin(want - f.heading), Math.cos(want - f.heading)); f.heading += diff * (f.pos.lengthSq() === 0 ? 1 : 1 - Math.exp(-dt * 5)); }
      f.pos.set(nx, ny, nz);
      dummy.position.copy(f.pos); dummy.rotation.set(0, f.heading, 0); dummy.scale.setScalar(f.size); dummy.updateMatrix(); f.inst.setMatrixAt(f.index, dummy.matrix);
    }
    for (const f of swimmers) f.inst.instanceMatrix.needsUpdate = true;

    // Whale shark cruises a wide loop, slow tail beats.
    {
      const u = ((t * .9 / sharkRoute.getLength()) % 1 + 1) % 1; sharkRoute.getPointAt(u, sharkPos); const tan = sharkRoute.getTangentAt(u);
      sharkHeading = Math.atan2(-tan.z, tan.x); shark.position.set(sharkPos.x, -1.05, sharkPos.z); shark.rotation.set(0, sharkHeading, 0);
    }

    // Otter: lazy drift that keeps company with the boat, bobbing on the swell.
    {
      const want = V(boat.x - 4.2 + Math.sin(t * .11) * 1.4, 0, boat.z - 1.6 + Math.cos(t * .09) * 1.5);
      tmp.subVectors(want, otterPos); const d = tmp.length();
      otterVel.lerp(tmp.multiplyScalar(d > .5 ? .35 : 0), 1 - Math.exp(-dt * .6));
      otterPos.addScaledVector(otterVel, dt);
      { const ax = otterPos.x - boat.x, az = otterPos.z - boat.z, ad = Math.hypot(ax, az); if (ad < 2.6) { otterPos.x = boat.x + ax / (ad || 1) * 2.6; otterPos.z = boat.z + az / (ad || 1) * 2.6; } }
      const speed = otterVel.length(); if (speed > .05) { const wantH = Math.atan2(-otterVel.z, otterVel.x); otterHeading += Math.atan2(Math.sin(wantH - otterHeading), Math.cos(wantH - otterHeading)) * (1 - Math.exp(-dt * 1.2)); }
      otter.position.set(otterPos.x, heightAt(otterPos.x, otterPos.z, t) + .02, otterPos.z);
      otter.rotation.set(Math.sin(t * 1.1) * .06, otterHeading + Math.sin(t * .3) * .3, Math.sin(t * .9) * .05);
    }

    // Hooked / landed fish.
    if (s.castCount !== lastCast) { lastCast = s.castCount; }
    if (s.phase !== lastPhase) { if (held) phaseStartPos.copy(held.position); lastPhase = s.phase; }
    const current = catchMeshes[s.species.id];
    for (const m of Object.values(catchMeshes)) if (m !== current) m.visible = false;
    held = current;
    const size = clamp(s.species.lengthCm / 100, .3, .9) * 1.1 * catchLength[s.species.id];
    current.scale.setScalar(size);
    const mat = current.material as THREE.MeshStandardMaterial; const effort = mat.userData.effort as { value: number };
    let hooked = false;
    if (s.phase === 'waiting') {
      // The fish circles in from the weeds beneath the float.
      const p = clamp(s.phaseFrame / Math.max(1, s.waitFrames), 0, 1);
      const a = t * .8, r = 1.6 * (1 - ease(p)) + .35;
      current.visible = p > .25; current.position.set(bobber.x + Math.cos(a) * r, -.55 + p * .25, bobber.z + Math.sin(a) * r);
      current.rotation.set(0, -a - Math.PI / 2, 0); effort.value = .6;
    } else if (s.phase === 'bite' || s.phase === 'reeling') {
      current.visible = true; hooked = true;
      const away = Math.atan2(-(bobber.z - boat.z), bobber.x - boat.x);
      const thrash = Math.sin(t * 9) * .35 * (s.phase === 'reeling' ? .6 + s.fishPull : 1);
      current.rotation.set(Math.sin(t * 7) * .15, away + thrash, -.25);
      tmp.set(-.5 * size, 0, 0).applyEuler(current.rotation);
      current.position.set(bobber.x + tmp.x * -.1, -.22 + Math.sin(t * 5) * .04, bobber.z + tmp.z * -.1);
      effort.value = 1.6;
    } else if (s.phase === 'caught') {
      const age = s.phaseFrame;
      hold.updateWorldMatrix(true, false); const anchor = hold.getWorldPosition(V());
      const lift = ease(age / 34);
      if (age < 2) phaseStartPos.set(bobber.x, -.2, bobber.z);
      const arc = V().lerpVectors(phaseStartPos, anchor, lift); arc.y += Math.sin(lift * Math.PI) * 1.1;
      current.position.copy(arc);
      const q = new THREE.Quaternion(); hold.getWorldQuaternion(q);
      const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
      current.rotation.set(Math.sin(t * 6) * .1 * (1 - lift), e.y + Math.PI / 2, .15 + Math.sin(t * 3) * .06 * lift, 'YXZ');
      const away = ease((age - 200) / 25); current.scale.multiplyScalar((1 + lift * (.95 - size * .6)) * (1 - away * .9));
      current.visible = age < 224; effort.value = lift < 1 ? 1.4 : .35;
      hooked = age < 30;
    } else current.visible = false;
    if (hooked) { tmp.set(.5 * size, 0, 0).applyEuler(current.rotation); hookPoint.copy(current.position).add(tmp); }
    void focus;
    return { hook: hooked ? hookPoint : null, otter: otter.position, shark: shark.position };
  }
  function underwaterObjects() { return [root, shark]; }
  function dispose() { [root, otter, shark, ...Object.values(catchMeshes)].forEach(o => o.removeFromParent()); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); }
  return { update, dispose, underwaterObjects, otter, shark, catchMeshes };
}
// Shared helpers for other modules that need to place things on the swell.
export const SWELL_GLSL = OCEAN_WAVE_GLSL;
