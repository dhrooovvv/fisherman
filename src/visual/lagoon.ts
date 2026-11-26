import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAUSTIC_GLSL } from './caustics';
import { OCEAN_WAVE_GLSL } from './ocean-motion';

const TAU = Math.PI * 2;
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const n2 = (x: number, z: number) => Math.sin(x * .41 + Math.cos(z * .37) * 1.7) * Math.sin(z * .33 + Math.sin(x * .29) * 1.9);
export const EXTENT = 38;
/** Lagoon floor height (m). Clear shallows with darker, deeper channels. */
export function floorHeight(x: number, z: number) {
  return -1.75 + n2(x, z) * .38 + Math.sin(x * .13 + z * .07) * .3 + n2(x * 2.3 + 4, z * 2.1 - 2) * .08;
}

export const NOISE_GLSL = `
float lgHash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float lgNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(lgHash(i),lgHash(i+vec2(1,0)),f.x),mix(lgHash(i+vec2(0,1)),lgHash(i+vec2(1,1)),f.x),f.y);}
float lgFbm(vec2 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*lgNoise(p);p=mat2(1.6,1.2,-1.2,1.6)*p+3.1;a*=.5;}return s;}
`;
const SWAY_GLSL = `
float swayFlow(vec2 p,float t){return .05+.02*sin(p.y*.23+t*.17)+.01*cos(p.x*.31-t*.11);}
`;

type Place = { x: number; y?: number; z: number; s: number; sy?: number; sz?: number; ry?: number; rx?: number; rz?: number; color?: THREE.ColorRepresentation };

export function createLagoon(scene: THREE.Scene) {
  const root = new THREE.Group(); root.name = 'lagoon'; scene.add(root);
  const surfaceRoot = new THREE.Group(); surfaceRoot.name = 'lagoon-surface'; scene.add(surfaceRoot);
  const geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = [];
  const time = { value: 0 }, golden = { value: 0 };
  const geometry = <T extends THREE.BufferGeometry>(g: T) => { geometries.push(g); return g; };

  /** MeshStandard with painterly patches, caustics, optional sway. Shares one program
   * for every non-floor material: options are uniforms, not shader text. */
  function painted(color: THREE.ColorRepresentation, opts: { sway?: boolean; patches?: number; moss?: boolean; side?: THREE.Side; roughness?: number; key: string; floor?: boolean }) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? .92, side: opts.side ?? THREE.FrontSide });
    materials.push(m);
    const floorMode = !!opts.floor;
    m.onBeforeCompile = shader => {
      shader.uniforms.lgTime = time; shader.uniforms.lgGolden = golden;
      shader.uniforms.lgSway = { value: opts.sway ? 1 : 0 }; shader.uniforms.lgPatch = { value: opts.patches ?? 0 }; shader.uniforms.lgMoss = { value: opts.moss ? 1 : 0 };
      shader.vertexShader = 'uniform float lgTime,lgSway;varying vec3 lgWorld;varying vec3 lgNormalW;\n' + SWAY_GLSL + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec2 anchor=vec2(0.);
        #ifdef USE_INSTANCING
         anchor=instanceMatrix[3].xz;
        #endif
        float tipH=max(position.y,0.)*lgSway;float fl=swayFlow(anchor,lgTime);
        transformed.x+=fl*tipH*tipH*1.6+sin(lgTime*.9+anchor.x*.8+anchor.y*.5+tipH*1.3)*tipH*tipH*.16;
        transformed.z+=cos(lgTime*.7+anchor.x*.6)*tipH*tipH*.09;`);
      shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 lgP=vec4(transformed,1.);vec3 lgN=objectNormal;
        #ifdef USE_INSTANCING
         lgP=instanceMatrix*lgP;lgN=mat3(instanceMatrix)*lgN;
        #endif
        lgWorld=(modelMatrix*lgP).xyz;lgNormalW=normalize(mat3(modelMatrix)*lgN);`);
      shader.fragmentShader = 'uniform float lgTime,lgGolden,lgPatch,lgMoss;varying vec3 lgWorld;varying vec3 lgNormalW;\n' + NOISE_GLSL + CAUSTIC_GLSL + shader.fragmentShader;
      const colorCode = floorMode ? `
        vec2 fp=lgWorld.xz;
        vec2 warp=vec2(lgFbm(fp*.22),lgFbm(fp*.22+7.3))*2.4;
        float base=lgFbm(fp*.68+warp*1.3);
        float ang=lgFbm(fp*.09)*6.28;mat2 R=mat2(cos(ang),-sin(ang),sin(ang),cos(ang));
        float stroke=lgNoise(R*fp*vec2(7.,1.3)+warp*2.);
        float nn=base+(stroke-.5)*.3;
        vec3 c0=vec3(.014,.058,.062),c1=vec3(.034,.128,.11),c2=vec3(.075,.215,.15),c3=vec3(.15,.30,.165);
        c0=mix(c0,vec3(.012,.05,.07),lgGolden);c1=mix(c1,vec3(.03,.11,.13),lgGolden);c2=mix(c2,vec3(.07,.18,.17),lgGolden);c3=mix(c3,vec3(.15,.24,.18),lgGolden);
        vec3 fc=mix(c0,c1,smoothstep(.36,.39,nn));fc=mix(fc,c2,smoothstep(.49,.52,nn));fc=mix(fc,c3,smoothstep(.63,.655,nn));
        float speck=lgNoise(fp*9.);fc*=.9+speck*.18;
        diffuseColor.rgb=fc;` : `
        if(lgPatch>0.){
          vec3 rp=lgWorld*lgPatch;
          float pn=lgFbm(rp.xz*1.3+rp.y*.7+vec2(lgNoise(rp.yz*2.),lgNoise(rp.xy*2.))*1.2);
          float tone=mix(.74,1.12,smoothstep(.42,.46,pn));tone=mix(tone,1.28,smoothstep(.62,.65,pn));
          diffuseColor.rgb*=tone;
          float up=smoothstep(.35,.85,lgNormalW.y);float mossN=smoothstep(.45,.5,lgFbm(lgWorld.xz*2.1));
          diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.72,1.,.66),up*mossN*.75*lgMoss);
        }`;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + colorCode);
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
        float cst=underwaterCaustic(lgWorld,lgTime);
        float cLine=smoothstep(.22,.5,cst)*.9+cst*.25;
        outgoingLight+=diffuseColor.rgb*mix(vec3(.85,1.,1.05),vec3(1.2,.95,.6),lgGolden)*cLine*.7*smoothstep(-.05,-.3,lgWorld.y);
        #include <opaque_fragment>`);
    };
    m.customProgramCacheKey = () => floorMode ? 'lagoon-floor' : 'lagoon-common';
    return m;
  }

  function instances(g: THREE.BufferGeometry, m: THREE.Material, places: Place[], shadow = false, parent = root) {
    const inst = new THREE.InstancedMesh(g, m, places.length); const d = new THREE.Object3D();
    places.forEach((p, i) => { d.position.set(p.x, p.y ?? floorHeight(p.x, p.z), p.z); d.rotation.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0); d.scale.set(p.s, p.sy ?? p.s, p.sz ?? p.s); d.updateMatrix(); inst.setMatrixAt(i, d.matrix); if (p.color !== undefined) inst.setColorAt(i, new THREE.Color(p.color)); });
    inst.instanceMatrix.needsUpdate = true; inst.castShadow = shadow; inst.receiveShadow = true; inst.userData.underwater = parent === root; parent.add(inst); return inst;
  }
  /** Jittered-grid scatter over the lagoon, seeded. */
  function scatter(count: number, salt: number, keep?: (x: number, z: number, r: number) => boolean) {
    const out: { x: number; z: number; r: number; i: number }[] = []; let i = 0, tries = 0;
    while (out.length < count && tries < count * 20) { tries++; const x = (hash(salt + i * 3.1) - .5) * EXTENT * 2, z = (hash(salt * 1.7 + i * 7.3 + 11) - .5) * EXTENT * 2, r = hash(salt + i * 13.7 + 5); i++; if (!keep || keep(x, z, r)) out.push({ x, z, r, i }); }
    return out;
  }

  // ---- Floor ----
  const floorMat = painted('#ffffff', { floor: true, key: 'floor' });
  const fg = geometry(new THREE.PlaneGeometry(EXTENT * 2.4, EXTENT * 2.4, 160, 160)); fg.rotateX(-Math.PI / 2);
  const fp = fg.attributes.position; for (let i = 0; i < fp.count; i++) fp.setY(i, floorHeight(fp.getX(i), fp.getZ(i))); fg.computeVertexNormals();
  const floor = new THREE.Mesh(fg, floorMat); floor.receiveShadow = true; floor.userData.underwater = true; root.add(floor);

  // ---- Rocks: rounded, pale grey-green boulders in loose families ----
  const rockMat = painted('#9aa797', { patches: 1.6, moss: true, key: 'rock', roughness: .95 });
  const rockGeos = Array.from({ length: 5 }, (_, j) => {
    const g = mergeVertices(new THREE.IcosahedronGeometry(1, 3)); const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = 1 + .16 * Math.sin(x * 2.6 + j) * Math.cos(z * 2.9 - j * 1.3) + .07 * Math.sin(y * 5.1 + x * 3.3 + j) + .035 * Math.sin(x * 9 + z * 7 + j * 2);
      let yy = y * n; if (yy < -.2) yy = -.2 + (yy + .2) * .3; // flat-ish base
      p.setXYZ(i, x * n, yy, z * n);
    }
    g.computeVertexNormals(); return geometry(g);
  });
  const rockColors = ['#c3ccbb', '#ccd0bd', '#b5c3b6', '#d4d6c3', '#bccabb'];
  const rocks: Place[] = [];
  for (const c of scatter(150, 17)) {
    const fam = 1 + Math.floor(c.r * 4);
    for (let k = 0; k < fam; k++) {
      const a = hash(c.i * 9 + k) * TAU, d = k ? .8 + hash(c.i + k * 5) * 1.6 : 0;
      const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
      const s = (k ? .4 + hash(c.i * 3 + k) * .7 : .9 + hash(c.i * 7) * 1.4);
      const fh = floorHeight(x, z);
      const sy = s * (.55 + hash(c.i + k * 31) * .35);
      rocks.push({ x, z, y: Math.min(fh + s * .3, -.3 - sy * 1.05), s, sy, sz: s * (.7 + hash(c.i * 5 + k) * .4), ry: hash(c.i * 11 + k) * TAU, color: rockColors[(c.i + k) % 5] });
    }
  }
  rockGeos.forEach((g, j) => instances(g, rockMat, rocks.filter((_, i) => i % 5 === j), true));
  const pebbles: Place[] = scatter(900, 41).map(c => ({ x: c.x, z: c.z, s: .06 + c.r * .14, sy: .05 + c.r * .06, ry: c.r * 9, color: ['#8fa08f', '#b4b7a3', '#7e9483', '#a7ab99'][c.i % 4] }));
  instances(geometry(new THREE.IcosahedronGeometry(1, 1)), rockMat, pebbles);

  // ---- Lettuce clumps: big crinkled green leaves (the bright bushes in the shallows) ----
  const leafParts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 9; k++) {
    const g = new THREE.SphereGeometry(.42, 16, 10, 0, TAU, 0, Math.PI * .42); const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x); const ruffle = 1 + .14 * Math.sin(a * 9 + k) * (1 - y / .42); p.setXYZ(i, x * ruffle, y + .05 * Math.sin(a * 7 + k * 2) * (1 - y / .42), z * ruffle); }
    g.scale(1, .9, .55); g.translate(0, -.12, .16); g.rotateX(-.9 - hash(k) * .5); g.rotateY(k * 2.399); g.translate(0, .25 + hash(k + 3) * .18, 0);
    const col = new THREE.Color(['#5fae5d', '#78c06a', '#4e9a57', '#8fcd78'][k % 4]); const cols: number[] = []; for (let i = 0; i < p.count; i++) { const h = p.getY(i); const c = col.clone().multiplyScalar(.75 + Math.min(.45, h * .8)); cols.push(c.r, c.g, c.b); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); g.deleteAttribute('uv'); leafParts.push(g);
  }
  const lettuceGeo = geometry(mergeGeometries(leafParts)!); leafParts.forEach(g => g.dispose());
  const lettuceMat = painted('#ffffff', { patches: 3, key: 'lettuce', side: THREE.DoubleSide, sway: true, roughness: .8 }); lettuceMat.vertexColors = true;
  const lettuce = scatter(120, 71).map(c => ({ x: c.x, z: c.z, s: .7 + c.r * .9, ry: c.r * TAU, color: ['#ffffff', '#e8ffd8', '#d4f0c8'][c.i % 3] }));
  instances(lettuceGeo, lettuceMat, lettuce, true);

  // ---- Seagrass blades ----
  function blade(width: number, bend: number) {
    const pos: number[] = [], idx: number[] = []; const rows = 8;
    for (let i = 0; i <= rows; i++) { const t = i / rows, w = width * Math.pow(Math.sin(Math.PI * (t * .92 + .04)), .6); for (let j = 0; j < 3; j++) pos.push((j - 1) * w + bend * t * t, t, (j === 1 ? .02 : 0)); }
    for (let i = 0; i < rows; i++) for (let j = 0; j < 2; j++) { const a = i * 3 + j; idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return geometry(g);
  }
  const grassMat = painted('#ffffff', { sway: true, key: 'grass', side: THREE.DoubleSide, roughness: .85 });
  const grass: Place[] = [];
  for (const c of scatter(170, 93)) for (let j = 0; j < 9; j++) { const a = hash(c.i * 17 + j) * TAU, r = Math.sqrt(hash(c.i + j * 3)) * .45; grass.push({ x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r, s: .7, sy: .5 + hash(c.i * 3 + j) * .9, ry: hash(j + c.i) * TAU, rz: (hash(c.i * 5 + j) - .5) * .5, color: ['#4f9c66', '#6db577', '#3f8a5e', '#8cc27c'][(c.i + j) % 4] }); }
  instances(blade(.05, .18), grassMat, grass);
  // Broad kelp-ish ribbons, taller, in a few beds.
  const ribbons: Place[] = [];
  for (const c of scatter(40, 113)) for (let j = 0; j < 6; j++) { const a = j * 1.05 + c.r, r = .25; ribbons.push({ x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r, s: 1.1, sy: .9 + hash(c.i + j) * .7, ry: a, rz: (hash(c.i * 7 + j) - .5) * .4, color: ['#3f9168', '#5aa875', '#2f7f5d'][j % 3] }); }
  instances(blade(.13, .4), grassMat, ribbons);

  // ---- Tube sponges (yellow-ochre clusters) and purple tube corals ----
  const tubeParts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 5; k++) {
    const h = .35 + hash(k + 1) * .45, a = k * 2.399, d = k ? .13 : 0;
    const g = new THREE.CylinderGeometry(.07, .08, h, 12, 1, true); g.translate(Math.cos(a) * d, h / 2, Math.sin(a) * d); g.rotateZ((hash(k) - .5) * .3); g.deleteAttribute('uv'); tubeParts.push(g);
    const lip = new THREE.TorusGeometry(.07, .016, 6, 14); lip.rotateX(Math.PI / 2); lip.translate(Math.cos(a) * d, h, Math.sin(a) * d); lip.rotateZ((hash(k) - .5) * .3); lip.deleteAttribute('uv'); tubeParts.push(lip);
  }
  const tubeGeo = geometry(mergeGeometries(tubeParts)!); tubeParts.forEach(g => g.dispose());
  const spongeMat = painted('#ffffff', { patches: 4, key: 'sponge', side: THREE.DoubleSide, roughness: .8 });
  instances(tubeGeo, spongeMat, scatter(70, 131).map(c => ({ x: c.x, z: c.z, s: .8 + c.r * .7, ry: c.r * 9, color: c.i % 3 ? '#d6a043' : '#9b7fae' })), true);

  // ---- Urchins and round sponges: purple/blue accents ----
  const urchinGeo = (() => { const g = new THREE.IcosahedronGeometry(.12, 1); const spikes: THREE.BufferGeometry[] = [g]; const p = g.attributes.position; const seen = new Set<string>(); for (let i = 0; i < p.count; i++) { const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)); const key = v.toArray().map(n => n.toFixed(3)).join(); if (seen.has(key)) continue; seen.add(key); const c = new THREE.ConeGeometry(.018, .16, 4); c.translate(0, .08, 0); const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize()); c.applyQuaternion(q); c.translate(v.x, v.y, v.z); spikes.push(c); } const out = mergeGeometries(spikes.map(s => { const n = s.index ? s.toNonIndexed() : s; n.deleteAttribute('uv'); return n; }))!; return geometry(out); })();
  const accentMat = painted('#ffffff', { patches: 5, key: 'accent', roughness: .6 });
  instances(urchinGeo, accentMat, scatter(110, 151).map(c => ({ x: c.x, z: c.z, y: floorHeight(c.x, c.z) + .06, s: .7 + c.r * .6, ry: c.r * 7, color: ['#5d4f9e', '#7a5aa6', '#3f4f9a'][c.i % 3] })));
  instances(geometry(new THREE.SphereGeometry(.16, 14, 10)), accentMat, scatter(90, 173).map(c => ({ x: c.x, z: c.z, y: floorHeight(c.x, c.z) + .05, s: .8 + c.r * .8, sy: .6 + c.r * .3, color: ['#4d63c9', '#8a5c9c', '#c46a6a', '#6d72c8'][c.i % 4] })));

  // ---- Starfish ----
  const star = new THREE.Shape(); for (let i = 0; i < 10; i++) { const a = i * TAU / 10, r = i % 2 ? .07 : .22; const x = Math.cos(a) * r, y = Math.sin(a) * r; i ? star.lineTo(x, y) : star.moveTo(x, y); } star.closePath();
  const starGeo = geometry(new THREE.ExtrudeGeometry(star, { depth: .03, bevelEnabled: true, bevelSize: .025, bevelThickness: .025, bevelSegments: 2, curveSegments: 3 })); starGeo.rotateX(-Math.PI / 2);
  instances(starGeo, accentMat, scatter(60, 191).map(c => ({ x: c.x, z: c.z, y: floorHeight(c.x, c.z) + .03, s: .8 + c.r * .6, ry: c.r * 9, color: ['#e2773a', '#d9603a', '#e89048'][c.i % 3] })));

  // ---- Branch coral, soft pink ----
  const coralParts: THREE.BufferGeometry[] = [];
  for (let j = 0; j < 7; j++) { const a = j * 2.399, h = .25 + hash(j + 9) * .3, tip = new THREE.Vector3(Math.cos(a) * .18, h, Math.sin(a) * .18); const t = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(), tip.clone().multiplyScalar(.5).setY(h * .55), tip]), 6, .03, 5); t.deleteAttribute('uv'); coralParts.push(t); const cap = new THREE.SphereGeometry(.036, 6, 5); cap.translate(tip.x, tip.y, tip.z); cap.deleteAttribute('uv'); coralParts.push(cap.toNonIndexed()); }
  const coralGeo = geometry(mergeGeometries(coralParts.map(g => g.index ? g.toNonIndexed() : g))!);
  instances(coralGeo, accentMat, scatter(45, 211).map(c => ({ x: c.x, z: c.z, s: .8 + c.r * .7, ry: c.r * 9, color: ['#e3a0a0', '#d98f8a', '#c9a0c8'][c.i % 3] })));

  // ---- Lily pads and lotus at the surface (bob with the swell) ----
  const padShape = new THREE.Shape(); const notch = .22;
  padShape.moveTo(0, 0); for (let i = 0; i <= 40; i++) { const a = notch + (TAU - notch * 2) * i / 40; padShape.lineTo(Math.cos(a) * .5, Math.sin(a) * .5); } padShape.closePath();
  const padGeo = geometry(new THREE.ShapeGeometry(padShape, 6)); padGeo.rotateX(-Math.PI / 2);
  { const p = padGeo.attributes.position; const cols: number[] = []; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z); p.setY(i, .02 * (1 - r * 2) * (1 - r * 2)); const vein = Math.pow(Math.abs(Math.sin(Math.atan2(z, x) * 7)), 18) * .2; const c = new THREE.Color('#7dc04a').lerp(new THREE.Color('#a6d965'), .3 * (1 - r * 2) + vein).lerp(new THREE.Color('#5f9e3c'), Math.max(0, r * 2 - .82) * 2.5); cols.push(c.r, c.g, c.b); } padGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); padGeo.computeVertexNormals(); }
  const surfaceTime = { value: 0 };
  const floatOnSwell = (m: THREE.MeshStandardMaterial, key: string) => {
    m.onBeforeCompile = shader => {
      shader.uniforms.swTime = surfaceTime;
      shader.vertexShader = 'uniform float swTime;\n' + OCEAN_WAVE_GLSL + shader.vertexShader.replace('#include <project_vertex>', `
        vec4 swAnchor=vec4(0.,0.,0.,1.);
        #ifdef USE_INSTANCING
         swAnchor=instanceMatrix[3];
        #endif
        float swBob=oceanHeight(swAnchor.xz,swTime)+sin(swTime*1.3+swAnchor.x*2.)*.008;
        vec4 mvPosition=vec4(transformed,1.);
        #ifdef USE_INSTANCING
         mvPosition=instanceMatrix*mvPosition;
        #endif
        mvPosition.y+=swBob;
        mvPosition=modelViewMatrix*mvPosition;
        gl_Position=projectionMatrix*mvPosition;`);
    };
    m.customProgramCacheKey = () => key;
  };
  const padMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .55, side: THREE.DoubleSide }); materials.push(padMat); floatOnSwell(padMat, 'pad');
  const pads: Place[] = [], lotus: Place[] = [];
  for (const c of scatter(70, 233, (x, z) => Math.hypot(x, z) > 4)) {
    const n = 3 + Math.floor(c.r * 9);
    for (let k = 0; k < n; k++) {
      const a = hash(c.i * 13 + k) * TAU, d = Math.sqrt(hash(c.i * 7 + k * 3)) * 2.4; const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d; const s = .38 + hash(c.i + k * 11) * .42;
      pads.push({ x, z, y: .025, s, ry: hash(k * 5 + c.i) * TAU, color: ['#ffffff', '#f2ffe4', '#e3f7d0'][k % 3] });
      if (hash(c.i * 3 + k * 19) > .86) lotus.push({ x: x + .05, z: z - .03, y: .04, s: .9 + hash(k + c.i) * .4, ry: hash(c.i + k) * TAU });
    }
  }
  const padMesh = instances(padGeo, padMat, pads, true, surfaceRoot); padMesh.userData.surface = true;
  const petalParts: THREE.BufferGeometry[] = [];
  for (let ring = 0; ring < 2; ring++) for (let k = 0; k < 8; k++) {
    const g = new THREE.SphereGeometry(.07, 8, 6); g.scale(.55, .35, 1.4); g.translate(0, .05 + ring * .03, .09 - ring * .02); g.rotateX(-.55 - ring * .45); g.rotateY(k / 8 * TAU + ring * .4);
    const cols: number[] = []; const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const c = new THREE.Color(ring ? '#f7c6d6' : '#e98fb0').lerp(new THREE.Color('#fff2f5'), Math.max(0, p.getY(i) - .05) * 4); cols.push(c.r, c.g, c.b); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); g.deleteAttribute('uv'); petalParts.push(g);
  }
  { const g = new THREE.SphereGeometry(.045, 8, 6); g.translate(0, .08, 0); const cols: number[] = []; for (let i = 0; i < g.attributes.position.count; i++) cols.push(.96, .78, .25); g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); g.deleteAttribute('uv'); petalParts.push(g); }
  const lotusGeo = geometry(mergeGeometries(petalParts)!); petalParts.forEach(g => g.dispose());
  const lotusMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .5 }); materials.push(lotusMat); floatOnSwell(lotusMat, 'lotus');
  instances(lotusGeo, lotusMat, lotus, true, surfaceRoot);

  function update(t: number, gold: number) { time.value = t; surfaceTime.value = t; golden.value = gold; }
  function dispose() { root.removeFromParent(); surfaceRoot.removeFromParent(); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); }
  return { root, surfaceRoot, update, dispose, rocks };
}
