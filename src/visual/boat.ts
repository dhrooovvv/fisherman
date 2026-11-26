import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { FishingState } from '../game/fishing';
import { raftPose } from './ocean-motion';

const TAU = Math.PI * 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const rnd = (i: number) => { const n = Math.sin(i * 127.1 + 313.7) * 43758.5453; return n - Math.floor(n); };
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/* Hull lines. Local space: bow is +x, starboard +z, waterline y=0. */
const LENGTH = 3.7, HALF = LENGTH / 2;
const xAt = (u: number) => -HALF + u * LENGTH;
function halfBeam(u: number) {
  if (u < .42) return .53 + .15 * Math.sin(u / .42 * Math.PI / 2);
  const t = (u - .42) / .58;
  return .68 * Math.pow(Math.max(0, 1 - Math.pow(t, 1.9)), .78);
}
const topAt = (u: number) => .40 + .17 * u * u * u + .05 * Math.pow(1 - u, 3);
const bottomAt = (u: number) => -.17 + .45 * Math.pow(u, 5);
const N_EXP = 2.7;
function section(u: number, s: number, inset = 0) {
  // s in [-1,1]: -1 port gunwale, 0 keel, 1 starboard gunwale (super-ellipse).
  const phi = s * Math.PI / 2, w = Math.max(0, halfBeam(u) - inset), top = topAt(u) - inset * .2, bottom = bottomAt(u) + inset * 1.4;
  const sn = Math.sin(phi), cs = Math.cos(phi);
  const z = w * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / N_EXP);
  const y = top - (top - bottom) * Math.pow(Math.abs(cs), 2 / N_EXP);
  return V(xAt(u), y, z);
}
/** Half-width of the hull where it meets the water, for the foam collar. */
function waterlineHalf(u: number) {
  const top = topAt(u), bottom = bottomAt(u);
  if (bottom >= -.005) return 0;
  const c = Math.pow(top / (top - bottom), N_EXP / 2);
  const phi = Math.acos(Math.min(1, c));
  return halfBeam(u) * Math.pow(Math.sin(phi), 2 / N_EXP);
}

export interface BoatPose { tip: THREE.Vector3; grip: THREE.Vector3; rowing: boolean; hold: THREE.Object3D; bow: THREE.Vector3; lanternWorld: THREE.Vector3 }

export function createBoat(scene: THREE.Scene) {
  const group = new THREE.Group(); group.name = 'rowboat'; scene.add(group);
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  const geo = <T extends THREE.BufferGeometry>(g: T) => { geometries.add(g); return g; };
  const mat = (o: THREE.MeshStandardMaterialParameters) => { const m = new THREE.MeshStandardMaterial({ roughness: .72, ...o }); materials.add(m); return m; };
  const mesh = (parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, p = V(), s = V(1, 1, 1)) => { const o = new THREE.Mesh(g, m); o.position.copy(p); o.scale.copy(s); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o; };
  const tube = (parent: THREE.Object3D, pts: THREE.Vector3[], r: number, m: THREE.Material, seg = 24, closed = false, radial = 8) => mesh(parent, geo(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed), seg, r, radial, closed)), m);
  function canvasTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, repeat = false) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d')!);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; textures.add(t); return t;
  }

  // Warm painted planking: strakes along the hull, soft grain, dark seams.
  const planks = canvasTexture(1024, 256, c => {
    const strakes = 7;
    for (let i = 0; i < strakes; i++) {
      const y0 = i * 256 / strakes, tone = [208, 196, 214, 200, 190, 210, 202][i];
      c.fillStyle = `rgb(${tone},${Math.round(tone * .74)},${Math.round(tone * .47)})`; c.fillRect(0, y0, 1024, 256 / strakes);
      for (let k = 0; k < 26; k++) {
        const yy = y0 + rnd(i * 40 + k) * 256 / strakes; c.strokeStyle = `rgba(120,78,40,${.05 + rnd(k + i) * .08})`; c.lineWidth = .6 + rnd(k * 3 + i) * 1.4;
        c.beginPath(); c.moveTo(0, yy); for (let x = 0; x <= 1024; x += 16) c.lineTo(x, yy + Math.sin(x * .01 + k) * 1.4); c.stroke();
      }
      c.fillStyle = 'rgba(92,58,30,.55)'; c.fillRect(0, y0, 1024, 2.2);
    }
  });
  const seatTex = canvasTexture(256, 256, c => {
    c.fillStyle = '#d6a668'; c.fillRect(0, 0, 256, 256);
    for (let k = 0; k < 40; k++) { const y = rnd(k + 7) * 256; c.strokeStyle = `rgba(130,84,44,${.06 + rnd(k) * .1})`; c.lineWidth = 1 + rnd(k + 3) * 2; c.beginPath(); c.moveTo(0, y); for (let x = 0; x <= 256; x += 8) c.lineTo(x, y + Math.sin(x * .03 + k) * 1.5); c.stroke(); }
  }, true);

  const wood = mat({ map: planks, roughness: .78, side: THREE.BackSide });
  const seatWood = mat({ map: seatTex, color: '#f1d2a4', roughness: .74 });
  const darkWood = mat({ color: '#a97646', roughness: .8 });
  const rail = mat({ color: '#e0492b', roughness: .55 });
  const hullPaint = mat({ vertexColors: true, roughness: .5 });

  // Hull shells (outer painted, inner planked) from one parametric surface.
  function hullGeometry(inset: number, painted: boolean) {
    const M = 56, Nn = 28, pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
    const red = new THREE.Color('#c63f2a'), cream = new THREE.Color('#f3e7cf'), boot = new THREE.Color('#f6f1e3'), deep = new THREE.Color('#8f3326');
    for (let i = 0; i <= M; i++) {
      const u = i / M;
      for (let j = 0; j <= Nn; j++) {
        const s = j / Nn * 2 - 1, p = section(u, s, inset); pos.push(p.x, p.y, p.z); uv.push(u * 3.2, (p.y + .2) / .8);
        if (painted) {
          const top = topAt(u); let c = red.clone();
          if (p.y > top - .15 && p.y < top - .085) c = cream.clone();
          if (p.y < .055 && p.y > -.015) c = boot.clone();
          if (p.y <= -.015) c = deep.clone();
          col.push(c.r, c.g, c.b);
        }
      }
    }
    for (let i = 0; i < M; i++) for (let j = 0; j < Nn; j++) { const a = i * (Nn + 1) + j, b = a + Nn + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    if (painted) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    // Orient outward: the starboard mid-ship normal must point +z.
    const mid = Math.round(M * .45) * (Nn + 1) + Math.round(Nn * .85);
    if (g.attributes.normal.getZ(mid) < 0) { const ix = g.index!.array as unknown as number[]; for (let k = 0; k < ix.length; k += 3) { const t = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = t; } g.index!.needsUpdate = true; g.computeVertexNormals(); }
    return geo(g);
  }
  mesh(group, hullGeometry(0, true), hullPaint);
  mesh(group, hullGeometry(.045, false), wood);
  // Transom: flat stern board, painted outside, planked inside.
  {
    const pts: THREE.Vector3[] = []; for (let j = 0; j <= 28; j++) pts.push(section(0, j / 28 * 2 - 1));
    const shape = new THREE.Shape(pts.map(p => new THREE.Vector2(p.z, p.y)));
    const g = geo(new THREE.ShapeGeometry(shape, 8)); g.rotateY(-Math.PI / 2); g.translate(xAt(0) + .002, 0, 0);
    mesh(group, g, mat({ color: '#c63f2a', roughness: .5, side: THREE.FrontSide }));
    const inner = geo(g.clone()); inner.translate(.04, 0, 0); mesh(group, inner, mat({ map: planks, roughness: .8, side: THREE.BackSide }));
  }
  // Gunwale rail: one closed loop along the sheer and across the transom.
  {
    const loop: THREE.Vector3[] = [];
    for (let i = 0; i <= 30; i++) { const u = i / 30 * .985; loop.push(section(u, 1)); }
    for (let i = 30; i >= 0; i--) { const u = i / 30 * .985; loop.push(section(u, -1)); }
    const g = geo(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(loop, true, 'centripetal'), 160, .045, 8, true)); g.scale(1, 1.05, 1);
    mesh(group, g, rail);
    // Inwale: a second darker strip just inside, gives the rim its painted thickness.
    const inside = loop.map((p, i) => { const u = i <= 30 ? i / 30 * .985 : (61 - i - 1) / 30 * .985; const q = section(Math.max(0, Math.min(.97, u)), Math.sign(p.z) || 1, .06); q.y = p.y - .035; return q; });
    mesh(group, geo(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(inside, true, 'centripetal'), 160, .026, 6, true)), mat({ color: '#b8402a', roughness: .6 }));
  }
  // Ribs, floorboards, thwarts and the little foredeck.
  for (let k = 0; k < 7; k++) {
    const u = .1 + k * .11, pts: THREE.Vector3[] = [];
    for (let j = 0; j <= 12; j++) pts.push(section(u, j / 12 * 2 - 1, .06));
    tube(group, pts, .018, darkWood, 24, false, 5);
  }
  const slat = geo(new RoundedBoxGeometry(1, 1, 1, 2, .2));
  for (let k = -2; k <= 2; k++) {
    const len = 1.9 - Math.abs(k) * .28;
    mesh(group, slat, seatWood, V(-.25, -.07 + Math.abs(k) * .025, k * .13), V(len, .035, .1));
  }
  const thwart = (u: number, depth: number, y: number) => {
    const w = halfBeam(u) * 2 - .1;
    mesh(group, geo(new RoundedBoxGeometry(depth, .06, w, 2, .02)), seatWood, V(xAt(u), y, 0));
    for (const s of [-1, 1]) mesh(group, slat, darkWood, V(xAt(u), y - .1, s * (w / 2 - .05)), V(depth * .8, .16, .05));
  };
  thwart(.1, .5, .24); thwart(.47, .3, .22); thwart(.76, .26, .27);
  {
    const tri = new THREE.Shape(); const u0 = .9; tri.moveTo(xAt(u0), -halfBeam(u0) + .06); tri.lineTo(xAt(.985), 0); tri.lineTo(xAt(u0), halfBeam(u0) - .06); tri.closePath();
    const g = geo(new THREE.ExtrudeGeometry(tri, { depth: .04, bevelEnabled: false })); g.rotateX(Math.PI / 2); g.translate(0, topAt(.93) - .03, 0);
    mesh(group, g, seatWood);
  }
  // Props: lantern on a crook, red buoy, rope coil, a little basket.
  const iron = mat({ color: '#2d2b29', roughness: .5, metalness: .3 });
  const brass = mat({ color: '#e0b13e', roughness: .35, metalness: .4 });
  const glass = mat({ color: '#ffe6a3', emissive: new THREE.Color('#ffb648'), emissiveIntensity: .25, roughness: .2 });
  const lanternRoot = new THREE.Group(); lanternRoot.position.set(xAt(.94), topAt(.94), 0); group.add(lanternRoot);
  tube(lanternRoot, [V(0, 0, 0), V(0, .35, 0), V(-.02, .62, 0), V(.08, .72, 0), V(.2, .66, 0)], .018, iron, 20);
  const lantern = new THREE.Group(); lantern.position.set(.2, .5, 0); lanternRoot.add(lantern);
  mesh(lantern, geo(new THREE.CylinderGeometry(.075, .085, .16, 12)), glass, V(0, 0, 0));
  mesh(lantern, geo(new THREE.ConeGeometry(.095, .08, 12)), brass, V(0, .12, 0));
  mesh(lantern, geo(new THREE.CylinderGeometry(.09, .09, .03, 12)), brass, V(0, -.09, 0));
  for (let k = 0; k < 4; k++) { const a = k / 4 * TAU; mesh(lantern, geo(new THREE.BoxGeometry(.012, .16, .012)), brass, V(Math.cos(a) * .08, 0, Math.sin(a) * .08)); }
  const buoy = new THREE.Group(); buoy.position.set(xAt(.8), topAt(.8) + .06, halfBeam(.8) - .06); group.add(buoy);
  mesh(buoy, geo(new THREE.SphereGeometry(.1, 18, 14)), mat({ color: '#d8392a', roughness: .35 }));
  mesh(buoy, geo(new THREE.CylinderGeometry(.015, .015, .14, 6)), mat({ color: '#f0c33c' }), V(0, .12, 0));
  const ropeMat = mat({ color: '#efe3c6', roughness: .9 });
  for (let k = 0; k < 4; k++) { const t = mesh(group, geo(new THREE.TorusGeometry(.13 - k * .022, .022, 6, 28)), ropeMat, V(xAt(.76) + .01, .31 + k * .012, -.18)); t.rotation.x = Math.PI / 2; }
  const basket = new THREE.Group(); basket.position.set(xAt(.35), -.02, .3); group.add(basket);
  const wicker = canvasTexture(128, 64, c => { c.fillStyle = '#d3ab63'; c.fillRect(0, 0, 128, 64); c.strokeStyle = '#a17738'; for (let y = 0; y < 64; y += 8) { c.beginPath(); c.moveTo(0, y); c.lineTo(128, y); c.stroke(); } for (let x = 0; x < 128; x += 10) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 64); c.stroke(); } }, true);
  mesh(basket, geo(new THREE.CylinderGeometry(.17, .14, .28, 18, 1, true)), mat({ map: wicker, side: THREE.DoubleSide, roughness: .9 }), V(0, .14, 0));
  mesh(basket, geo(new THREE.CircleGeometry(.14, 18).rotateX(-Math.PI / 2)), mat({ color: '#8f6a33' }), V(0, .02, 0));
  const baitTin = mesh(basket, geo(new THREE.CylinderGeometry(.06, .06, .05, 12)), mat({ color: '#f0c33c', roughness: .4 }), V(.04, .26, 0)); baitTin.rotation.z = .5;

  // Batch the static pieces into one draw per material.
  {
    group.updateMatrixWorld(true);
    const inverse = group.matrixWorld.clone().invert(), byMat = new Map<THREE.Material, THREE.Mesh[]>();
    group.traverse(o => { if (o instanceof THREE.Mesh && !Array.isArray(o.material) && o.material !== glass) { const l = byMat.get(o.material) ?? []; l.push(o); byMat.set(o.material, l); } });
    for (const [m, list] of byMat) {
      if (list.length < 2) continue;
      const parts = list.map(o => { const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k); g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, o.matrixWorld)); return g; });
      const keys = Object.keys(parts[0].attributes); if (parts.some(p => Object.keys(p.attributes).length !== keys.length || keys.some(k => !p.attributes[k]))) { parts.forEach(p => p.dispose()); continue; }
      const merged = mergeGeometries(parts, false); parts.forEach(p => p.dispose()); if (!merged) continue;
      list.forEach(o => o.removeFromParent()); mesh(group, geo(merged), m);
    }
  }

  // ---- Fisherman ----
  const person = new THREE.Group(); person.position.set(xAt(.47), .25, 0); group.add(person);
  const skin = mat({ color: '#eab48a', roughness: .65 });
  const denim = mat({ color: '#3f5f97', roughness: .8 });
  const bootMat = mat({ color: '#5d3e28', roughness: .7 });
  const shirtTex = canvasTexture(64, 64, c => { c.fillStyle = '#f3ecdc'; c.fillRect(0, 0, 64, 64); c.fillStyle = '#5e6f8e'; for (let y = 0; y < 64; y += 8) c.fillRect(0, y, 64, 2.5); }, true);
  shirtTex.repeat.set(1, 3);
  const shirt = mat({ map: shirtTex, roughness: .85 });
  const scarf = mat({ color: '#f1bd2c', roughness: .7 });
  const strawTex = canvasTexture(256, 256, c => {
    c.fillStyle = '#e8c27a'; c.fillRect(0, 0, 256, 256);
    for (let r = 4; r < 182; r += 5) { c.strokeStyle = r % 10 ? 'rgba(170,122,52,.35)' : 'rgba(255,236,180,.45)'; c.lineWidth = 2; c.beginPath(); c.arc(128, 128, r, 0, TAU); c.stroke(); }
  });
  const straw = mat({ map: strawTex, roughness: .9, side: THREE.DoubleSide });
  const body = new THREE.Group(); person.add(body);
  // Overalls bib + striped shirt: two stacked capsules read clearly from above.
  mesh(body, geo(new THREE.CapsuleGeometry(.17, .16, 6, 14)), denim, V(0, .2, 0), V(1, 1, 1.12));
  mesh(body, geo(new THREE.CapsuleGeometry(.16, .14, 6, 14)), shirt, V(-.01, .38, 0), V(1, 1, 1.14));
  for (const s of [-1, 1]) tube(body, [V(.1, .26, s * .09), V(.13, .44, s * .1), V(.02, .54, s * .12), V(-.12, .42, s * .1)], .018, denim, 12, false, 5);
  mesh(body, geo(new THREE.TorusGeometry(.12, .05, 8, 18)), scarf, V(0, .53, 0)).rotation.x = Math.PI / 2;
  const scarfTail = mesh(body, geo(new RoundedBoxGeometry(.04, .14, .08, 2, .015)), scarf, V(.13, .46, .05)); scarfTail.rotation.z = -.3;
  const head = new THREE.Group(); head.position.set(0, .7, 0); body.add(head);
  mesh(head, geo(new THREE.SphereGeometry(.14, 20, 16)), skin, V(), V(1, 1.05, 1));
  mesh(head, geo(new THREE.SphereGeometry(.146, 18, 12, 0, TAU, 0, Math.PI * .55)), mat({ color: '#5b3b26', roughness: .9 }), V(-.02, .01, 0)).rotation.z = .5;
  mesh(head, geo(new THREE.SphereGeometry(.035, 10, 8)), skin, V(.14, -.01, 0));
  for (const s of [-1, 1]) mesh(head, geo(new THREE.SphereGeometry(.014, 8, 6)), mat({ color: '#2a211c' }), V(.128, .035, s * .05));
  // Big sun hat with a drooping brim and a red band.
  const hat = new THREE.Group(); hat.position.set(-.01, .11, 0); hat.rotation.z = -.08; head.add(hat);
  const brimPts = [V(.0, .0), V(.16, .0), V(.26, -.008), V(.36, -.03), V(.43, -.065)].map(p => new THREE.Vector2(p.x, p.y));
  mesh(hat, geo(new THREE.LatheGeometry(brimPts, 48)), straw);
  const crownPts = [V(.175, 0), V(.17, .07), V(.15, .13), V(.09, .165), V(0, .175)].map(p => new THREE.Vector2(p.x, p.y));
  mesh(hat, geo(new THREE.LatheGeometry(crownPts, 36)), straw);
  mesh(hat, geo(new THREE.CylinderGeometry(.178, .178, .05, 36, 1, true)), mat({ color: '#c8352a', roughness: .6, side: THREE.DoubleSide }), V(0, .03, 0));
  // Legs: thighs forward along the thwart, shins down to the floorboards.
  for (const s of [-1, 1]) {
    tube(person, [V(-.02, .1, s * .1), V(.2, .13, s * .12), V(.34, .14, s * .13)], .072, denim, 10);
    tube(person, [V(.34, .14, s * .13), V(.42, -.05, s * .14), V(.46, -.24, s * .14)], .062, denim, 10);
    mesh(person, geo(new RoundedBoxGeometry(.2, .08, .1, 2, .03)), bootMat, V(.52, -.27, s * .14));
  }
  // Arms are solved each frame between shoulder and the hand targets.
  const up = V(0, 1, 0), tmp = V();
  const cyl = geo(new THREE.CylinderGeometry(1, 1, 1, 10));
  const arms = [-1, 1].map(sign => ({ sign, upper: mesh(person, cyl, shirt), lower: mesh(person, cyl, shirt), elbow: mesh(person, geo(new THREE.SphereGeometry(1, 10, 8)), shirt), hand: mesh(person, geo(new THREE.SphereGeometry(.045, 10, 8)), skin) }));
  function segment(o: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, r: number) { tmp.subVectors(b, a); o.position.copy(a).add(b).multiplyScalar(.5); o.quaternion.setFromUnitVectors(up, tmp.clone().normalize()); o.scale.set(r, tmp.length(), r); }

  // ---- Oars: always shipped in their locks, as in a real working boat. ----
  const oarWood = mat({ color: '#d7aa6a', roughness: .7 });
  const oarTip = mat({ color: '#d8432c', roughness: .5 });
  const oarWhite = mat({ color: '#f5efe1', roughness: .6 });
  const oars = [-1, 1].map(sign => {
    const root = new THREE.Group(); group.add(root);
    const lock = V(xAt(.5), topAt(.5) + .03, sign * (halfBeam(.5) + .02));
    root.position.copy(lock);
    const pivot = new THREE.Group(); root.add(pivot);
    // Oar is built along +z (outboard). Inboard handle extends to -z.
    mesh(pivot, cyl, oarWood, V(0, 0, .45), V(.026, 2.15, .026)).rotation.x = Math.PI / 2;
    mesh(pivot, geo(new THREE.CylinderGeometry(.035, .035, .2, 8)), oarWood, V(0, 0, -.52)).rotation.x = Math.PI / 2;
    const blade = new THREE.Group(); blade.position.set(0, 0, 1.38); pivot.add(blade);
    mesh(blade, geo(new RoundedBoxGeometry(.15, .03, .5, 2, .012)), oarWood, V(0, 0, 0));
    mesh(blade, geo(new RoundedBoxGeometry(.155, .034, .14, 2, .012)), oarTip, V(0, 0, .2));
    mesh(blade, geo(new RoundedBoxGeometry(.156, .035, .05, 2, .012)), oarWhite, V(0, 0, .105));
    mesh(root, geo(new THREE.TorusGeometry(.04, .01, 6, 12)), iron).rotation.y = Math.PI / 2;
    if (sign < 0) pivot.scale.z = -1;
    return { sign, root, pivot, lock };
  });

  // ---- Rod ----
  const rodMat = mat({ color: '#d24e2c', roughness: .4 });
  const rodGeo = geo(new THREE.BufferGeometry());
  const RS = 20, RR = 6, rodPos = new Float32Array((RS + 1) * (RR + 1) * 3), rodIdx: number[] = [];
  for (let i = 0; i < RS; i++) for (let j = 0; j < RR; j++) { const a = i * (RR + 1) + j, b = a + RR + 1; rodIdx.push(a, b, a + 1, b, b + 1, a + 1); }
  rodGeo.setAttribute('position', new THREE.BufferAttribute(rodPos, 3)); rodGeo.setIndex(rodIdx);
  const rod = new THREE.Mesh(rodGeo, rodMat); rod.castShadow = true; rod.frustumCulled = false; scene.add(rod);
  const reelBody = mesh(scene, geo(new THREE.CylinderGeometry(.045, .045, .04, 14)), mat({ color: '#d9d4c4', metalness: .5, roughness: .3 }));
  const cork = mesh(scene, cyl, mat({ color: '#c49a66', roughness: .9 }));

  // Hold anchor for landed fish, in front of the chest.
  const hold = new THREE.Object3D(); hold.position.set(.5, .46, 0); person.add(hold);

  // ---- Foam collar at the waterline ----
  const foamGeo = geo(new THREE.BufferGeometry());
  {
    const pts: THREE.Vector2[] = []; const K = 40;
    for (let i = 0; i <= K; i++) { const u = i / K * .97; pts.push(new THREE.Vector2(xAt(u), waterlineHalf(u))); }
    const loop = [...pts, ...pts.slice().reverse().map(p => new THREE.Vector2(p.x, -p.y))];
    const pos: number[] = [], alpha: number[] = [], idx: number[] = [];
    loop.forEach((p, i) => {
      const prev = loop[(i - 1 + loop.length) % loop.length], next = loop[(i + 1) % loop.length];
      const tx = next.x - prev.x, tz = next.y - prev.y, l = Math.hypot(tx, tz) || 1; let nx = tz / l, nz = -tx / l;
      if (nx * p.x + nz * p.y < 0) { nx = -nx; nz = -nz; }
      const inner = .0, outer = .07 + (p.x < -1.5 ? .03 : 0);
      pos.push(p.x + nx * inner, 0, p.y + nz * inner, p.x + nx * outer, 0, p.y + nz * outer); alpha.push(1, 0);
    });
    for (let i = 0; i < loop.length; i++) { const a = i * 2, b = ((i + 1) % loop.length) * 2; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    foamGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); foamGeo.setAttribute('alpha', new THREE.Float32BufferAttribute(alpha, 1)); foamGeo.setIndex(idx);
  }
  const foamMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { tint: { value: new THREE.Color('#ffffff') } },
    vertexShader: 'attribute float alpha;varying float vA;void main(){vA=alpha;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'uniform vec3 tint;varying float vA;void main(){gl_FragColor=vec4(tint,smoothstep(.0,.55,vA)*.95);}' });
  materials.add(foamMat);
  const foam = new THREE.Mesh(foamGeo, foamMat); foam.renderOrder = 2; foam.frustumCulled = false; scene.add(foam);

  const lanternLight = new THREE.PointLight('#ffb357', 0, 5, 1.6); lantern.add(lanternLight);

  const grip = V(), tip = V(), c1 = V(), c2 = V(), bow = V(), lanternWorld = V();
  const center = V(), tangent = V(), side = V(), other = V(), axis = V();
  let rodLoad = 0, lastTime: number | undefined, strokePhase = 0, rowBlend = 0, facing = 0, catchBlend = 0;

  function update(time: number, s: FishingState, golden: number): BoatPose {
    const dt = lastTime === undefined ? 1 / 60 : Math.min(.1, Math.max(0, time - lastTime)); lastTime = time;
    const b = s.boat, speed = Math.hypot(b.vx, b.vz);
    const rowing = s.phase === 'aim' && (speed > .06 || Math.hypot(b.destination.x - b.x, b.destination.z - b.z) > .4);
    rowBlend += ((rowing ? 1 : 0) - rowBlend) * (1 - Math.exp(-dt * 4));
    strokePhase += dt * (2.2 + speed * 1.2) * (rowBlend > .02 ? 1 : 0);
    const motion = raftPose(time, s);
    const surge = Math.sin(strokePhase) * .012 * rowBlend;
    group.position.set(b.x + motion.x, motion.y - .02, b.z + motion.z);
    group.rotation.set(motion.roll * .9, b.heading + motion.yaw, motion.pitch * .9 + surge, 'YXZ');
    foam.position.set(group.position.x, motion.y + .012, group.position.z); foam.rotation.set(0, group.rotation.y, 0);
    (foamMat.uniforms.tint.value as THREE.Color).set('#ffffff').lerp(new THREE.Color('#ffe2b0'), golden * .6);

    // Seated pose: face the stern while rowing; turn toward the line when fishing.
    const toTarget = Math.atan2(-(s.target.z - b.z), s.target.x - b.x) - b.heading;
    const want = rowBlend > .5 ? Math.PI : toTarget;
    const diff = Math.atan2(Math.sin(want - facing), Math.cos(want - facing));
    facing += diff * (1 - Math.exp(-dt * 3));
    person.rotation.y = facing;
    const caught = s.phase === 'caught' && s.phaseFrame > 30 && s.phaseFrame < 200;
    catchBlend += ((caught ? 1 : 0) - catchBlend) * (1 - Math.exp(-dt * 6));
    const reel = s.phase === 'reeling', cast = s.phase === 'casting';
    const castP = cast ? Math.min(1, s.phaseFrame / 48) : 1, castLift = cast ? Math.sin(castP * Math.PI) : 0;
    body.rotation.z = -.05 - (reel ? s.tension * .12 : 0) + Math.sin(strokePhase) * .16 * rowBlend + catchBlend * .1;
    body.rotation.x = Math.sin(time * 1.3) * .015;
    head.rotation.y = Math.sin(time * .4) * .12 * (1 - rowBlend);

    // Oars: rowing stroke, or resting with blades trailing in the water.
    for (const o of oars) {
      const yawRest = -.75, pitchRest = .32;
      const sweep = Math.sin(strokePhase) * .55, lift = Math.max(0, Math.cos(strokePhase)) * .18;
      const yaw = THREE.MathUtils.lerp(yawRest, -.05 + sweep, rowBlend);
      const pitch = THREE.MathUtils.lerp(pitchRest, .22 - lift, rowBlend);
      o.pivot.rotation.set(0, 0, 0);
      o.pivot.rotateOnWorldAxis(V(0, 1, 0), o.sign * yaw);
      o.pivot.rotateOnAxis(V(1, 0, 0), o.sign * pitch);
    }
    group.updateMatrixWorld(true);

    // Hands: rowing grips the oar handles; fishing grips the rod.
    const rodGripLocal = V(.3, .36 + castLift * .16, .06);
    for (const a of arms) {
      const shoulder = V(.0, .5, a.sign * .17);
      let hand: THREE.Vector3;
      if (rowBlend > .5) {
        const o = oars[a.sign < 0 ? 0 : 1];
        hand = o.pivot.localToWorld(V(0, 0, -.5 * (a.sign < 0 ? -1 : 1) * (o.pivot.scale.z))); person.worldToLocal(hand);
      } else if (catchBlend > .5) hand = V(.46, .42, a.sign * .2);
      else hand = rodGripLocal.clone().add(V(a.sign * .02, a.sign * -.03, a.sign * .07));
      const elbow = shoulder.clone().lerp(hand, .5).add(V(-.08, -.1, a.sign * .08));
      segment(a.upper, shoulder, elbow, .05); segment(a.lower, elbow, hand, .044);
      a.elbow.position.copy(elbow); a.elbow.scale.setScalar(.05); a.hand.position.copy(hand);
    }

    // Rod: firm handle, upper blank bends under load toward the fish.
    const showRod = rowBlend < .5 && !caught;
    rod.visible = reelBody.visible = cork.visible = showRod;
    grip.copy(rodGripLocal); person.localToWorld(grip);
    const desired = reel ? Math.min(1, .25 + s.tension * .7 + s.fishPull * .2) : s.phase === 'bite' ? .25 : 0;
    rodLoad += (desired - rodLoad) * (1 - Math.exp(-dt * 8));
    const tipLocal = V(2.45 - castLift * 1.3, .95 + castLift * 1.2 + Math.sin(time * 2.1) * .015, .12);
    tipLocal.y -= rodLoad * .7; tipLocal.x -= rodLoad * .15;
    const dir = tipLocal.clone().sub(rodGripLocal).normalize();
    c1.copy(rodGripLocal).addScaledVector(dir, .6); c2.copy(rodGripLocal).lerp(tipLocal, .7); c2.y += rodLoad * .45;
    tip.copy(tipLocal);
    person.localToWorld(c1); person.localToWorld(c2); person.localToWorld(tip);
    const butt = rodGripLocal.clone().addScaledVector(dir, -.35); person.localToWorld(butt);
    const curve = new THREE.CubicBezierCurve3(butt, c1, c2, tip);
    for (let i = 0; i <= RS; i++) {
      const p = i / RS; curve.getPoint(p, center); curve.getTangent(p, tangent);
      axis.set(Math.abs(tangent.y) > .95 ? 1 : 0, Math.abs(tangent.y) > .95 ? 0 : 1, 0);
      side.crossVectors(tangent, axis).normalize(); other.crossVectors(tangent, side).normalize();
      const r = .032 * (1 - p) + .011 * p;
      for (let j = 0; j <= RR; j++) { const q = j / RR * TAU, cx = Math.cos(q) * r, cy = Math.sin(q) * r; rodPos.set([center.x + side.x * cx + other.x * cy, center.y + side.y * cx + other.y * cy, center.z + side.z * cx + other.z * cy], (i * (RR + 1) + j) * 3); }
    }
    rodGeo.attributes.position.needsUpdate = true; rodGeo.computeVertexNormals(); rodGeo.computeBoundingSphere();
    reelBody.position.copy(curve.getPoint(.16)); reelBody.quaternion.setFromUnitVectors(up, curve.getTangent(.16)); reelBody.rotateX(Math.PI / 2); reelBody.translateZ(.05);
    segment(cork, butt, curve.getPoint(.12), .03);

    bow.set(xAt(1), topAt(1), 0); group.localToWorld(bow);
    lanternWorld.set(0, 0, 0); lantern.localToWorld(lanternWorld);
    (glass.emissive as THREE.Color).set('#ffb648'); glass.emissiveIntensity = .3 + golden * 2.4;
    lanternLight.intensity = golden * 2.2;
    return { tip, grip, rowing: rowBlend > .5, hold, bow, lanternWorld };
  }
  function dispose() { [group, rod, reelBody, cork, foam].forEach(o => o.removeFromParent()); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); }
  return { group, update, dispose };
}
