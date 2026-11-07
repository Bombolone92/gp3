// The Last Night Train: one timeline (timeline.json from tools/timeline.py) drives the picture, the subtitles and the mix.
// ?from=a&to=b renders a cut (window.DUR = b − a); ?sign10=1 grows the credit strip in the 10 s cut's last 2.5 s.
import * as THREE from 'three';
import { Pipe } from './post.js';
import { dispose } from './stage.js';
import { ss, seg, clamp } from './lib.js';
import { world } from './world.js';
import * as SH from './shots.js';

const Q = new URLSearchParams(location.search), SSAA = +(Q.get('ssaa') || 2);
const TL = await (await fetch('timeline.json')).json();
const FROM = Q.has('from') ? +Q.get('from') : 0, TO = Q.has('to') ? +Q.get('to') : TL.DUR;
window.DUR = +(TO - FROM).toFixed(3);
const BUILD = { S1: world, S2: SH.s2, S3: SH.s3, S4: SH.s4, S5: SH.s5, S6: SH.s6 };
const TR = { cut: { type: 'cut', dur: 0 }, dissolve: { type: 'dissolve', dur: .6 } };
const plan = TL.SHOTS.map(([id, start, tr]) => ({ id, start, in: TR[tr] || TR.cut }));
plan.forEach((s, i) => { s.end = i + 1 < plan.length ? plan[i + 1].start : TL.DUR; });

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(SSAA); renderer.setSize(1920, 1080, false);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.VSMShadowMap;
renderer.toneMapping = THREE.NoToneMapping; renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
const pipe = new Pipe(renderer, 1920, 1080, SSAA);
await Promise.all([document.fonts.load('40px NotoSerifSC', '车夜'), document.fonts.load('700 40px NotoSerifSC', '车'), document.fonts.load('600 40px Cormorant', 'Lemo'), document.fonts.load('700 40px Cormorant', 'PINE')]);

const live = new Map();
function get(i) { if (!live.has(i)) live.set(i, BUILD[plan[i].id]({ H: TL.HIT, sign: Q.get('sign10') === '1', T0: plan[i].start, dur: plan[i].end - plan[i].start })); return live.get(i); }
function gc(keep) { for (const [i, s] of live) if (!keep.includes(i)) { dispose(s.S.scene); live.delete(i); } }
function draw(i, t, target) { const s = get(i); s.update(t); pipe.shot(s.S.scene, s.S.cam, s.post(), target); return s.grade(); }

const sub = document.getElementById('sub'), zh = sub.querySelector('.zh'), en = sub.querySelector('.en');
function R(t) {
  let i = plan.findIndex(p => t >= p.start && t < p.end); if (i < 0) i = plan.length - 1;
  const p = plan[i], tl = t - p.start;
  let g, mixB = 0;
  if (i > 0 && p.in.type !== 'cut' && tl < p.in.dur) { draw(i - 1, t, pipe.rtA); g = draw(i, t, pipe.rtB); mixB = ss(tl / p.in.dur); gc([i - 1, i]); }
  else { g = draw(i, t, pipe.rtA); gc([i]); }
  const fin = 1;
  pipe.final({ ...g, mixB, fade: (g.fade ?? 1) * (FROM === 0 ? ss(clamp(t / .5)) : 1) * fin });
  let c = null, a = 0;
  for (const q of TL.cues) if (t > q.t0 && t < q.t1) { c = q; a = Math.min(ss(seg(t, q.t0, q.t0 + .2)), 1 - ss(seg(t, q.t1 - .22, q.t1))); }
  zh.textContent = c ? c.zh.replace(/[，。]$/, '') : ''; en.textContent = c ? c.en : ''; sub.style.opacity = Q.has('nosub') ? 0 : a;
}
window.render = t => R(FROM + t);
window.READY = true;
