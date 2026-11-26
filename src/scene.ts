import * as THREE from 'three';
import { createWater } from './visual/water';
import { createLagoon } from './visual/lagoon';
import { createBoat } from './visual/boat';
import { createCreatures } from './visual/creatures';
import { heightAt, surfaceSlope } from './visual/ocean-motion';
import { goldenness, type FishingState } from './game/fishing';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const rnd = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const CAM_OFFSET = V(0, 14.2, 9.6);

/** All rendering is disposable and independent of the deterministic fishing rules. */
export function createScene(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.info.autoReset = false; renderer.debug.checkShaderErrors = import.meta.env.DEV;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#1f6f6c');
  const camera = new THREE.PerspectiveCamera(30, 16 / 9, .5, 120);
  const hemi = new THREE.HemisphereLight('#d4ecff', '#3d6b58', 1.35); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff3df', 3.1); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 70 });
  sun.shadow.radius = 4; sun.shadow.bias = -.0004; sun.shadow.normalBias = .03; scene.add(sun, sun.target);

  if (import.meta.env.DEV) Object.assign(window, { __three: { scene, camera, renderer } });
  const lagoon = createLagoon(scene);
  const boat = createBoat(scene);
  const creatures = createCreatures(scene);
  const water = createWater(scene, camera);

  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => { disposables.push(x); return x; };
  // Float: red cap, white skirt, yellow antenna.
  const bobber = new THREE.Group(); scene.add(bobber);
  {
    const red = keep(new THREE.MeshStandardMaterial({ color: '#e0352a', roughness: .35 })), white = keep(new THREE.MeshStandardMaterial({ color: '#f6f1e6', roughness: .4 })), yellow = keep(new THREE.MeshStandardMaterial({ color: '#f3c234', roughness: .4 }));
    const ball = keep(new THREE.SphereGeometry(1, 20, 14));
    const top = new THREE.Mesh(ball, red); top.scale.set(.085, .08, .085); top.position.y = .04; top.castShadow = true;
    const skirt = new THREE.Mesh(ball, white); skirt.scale.set(.08, .045, .08); skirt.position.y = -.01;
    const stick = new THREE.Mesh(keep(new THREE.CylinderGeometry(.012, .012, .16, 6)), yellow); stick.position.y = .17;
    bobber.add(top, skirt, stick);
  }
  // Fishing line as a thin tube so it reads clearly at any resolution.
  const LINE_SEG = 28;
  const lineCurvePts = Array.from({ length: LINE_SEG + 1 }, () => V());
  const lineMat = keep(new THREE.MeshBasicMaterial({ color: '#fbf7ec' }));
  let lineGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(), V(1, 0, 0)]), LINE_SEG, .009, 4, false);
  const line = new THREE.Mesh(lineGeo, lineMat); line.frustumCulled = false; scene.add(line);
  // Cast target hint: a soft dashed ring on the water.
  const aimMat = keep(new THREE.MeshBasicMaterial({ color: '#fff8e6', transparent: true, opacity: .55, depthWrite: false }));
  const aimGeo = keep(new THREE.RingGeometry(.3, .34, 48, 1, 0, Math.PI * 2)); aimGeo.rotateX(-Math.PI / 2);
  const aim = new THREE.Mesh(aimGeo, aimMat); aim.renderOrder = 3; scene.add(aim);
  const destGeo = keep(new THREE.RingGeometry(.18, .21, 32)); destGeo.rotateX(-Math.PI / 2);
  const dest = new THREE.Mesh(destGeo, aimMat); dest.renderOrder = 3; scene.add(dest);
  // Splash droplets.
  const dropMat = keep(new THREE.MeshBasicMaterial({ color: '#f4fffb' }));
  const drops = new THREE.InstancedMesh(keep(new THREE.SphereGeometry(1, 8, 6)), dropMat, 40); drops.frustumCulled = false; scene.add(drops);
  const dropDummy = new THREE.Object3D();
  let splashAt = -100, splashPos = V(), splashPower = 1;

  const raycaster = new THREE.Raycaster(), plane = new THREE.Plane(V(0, 1, 0), 0), ndc = new THREE.Vector2(), hit = V();
  const focus = V(), focusGoal = V(), camPos = V(), lookAt = V();
  let viewW = 1280, viewH = 720, zoom = 1, lastT: number | undefined, focusInit = false;
  let lastBoatRipple = -10, lastOarDip = -10, lastBobRipple = -10, lastOtterRipple = -10, lastPhase = '';
  const seenEvents = new Set<string>();

  function resize() {
    viewW = window.innerWidth; viewH = window.innerHeight;
    renderer.setSize(viewW, viewH, false); canvas.style.width = viewW + 'px'; canvas.style.height = viewH + 'px';
    camera.aspect = viewW / viewH;
    // Keep horizontal coverage on portrait screens.
    const baseV = 30, aspect = camera.aspect;
    camera.fov = aspect >= 16 / 9 ? baseV : Math.min(62, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(baseV) / 2) * (16 / 9) / aspect)) * (aspect < 1 ? .82 : 1));
    camera.updateProjectionMatrix();
  }
  resize();

  function pick(clientX: number, clientY: number) {
    const r = canvas.getBoundingClientRect();
    ndc.set((clientX - r.left) / r.width * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray.intersectPlane(plane, hit) ? { x: hit.x, z: hit.z } : null;
  }

  const sunDay = V(.2, .74, -.64).normalize(), sunGold = V(.5, .5, -.7).normalize(), sunDir = V();
  const cSunDay = new THREE.Color('#fff3df'), cSunGold = new THREE.Color('#ffae62');
  const cSkyDay = new THREE.Color('#d4ecff'), cSkyGold = new THREE.Color('#a9c6d6');
  const cGrDay = new THREE.Color('#3d6b58'), cGrGold = new THREE.Color('#2a5a5e');
  const cBgDay = new THREE.Color('#1f6f6c'), cBgGold = new THREE.Color('#1f4a44');

  function render(s: FishingState, frame: number, events: { type: string; frame: number }[] = [], t = frame / 60) {
    const dt = lastT === undefined ? 1 / 60 : Math.min(.1, Math.max(0, t - lastT)); lastT = t;
    renderer.info.reset();
    const golden = goldenness(s.clock);

    // Light: noon to golden hour.
    sunDir.copy(sunDay).lerp(sunGold, golden).normalize();
    sun.color.copy(cSunDay).lerp(cSunGold, golden); sun.intensity = THREE.MathUtils.lerp(2.7, 3.2, golden);
    hemi.color.copy(cSkyDay).lerp(cSkyGold, golden); hemi.groundColor.copy(cGrDay).lerp(cGrGold, golden); hemi.intensity = THREE.MathUtils.lerp(1.6, 1.15, golden);
    (scene.background as THREE.Color).copy(cBgDay).lerp(cBgGold, golden);
    renderer.toneMappingExposure = THREE.MathUtils.lerp(1.05, 1.12, golden);

    // Camera follows the boat with a little lead; it leans toward the line while fishing.
    const b = s.boat;
    focusGoal.set(b.x + b.vx * .7, 0, b.z + b.vz * .7);
    if (['waiting', 'bite', 'reeling'].includes(s.phase)) focusGoal.lerp(V(s.target.x, 0, s.target.z), .28);
    if (!focusInit) { focus.copy(focusGoal); focusInit = true; }
    focus.lerp(focusGoal, 1 - Math.exp(-dt * 1.8));
    const zoomGoal = s.phase === 'caught' && s.phaseFrame > 20 && s.phaseFrame < 210 ? .8 : s.phase === 'reeling' ? .93 : 1;
    zoom += (zoomGoal - zoom) * (1 - Math.exp(-dt * 1.6));
    camPos.copy(focus).addScaledVector(CAM_OFFSET, zoom); camera.position.copy(camPos);
    lookAt.copy(focus); lookAt.y = -.2; camera.lookAt(lookAt); camera.updateMatrixWorld();
    sun.target.position.copy(focus); sun.position.copy(focus).addScaledVector(sunDir, 35);
    sun.shadow.camera.updateProjectionMatrix();

    lagoon.update(t, golden);
    const pose = boat.update(t, s, golden);

    // Float position by phase.
    let bx = s.target.x, bz = s.target.z, by = .02 + heightAt(bx, bz, t);
    if (s.phase === 'casting') { const p = Math.min(1, s.phaseFrame / 48); bx = THREE.MathUtils.lerp(pose.tip.x, s.target.x, p); bz = THREE.MathUtils.lerp(pose.tip.z, s.target.z, p); by = THREE.MathUtils.lerp(pose.tip.y, heightAt(bx, bz, t), p) + Math.sin(p * Math.PI) * 1.8; }
    if (s.phase === 'waiting' && s.phaseFrame > s.waitFrames - 60) by += Math.sin(t * 16) * .025;
    if (s.phase === 'bite') by -= .12 + Math.sin(t * 20) * .05;
    if (s.phase === 'reeling') { const k = 1 - s.progress * .7; bx = b.x + (s.target.x - b.x) * k + Math.sin(t * 6) * s.fishPull * .25; bz = b.z + (s.target.z - b.z) * k + Math.cos(t * 5) * s.fishPull * .15; by = heightAt(bx, bz, t) - .04; }
    bobber.position.set(bx, by, bz);
    const sl = surfaceSlope(bx, bz, t); bobber.rotation.set(sl.z * 2, 0, -sl.x * 2 + (s.phase === 'bite' ? .5 : 0));
    bobber.visible = ['casting', 'waiting', 'bite', 'reeling'].includes(s.phase);

    const life = creatures.update(t, s, bobber.position, pose.hold, focus);
    // Line from rod tip to float or to the fish's mouth while it is lifted.
    const lineEnd = life.hook ?? bobber.position;
    line.visible = !pose.rowing && (bobber.visible || !!life.hook);
    if (line.visible) {
      const taut = ['bite', 'reeling', 'caught'].includes(s.phase);
      for (let i = 0; i <= LINE_SEG; i++) { const p = i / LINE_SEG; lineCurvePts[i].lerpVectors(pose.tip, lineEnd, p); lineCurvePts[i].y -= Math.sin(Math.PI * p) * (taut ? .03 : .35); }
      lineGeo.dispose(); lineGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(lineCurvePts), LINE_SEG, .009, 4, false); line.geometry = lineGeo;
    }

    // Aim and row-destination hints.
    aim.visible = s.phase === 'aim' && !pose.rowing;
    aim.position.set(s.target.x, .03 + heightAt(s.target.x, s.target.z, t), s.target.z); aim.scale.setScalar(1 + Math.sin(t * 3) * .05);
    const dd = Math.hypot(b.destination.x - b.x, b.destination.z - b.z);
    dest.visible = s.phase === 'aim' && dd > .6; dest.position.set(b.destination.x, .03 + heightAt(b.destination.x, b.destination.z, t), b.destination.z);
    aimMat.opacity = .45 + .1 * Math.sin(t * 3);

    // Ripples: wake circles while rowing, oar dips, float rings, otter, events.
    const speed = Math.hypot(b.vx, b.vz);
    if (speed > .12 && t - lastBoatRipple > .85) { lastBoatRipple = t; water.emit({ x: b.x - Math.cos(b.heading) * .6, z: b.z + Math.sin(b.heading) * .6, strength: .75, speed: 1.0 + speed * .25, rings: 1, width: .045, life: 4.6 }, t); }
    if (pose.rowing && t - lastOarDip > .95) { lastOarDip = t; for (const sgn of [-1, 1]) water.emit({ x: b.x + Math.sin(b.heading) * sgn * 1.9 - Math.cos(b.heading) * .5, z: b.z + Math.cos(b.heading) * sgn * 1.9 + Math.sin(b.heading) * .5, strength: .7, speed: .45, rings: 1, width: .04, life: 2.2 }, t); }
    if (bobber.visible && s.phase !== 'casting' && t - lastBobRipple > (s.phase === 'reeling' ? 1.0 : 1.6)) { lastBobRipple = t; water.emit({ x: bx, z: bz, strength: s.phase === 'reeling' ? .8 : .55, speed: s.phase === 'reeling' ? .5 : .32, rings: 1, width: .032, life: 2.2 }, t); }
    if (t - lastOtterRipple > 1.8) { lastOtterRipple = t; water.emit({ x: life.otter.x, z: life.otter.z, strength: .55, speed: .3, rings: 1, width: .035, life: 2.6 }, t); }
    const allEvents = events.length ? events : s.event ? [{ type: s.event, frame }] : [];
    for (const e of allEvents) {
      const key = `${s.castCount}:${e.type}:${e.frame}`; if (seenEvents.has(key)) continue; seenEvents.add(key); if (seenEvents.size > 64) seenEvents.delete(seenEvents.values().next().value!);
      const big = { splash: 1, bite: .9, hook: 1, catch: 1, nibble: .5, escape: .8, snap: .8 }[e.type as 'splash'];
      if (big) { water.emit({ x: bx, z: bz, strength: 1, speed: e.type === 'nibble' ? .4 : .75, rings: e.type === 'nibble' ? 1 : 2, width: .045, life: 2.8 }, t); }
      if (['splash', 'hook', 'catch'].includes(e.type)) { splashAt = t; splashPos.set(bx, 0, bz); splashPower = e.type === 'catch' ? 1.3 : 1; }
    }
    if (s.phase !== lastPhase) { lastPhase = s.phase; }
    for (let i = 0; i < 40; i++) {
      const age = t - splashAt, a = i * 2.399, sp = (.5 + rnd(i) * 1.1) * splashPower;
      const y = (1.6 + rnd(i + 1) * 1.6) * splashPower * age - 4.8 * age * age;
      const vis = age >= 0 && age < .9 && y > -.02;
      dropDummy.position.set(splashPos.x + Math.cos(a) * sp * age, y, splashPos.z + Math.sin(a) * sp * age);
      dropDummy.scale.setScalar(vis ? .03 + rnd(i + 5) * .025 : 0); dropDummy.updateMatrix(); drops.setMatrixAt(i, dropDummy.matrix);
    }
    drops.instanceMatrix.needsUpdate = true;

    water.update(t, sunDir, golden, focus);
    renderer.shadowMap.needsUpdate = true;
    // Refraction pass: everything except surface-only things.
    water.beforeRender(renderer, [lagoon.surfaceRoot, line, aim, dest, drops, bobber]);
    // Final pass: underwater content is already inside the water's colour.
    const hidden: THREE.Object3D[] = [];
    const hide = (o: THREE.Object3D) => { if (o.visible) { o.visible = false; hidden.push(o); } };
    hide(lagoon.root); for (const o of creatures.underwaterObjects()) hide(o);
    for (const m of Object.values(creatures.catchMeshes)) if (m.position.y < -.12) hide(m);
    try { renderer.render(scene, camera); } finally { hidden.forEach(o => o.visible = true); }
  }
  /** Compile every program up front without blocking the page (KHR_parallel_shader_compile). */
  async function warm() {
    const shown: THREE.Object3D[] = [];
    for (const m of [...Object.values(creatures.catchMeshes), bobber, line, aim, dest]) if (!m.visible) { m.visible = true; shown.push(m); }
    camera.position.copy(CAM_OFFSET); camera.lookAt(0, -.2, 0); camera.updateMatrixWorld();
    try { await renderer.compileAsync(scene, camera); await water.warm(renderer); } catch { /* older drivers compile on first draw */ }
    finally { shown.forEach(o => o.visible = false); }
  }
  function dispose() { lineGeo.dispose(); disposables.forEach(d => d.dispose()); water.dispose(); lagoon.dispose(); boat.dispose(); creatures.dispose(); renderer.dispose(); }
  return { render, resize, dispose, pick, warm, golden: (s: FishingState) => goldenness(s.clock), stats: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries }) };
}
