// v3 look frame: the last night train crossing a snowy valley on a curved viaduct. Deep night blue, warm light only in points.
import * as THREE from 'three';
import { sheet, skyPanel, moon, setMoon, text } from './paper.js';
import { stage, aim } from './stage.js';
import { mulberry, lerp, clamp, TAU, ss, seg, eio, eo, ei } from './lib.js';

export const PAPER = '#9a9a9a', BASE = new THREE.Color(PAPER).r;
export const tint = (m, hex, k = 1) => m.material.color.set(hex).multiplyScalar(k / BASE);
export const cut = (x, fn) => { x.save(); x.globalCompositeOperation = 'destination-out'; x.fillStyle = '#000'; x.strokeStyle = '#000'; fn(); x.restore(); };

// snowy peaks: sharp-ish summits, carved contour slits that let the layer behind show through
export function peaks(x, o) {
  const { x0, x1, base, list, seed = 1 } = o, R = mulberry(seed);
  const h = u => { let y = 0; for (const [cx, hh, w] of list) { const d = Math.abs(u - cx) / w; y = Math.max(y, hh * Math.max(0, 1 - Math.pow(d, 1.25))); } return y; };
  x.beginPath(); x.moveTo(x0, base - .3);
  for (let u = x0; u <= x1 + .001; u += .0015) x.lineTo(u, base + h(u) + .0008 * Math.sin(u * 400 + seed));
  x.lineTo(x1, base - .3); x.closePath(); x.fill();
  cut(x, () => {   // snow line + ridge slits on each peak
    x.lineWidth = o.lw ?? .0007; x.lineCap = 'round';
    for (const [cx, hh, w] of list) {
      for (const f of [.72, .5]) { if (hh * f < .01) continue;
        x.beginPath(); let st = false;
        for (let u = cx - w; u <= cx + w; u += .0015) { const d = Math.abs(u - cx) / w, top = hh * Math.max(0, 1 - Math.pow(d, 1.25));
          const y = base + top * f + .004 * Math.sin(u * 160 + cx * 30); if (top * f > .004 && y < base + top - .003) { st ? x.lineTo(u, y) : x.moveTo(u, y); st = true; } else st = false; }
        x.stroke(); }
      x.beginPath(); x.moveTo(cx, base + hh - .004); x.lineTo(cx + w * .18 * (R() - .3), base + hh * .55); x.stroke();
    }
  });
}
// a row of conifers on a ridge line
export function firs(x, o) {
  const { x0, x1, base, h, gap, seed = 3, ground = .3 } = o, R = mulberry(seed);
  x.beginPath(); x.moveTo(x0, base - ground); x.lineTo(x0, base);
  for (let u = x0; u < x1; u += .002) x.lineTo(u, base + (o.roll ?? .004) * Math.sin(u * 23 + seed));
  x.lineTo(x1, base); x.lineTo(x1, base - ground); x.closePath(); x.fill();
  for (let u = x0 + R() * gap; u < x1; u += gap * (.6 + R() * .8)) {
    const hh = h * (.6 + R() * .6), w = hh * .32, by = base + (o.roll ?? .004) * Math.sin(u * 23 + seed) - .001;
    x.beginPath(); x.moveTo(u, by + hh);
    for (let k = 0; k < 4; k++) { const t0 = k / 4, t1 = (k + 1) / 4; x.lineTo(u + w * (.35 + .65 * t1), by + hh * (1 - t1)); x.lineTo(u + w * .3 * (1 - t1) + w * .12, by + hh * (1 - t1) + hh * .04); }
    x.lineTo(u + .0012, by - .002); x.lineTo(u - .0012, by - .002);
    for (let k = 3; k >= 0; k--) { const t1 = (k + 1) / 4; x.lineTo(u - w * .3 * (1 - t1) - w * .12, by + hh * (1 - t1) + hh * .04); x.lineTo(u - w * (.35 + .65 * t1), by + hh * (1 - t1)); }
    x.closePath(); x.fill();
  }
}
// the track: flat through the halt, then a gentle curve down across the valley (by x, metres)
const TY = x => { const s = Math.max(0, (x + .15) / .48); return -.006 - .045 * s * s; };
const TRACK = u => { const x = lerp(-.15, .33, u); return [x, TY(x)]; };   // u: the valley part only (viaduct)
const slope = x => Math.atan2(TY(x + .001) - TY(x - .001), .002);
// arc length along the track from x = -1 (for spacing the carriages)
const AX = [], AS = []; { let sAcc = 0, px = -1, py = TY(-1); for (let x = -1; x <= .7; x += .0005) { sAcc += Math.hypot(x - px, TY(x) - py); AX.push(x); AS.push(sAcc); px = x; py = TY(x); } }
const xAtS = s => { let lo = 0, hi = AS.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (AS[m] < s) lo = m; else hi = m; } return AX[lo]; };
const sAtX = x => AS[Math.min(AS.length - 1, Math.max(0, Math.round((x + 1) / .0005)))];
function viaduct(x) {
  // the halt: a stone embankment and a platform edge, flat, left of the valley
  x.beginPath(); x.moveTo(-.4, TY(-.4) - .003); x.lineTo(-.15, TY(-.15) - .003); x.lineTo(-.15, -.2); x.lineTo(-.4, -.2); x.closePath(); x.fill();
  x.fillRect(-.36, -.012, .2, .004);                                                 // platform edge
  cut(x, () => { x.lineWidth = .0005; for (let r = 0; r < 6; r++) for (let c = 0; c < 14; c++) { const yy = -.02 - r * .008, xx = -.38 + c * .016 + (r % 2) * .008; x.beginPath(); x.moveTo(xx, yy); x.lineTo(xx + .012, yy); x.stroke(); } });
  // deck and spandrel band along the curve, round arches cut out between the piers, piers down into the valley
  const n = 22;
  x.beginPath();
  for (let i = 0; i <= 200; i++) { const [px, py] = TRACK(i / 200); i ? x.lineTo(px, py - .003) : x.moveTo(px, py - .003); }
  for (let i = 200; i >= 0; i--) { const [px, py] = TRACK(i / 200); x.lineTo(px, py - .03); }
  x.closePath(); x.fill();
  for (let i = 0; i <= n; i++) { const [px, py] = TRACK(i / n); x.beginPath(); x.moveTo(px - .004, py - .02); x.lineTo(px - .0055, -.2); x.lineTo(px + .0055, -.2); x.lineTo(px + .004, py - .02); x.closePath(); x.fill(); }
  cut(x, () => {
    for (let i = 0; i < n; i++) { const [ax, ay] = TRACK(i / n), [bx, by] = TRACK((i + 1) / n), cx = (ax + bx) / 2, cy = (ay + by) / 2, w = (bx - ax) / 2 - .005;
      x.beginPath(); x.ellipse(cx, cy - .031, w, .019, 0, 0, Math.PI); x.fill(); }
    x.lineWidth = .0006; for (let i = 0; i < 160; i++) { const [px, py] = TRACK(i / 160); x.beginPath(); x.moveTo(px - .0012, py - .007); x.lineTo(px + .0012, py - .007); x.stroke(); }   // a row of small slits under the rail
  });
}
// one carriage, local frame: x along the track, y up from the rail
export function car(x, g, L, H, loco) {
  const c = x || g;
  if (x) {
    x.beginPath(); x.roundRect(-L / 2, H * .14, L, H * .86, H * .16); x.fill();
    x.fillRect(-L / 2 + L * .03, H * 1.0, L * .94, H * .1);                                    // roof line
    for (const k of [-.36, -.24, .24, .36]) { x.beginPath(); x.arc(L * k, H * .1, H * .11, 0, TAU); x.fill(); }
    cut(x, () => { x.fillRect(-L / 2, H * .38, L, H * .035); });                                // waist line, cut through
    if (loco) { x.beginPath(); x.moveTo(L / 2 - .001, H * .14); x.quadraticCurveTo(L / 2 + L * .32, H * .2, L / 2 + L * .14, H * .98); x.lineTo(L / 2 - .001, H * .98); x.closePath(); x.fill(); }
  }
  const win = (dx) => c.fillRect(dx, H * .5, L * .07, H * .3);
  if (g) g.fillStyle = '#fff';
  if (x) { x.save(); x.fillStyle = '#c8a070'; for (let k = 0; k < (loco ? 2 : 8); k++) win(-L / 2 + L * (.07 + k * .112)); x.restore(); }   // window panes: pale paper, lit by the glow map
  else for (let k = 0; k < (loco ? 2 : 8); k++) win(-L / 2 + L * (.07 + k * .112));
  if (loco && g) { g.beginPath(); g.arc(L / 2 + L * .2, H * .45, H * .09, 0, TAU); g.fill(); }
}

export function world(E) {
  const S = stage({ light: [.12, .03, -.1], lightR: .12, lightCol: '#b8c8f0', key: 1.0, keyCol: '#c8d4ff', amb: .2, ambCol: '#5a6ca8', floor: .32, keyPos: [-.05, .3, .3], keyTarget: [0, -.03, -.09], keyAngle: 1.0 });
  const { U } = S;
  S.add(skyPanel({ w: .8, h: .46, z: -.142, stops: [[0, '#060b22'], [.45, '#0d1a40'], [.8, '#1c2d5e'], [1, '#2c4074']], stars: 340, starMinY: -.02, gain: 1 }));
  const mn = S.add(moon({ x: .155, y: .098, z: -.138, r: .0095, gain: 1.5, halo: 5, haloGain: .16 })); setMoon(mn, 1);
  const H = E.H;
  const far = S.add(sheet({ U, w: .74, h: .36, z: -.126, trans: .85, ppm: 3600, draw: x => { x.fillStyle = PAPER;
    peaks(x, { x0: -.37, x1: .37, base: .0, seed: 2, list: [[-.31, .07, .06], [-.22, .1, .07], [-.11, .065, .05], [-.03, .085, .06], [.07, .12, .08], [.17, .075, .05], [.27, .095, .07], [.35, .06, .05]] }); } }));
  const mid = S.add(sheet({ U, w: .74, h: .36, z: -.112, trans: .6, ppm: 3600, draw: x => { x.fillStyle = PAPER;
    peaks(x, { x0: -.37, x1: .37, base: -.02, seed: 5, lw: .0008, list: [[-.34, .05, .07], [-.24, .075, .06], [-.13, .045, .06], [-.02, .06, .07], [.1, .045, .05], [.21, .068, .07], [.33, .05, .06]] }); } }));
  const CAB = [[-.12, -.031], [.05, -.034], [.135, -.03]];
  const ridgeFar = S.add(sheet({ U, w: .74, h: .36, z: -.1, trans: .42, ppm: 4200, glow: 2.2, glowCol: '#ffbe68', draw: x => { x.fillStyle = PAPER; firs(x, { x0: -.37, x1: .37, base: -.035, h: .018, gap: .006, seed: 4, roll: .006 });
    for (const [cx, cy] of CAB) { x.fillRect(cx - .005, cy, .01, .006); x.beginPath(); x.moveTo(cx - .007, cy + .006); x.lineTo(cx, cy + .011); x.lineTo(cx + .007, cy + .006); x.closePath(); x.fill(); x.save(); x.fillStyle = '#c8a070'; x.fillRect(cx - .0018, cy + .0015, .0028, .0025); x.restore(); } },
    glowDraw: g => { g.fillStyle = '#000'; g.fillRect(-.37, -.18, .74, .36); g.fillStyle = '#fff'; for (const [cx, cy] of CAB) g.fillRect(cx - .0018, cy + .0015, .0028, .0025); }, glowRes: 1 }));
  // mist in the valley: a pale, very translucent paper band with a soft cut edge
  const mist = S.add(sheet({ U, w: .74, h: .36, z: -.091, trans: .95, ppm: 3000, shadow: false, draw: x => { x.fillStyle = PAPER;
    x.beginPath(); x.moveTo(-.37, -.2); for (let u = -.37; u <= .37; u += .004) x.lineTo(u, -.05 + .006 * Math.sin(u * 30) + .003 * Math.sin(u * 77)); x.lineTo(.37, -.2); x.closePath(); x.fill(); } }));
  const via = S.add(sheet({ U, w: .74, h: .36, z: -.08, trans: .1, ppm: 6000, draw: x => { x.fillStyle = PAPER; x.strokeStyle = PAPER; viaduct(x); } }));
  // the train: the engine and 7 carriages, each its own sheet following the track; windows burn warm
  const L = .043, Hc = .015, N = 8;
  const cars = [];
  for (let i = 0; i < N; i++) {
    const loco = i === 0;
    const m = S.add(sheet({ U, w: L * 1.5, h: Hc * 1.4, ay: -Hc * .5, z: -.0785, trans: .12, glow: 2.6, glowCol: '#ffc46a', ppm: 9000, glowRes: 1,
      draw: x => { x.fillStyle = PAPER; x.translate(0, -Hc * .5); car(x, null, L, Hc, loco); }, glowDraw: g => { g.fillStyle = '#000'; g.fillRect(-1, -1, 2, 2); g.translate(0, -Hc * .5); car(null, g, L, Hc, loco); } }));
    cars.push(m);
  }
  const flare = S.add(new THREE.Mesh(new THREE.PlaneGeometry(.05, .05), new THREE.ShaderMaterial({ uniforms: { col: { value: new THREE.Color('#ffd590') }, k: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: 'varying vec2 vUv; uniform vec3 col; uniform float k; void main(){ float r = length(vUv - .5) * 2.; gl_FragColor = vec4(col * k * (pow(max(0., 1. - r), 3.) * .9 + pow(max(0., 1. - r * 4.), 2.) * .8), 1.); }' })));
  flare.renderOrder = 12;
  const lampFlare = S.add(new THREE.Mesh(new THREE.PlaneGeometry(.03, .03), flare.material.clone())); lampFlare.renderOrder = 12;
  // the halt: a small station house with one lit window, a lamp post, a name board; behind the train
  const HX = -.3;
  const halt = S.add(sheet({ U, w: .12, h: .07, x: HX, y: .047, z: -.0806, trans: .08, glow: 2.4, glowCol: '#ffbf6a', ppm: 9000,
    draw: x => { x.fillStyle = PAPER;
      x.beginPath(); x.moveTo(-.06, -.035); x.quadraticCurveTo(-.01, -.012, .05, -.035); x.closePath(); x.fill(); x.fillRect(-.06, -.035, .11, .002);   // a small snowy rise
      x.fillRect(-.024, -.022, .04, .02); x.beginPath(); x.moveTo(-.028, -.002); x.lineTo(-.004, .012); x.lineTo(.02, -.002); x.closePath(); x.fill(); x.fillRect(.006, .002, .004, .008);   // house, roof, chimney
      x.save(); x.fillStyle = '#c8a070'; x.fillRect(-.016, -.016, .007, .008); x.fillRect(-.004, -.016, .007, .008); x.restore(); },
    glowDraw: g => { g.fillStyle = '#000'; g.fillRect(-.06, -.035, .12, .07); g.fillStyle = '#fff'; g.fillRect(-.016, -.016, .007, .008); g.fillRect(-.004, -.016, .007, .008); } }));
  // the front platform edge with the lamp post and the name board (in front of the train)
  const PX = -.168;
  const plat = S.add(sheet({ U, w: .3, h: .08, x: -.3, y: -.03, z: -.0772, trans: .06, glow: 2.4, glowCol: '#ffc070', ppm: 9000,
    draw: x => { x.fillStyle = PAPER; x.fillRect(-.15, -.04, .3, .029); x.translate(PX + .3, 0);
      x.fillRect(-.0009, -.012, .0018, .036); x.fillRect(-.004, .023, .008, .0016); x.beginPath(); x.moveTo(-.0028, .0225); x.lineTo(.0028, .0225); x.lineTo(.0022, .0165); x.lineTo(-.0022, .0165); x.closePath(); x.fill();
      x.fillRect(-.06, -.012, .0012, .014); x.fillRect(-.0405, -.012, .0012, .014);
      x.save(); x.fillStyle = '#c8a070'; x.fillRect(-.0016, .0172, .0032, .0046); x.restore(); },
    glowDraw: g => { g.fillStyle = '#000'; g.fillRect(-.15, -.04, .3, .08); g.translate(PX + .3, 0); g.fillStyle = '#fff'; g.fillRect(-.0016, .0172, .0032, .0046); } }));
  const board = S.add(sheet({ U, w: .03, h: .01, x: PX - .05, y: -.03 + .0055, z: -.0771, trans: .3, shadow: false, ppm: 16000, finish: { rim: 0, under: 0 },
    draw: x => { x.fillStyle = '#d8c8a0'; x.fillRect(-.012, -.0036, .024, .0072); text(x, 'PINE HALT', 0, -.0002, .0038, '"Cormorant"', { fill: '#1a1a2a', weight: 700 }); } }));
  const puffs = [];
  const ridgeNear = S.add(sheet({ U, w: .74, h: .36, z: -.058, trans: .15, ppm: 4500, draw: x => { x.fillStyle = PAPER; firs(x, { x0: -.37, x1: .37, base: -.088, h: .034, gap: .011, seed: 8, roll: .01 }); cut(x, () => x.fillRect(-.37, -.07, .23, .1)); } }));
  const front = S.add(sheet({ U, w: .74, h: .36, z: -.03, trans: .04, ppm: 4500, draw: x => { x.fillStyle = PAPER;
    firs(x, { x0: -.37, x1: -.31, base: -.128, h: .11, gap: .03, seed: 12, roll: .014 }); firs(x, { x0: .2, x1: .37, base: -.13, h: .095, gap: .028, seed: 15, roll: .012 });
    x.beginPath(); x.moveTo(-.37, -.2); for (let u = -.37; u <= .37; u += .004) x.lineTo(u, -.135 + .01 * Math.sin(u * 9 + 1) + .004 * Math.sin(u * 31)); x.lineTo(.37, -.2); x.closePath(); x.fill(); } }));
  // falling snow on a near transparent sheet (soft, out of focus)
  const snow = [0, 1].map(j => S.add(sheet({ U, w: .6, h: .36, z: -.012 - j * .004, trans: .3, shadow: false, recv: false, ppm: 3000, finish: { grain: false, rim: 0, under: 0 }, draw: x => { x.fillStyle = PAPER; const R = mulberry(9 + j); for (let i = 0; i < 160; i++) { x.beginPath(); x.arc((R() - .5) * .6, (R() - .5) * .36, .0005 + R() * .0009, 0, TAU); x.fill(); } } })));
  tint(far, '#7385b6'); tint(mid, '#4b6294'); tint(ridgeFar, '#34487c'); tint(mist, '#7b8fc0', .9); tint(via, '#1b2650'); cars.forEach(m => tint(m, '#151d3c')); tint(halt, '#121a38'); tint(plat, '#0e1532'); tint(ridgeNear, '#141c3e'); tint(front, '#080d24'); snow.forEach(m => tint(m, '#c8d4ee', .9));
  const sign = E.sign ? S.add(signStrip(U, -.088, -.115, .084)) : null;
  const headS0 = sAtX(-.13);
  return {
    S,
    update(t) {
      const fl = 1 + .05 * Math.sin(t * 7.3) * Math.sin(t * 3.1);
      U.uLit.value = .85;
      // the halt lamp, then the windows car by car (engine first), then the headlight
      const lamp = ss(seg(t, H.lamp, H.lamp + .25)) * fl;
      halt.material.userData.u.uGlowLit.value = .5 + .5 * ss(seg(t, H.lamp + .4, H.lamp + .7));
      // the train: standing, then pulling away (ease-in), carriages spaced by arc length
      const dAcc = tt => .02 * Math.pow(Math.max(0, tt - H.depart), 1.9), vC = .02 * 1.9 * Math.pow(10 - H.depart, .9);
      const d = t < H.depart ? 0 : t < 10 ? dAcc(t) : dAcc(10) + vC * (t - 10);
      const sHead = headS0 + d;
      for (let i = 0; i < N; i++) {
        const si = sHead - i * (L + .0025) - (i ? L * .12 : 0), xi = xAtS(si);
        const m = cars[i]; m.position.set(xi, TY(xi) - .0022 + (t > H.depart ? .0003 * Math.abs(Math.sin(t * 22 + i)) : 0), -.0785); m.rotation.z = slope(xi);
        const on = ss(seg(t, H.cars[i], H.cars[i] + .12)); m.material.userData.u.uGlowLit.value = on * (1 + .03 * Math.sin(t * 9 + i * 2));
      }
      const hx = xAtS(sHead), ha = slope(hx), hk = ss(seg(t, H.head, H.head + .3));
      flare.position.set(hx + Math.cos(ha) * L * .68, TY(hx) + .0055, -.0775); flare.material.uniforms.k.value = hk;
      U.uBeamO.value.set(hx + Math.cos(ha) * L * .7, TY(hx) + .006, 1.3 * hk); U.uBeamD.value.set(ha - .05, .1, .09);
      lampFlare.position.set(PX, -.03 + .0195, -.0768); lampFlare.material.uniforms.k.value = .45 * lamp; plat.material.userData.u.uGlowLit.value = lamp;
      // smoke: a puff on the horn and at each of the first wheel turns
      const dAt = tt => (tt < H.depart ? 0 : .02 * Math.pow(tt - H.depart, 1.9));
      puffs.forEach((m, i) => { const t0 = H.horn - .1 + i * .55, k = seg(t, t0, t0 + 2.4); m.visible = k > 0 && k < 1;
        const px = xAtS(headS0 + dAt(t0)) - L * .25; m.position.set(px - .012 * k, TY(px) + .016 + .028 * eo(k), -.0795); m.scale.setScalar(.6 + 1.2 * eo(k)); m.material.color.set('#aab8dc').multiplyScalar((1 - k) / BASE); });
      snow.forEach((m, j) => { const p = ((t * (.012 + j * .005) + j * .18) % .36); m.position.set(.03 * Math.sin(t * .3 + j), .18 - p - .0, -.012 - j * .004); });
      if (sign) sign.userData.reveal(eo(seg(t, H.sign, H.sign + .9)));
      // camera: close on the halt and the standing train; as it pulls away, follow and pull back to the valley
      const a = eio(seg(t, H.depart - .4, 10.4));
      const pre = eio(seg(t, 0, H.depart)); const cx = lerp(lerp(-.232, -.205, pre), .005, a), cz = lerp(lerp(.235, .205, pre), .43, a), cy = lerp(lerp(.006, .008, pre), -.006, a);
      const b = eio(seg(t, 10.2, 13.8));
      aim(S.cam, [cx + .09 * b, cy - .004 * b, cz, lerp(lerp(-.225, -.2, pre), .015, a) + .11 * b, lerp(.012, -.012, a) - .004 * b, -.08], t, { hand: .0006 });
      this._f = cz + .079;
    },
    post() { return { focus: this._f, aper: 10, maxCoc: 10, bloom: { strength: .3, radius: .5, threshold: 1.15 } }; },
    grade() { return { expo: 1.0, vig: .45, sat: 1.04, contrast: .12, lift: [0, .004, .02], gain: [1.0, 1.0, 1.0] }; },
  };
}

// the credit strip: cream paper with a red seal, grows from its left edge (texture repeat follows the mesh scale)
export function signStrip(U, z, x, y) {
  const w = .11, h = .0135;
  const m = sheet({ U, w, h, z, x, y, ax: -w / 2, trans: .35, shadow: false, recv: false, ppm: 12000, finish: { rim: .5, under: .2 }, draw: c => {
    c.fillStyle = '#efd9aa'; c.beginPath(); c.moveTo(-w / 2, -h / 2); c.lineTo(w / 2 - h * .25, -h / 2); c.lineTo(w / 2, 0); c.lineTo(w / 2 - h * .25, h / 2); c.lineTo(-w / 2, h / 2); c.closePath(); c.fill();
    c.fillStyle = '#b3302a'; c.fillRect(-w / 2 + h * .3, -h * .3, h * .6, h * .6);
    text(c, '车', -w / 2 + h * .6, -h * .02, h * .42, '"NotoSerifSC"', { fill: '#f7e6c8', weight: 700 });
    text(c, 'LemoLab × Claude Opus 5.5', -w / 2 + h * 1.15, -h * .04, h * .5, '"Cormorant"', { fill: '#2a1d14', weight: 600, align: 'left' });
  } });
  m.userData.reveal = k => { k = clamp(k, .0001, 1); m.scale.x = k; m.material.map.repeat.x = k; m.visible = k > .002; };
  return m;
}
