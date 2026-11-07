// Post for the flythrough look: every output frame = N sub-frames (each: scene → physical DOF), averaged → bloom → grade/vignette → tone map.
// Sub-frames spread over the shutter (true motion blur) and carry sub-pixel jitter (anti-aliasing for free).
// DOF shaders are copied from $LIB/core/three/post.js.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;
const cocShader = {
  uniforms: { tColor: { value: null }, tDepth: { value: null }, focus: { value: .3 }, aper: { value: 4 }, maxCoc: { value: 18 }, near: { value: .01 }, far: { value: 50 } },
  vertexShader: VS,
  fragmentShader: `
    #include <packing>
    varying vec2 vUv; uniform sampler2D tColor, tDepth; uniform float focus, aper, maxCoc, near, far;
    void main(){
      float d = texture2D(tDepth, vUv).x;
      float z = -perspectiveDepthToViewZ(d, near, far);
      float c = clamp(aper * (1.0/focus - 1.0/z), 0.0, maxCoc);   // background only: nothing nearer than the focus plane is ever blurred
      gl_FragColor = vec4(texture2D(tColor, vUv).rgb, c);
    }`
};
const gatherShader = {
  uniforms: { tIn: { value: null }, res: { value: new THREE.Vector2(1920, 1080) }, maxCoc: { value: 18 } },
  vertexShader: VS,
  fragmentShader: `
    varying vec2 vUv; uniform sampler2D tIn; uniform vec2 res; uniform float maxCoc;
    void main(){
      vec4 c0 = texture2D(tIn, vUv); float a0 = abs(c0.a);
      vec3 acc = c0.rgb / (a0*a0 + 1.); float wsum = 1. / (a0*a0 + 1.);
      const int N = 64;
      for (int i = 0; i < N; i++) {
        float r = maxCoc * sqrt((float(i) + .5) / float(N));
        float th = float(i) * 2.39996;
        vec2 off = vec2(cos(th), sin(th)) * r / res;
        vec4 s = texture2D(tIn, vUv + off);
        float sa = abs(s.a);
        if (s.a > c0.a) sa = min(sa, max(a0, 0.));
        float w = smoothstep(r - 1.5, r + .5, sa) / (sa*sa + 1.);
        acc += s.rgb * w; wsum += w;
      }
      gl_FragColor = vec4(acc / wsum, 1.);
    }`
};

class DofScene {
  constructor(scene, camera, w, h) {
    this.scene = scene; this.camera = camera;
    this.rt = new THREE.WebGLRenderTarget(w, h, { samples: 4, type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(w, h, THREE.FloatType) });
    this.rtC = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
    this.coc = new FullScreenQuad(new THREE.ShaderMaterial(cocShader));
    this.gat = new FullScreenQuad(new THREE.ShaderMaterial(gatherShader));
    this.gat.material.uniforms.res.value.set(w, h);
    this.focus = .3; this.aper = 4; this.maxCoc = 18;
  }
  render(renderer, target) {
    renderer.setRenderTarget(this.rt); renderer.clear(); renderer.render(this.scene, this.camera);
    const u = this.coc.material.uniforms;
    u.tColor.value = this.rt.texture; u.tDepth.value = this.rt.depthTexture; u.focus.value = this.focus; u.aper.value = this.aper; u.maxCoc.value = this.maxCoc;
    u.near.value = this.camera.near; u.far.value = this.camera.far;
    renderer.setRenderTarget(this.rtC); this.coc.render(renderer);
    const g = this.gat.material.uniforms; g.tIn.value = this.rtC.texture; g.maxCoc.value = this.maxCoc;
    renderer.setRenderTarget(target); this.gat.render(renderer);
  }
}

class AccumPass extends Pass {
  constructor(dof, w, h) {
    super(); this.dof = dof; this.needsSwap = true; this.N = 12; this.setSub = null;
    this.tmp = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tex: { value: null }, k: { value: 1 } }, vertexShader: VS,
      fragmentShader: `varying vec2 vUv; uniform sampler2D tex; uniform float k; void main(){ gl_FragColor = vec4(texture2D(tex, vUv).rgb * k, k); }`,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
      depthTest: false, depthWrite: false, transparent: true
    }));
  }
  render(renderer, writeBuffer) {
    const ac = renderer.autoClear; renderer.autoClear = false;
    renderer.setRenderTarget(writeBuffer); renderer.setClearColor(0x000000, 0); renderer.clear();
    for (let i = 0; i < this.N; i++) {
      this.setSub(i, this.N);
      this.dof.render(renderer, this.tmp);
      renderer.setRenderTarget(writeBuffer);
      this.quad.material.uniforms.tex.value = this.tmp.texture; this.quad.material.uniforms.k.value = 1 / this.N;
      this.quad.render(renderer);
    }
    renderer.autoClear = ac;
  }
}

const gradeShader = {
  uniforms: { tDiffuse: { value: null }, amt: { value: .45 }, warm: { value: .35 }, contrast: { value: .12 }, sat: { value: 1.05 }, lift: { value: new THREE.Vector3(.010, .006, .004) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  fragmentShader: `varying vec2 vUv; uniform sampler2D tDiffuse; uniform float amt, warm, contrast, sat; uniform vec3 lift;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 d = vUv - .5; d.x *= 1.3; float v = 1. - amt * smoothstep(.2, .85, length(d));
      c.rgb = c.rgb * v * mix(vec3(1.), vec3(1.07, 1., .88), warm) + lift;
      float l = dot(c.rgb, vec3(.2126, .7152, .0722)); c.rgb = mix(vec3(l), c.rgb, sat);
      c.rgb = c.rgb * (1. + contrast) / (1. + contrast * c.rgb / (c.rgb + .6));
      gl_FragColor = c; }`
};

export function makePost(renderer, scene, camera, w, h) {
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType }));
  const dof = new DofScene(scene, camera, w, h);
  const accum = new AccumPass(dof, w, h);
  const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), .28, .55, 1.05);
  const grade = new ShaderPass(gradeShader);
  composer.addPass(accum); composer.addPass(bloom); composer.addPass(grade); composer.addPass(new OutputPass());
  return { composer, dof, accum, bloom, grade };
}
