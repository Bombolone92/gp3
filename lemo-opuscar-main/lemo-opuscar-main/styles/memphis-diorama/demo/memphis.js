// Memphis Diorama: 3D engine
// Flat materials (no lighting model: fixed face tones + hard-edged deep-indigo shadows + world-space patterns + facade windows),
// normal/depth outlines, grainy spray-paint frame, three lines of type at the bottom. Everything is a deterministic function of t.
import * as THREE from 'three';

export const W = 1920, H = 1080, SS = 2;
export const INK = '#25214A', PAPER = '#FFFCF6';
export const FRAME = { cx: 960, cy: 468, hw: 760, hh: 372, r: 34 };
export const SUN = new THREE.Vector3(-0.42, 0.78, 0.46).normalize();

// ---------- Random ----------
export function rng(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export const ease = (x) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
export const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const lerp = (a, b, u) => a + (b - a) * u;

// ---------- Flat material ----------
const FLAT_VS = /* glsl */`
varying vec3 vWP;
varying vec3 vWN;
#include <common>
#include <shadowmap_pars_vertex>
void main() {
  #include <beginnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <project_vertex>
  #include <worldpos_vertex>
  #include <shadowmap_vertex>
  vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vWN = normalize(mat3(modelMatrix) * objectNormal);
}`;
const FLAT_FS = /* glsl */`
uniform vec3 uCol2, uPatCol2; uniform float uHasC2; uniform vec3 uSeas; uniform float uHT;
uniform vec3 uCol, uPatCol, uInk, uWinDay, uWinLit, uWinDark, uWarm, uNC;
uniform float uPat, uPatScale, uWin, uY0, uY1, uSeed, uEmit, uNight, uShadow, uLit, uHasNC;
uniform vec3 uSun;
uniform vec4 uLamps[48];
uniform float uWave, uZoneLit, uFlash, uDusk, uZA;
uniform vec2 uWaveC;
uniform vec4 uZone;
varying vec3 vWP;
varying vec3 vWN;
#include <common>
#include <packing>
#include <bsdfs>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float aaStep(float e, float x) { float w = fwidth(x) * 0.75; return smoothstep(e - w, e + w, x); }
// Light-up wave + ginkgo lane: windows the wave hasn't reached stay dark; lane windows light pane by pane in random order (uZoneLit 0→1)
bool inZone(vec3 p) { return p.x > uZone.x && p.x < uZone.z && p.z > uZone.y && p.z < uZone.w; }
float waveOn(vec3 p, float hsh) {
  float on = step(length(p.xz - uWaveC), uWave);
  if (inZone(p)) on = step(hsh, uZoneLit - 0.001);
  return on;
}
void main() {
  vec3 n = normalize(vWN);
  bool top = n.y > 0.6;
  vec2 puv = abs(n.y) > 0.5 ? vWP.xz : vec2(abs(n.x) > abs(n.z) ? vWP.z : vWP.x, vWP.y);
  puv /= uPatScale;
  // season wave: whatever it has passed takes the next season's colour
  bool nxt = uHasC2 > 0.5 && length(vWP.xz - uSeas.xy) < uSeas.z;
  vec3 col = nxt ? uCol2 : uCol, pc = nxt ? uPatCol2 : uPatCol;
  if (uPat > 0.5 && uPat < 1.5) {            // dots
    vec2 q = puv; q.x += 0.5 * mod(floor(q.y), 2.0);
    float d = length(fract(q) - 0.5);
    col = mix(col, pc, 1.0 - aaStep(0.17, d));
  } else if (uPat > 1.5 && uPat < 2.5) {     // diagonal stripes
    float s = fract(puv.x + puv.y);
    col = mix(col, pc, 1.0 - aaStep(0.28, abs(s - 0.5)));
  } else if (uPat > 2.5 && uPat < 3.5) {     // zigzag
    float y = fract(puv.y) - abs(fract(puv.x) - 0.5) * 0.7;
    col = mix(col, pc, 1.0 - aaStep(0.07, abs(fract(y + 0.5) - 0.5)));
  } else if (uPat > 3.5 && uPat < 4.5) {     // vertical stripes (awnings)
    float s = fract(puv.x);
    col = mix(col, pc, aaStep(0.5, s));
  } else if (uPat > 5.5 && uPat < 6.5) {     // horizontal stripes (roller shutters)
    col = mix(col, pc, aaStep(0.72, fract(puv.y)));
  } else if (uPat > 4.5 && uPat < 5.5) {     // section hatching
    float s = fract((puv.x + puv.y) * 1.0);
    col = mix(col, pc, 1.0 - aaStep(0.08, abs(s - 0.5)));
  }
  // uZA: lights switched with the light-up wave / ginkgo lane (lamp heads, skylights, string lights)
  bool zoneOff = uZA > 0.5 && waveOn(vWP, h21(floor(vWP.xz * 0.2))) < 0.5;
  bool emit = uEmit > 0.5 && !zoneOff;
  bool useNC = uHasNC > 0.5 && !zoneOff;
  vec3 winCol = vec3(-1.0);
  // facade window grid
  if (uWin > 0.5 && abs(n.y) < 0.3) {
    float u = abs(n.x) > abs(n.z) ? vWP.z : vWP.x;
    float v = vWP.y - uY0;
    vec2 cell = vec2(u / 2.8, (v - 0.2) / 3.2);
    vec2 f = fract(cell); vec2 id = floor(cell);
    if (v > 3.6 && v < uY1 - uY0 - 0.9) {
      vec2 lo = vec2(0.22, 0.26), hi = vec2(0.78, 0.8);
      float inside = aaStep(lo.x, f.x) * (1.0 - aaStep(hi.x, f.x)) * aaStep(lo.y, f.y) * (1.0 - aaStep(hi.y, f.y));
      float inner = aaStep(lo.x + 0.06, f.x) * (1.0 - aaStep(hi.x - 0.06, f.x)) * aaStep(lo.y + 0.07, f.y) * (1.0 - aaStep(hi.y - 0.07, f.y));
      // when the ginkgo lane powers up every pane lights (elsewhere a random majority)
      float lit = (inZone(vWP) ? 1.0 : step(0.42, h21(id + uSeed + n.xz * 7.0))) * waveOn(vWP, h21(id * 1.37 + uSeed + n.xz * 3.0));
      vec3 glass = mix(uWinDay, lit > 0.5 ? uWinLit : uWinDark, uNight);
      float glint = (1.0 - uNight) * (1.0 - aaStep(0.06, abs(f.x - f.y * 0.6 - 0.2)));
      glass = mix(glass, vec3(1.0), glint * 0.8);
      col = mix(col, uInk, inside * (1.0 - inner));
      col = mix(col, glass, inner);
      if (inner > 0.5 && uNight > 0.5 && lit > 0.5) winCol = glass;
    } else if (v < 3.4 && v > 0.3) {                         // ground-floor shop windows
      float sx = fract(u / 5.6);
      float inside = aaStep(0.08, sx) * (1.0 - aaStep(0.92, sx)) * aaStep(0.35, v) * (1.0 - aaStep(2.7, v));
      float inner = aaStep(0.11, sx) * (1.0 - aaStep(0.89, sx)) * aaStep(0.45, v) * (1.0 - aaStep(2.6, v));
      float on = waveOn(vWP, h21(vec2(floor(u / 5.6), uSeed)));
      vec3 glass = mix(uWinDay, on > 0.5 ? uWinLit : uWinDark, uNight);
      col = mix(col, uInk, inside * (1.0 - inner));
      col = mix(col, glass, inner);
      if (inner > 0.5 && uNight > 0.5 && on > 0.5) winCol = glass;
    }
  }
  // fixed face tones: top brightest, sun side next, shaded side matches cast shadows as "hard shadow"
  float facing = dot(normalize(vec3(n.x, 0.0, n.z) + 1e-5), normalize(vec3(uSun.x, 0.0, uSun.z)));
  float sh = 1.0 - getShadowMask();
  if (!top) sh = max(sh, step(facing, 0.0) * (n.y < 0.6 ? 0.5 : 0.0));
  if (n.y < -0.6) sh = 1.0;
  float tone = top ? 1.0 : 0.95;
  vec3 c = col * (uLit > 0.5 ? 1.0 : tone);
  if (uShadow > 0.5 && !emit) {
    vec3 shc = mix(vec3(1.0), vec3(0.70, 0.58, 0.90), sh);
    // halftone: light dots printed in the shadows, like print (world space, moves with the object)
    if (uHT > 0.5 && sh > 0.5) {
      vec2 wq = (abs(n.y) > 0.5 ? vWP.xz : vec2(abs(n.x) > abs(n.z) ? vWP.z : vWP.x, vWP.y)) / 0.38;
      wq.x += 0.5 * mod(floor(wq.y), 2.0);
      float dd = 1.0 - aaStep(0.2, length(fract(wq) - 0.5));
      shc = mix(shc, mix(vec3(1.0), vec3(0.70, 0.58, 0.90), sh * 0.45), dd);
    }
    c *= shc;
  }
  // night: darken overall to deep indigo; lamp pools are hard-edged warm circles
  if (useNC) c = mix(c, uNC * (uShadow > 0.5 ? mix(vec3(1.0), vec3(0.8, 0.76, 0.92), sh) : vec3(1.0)), uNight);
  if (uNight > 0.0 && !emit && !useNC) {
    // night tint: shift toward indigo-violet by luminance, keeping some hue (so darkened yellow doesn't turn olive)
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec3 dark = mix(c * vec3(0.25, 0.26, 0.44), lum * vec3(0.24, 0.22, 0.46), 0.6) + vec3(0.008, 0.007, 0.024);
    dark = mix(dark, c * vec3(0.92, 0.55, 0.6) + vec3(0.05, 0.0, 0.03), uDusk); // dusk: orange-pink
    float pool = 0.0;
    for (int i = 0; i < 48; i++) {
      vec4 L = uLamps[i];
      if (L.w <= 0.0) continue;
      float d = length(vWP.xz - L.xz);
      float hFall = 1.0 - clamp((vWP.y - 0.0) / max(L.y, 0.1), 0.0, 1.0) * 0.55;
      pool = max(pool, (1.0 - aaStep(L.w * hFall, d)) * (0.55 + 0.45 * (1.0 - d / L.w)));
    }
    vec3 lamp = c * uWarm * 1.05;
    vec3 nightC = mix(dark, lamp, clamp(pool, 0.0, 1.0) * 0.85);
    c = mix(c, nightC, uNight);
  }
  if (winCol.x >= 0.0) c = winCol;
  if (emit && uFlash > 0.0) c = mix(c, vec3(1.0), uFlash);
  gl_FragColor = vec4(c, 1.0);
}`;

const linear = (hex) => new THREE.Color(hex);
const LAMPS = Array.from({ length: 48 }, () => new THREE.Vector4(0, 0, 0, 0));
const GLOBAL = { uNight: { value: 0 }, uSun: { value: SUN.clone() }, uLamps: { value: LAMPS }, uWave: { value: 1e5 }, uWaveC: { value: new THREE.Vector2() }, uZone: { value: new THREE.Vector4() }, uZoneLit: { value: 1 }, uFlash: { value: 0 }, uDusk: { value: 0 }, uSeas: { value: new THREE.Vector3(0, 0, -1) }, uHT: { value: 0 } };

export function flat(hex, o = {}) {
  const u = THREE.UniformsUtils.merge([THREE.UniformsLib.lights, {
    uCol: { value: linear(hex) }, uPatCol: { value: linear(o.patCol || '#FFFFFF') },
    uCol2: { value: linear(o.col2 || hex) }, uPatCol2: { value: linear(o.patCol2 || o.patCol || '#FFFFFF') }, uHasC2: { value: o.col2 ? 1 : 0 },
    uInk: { value: linear(INK) }, uWinDay: { value: linear('#BFE4FF') }, uWinLit: { value: linear('#FFD36E') }, uWinDark: { value: linear('#2C2752') },
    uWarm: { value: linear('#FFE3A3') },
    uPat: { value: o.pat || 0 }, uPatScale: { value: o.patScale || 1 }, uWin: { value: o.win ? 1 : 0 },
    uY0: { value: o.y0 || 0 }, uY1: { value: o.y1 || 0 }, uSeed: { value: o.seed || 0 },
    uEmit: { value: o.emit ? 1 : 0 }, uNC: { value: linear(o.nightCol || '#000000') }, uHasNC: { value: o.nightCol ? 1 : 0 }, uZA: { value: o.zoneAware ? 1 : 0 }, uShadow: { value: o.shadow === false ? 0 : 1 }, uLit: { value: o.lit ? 1 : 0 },
  }]);
  Object.assign(u, GLOBAL);
  return new THREE.ShaderMaterial({ uniforms: u, vertexShader: FLAT_VS, fragmentShader: FLAT_FS, lights: true });
}
export function setNight(v) { GLOBAL.uNight.value = v; }
export function setWave(r, x = 0, z = 0) { GLOBAL.uWave.value = r; GLOBAL.uWaveC.value.set(x, z); }
export function setZone(z, lit) { GLOBAL.uZone.value.set(z[0], z[1], z[2], z[3]); GLOBAL.uZoneLit.value = lit; }
export function setFlash(v) { GLOBAL.uFlash.value = v; }
export function setDusk(v) { GLOBAL.uDusk.value = v; }
export function setSeason(x, z, r) { GLOBAL.uSeas.value.set(x, z, r); }
export function setHalftone(v) { GLOBAL.uHT.value = v; }
export function setLamps(list) { for (let i = 0; i < 48; i++) { const L = list[i]; LAMPS[i].set(L ? L[0] : 0, L ? L[1] : 0, L ? L[2] : 0, L ? L[3] : 0); } }

// Helper: mesh with material, casts and receives shadows by default
export function mesh(geo, mat, x = 0, y = 0, z = 0, parent) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  if (parent) parent.add(m); return m;
}
export function box(w, h, d) { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, h / 2, 0); return g; }

// Text texture (signs)
export function signTex(text, bg, fg, w = 512, h = 160) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = INK; g.lineWidth = 14; g.strokeRect(7, 7, w - 14, h - 14);
  g.fillStyle = fg; g.font = `600 ${Math.round(h * 0.56)}px SC, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

// ---------- Composite: outlines + grainy frame ----------
const COMP_FS = /* glsl */`
uniform sampler2D tCol, tNor, tDep;
uniform vec2 res;
uniform float cn, cf, uT, uSeed, uGrow, uWob;
uniform vec3 uInk, uPaper;
uniform vec4 uFrame;
uniform float uRad;
varying vec2 vUv;
#include <packing>
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 x) { vec2 i = floor(x), f = fract(x); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 x) { return vn(x) * 0.55 + vn(x * 2.1 + 5.0) * 0.3 + vn(x * 4.3 + 9.0) * 0.15; }
float wz(vec2 uv) { float d = texture2D(tDep, uv).x; return 1.0 / max(-perspectiveDepthToViewZ(d, cn, cf), 1e-4); }
vec3 nr(vec2 uv) { return texture2D(tNor, uv).xyz * 2.0 - 1.0; }
float edge(vec2 uv) {
  vec2 px = 1.0 / res; float r = 1.7;
  float w = wz(uv); vec3 n = nr(uv);
  float e = 0.0;
  vec2 ds[2]; ds[0] = vec2(1.0, 0.0); ds[1] = vec2(0.0, 1.0);
  for (int i = 0; i < 2; i++) {
    vec2 o = ds[i] * px * r;
    float wa = wz(uv + o), wb = wz(uv - o);
    float lap = abs(wa + wb - 2.0 * w) / max(w, 1e-5);
    if (lap > 0.06) e = 1.0;
    if (dot(n, nr(uv + o)) < 0.82 || dot(n, nr(uv - o)) < 0.82) e = 1.0;
  }
  return e;
}
void main() {
  vec2 px = 1.0 / res;
  vec3 acc = vec3(0.0);
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    vec2 uv = vUv + (vec2(float(i), float(j)) - 0.5) * px;
    vec3 c = texture2D(tCol, uv).rgb;
    acc += mix(c, uInk, edge(uv));
  }
  vec3 col = acc * 0.25;
  // grainy frame (output pixel coords, y down)
  vec2 p = vec2(vUv.x * ${W}.0, (1.0 - vUv.y) * ${H}.0);
  vec2 q = abs(p - uFrame.xy) - uFrame.zw + uRad;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRad;
  d += (fbm(p / 170.0 + 11.0) - 0.5) * 44.0 + (fbm(p / 38.0 + 2.0) - 0.5) * 11.0;
  float m1 = fbm(p / 140.0 + 40.0) - 0.5;
  float g = h21(p + uSeed * 17.31) * 2.0 - 1.0; g = g * g * g * 40.0;
  float m2 = length((p - uFrame.xy) * vec2(1.0, 1.15)) + (fbm(p / 120.0 + 7.0) - 0.5) * 150.0;
  if (d + uWob * m1 + g >= 0.0 || m2 + g * 1.6 >= uGrow) col = uPaper;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export class Diorama {
  constructor(glCanvas, ctx2d) {
    this.r = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: false, preserveDrawingBuffer: true });
    this.r.setPixelRatio(1); this.r.setSize(W, H, false);
    this.r.shadowMap.enabled = true; this.r.shadowMap.type = THREE.PCFShadowMap;
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.ctx = ctx2d;
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(30, W / H, 0.5, 1500);
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    const opt = { type: THREE.HalfFloatType };
    this.rtCol = new THREE.WebGLRenderTarget(W * SS, H * SS, { ...opt, samples: 4 });
    this.rtNor = new THREE.WebGLRenderTarget(W * SS, H * SS, { ...opt, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthTexture: new THREE.DepthTexture(W * SS, H * SS) });
    this.normMat = new THREE.MeshNormalMaterial();
    this.comp = new THREE.ShaderMaterial({
      uniforms: {
        tCol: { value: this.rtCol.texture }, tNor: { value: this.rtNor.texture }, tDep: { value: this.rtNor.depthTexture },
        res: { value: new THREE.Vector2(W * SS, H * SS) }, cn: { value: 0.5 }, cf: { value: 1500 },
        uT: { value: 0 }, uSeed: { value: 0 }, uGrow: { value: 1e9 }, uWob: { value: 0 },
        uInk: { value: linear(INK) }, uPaper: { value: linear(PAPER) },
        uFrame: { value: new THREE.Vector4(FRAME.cx, FRAME.cy, FRAME.hw, FRAME.hh) }, uRad: { value: FRAME.r },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: COMP_FS, depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.comp);
    this.quadScene = new THREE.Scene(); this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  // fit the shadow camera to the area in view
  fitShadow(target, radius) {
    const s = this.sun;
    s.target.position.copy(target);
    s.position.copy(target).addScaledVector(SUN, 400);
    const c = s.shadow.camera; c.left = -radius; c.right = radius; c.top = radius; c.bottom = -radius; c.near = 10; c.far = 900;
    c.updateProjectionMatrix();
  }
  // t: seconds; frame: frame number (grain changes every 5 frames); grow: draw-in radius at open/close
  render(t, frame, opts = {}) {
    const r = this.r, cam = this.cam;
    cam.updateMatrixWorld();
    r.setRenderTarget(this.rtCol); r.render(this.scene, cam);
    const hidden = [];
    this.scene.traverse((o) => { if (o.userData.noOutline && o.visible) { o.visible = false; hidden.push(o); } });
    const bg = this.scene.background; this.scene.background = null;
    this.scene.overrideMaterial = this.normMat;
    r.setClearColor(0x8080ff, 1);
    r.setRenderTarget(this.rtNor); r.render(this.scene, cam);
    this.scene.overrideMaterial = null; this.scene.background = bg;
    for (const o of hidden) o.visible = true;
    const u = this.comp.uniforms;
    u.cn.value = cam.near; u.cf.value = cam.far; u.uT.value = t; u.uSeed.value = Math.floor(frame / 5) % 4;
    u.uWob.value = 22 * Math.sin(t * 0.55); u.uGrow.value = opts.grow ?? 1e9;
    r.setRenderTarget(null); r.render(this.quadScene, this.quadCam);
    const g = this.ctx; g.drawImage(r.domElement, 0, 0);
    if (opts.text) drawText(g, opts.text, opts.textAlpha ?? 1, opts.strong2);
  }
}

// Three lines of type at the bottom + small Memphis marks
export function drawText(g, [l1, l2, l3], a, strong2 = false) {
  if (a <= 0) return;
  const y0 = FRAME.cy + FRAME.hh + 64;
  g.save(); g.globalAlpha = a; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.fillStyle = '#2B2840'; g.font = '600 25px IT, SC, sans-serif'; g.fillText(l1, 960, y0 + 34);
  g.fillStyle = strong2 ? '#2B2840' : '#8D8AA0'; g.font = strong2 ? '600 21px IT, SC, sans-serif' : '400 18px IT, SC, sans-serif'; g.fillText(l2, 960, y0 + 64);  // strong2: a line that must not be missed (the sign-off)
  g.fillStyle = '#B7B4C6'; g.font = '400 15px PM, SC, monospace'; g.fillText(l3, 960, y0 + 91);
  const mx = 960, my = y0;
  g.fillStyle = '#FFC93C'; g.beginPath(); g.arc(mx - 24, my, 5, 0, 7); g.fill();
  g.fillStyle = '#FF7FAA'; g.beginPath(); g.moveTo(mx - 5.5, my + 4.5); g.lineTo(mx, my - 5.5); g.lineTo(mx + 5.5, my + 4.5); g.closePath(); g.fill();
  g.strokeStyle = '#2E5BE6'; g.lineWidth = 2.2; g.lineCap = 'round'; g.beginPath(); g.moveTo(mx + 16, my); g.lineTo(mx + 20, my - 3.5); g.lineTo(mx + 24.5, my + 3.5); g.lineTo(mx + 29, my); g.stroke();
  g.restore();
}
