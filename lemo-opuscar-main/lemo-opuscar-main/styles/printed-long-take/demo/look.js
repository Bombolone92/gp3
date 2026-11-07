// Materials: every surface is drawn as a scratchboard print — ink, paper, one red and a little warm yellow.
// Knife lines are fixed in world space (or in direction space for the sky) so they never slide with the camera.
import * as THREE from 'three';

THREE.ColorManagement.enabled = false;   // hex values are print inks, used as written

export const C = {
  ink: new THREE.Color('#16171b'), paper: new THREE.Color('#ede5cd'),
  red: new THREE.Color('#c4332b'), redShade: new THREE.Color('#7e2229'),
  yellow: new THREE.Color('#dfa443'), wood: new THREE.Color('#3a2f27'),
};
const v3 = c => new THREE.Vector3(c.r, c.g, c.b);
// shared uniforms: the light, the warmth of the sunrise
export const U = {
  uInk: { value: v3(C.ink) }, uPaper: { value: v3(C.paper) }, uYellow: { value: v3(C.yellow) },
  uL: { value: new THREE.Vector3(-0.92, 0.36, 0.3).normalize() },
  uWarm: { value: 0 }, uCam: { value: new THREE.Vector3() }, uSun: { value: new THREE.Vector3(1, .02, 0).normalize() },
};

export const GLSL_HASH = /* glsl */`
  float h11(float n){ return fract(sin(n*127.1+311.7)*43758.5453); }
  float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
  float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
`;
const VS_WORLD = `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`;

// ------------------------------------------------------------------ mountains: flat faces, carved shadow sides
export const carveMat = (scale = 1) => new THREE.ShaderMaterial({
  uniforms: { ...U, uScale: { value: scale } }, side: THREE.DoubleSide,
  vertexShader: VS_WORLD,
  fragmentShader: GLSL_HASH + `
    uniform vec3 uInk, uPaper, uYellow, uL; uniform float uWarm, uScale; varying vec3 vW;
    float scratches(vec3 p, vec3 n, float spacing, float density, float wmax, float seed){
      vec3 down = vec3(0.,-1.,0.);
      vec3 d = down - n*dot(down,n); float dl = length(d); d = dl > 1e-3 ? d/dl : vec3(0.,0.,1.);
      vec3 side = normalize(cross(n, d));
      float u = dot(p, d), s0 = dot(p, side) / spacing, id = floor(s0), cov = 0.;
      for (int k=-1; k<=1; k++){
        float i = id + float(k);
        float r1 = h11(i*1.13+seed), r2 = h11(i*2.71+seed+3.), r3 = h11(i*5.3+seed+7.), r4 = h11(i*9.1+seed+1.);
        float s = s0 - i - .5 - (r1-.5)*.6 - u*(r3-.5)*.35/spacing;
        float segL = spacing*(8.+r2*14.), uj = u/segL + r4*7., j = floor(uj), f = fract(uj);
        float on = step(1.-density, h11(j*3.7+i*.71+seed));
        float taper = smoothstep(0.,.08,f) * (1.-smoothstep(.35+.5*r2, .95, f));
        float w = wmax*(.35+.65*r1)*taper, aa = fwidth(s);
        cov = max(cov, on*(1.-smoothstep(w-aa, w+aa, abs(s))));
      }
      return cov;
    }
    void main(){
      vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
      float ndl = dot(n, uL);
      vec3 lit = mix(uPaper, mix(uPaper, uYellow, .35), uWarm*smoothstep(.3,.8,ndl));
      vec3 col;
      if (ndl > 0.12) { float k = scratches(vW*uScale, n, 3.2, .22*smoothstep(.55,.12,ndl), .07, 11.); col = mix(lit, uInk, k); }
      else { float dens = mix(.8, .3, smoothstep(.12,-.5,ndl)); float k = scratches(vW*uScale, n, 2.4, dens, .16, 3.); col = mix(uInk, uPaper, k*.95); }
      gl_FragColor = vec4(col, 1.);
    }`,
});
export const mtnMat = carveMat(1);

// ------------------------------------------------------------------ snow ground, with the river cut out of it
export function groundMat(maskTex, rect) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, tMask: { value: maskTex }, uRect: { value: new THREE.Vector4(...rect) } },
    vertexShader: VS_WORLD,
    fragmentShader: GLSL_HASH + `
      uniform vec3 uInk, uPaper, uCam; uniform sampler2D tMask; uniform vec4 uRect; varying vec3 vW;
      void main(){
        vec2 mu = (vW.xz - uRect.xy) / uRect.zw;
        float m = (mu.x > 0. && mu.x < 1. && mu.y > 0. && mu.y < 1.) ? texture2D(tMask, mu).r : 0.;
        if (m > .5) discard;
        float dist = distance(vW, uCam);
        // wind-drift strokes across the snow
        float v = vW.z*.16 + sin(vW.x*.013)*3. + sin(vW.x*.041+1.3)*.8;
        float row = floor(v); v += vW.x*(h11(row*7.3)-.5)*.03;
        row = floor(v); float f = fract(v)-.5 - (h11(row*2.2)-.5)*.5;
        float segs = vW.x/(6.+h11(row)*14.) + h11(row*3.1)*9.;
        float on = step(.965, h11(floor(segs)*1.7 + row*.37)) * smoothstep(0.,.12,fract(segs)) * (1.-smoothstep(.2,.6,fract(segs)));
        float w = (.015+.03*h11(floor(segs)+row))*on, aa = fwidth(v);
        float k = on*(1.-smoothstep(w-aa, w+aa, abs(f)));
        k *= 1.-smoothstep(90., 260., dist);
        // the snow cornice along the river: short ink hatching where the bank drops away
        float bank = smoothstep(.12, .45, m) * smoothstep(25., 70., dist);
        float hv = (vW.x+vW.z)*1.6; float hf = abs(fract(hv)-.5);
        float ha = fwidth(hv);
        float hk = bank * (1.-smoothstep(.12-ha, .12+ha, hf)) * step(.35, h21(floor(vec2(hv, vW.x*.3+vW.z*.3))));
        k = max(k, hk*.9);
        // far snow: sparse reed stubble ticks keep the marsh from going blank from the air
        vec2 rc = floor(vW.xz/vec2(3.,1.4)); vec2 rf = fract(vW.xz/vec2(3.,1.4))-.5;
        float reed = step(.93, h21(rc*1.31)) * (1.-smoothstep(.04, .07, abs(rf.x+rf.y*.25))) * step(abs(rf.y), .4);
        reed *= smoothstep(120., 300., dist) * (1.-smoothstep(1400., 2600., dist)) * step(.45, vn(vW.xz*.004));
        k = max(k, reed*.8);
        gl_FragColor = vec4(mix(uPaper, uInk, k*.9), 1.);
      }`,
  });
}

// ------------------------------------------------------------------ open water: ink with carved ripple lines across the flow
export const waterMat = new THREE.ShaderMaterial({
  uniforms: { ...U, uT: { value: 0 } },
  vertexShader: `attribute vec2 aRiv; varying vec2 vR; varying vec3 vW;
    void main(){ vR = aRiv; vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
  fragmentShader: GLSL_HASH + `
    uniform vec3 uInk, uPaper, uYellow, uCam, uSun; uniform float uWarm, uT; varying vec2 vR; varying vec3 vW;
    void main(){
      // vR.x = metres along the river, vR.y = -1..1 across it
      float flow = vR.x + uT*.6;
      float v = flow*3.4 + sin(vR.y*2.1 + vR.x*.05)*.35;
      float row = floor(v), f = fract(v)-.5;
      float segs = vR.y*(4.+h11(row)*6.) + h11(row*1.9)*5. + sin(uT*.8+row)*.15;
      float on = step(.62, h11(floor(segs)*2.3+row)) * (1.-smoothstep(.5,.95,fract(segs))) * smoothstep(0.,.15,fract(segs));
      float aa = fwidth(v), w = .055*on*(.6+.8*h11(floor(segs)+row*3.1));
      float k = on*(1.-smoothstep(w-aa, w+aa, abs(f)));
      k *= 1. - smoothstep(.25, .7, aa);              // far water stays ink instead of turning grey
      // slush: small paper floes drifting with the current
      vec2 sc = vec2((vR.x - uT*.55)*.9, vR.y*7.); vec2 si = floor(sc), sf = fract(sc)-.5;
      float sh = h21(si*1.37);
      float floe = step(.86, sh) * (1.-smoothstep(.16, .2, length(sf*vec2(1., 1.8 + sh)))) * (1.-smoothstep(.25, .7, aa));
      k = max(k, floe);
      // a sheen of the sky near the banks: denser cuts at the edges
      float edge = smoothstep(.75, .98, abs(vR.y));
      k = max(k, edge * step(.55, h21(vec2(floor(v*2.), floor(vR.y*9.)))) * (1.-smoothstep(.1,.18,abs(fract(v*2.)-.5))));
      // the sun's road on the water at sunrise
      vec3 d = normalize(vW - uCam); vec3 r = reflect(d, vec3(0.,1.,0.));
      float road = pow(max(dot(normalize(r.xz), normalize(uSun.xz)), 0.), 220.) * uWarm;
      float rk = road * (1.-smoothstep(.16, .3, abs(f))) * step(.25, h11(floor(segs*1.7)+row*3.));
      vec3 lineCol = mix(uPaper, uYellow, clamp(road*1.6, 0., 1.));
      vec3 col = mix(uInk, lineCol, max(k, rk));
      gl_FragColor = vec4(col, 1.);
    }`,
});

// river banks: the cut wall of snow and earth, ink with paper strata
export const bankMat = new THREE.ShaderMaterial({
  uniforms: { ...U }, side: THREE.DoubleSide,
  vertexShader: `attribute vec2 aB; varying vec2 vB; varying vec3 vW;
    void main(){ vB = aB; vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
  fragmentShader: GLSL_HASH + `
    uniform vec3 uInk, uPaper; varying vec2 vB; varying vec3 vW;
    void main(){
      // vB.x = metres along the bank, vB.y = 0 at the water .. 1 at the lip
      if (vB.y > .8) { // the snow lip, with an ink undercut line
        float lip = smoothstep(.8, .84, vB.y);
        gl_FragColor = vec4(mix(uInk, uPaper, lip), 1.); return;
      }
      float v = vB.y*6. + sin(vB.x*.4)*.4, row = floor(v), f = fract(v)-.5;
      float segs = vB.x/(3.+h11(row)*6.) + h11(row*3.)*7.;
      float on = step(.88, h11(floor(segs)+row*1.7)) * smoothstep(0.,.1,fract(segs))*(1.-smoothstep(.5,.9,fract(segs)));
      float aa = fwidth(v), w = .06*on;
      float k = on*(1.-smoothstep(w-aa, w+aa, abs(f)));
      // icicles hanging under the lip
      float ic = step(.6, h11(floor(vB.x*3.))) * step(.8 - .25*h11(floor(vB.x*3.)+4.), vB.y) * (1.-smoothstep(.15,.3,abs(fract(vB.x*3.)-.5)));
      gl_FragColor = vec4(uInk, 1.);
    }`,
});

// shelf ice along the banks
export const iceMat = new THREE.ShaderMaterial({
  uniforms: { ...U },
  vertexShader: VS_WORLD,
  fragmentShader: GLSL_HASH + `
    uniform vec3 uInk, uPaper; varying vec3 vW;
    void main(){
      float cn = abs(vn(vW.xz*.7)-.5), ca = fwidth(cn);
      float k = (1.-smoothstep(.008-ca,.008+ca,cn))*.7;
      gl_FragColor = vec4(mix(uPaper, uInk, k), 1.);
    }`,
});

// ------------------------------------------------------------------ the sky: knife cuts in direction space
// night: sparse wind cuts and stab-cut stars; dawn: the sky is carved from the horizon up, line by line;
// day: dense horizontal cuts, still ink between them, so white mountains keep their weight.
export const skyMat = new THREE.ShaderMaterial({
  uniforms: { ...U, uFront: { value: -1 }, uStars: { value: 1 }, uDense: { value: 0 },
    tType1: { value: null }, uRect1: { value: new THREE.Vector4() }, uAmt1: { value: 0 },
    tType2: { value: null }, uRect2: { value: new THREE.Vector4() }, uAmt2: { value: 0 } },
  side: THREE.BackSide, depthWrite: false,
  vertexShader: VS_WORLD,
  fragmentShader: GLSL_HASH + `
    uniform vec3 uInk, uPaper, uYellow, uCam, uSun; uniform float uFront, uStars, uDense, uWarm; varying vec3 vW;
    uniform sampler2D tType1, tType2; uniform vec4 uRect1, uRect2; uniform float uAmt1, uAmt2;
    // a plate of carved type hung in direction space: an ink block cleared out of the sky, letters cut in paper,
    // revealed left to right as the knife goes (amt 0..1), and taken back the same way
    vec3 typePlate(vec3 col, sampler2D tex, vec4 rect, float amt, float az, float el, float plate){
      vec2 uv = vec2((az - rect.x)/(rect.z - rect.x), (el - rect.y)/(rect.w - rect.y));
      if (amt <= 0. || uv.x < -.06 || uv.x > 1.06 || uv.y < -.12 || uv.y > 1.12) return col;
      // the cleared plate, with a ragged knife edge
      float e = min(min(uv.x + .05, 1.05 - uv.x)*3., min(uv.y + .1, 1.1 - uv.y));
      float rag = (h21(floor(vec2(az, el)*900.)) - .5)*.012;
      float inside = smoothstep(0., .004, e + rag) * plate * clamp(amt*3., 0., 1.);
      col = mix(col, uInk, inside);
      if (uv.x < 0. || uv.x > 1. || uv.y < 0. || uv.y > 1.) return col;
      float a = texture2D(tex, uv).a;
      float shown = step(uv.x, amt*1.04);
      return mix(col, uPaper, a*shown);
    }
    float lineRow(float el, float az, float rows, float prob, float seed, float wmul, float segMin, float segMax, out float rowEl){
      float v = el*rows; float row = floor(v);
      float ph = h11(row*1.7+seed)*6.28, amp = .18 + h11(row*3.1+seed)*.25, fr = 4. + h11(row*5.3+seed)*9.;
      v += sin(ph + az*fr)*amp;
      row = floor(v); float f = fract(v)-.5;
      rowEl = (row + .5)/rows;
      float segL = segMin + h11(row*2.9+seed)*(segMax-segMin);
      float s = az/segL + h11(row*7.7+seed)*9.; float j = floor(s), sf = fract(s);
      float on = step(1.-prob, h11(j*3.1+row*.71+seed));
      float taper = smoothstep(0.,.06,sf)*(1.-smoothstep(.55,.98,sf));
      float w = (.07 + .1*h11(j+row*1.3+seed))*wmul*taper*on;
      float aa = fwidth(v)*.9;
      return 1.-smoothstep(w-aa, w+aa, abs(f));
    }
    void main(){
      vec3 d = normalize(vW - uCam);
      float el = asin(clamp(d.y,-1.,1.)), az = atan(d.x, -d.z);
      if (el < -.004) { gl_FragColor = vec4(uPaper, 1.); return; }
      float re;
      // night wind cuts
      float kn = lineRow(el, az, 105., .45, 0., 1., .06, .32, re) * (1.-uDense);
      // carved dawn / day: an engraver's sky. Straight parallel cuts, thick near the horizon and thin overhead,
      // so the tone is made by the width of the lines. Rows up to the front are cut; the newest row still runs left to right.
      float sunA0 = max(dot(normalize(d.xz), normalize(uSun.xz)), 0.);
      float glow0 = pow(sunA0, 24.) * (1.-smoothstep(.0, .3, el)) * uWarm;
      float rows = 260.;
      float v = el*rows + sin(az*2.3 + floor(el*rows)*1.7)*.06;
      float row = floor(v), f = fract(v)-.5;
      re = (row+.5)/rows;
      float cov = mix(.5, .1, smoothstep(.0, .36, el)) * mix(.85, 1., uDense) + glow0*.3;
      float segL = .5 + h11(row*2.9+21.)*1.1;
      float sg = az/segL + h11(row*7.7)*9.; float sj = floor(sg), sf = fract(sg);
      float on = step(.12, h11(sj*3.1+row*.71+21.));
      float taper = smoothstep(0.,.03,sf)*(1.-smoothstep(.9,1.,sf));
      float w = cov*.5*mix(.55, 1., taper)*on;
      float aa = fwidth(v)*.9;
      float kd = 1.-smoothstep(w-aa, w+aa, abs(f));
      float carved = step(re, uFront);
      float edge = step(uFront - 1./rows, re);
      float run = clamp((uFront - re)*rows, 0., 1.);
      float sweep = step(az, mix(-3.2, 3.2, run));
      kd *= carved * mix(1., sweep, edge);
      // stars, dimming as the day comes
      vec2 sc = vec2(az, el)*vec2(140., 140.); vec2 cid = floor(sc), cf = fract(sc)-.5;
      float sr = h21(cid), ss = mix(.1, .2, step(.92, h21(cid+3.)));
      float star = step(.965, sr) * step(max(abs(cf.x),abs(cf.y)*1.1), ss) * uStars * smoothstep(.0, .05, el);
      float k = max(max(kn, kd), star);
      // warm light near the sun: the cut lines catch it
      float sunA = max(dot(normalize(d.xz), normalize(uSun.xz)), 0.);
      float glow = pow(sunA, 26.) * (1.-smoothstep(.0, .3, el)) * uWarm;
      vec3 lineCol = mix(uPaper, uYellow, clamp(glow*1.3, 0., .85));
      vec3 col = mix(uInk, lineCol, k);
      col = typePlate(col, tType1, uRect1, uAmt1, az, el, 1.);
      col = typePlate(col, tType2, uRect2, uAmt2, az, el, 1.);
      gl_FragColor = vec4(col, 1.);
    }`,
});

// ------------------------------------------------------------------ billboards
// mode 0: cylindrical (trees, standing cranes), feet at the pivot; mode 1: spherical, centred, rotated on screen.
export function billboardMat(tex, mode, opts = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { tMap: { value: tex }, ...U, uTint: { value: 0 } },
    vertexShader: `
      attribute vec3 aOff; attribute vec2 aSize; attribute vec4 aTile; attribute float aRot;
      varying vec2 vUv; varying vec3 vW;
      void main(){
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        ${mode === 0 ? 'right = normalize(vec3(right.x,0.,right.z)); up = vec3(0.,1.,0.);' : ''}
        vec2 q = position.xy*aSize; float c = cos(aRot), s = sin(aRot);
        q = vec2(c*q.x - s*q.y, s*q.x + c*q.y);
        vec3 p = aOff + right*q.x + up*q.y;
        vUv = aTile.xy + uv*aTile.zw; vW = p;
        gl_Position = projectionMatrix*viewMatrix*vec4(p,1.);
      }`,
    fragmentShader: `
      uniform sampler2D tMap; uniform vec3 uYellow, uCam, uSun; uniform float uTint, uWarm; varying vec2 vUv; varying vec3 vW;
      void main(){
        vec4 c = texture2D(tMap, vUv, -1.6); if (c.a < .42) discard;   // sharper mips keep thin sprites alive far away
        ${opts.fade ? `if (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)))*43758.5453) > smoothstep(${opts.fade[0].toFixed(1)}, ${opts.fade[1].toFixed(1)}, distance(vW, uCam))) discard;` : ''}
        float l = dot(c.rgb, vec3(.33));
        vec3 col = c.rgb;
        ${opts.warm ? 'col = mix(col, mix(col, uYellow, .35), uWarm*uTint*smoothstep(.5,.8,l)*smoothstep(-.1,.6,dot(normalize(vW.xz-uCam.xz), normalize(uSun.xz))));' : ''}
        gl_FragColor = vec4(col, 1.);
      }`,
    side: THREE.DoubleSide,
    ...(opts.transparentDepth ? { depthWrite: false } : {}),
  });
}
// the cranes' reflections: the same sprite hung upside down from the water line, cut into broken horizontal strips
export function reflectMat(tex) {
  return new THREE.ShaderMaterial({
    uniforms: { tMap: { value: tex }, uWaterY: { value: -.6 }, uT: { value: 0 } },
    vertexShader: `
      attribute vec3 aOff; attribute vec2 aSize; attribute vec4 aTile; attribute float aRot;
      uniform float uWaterY; varying vec2 vUv; varying float vY;
      void main(){
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        right = normalize(vec3(right.x,0.,right.z));
        vec2 q = position.xy*aSize;
        float sink = uWaterY - aOff.y;
        vec3 p = vec3(aOff.x, uWaterY + .01, aOff.z) + right*q.x + vec3(0.,-1.,0.)*(q.y - sink);
        vUv = aTile.xy + uv*aTile.zw; vY = q.y;
        gl_Position = projectionMatrix*viewMatrix*vec4(p,1.);
      }`,
    fragmentShader: GLSL_HASH + `
      uniform sampler2D tMap; uniform vec3 uPaper; uniform float uT; varying vec2 vUv; varying float vY;
      void main(){
        float band = vY*14.; float row = floor(band);
        vec2 uv = vUv + vec2(sin(row*1.7 + uT*2.)*.004, 0.);
        vec4 c = texture2D(tMap, uv); if (c.a < .45) discard;
        float l = dot(c.rgb, vec3(.33)); if (l < .5) discard;
        if (abs(fract(band)-.5) > .22 || h11(row*3.3) < .2) discard;
        gl_FragColor = vec4(${'vec3(0.93,0.90,0.80)'}, 1.);
      }`,
    side: THREE.DoubleSide,
  });
}
// the red crowns: one round red stab per bird, never smaller than a few pixels
export function crownMat(proj) {
  return new THREE.ShaderMaterial({
    uniforms: { uProj: { value: proj }, uMin: { value: 7 }, uRed: { value: v3(C.red) }, uPaper: U.uPaper, uOn: { value: 1 }, uShift: { value: new THREE.Vector2() } },
    vertexShader: `
      attribute vec3 aOff; attribute vec2 aSize; attribute vec2 aHead; attribute float aRot; attribute float aMode; attribute float aOn;
      uniform float uProj, uMin, uOn; uniform vec2 uShift; varying float vOn;
      void main(){
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        if (aMode < .5) { right = normalize(vec3(right.x,0.,right.z)); up = vec3(0.,1.,0.); }
        vec2 q = vec2((aHead.x-.5)*aSize.x, (aMode < .5 ? (1.-aHead.y) : (.5-aHead.y))*aSize.y);
        float c = cos(aRot), s = sin(aRot); q = vec2(c*q.x - s*q.y, s*q.x + c*q.y);
        vec3 p = aOff + right*q.x + up*q.y + (vec3(0.)) ;
        vec4 mv = viewMatrix*vec4(p,1.);
        mv.z += .02;    // sit just in front of the head
        float px = (aMode < .5 ? .045 : .026)*abs(aSize.y)*uProj/-mv.z;
        // the red plus a paper ring around it, so it separates from the ink of the head
        gl_PointSize = aOn*uOn > .01 ? max(px, uMin)*aOn*1.45 : 0.;
        vOn = aOn*uOn;
        gl_Position = projectionMatrix*mv;
        gl_Position.xy += uShift/vec2(1920., 1080.)*gl_Position.w;
      }`,
    fragmentShader: `uniform vec3 uRed, uPaper; varying float vOn;
      void main(){ vec2 q = gl_PointCoord-.5; float r = length(q); if (r > .5 || vOn < .01) discard;
        gl_FragColor = vec4(r < .345 ? uRed : uPaper, 1.); }`,
  });
}

// flat-shaded props (bridge, hut, fence, sign) with ink hulls
export function toonMat(lit, shade) {
  return new THREE.ShaderMaterial({
    uniforms: { uLit: { value: v3(lit) }, uShade: { value: v3(shade) }, uL: U.uL },
    vertexShader: `varying vec3 vN; void main(){ vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*modelMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform vec3 uLit, uShade, uL; varying vec3 vN;
      void main(){ gl_FragColor = vec4(dot(normalize(vN), uL) > .05 ? uLit : uShade, 1.); }`,
  });
}
// wood: dark boards with paper grain cuts along the board
export const woodMat = new THREE.ShaderMaterial({
  uniforms: { ...U },
  vertexShader: `varying vec3 vW; varying vec3 vN; void main(){ vN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
  fragmentShader: GLSL_HASH + `
    uniform vec3 uInk, uPaper, uL; varying vec3 vW; varying vec3 vN;
    void main(){
      vec3 n = normalize(vN);
      if (n.y > .7) { gl_FragColor = vec4(uPaper, 1.); return; }   // snow on top
      float along = abs(n.x) > abs(n.z) ? vW.z : vW.x;
      float v = vW.y*7. + sin(along*1.3)*.3, row = floor(v), f = fract(v)-.5;
      float segs = along*(.8+h11(row)) + h11(row*2.)*5.;
      float on = step(.55, h11(floor(segs)+row*3.)) * smoothstep(0.,.1,fract(segs))*(1.-smoothstep(.4,.9,fract(segs)));
      float aa = fwidth(v), lit = dot(n, uL) > .05 ? 1. : .45;
      float k = on*(1.-smoothstep(.06*lit-aa, .06*lit+aa, abs(f)));
      gl_FragColor = vec4(mix(uInk, uPaper, k*.8), 1.);
    }`,
});
// concrete in moonlight: lit faces paper with the formwork lines cut in ink, shadow faces ink with paper lines
export const concreteMat = new THREE.ShaderMaterial({
  uniforms: { ...U },
  vertexShader: `varying vec3 vW; varying vec3 vN; void main(){ vN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
  fragmentShader: GLSL_HASH + `
    uniform vec3 uInk, uPaper, uL; varying vec3 vW; varying vec3 vN;
    float ln(float v, float w){ float f = abs(fract(v)-.5), a = fwidth(v); return 1.-smoothstep(w-a, w+a, f); }
    void main(){
      vec3 n = normalize(vN);
      if (n.y > .7) { gl_FragColor = vec4(uPaper, 1.); return; }
      float along = abs(n.x) > abs(n.z) ? vW.z : vW.x;
      // courses of cut stone: horizontal joints every 0.42 m, staggered vertical joints
      float fy = fract(vW.y/.42), row = floor(vW.y/.42);
      float joints = max(ln(vW.y/.42 + .5, .035), ln(along/.9 + h11(row)*.5 + .5, .03) * step(.12, fy) * step(fy, .88));
      if (dot(n, uL) <= 0.) {   // the shadow face: ink, diagonal hatching, paper joints
        float hatch = ln((along + vW.y*.8)*7., .16);
        gl_FragColor = vec4(mix(uInk, uPaper, max(joints*.85, hatch*.4)), 1.); return;
      }
      // the lit face: paper, ink joints, chisel marks thicker toward the waterline, a frozen splash band at the bottom
      vec2 cc = vec2(along, vW.y)*vec2(9., 14.); vec2 ci = floor(cc), cf = fract(cc)-.5;
      float chis = step(.74 - .22*smoothstep(1.4, -.6, vW.y), h21(ci)) * (1.-smoothstep(.05, .09, abs(cf.x - cf.y*.6)));
      float k = max(joints*.95, chis*.8);
      float ice = smoothstep(-.4, -.25, vW.y) * (1.-smoothstep(.0, .3 + .25*h11(floor(along*6.)), vW.y));
      k *= 1. - ice;
      gl_FragColor = vec4(mix(uPaper, uInk, k), 1.);
    }`,
});
export const inkMat = new THREE.MeshBasicMaterial({ color: C.ink });
export const paperMat = new THREE.MeshBasicMaterial({ color: C.paper });
export const hullMat = new THREE.MeshBasicMaterial({ color: C.ink, side: THREE.BackSide });
