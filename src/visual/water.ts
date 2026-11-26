import * as THREE from 'three';
import { OCEAN_WAVE_GLSL } from './ocean-motion';
import { NOISE_GLSL } from './lagoon';

/** One crisp, painted ring on the surface. */
export interface Ripple { x: number; z: number; strength: number; speed?: number; rings?: number; width?: number; life?: number }
const MAX_RIPPLES = 32;

/**
 * Stylized lagoon water: a colour/depth refraction pass of everything underwater,
 * depth-based teal absorption, crisp thresholded sun glints with star sparkles,
 * and thin white ripple rings drawn analytically in the surface shader.
 */
export function createWater(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
  const target = new THREE.WebGLRenderTarget(1280, 720, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, type: THREE.HalfFloatType, depthBuffer: true, samples: 2 });
  target.texture.colorSpace = THREE.LinearSRGBColorSpace;
  target.depthTexture = new THREE.DepthTexture(1280, 720, THREE.UnsignedIntType);
  const ripA = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -100, 0));
  const ripB = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(1, .03, 1, 3));
  const uniforms = {
    time: { value: 0 }, golden: { value: 0 },
    worldColor: { value: target.texture }, worldDepth: { value: target.depthTexture },
    resolution: { value: new THREE.Vector2(1, 1) }, eye: { value: camera.position },
    sunDirection: { value: new THREE.Vector3(0, 1, 0) },
    inverseProjection: { value: camera.projectionMatrixInverse.clone() }, cameraWorld: { value: camera.matrixWorld.clone() },
    ripA: { value: ripA }, ripB: { value: ripB },
  };
  const geometry = new THREE.PlaneGeometry(120, 120, 240, 240); geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    uniforms, depthWrite: true,
    vertexShader: `uniform float time;varying vec3 world;${OCEAN_WAVE_GLSL}
      void main(){vec4 w=modelMatrix*vec4(position,1.);w.y+=oceanHeight(w.xz,time);world=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
    fragmentShader: `
      ${OCEAN_WAVE_GLSL}
      ${NOISE_GLSL}
      uniform sampler2D worldColor,worldDepth;uniform vec2 resolution;uniform float time,golden;uniform vec3 eye,sunDirection;
      uniform mat4 inverseProjection,cameraWorld;uniform vec4 ripA[${MAX_RIPPLES}];uniform vec4 ripB[${MAX_RIPPLES}];
      varying vec3 world;
      vec3 positionAt(vec2 uv,float d){vec4 p=inverseProjection*vec4(uv*2.-1.,d*2.-1.,1.);return(cameraWorld*vec4(p.xyz/p.w,1.)).xyz;}
      float chop(vec2 p,float t){
        // Wind ripples stretched across the view: glints break into horizontal slivers.
        vec2 a=p*vec2(1.15,2.7)+vec2(t*.2,-t*.13);
        vec2 b=mat2(.8,-.6,.6,.8)*p*vec2(2.1,4.4)+vec2(-t*.17,t*.24);
        return lgNoise(a+lgNoise(b*.45)*1.5)*.06+lgNoise(b)*.022;
      }
      // White ring strokes; also returns a little normal kick for refraction.
      float rings(vec2 p,out vec2 kick){
        float acc=0.;kick=vec2(0.);
        for(int i=0;i<${MAX_RIPPLES};i++){
          vec4 a=ripA[i];vec4 b=ripB[i];float age=time-a.z;
          if(age<0.||age>b.w||a.w<=0.)continue;
          vec2 d=p-a.xy;float r=length(d);
          float life=age/b.w;
          for(int k=0;k<3;k++){
            if(float(k)>=b.z)break;
            float front=b.x*age*(1.-float(k)*.22)+.12;
            float ang=atan(d.y,d.x);
            float wob=lgNoise(vec2(ang*2.2+a.x*3.,float(k)*7.+a.z))*.18;
            float off=abs(r-front-wob*front*.25);
            float w=b.y*(1.+life*.8);
            float line=1.-smoothstep(w*.55,w,off);
            float broken=smoothstep(.28,.5,lgNoise(vec2(ang*(2.+front*1.5)+a.z*5.,float(k)*3.1+a.x)));
            float fade=(1.-smoothstep(.45,1.,life))*smoothstep(0.,.06,age);
            acc+=line*broken*fade*a.w*(1.-float(k)*.25);
            kick+=normalize(d+1e-4)*exp(-off*off*80.)*fade*a.w*.6;
          }
        }
        return clamp(acc,0.,1.);
      }
      void main(){
        vec2 p=world.xz;
        float e=.03;
        float h0=chop(p,time),hx=chop(p+vec2(e,0.),time),hz=chop(p+vec2(0.,e),time);
        vec2 slope=oceanSlope(p,time)*1.4+vec2(hx-h0,hz-h0)/e;
        vec2 kick;float ring=rings(p,kick);slope+=kick*.25;
        vec3 N=normalize(vec3(-slope.x,1.,-slope.y));
        vec3 V=normalize(eye-world);
        vec2 uv=gl_FragCoord.xy/resolution;
        vec3 vn=mat3(viewMatrix)*N;
        vec2 ruv=clamp(uv+vn.xy*.016,vec2(.001),vec2(.999));
        float depth=texture2D(worldDepth,ruv).r;vec3 under=positionAt(ruv,depth);
        if(under.y>.03){ruv=uv;depth=texture2D(worldDepth,uv).r;under=positionAt(uv,depth);}
        float thick=clamp(length(under-world),0.,18.);
        vec3 bottom=texture2D(worldColor,ruv).rgb;
        // Clear, teal lagoon: red goes first, blue-green carries.
        vec3 absorb=mix(vec3(.62,.13,.095),vec3(.62,.16,.12),golden);
        vec3 trans=exp(-absorb*thick);
        vec3 body=mix(vec3(.003,.125,.135),vec3(.006,.085,.10),golden);
        vec3 col=bottom*trans*mix(vec3(.8,.97,1.04),vec3(.98,.95,.98),golden)+body*(1.-trans);
        // Gentle sky sheen toward the top of the frame.
        float fres=.02+.98*pow(1.-clamp(dot(N,V),0.,1.),5.);
        col=mix(col,mix(vec3(.30,.62,.66),vec3(.85,.55,.30),golden),clamp(fres*1.2,0.,.35));
        // Crisp painted sun glints: thresholded mirror reflection of the sun.
        vec3 L=normalize(sunDirection);vec3 R=reflect(-V,N);float s=max(dot(R,L),0.);
        float broad=pow(s,60.);
        float glint=smoothstep(.9968,.9976,s)*smoothstep(.25,.6,lgNoise(p*.35+time*.05));
        vec3 sunCol=mix(vec3(1.,.99,.95),vec3(1.,.80,.45),golden);
        col+=sunCol*broad*mix(.06,.2,golden);
        // Star sparkles on a jittered grid, twinkling where the glint band lives.
        vec2 cell=floor(p/1.7);vec2 f=p/1.7-cell;
        float rnd=lgHash(cell*1.31+4.1);
        vec2 c=vec2(lgHash(cell+1.7),lgHash(cell+9.2))*.6+.2;
        vec2 dd=(f-c)*1.7;
        float tw=pow(max(0.,sin(time*(.7+rnd*.9)+rnd*30.)),12.)*step(.55,rnd);
        float cross=exp(-abs(dd.x)*55.)*exp(-abs(dd.y)*5.)+exp(-abs(dd.y)*55.)*exp(-abs(dd.x)*5.);
        float core=exp(-dot(dd,dd)*900.);
        float sparkle=(cross*.8+core)*tw*smoothstep(.0,.6,pow(s,8.)*1.6);
        col=mix(col,sunCol*1.25,clamp(glint*.95+sparkle,0.,1.));
        // White ripple strokes on top.
        col=mix(col,mix(vec3(1.),vec3(1.,.9,.72),golden*.6),ring*.92);
        gl_FragColor=vec4(col,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const surface = new THREE.Mesh(geometry, material); surface.name = 'lagoon-water'; surface.frustumCulled = false; surface.renderOrder = 0; scene.add(surface);
  const size = new THREE.Vector2();
  let next = 0;
  function emit(r: Ripple, now: number) {
    const i = next++ % MAX_RIPPLES;
    ripA[i].set(r.x, r.z, now, Math.max(0, Math.min(1, r.strength)));
    ripB[i].set(r.speed ?? .55, r.width ?? .045, r.rings ?? 1, r.life ?? 3.2);
  }
  return {
    surface, emit,
    update(time: number, sun: THREE.Vector3, golden: number, follow: THREE.Vector3) {
      uniforms.time.value = time; uniforms.golden.value = golden; uniforms.sunDirection.value.copy(sun).normalize();
      uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse);
      surface.position.set(Math.round(follow.x / 4) * 4, 0, Math.round(follow.z / 4) * 4);
    },
    beforeRender(renderer: THREE.WebGLRenderer, hideForRefraction: THREE.Object3D[]) {
      renderer.getDrawingBufferSize(size); uniforms.resolution.value.copy(size);
      const width = Math.min(1600, Math.round(size.x)), height = Math.max(1, Math.round(width * size.y / size.x));
      if (target.width !== width || target.height !== height) target.setSize(width, height);
      const previous = renderer.getRenderTarget(), toneMapping = renderer.toneMapping;
      const hidden: THREE.Object3D[] = [];
      for (const o of [surface, ...hideForRefraction]) if (o.visible) { o.visible = false; hidden.push(o); }
      renderer.toneMapping = THREE.NoToneMapping;
      try { renderer.setRenderTarget(target); renderer.clear(); renderer.render(scene, camera); }
      finally { hidden.forEach(o => o.visible = true); renderer.setRenderTarget(previous); renderer.toneMapping = toneMapping; }
      uniforms.cameraWorld.value.copy(camera.matrixWorld);
    },
    /** Compile the refraction-pass program variants (linear target, no tone mapping). */
    async warm(renderer: THREE.WebGLRenderer) {
      const prev = renderer.getRenderTarget(), tm = renderer.toneMapping; surface.visible = false;
      renderer.setRenderTarget(target); renderer.toneMapping = THREE.NoToneMapping;
      try { await renderer.compileAsync(scene, camera); } finally { renderer.setRenderTarget(prev); renderer.toneMapping = tm; surface.visible = true; }
    },
    dispose() { surface.removeFromParent(); geometry.dispose(); material.dispose(); target.dispose(); },
  };
}
