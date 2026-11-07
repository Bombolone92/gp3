// The world: the Setsuri river at Tsurui in January, the Kushiro marsh, the grid of windbreaks, the Akan volcanoes,
// and the feeding field. Units are metres; north is -z, east is +x.
import * as THREE from 'three';
import { mulberry, clamp, lerp } from '/core/lib.js';
import { C, U, mtnMat, carveMat, groundMat, waterMat, bankMat, iceMat, skyMat, billboardMat, reflectMat, crownMat, toonMat, woodMat, concreteMat, inkMat, paperMat, hullMat } from './look.js';
import { pineAtlas, frostTreeAtlas, craneAtlas, mistAtlas, moonCanvas, sunCanvas, HEAD } from './textures.js';
import { plateCanvas, dialCanvas, boardCanvas, BOARD } from './props.js';

export const WY = -0.6;   // the river surface

export function canvasTex(c, mips = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8; t.generateMipmaps = mips;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  return t;
}

// ------------------------------------------------------------------ the river
export const RIVER = new THREE.CatmullRomCurve3([
  [-34, 620], [-14, 470], [8, 360], [-10, 250], [8, 150], [-4, 70], [2, 10], [7, -40], [26, -80], [64, -104], [120, -116],
  [190, -114], [262, -122], [350, -150], [470, -196], [640, -236], [880, -262], [1180, -300], [1550, -360], [2000, -430], [2600, -470],
].map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
const RLEN = RIVER.getLength();
export const riverHalf = x => 9 + 14 * clamp((x - 34) / 46) * (1 - clamp((x - 236) / 80));   // widens into a shallow pool
export const BRIDGE = { z: -30, x: 6, y: 3.6, len: 46, pier: 8.6 };

function riverFrame(u) {
  const p = RIVER.getPointAt(u), tg = RIVER.getTangentAt(u);
  const n = new THREE.Vector3(-tg.z, 0, tg.x).normalize();
  return { p, n, hw: riverHalf(p.x) };
}
// nearest river point (coarse), for placing things off the water
const RS = []; for (let i = 0; i <= 1600; i++) { const f = riverFrame(i / 1600); RS.push([f.p.x, f.p.z, f.hw]); }
export function riverDist(x, z) {
  let best = 1e9, hw = 9;
  for (const [px, pz, h] of RS) { const d = (px - x) ** 2 + (pz - z) ** 2; if (d < best) { best = d; hw = h; } }
  return Math.sqrt(best) - hw;   // metres from the water's edge (negative = in the water)
}

function riverMeshes(maskG, rect) {
  const grp = new THREE.Group(), N = 1400;
  // water ribbon
  const pos = [], riv = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const { p, n, hw } = riverFrame(i / N), w = hw + 1.2;
    pos.push(p.x - n.x * w, WY, p.z - n.z * w, p.x + n.x * w, WY, p.z + n.z * w);
    riv.push(i / N * RLEN, -1.08, i / N * RLEN, 1.08);
    if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aRiv', new THREE.Float32BufferAttribute(riv, 2)); g.setIndex(idx);
  grp.add(new THREE.Mesh(g, waterMat));
  // banks: from the water up to a snow lip just outside the cut in the ground
  for (const side of [-1, 1]) {
    const bp = [], ba = [], bi = [], ip = [], ii = [];
    const R = mulberry(side > 0 ? 41 : 43);
    let wob = 0;
    for (let i = 0; i <= N; i++) {
      const { p, n, hw } = riverFrame(i / N);
      wob = wob * .9 + (R() - .5) * .25;
      const e0 = hw - .2 + wob * .3, e1 = hw + .9;
      bp.push(p.x + n.x * side * e0, WY - .05, p.z + n.z * side * e0, p.x + n.x * side * e1, .05, p.z + n.z * side * e1);
      ba.push(i / N * RLEN, 0, i / N * RLEN, 1);
      if (i) { const a = (i - 1) * 2; bi.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      // shelf ice: an irregular paper ledge on the water along the bank
      const iw = Math.max(0, .45 + Math.sin(i * .13 + side) * .5 + Math.sin(i * .041) * .35);
      ip.push(p.x + n.x * side * (hw - .2 - iw), WY + .03, p.z + n.z * side * (hw - .2 - iw), p.x + n.x * side * (hw + .1), WY + .03, p.z + n.z * side * (hw + .1));
      if (i) { const a = (i - 1) * 2; ii.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3)); g.setAttribute('aB', new THREE.Float32BufferAttribute(ba, 2)); g.setIndex(bi);
    grp.add(new THREE.Mesh(g, bankMat));
    g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(ip, 3)); g.setIndex(ii);
    const ice = new THREE.Mesh(g, iceMat); grp.add(ice);
  }
  // the mask: where the ground is cut away
  const [x0, z0, sx, sz] = rect, S = maskG.canvas.width;
  maskG.strokeStyle = '#fff'; maskG.lineCap = 'round'; maskG.lineJoin = 'round';
  for (let i = 0; i < N; i++) {
    const a = riverFrame(i / N), b = riverFrame((i + 1) / N);
    maskG.lineWidth = (a.hw + .45) * 2 / sx * S;
    maskG.beginPath(); maskG.moveTo((a.p.x - x0) / sx * S, (a.p.z - z0) / sz * S); maskG.lineTo((b.p.x - x0) / sx * S, (b.p.z - z0) / sz * S); maskG.stroke();
  }
  return grp;
}

// marsh streams: thin ink meanders lying on the snow, seen from the air
function streams(R) {
  const grp = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: C.ink, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const make = (x, z, len, heading, w, seed) => {
    const r = mulberry(seed), pts = []; let a = heading, px = x, pz = z;
    for (let i = 0; i < len; i++) { pts.push(new THREE.Vector3(px, .05, pz)); a += Math.sin(i * .9 + r() * 2) * .9; px += Math.cos(a) * 26; pz += Math.sin(a) * 26; }
    const cv = new THREE.CatmullRomCurve3(pts), N = len * 10, pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const p = cv.getPointAt(i / N), tg = cv.getTangentAt(i / N), n = new THREE.Vector3(-tg.z, 0, tg.x), ww = w * (.7 + .3 * Math.sin(i * .2));
      pos.push(p.x - n.x * ww, .05, p.z - n.z * ww, p.x + n.x * ww, .05, p.z + n.z * ww);
      if (i) { const a2 = (i - 1) * 2; idx.push(a2, a2 + 1, a2 + 2, a2 + 1, a2 + 3, a2 + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    grp.add(new THREE.Mesh(g, mat));
  };
  make(260, 1500, 60, -1.75, 5, 11); make(900, 1600, 64, -2.1, 4, 12); make(1500, 1300, 54, -2.4, 3.5, 13);
  make(120, 700, 30, -.3, 3, 14); make(700, 220, 34, .6, 3, 15); make(1300, 500, 30, 2.6, 2.6, 16);
  make(-500, 900, 30, -1.2, 3, 17); make(1900, 200, 40, 2.9, 3.5, 18);
  return grp;
}

// ------------------------------------------------------------------ mountains: the Akan volcanoes and their ridges
function volcano(cx, cz, h, r, seed, crater = 0) {
  // a stratovolcano: concave flanks that steepen toward the summit, cut into flat facets.
  // crater > 0 truncates the summit into a rim (a broad massif instead of a sharp cone)
  const R = mulberry(seed), pos = [], n = 16;
  const prof = [[1, 0], [.62, .22], [.36, .5], [.17, .78], [.06 + crater * .14, .95 - crater * .1]];
  const rings = prof.map(([rf, hf], k) => {
    const a0 = R() * .4, ring = [];
    for (let i = 0; i < n; i++) {
      const a = a0 + i / n * Math.PI * 2 + (R() - .5) * .12 * (k > 0);
      const rr = r * rf * (1 + (R() - .5) * .1), hh = h * hf * (1 + (R() - .5) * .04 * (k > 0));
      ring.push([cx + Math.cos(a) * rr, k ? hh : -4, cz + Math.sin(a) * rr * .7]);
    }
    return ring;
  });
  const apex = [cx, h * (crater ? .86 : 1), cz];
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, A = rings[k], B = rings[k + 1];
    tri(A[i], B[j], A[j]); tri(A[i], B[i], B[j]);
  }
  const top = rings[rings.length - 1];
  for (let i = 0; i < n; i++) tri(top[i], apex, top[(i + 1) % n]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return new THREE.Mesh(g, mtnMat);
}

// ------------------------------------------------------------------ instanced billboards
export function billboards(count, mat, pivotBottom) {
  const base = new THREE.PlaneGeometry(1, 1); if (pivotBottom) base.translate(0, .5, 0);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index; g.attributes.position = base.attributes.position; g.attributes.uv = base.attributes.uv;
  g.setAttribute('aOff', new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('aSize', new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2));
  g.setAttribute('aTile', new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4));
  g.setAttribute('aRot', new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
  g.instanceCount = count;
  const m = new THREE.Mesh(g, mat); m.frustumCulled = false; return m;
}
function fillBoards(mesh, list, cols, rows = 1) {
  const a = mesh.geometry.attributes;
  list.forEach(([x, y, z, w, h, v, rot = 0], i) => {
    a.aOff.array.set([x, y, z], i * 3); a.aSize.array.set([w, h], i * 2);
    a.aTile.array.set([(v % cols) / cols, (rows - 1 - Math.floor(v / cols)) / rows, 1 / cols, 1 / rows], i * 4); a.aRot.array[i] = rot;
  });
  mesh.geometry.instanceCount = list.length;
  for (const k in a) a[k].needsUpdate = true;
}

// ------------------------------------------------------------------ cranes: one instanced flock per mesh
// each crane: {x,y,z,s (height in m), flip, pose, rot, mode (0 standing, 1 flying), crown (0..1)}
export class Flock {
  constructor(tex, crownM, max, mode, reflect = false) {
    this.max = max; this.mode = mode;
    this.mesh = billboards(max, billboardMat(tex, mode), mode === 0);
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    for (const [k, n] of [['aOff', 3], ['aSize', 2], ['aHead', 2], ['aRot', 1], ['aMode', 1], ['aOn', 1]]) cg.setAttribute(k, new THREE.BufferAttribute(new Float32Array(max * n), n));
    this.crowns = new THREE.Points(cg, crownM); this.crowns.frustumCulled = false;
    if (reflect) { this.refl = billboards(max, reflectMat(tex), true); }
  }
  set(list) {
    const a = this.mesh.geometry.attributes, c = this.crowns.geometry.attributes;
    const n = Math.min(list.length, this.max);
    for (let i = 0; i < n; i++) {
      // printmaker's scale: far birds are cut a little larger so they still read as birds, not specks
      const b = list[i], d = Flock.cam ? Math.hypot(b.x - Flock.cam.x, b.y - Flock.cam.y, b.z - Flock.cam.z) : 0;
      const grow = 1 + 2 * Math.min(1, Math.max(0, (d - 40) / 160));
      const sz = b.s * 1.16 * grow, w = sz * (b.flip ? -1 : 1);
      a.aOff.array.set([b.x, b.y, b.z], i * 3); a.aSize.array.set([w, sz], i * 2);
      a.aTile.array.set([(b.pose % 4) / 4, (3 - Math.floor(b.pose / 4)) / 4, .25, .25], i * 4); a.aRot.array[i] = b.rot || 0;
      const hd = HEAD[b.pose];
      const hx = b.flip ? 1 - hd[0] / 100 : hd[0] / 100;
      c.aOff.array.set([b.x, b.y, b.z], i * 3); c.aSize.array.set([sz, sz], i * 2); c.aHead.array.set([hx, hd[1] / 100], i * 2);
      c.aRot.array[i] = b.rot || 0; c.aMode.array[i] = this.mode; c.aOn.array[i] = b.crown ?? 1;
    }
    this.mesh.geometry.instanceCount = n;
    c.position.count; this.crowns.geometry.setDrawRange(0, n);
    for (const k in a) a[k].needsUpdate = true;
    for (const k in c) c[k].needsUpdate = true;
    if (this.refl) {
      const r = this.refl.geometry.attributes;
      for (const k of ['aOff', 'aSize', 'aTile', 'aRot']) { r[k].array.set(a[k].array.subarray(0, n * r[k].itemSize)); r[k].needsUpdate = true; }
      this.refl.geometry.instanceCount = n;
    }
  }
  addTo(scene) { scene.add(this.mesh); scene.add(this.crowns); if (this.refl) scene.add(this.refl); }
}

// ------------------------------------------------------------------ props
const E = .05;
function box(parent, w, h, d, x, y, z, mat, outline = true, ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.rotation.y = ry; parent.add(m);
  if (outline) { const o = new THREE.Mesh(new THREE.BoxGeometry(w + 2 * E, h + 2 * E, d + 2 * E), hullMat); o.position.copy(m.position); o.rotation.y = ry; parent.add(o); }
  return m;
}
const steel = woodMat, concrete = concreteMat;
const snowT = toonMat(C.paper, new THREE.Color('#c9c3ab'));

// Otowa bridge: a plain steel girder bridge on two piers, snow on the deck and the rails
function bridge() {
  const g = new THREE.Group(), { x, z, y, len } = BRIDGE;
  box(g, len, .9, 7.2, x, y, z, steel);                       // deck girder
  box(g, len, .18, 7.0, x, y + .54, z, snowT, false);          // snow on the road
  for (const s of [-1, 1]) {
    box(g, len, .16, .16, x, y + 1.6, z + s * 3.45, steel);      // top rail
    box(g, len, .12, .12, x, y + 1.05, z + s * 3.45, steel);     // mid rail
    box(g, len - .2, .08, .2, x, y + 1.71, z + s * 3.45, snowT, false);
    for (let k = 0; k <= 22; k++) box(g, .1, 1.15, .1, x - len / 2 + k * len / 22, y + 1.05, z + s * 3.45, steel, false);
  }
  for (const s of [-1, 1]) box(g, 2.4, 4.6, 5.5, x + s * BRIDGE.pier, WY + 1.7, z, concrete);   // piers
  // abutments
  for (const s of [-1, 1]) box(g, 3, 4.4, 8.4, x + s * (len / 2 - 1), 1.6, z, concrete);
  return g;
}

function hut(x, z, ry = 0, w = 4.4, d = 3.4) {
  const g = new THREE.Group();
  box(g, w, 2.4, d, 0, 1.2, 0, woodMat);
  // gable roof with snow
  const roof = new THREE.BufferGeometry(), hw = w / 2 + .35, hd = d / 2 + .4, ry0 = 2.4, ry1 = 3.6;
  const v = [-hw, ry0, -hd, hw, ry0, -hd, hw, ry1, 0, -hw, ry0, -hd, hw, ry1, 0, -hw, ry1, 0,
    -hw, ry0, hd, -hw, ry1, 0, hw, ry1, 0, -hw, ry0, hd, hw, ry1, 0, hw, ry0, hd];
  roof.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); roof.computeVertexNormals();
  const rm = new THREE.Mesh(roof, toonMat(C.paper, new THREE.Color('#bdb79f'))); rm.material.side = THREE.DoubleSide; g.add(rm);
  box(g, .7, .9, .06, w * .2, 1.0, d / 2 + .02, inkMat, false);   // door
  box(g, .6, .5, .06, -w * .25, 1.5, d / 2 + .02, inkMat, false); // window
  g.position.set(x, 0, z); g.rotation.y = ry; return g;
}

// ------------------------------------------------------------------ build everything
export function buildWorld(scene, proj, clear = []) {
  // keep trees off the camera's path through the valley
  const onPath = (x, z) => clear.some(([cx, cz, r]) => (cx - x) ** 2 + (cz - z) ** 2 < r * r);
  const R = mulberry(2026);
  const W = {};
  // sky: a sphere that travels with the camera
  W.sky = new THREE.Mesh(new THREE.SphereGeometry(8000, 64, 32), skyMat); W.sky.renderOrder = -10; scene.add(W.sky);
  W.moon = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshBasicMaterial({ map: canvasTex(moonCanvas()), transparent: true, depthWrite: false }));
  W.moon.renderOrder = -9; scene.add(W.moon);
  W.sun = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.MeshBasicMaterial({ map: canvasTex(sunCanvas()), transparent: true, depthWrite: false }));
  W.sun.renderOrder = -9; scene.add(W.sun);

  // ground + river
  const rect = [-1400, -1400, 4200, 4200];
  const mc = document.createElement('canvas'); mc.width = mc.height = 4096;
  const mg = mc.getContext('2d'); mg.fillStyle = '#000'; mg.fillRect(0, 0, 4096, 4096);
  W.river = riverMeshes(mg, rect); scene.add(W.river);
  // soften the mask a little so the ground can hatch the cornice
  const mc2 = document.createElement('canvas'); mc2.width = mc2.height = 4096; const mg2 = mc2.getContext('2d');
  mg2.filter = 'blur(3px)'; mg2.drawImage(mc, 0, 0); mg2.filter = 'none'; mg2.globalCompositeOperation = 'lighter'; mg2.globalAlpha = .55; mg2.drawImage(mc, 0, 0);
  const maskTex = canvasTex(mc2, false); maskTex.flipY = false;
  W.ground = new THREE.Mesh(new THREE.PlaneGeometry(24000, 24000, 1, 1), groundMat(maskTex, rect));
  W.ground.rotation.x = -Math.PI / 2; scene.add(W.ground);
  W.streams = streams(R); scene.add(W.streams);

  // mountains: two volcano cones, a broad massif, and a long row of lower ridges
  const mtns = new THREE.Group(); scene.add(mtns);
  // the Akan group to the north-west: an even cone, a broad truncated massif with a small cone at its side,
  // then a long low line of older volcanoes and ridges
  mtns.add(volcano(-560, -2300, 520, 1050, 11));              // the even cone
  mtns.add(volcano(-1500, -2600, 560, 1350, 12, 1));          // the broad massif with a crater rim
  mtns.add(volcano(-1080, -2420, 430, 760, 13));              // a small sharp cone beside it
  for (let i = 0; i < 12; i++) {
    const x = -3200 + i * 560 + (R() - .5) * 160; if (x > -1900 && x < -250) continue;
    const h = 170 + R() * 120; mtns.add(volcano(x, -2050 - R() * 300, h, h * (2.6 + R() * .8), 100 + i, R() < .5 ? .6 : 0));
  }
  for (let i = 0; i < 10; i++) { const h = 80 + R() * 50; mtns.add(volcano(-2600 + i * 560 + (R() - .5) * 150, -1700 - R() * 80, h, h * 3.4, 200 + i, .8)); }
  // a dark foothill band under the mountains
  const band = new THREE.Mesh(new THREE.PlaneGeometry(9000, 120), inkMat); band.rotation.x = -Math.PI / 2; band.position.set(0, .2, -1580); scene.add(band);

  W.bridge = bridge(); scene.add(W.bridge);
  // the cast-iron name plate and the dial thermometer on the downstream face of the east pier
  const face = BRIDGE.z + 2.75 + .03, px = BRIDGE.x + BRIDGE.pier;
  W.plate = new THREE.Mesh(new THREE.PlaneGeometry(1.1, .56), new THREE.MeshBasicMaterial({ map: canvasTex(plateCanvas()) }));
  W.plate.position.set(px - .55, 1.55, face); scene.add(W.plate);
  const plateBack = new THREE.Mesh(new THREE.BoxGeometry(1.16, .62, .05), inkMat); plateBack.position.set(px - .55, 1.55, face - .03); scene.add(plateBack);
  W.dial = new THREE.Mesh(new THREE.CircleGeometry(.23, 48), new THREE.MeshBasicMaterial({ map: canvasTex(dialCanvas()) }));
  W.dial.geometry.attributes.uv.array.forEach((v, i, a) => a[i] = v);   // circle uvs already span the disc
  W.dial.position.set(px + .62, 1.5, face + .02); scene.add(W.dial);
  const dialRim = new THREE.Mesh(new THREE.CylinderGeometry(.25, .25, .06, 48), inkMat); dialRim.rotation.x = Math.PI / 2; dialRim.position.set(px + .62, 1.5, face - .01); scene.add(dialRim);
  W.plateRect = { w: 1.1, h: .56 };
  // snow lying on the plate and the dial, icicles hanging under them
  box(scene, 1.22, .07, .14, px - .55, 1.55 + .31, face + .03, paperMat, true);
  box(scene, .34, .05, .1, px + .62, 1.5 + .25, face + .02, paperMat, true);
  { const R = mulberry(88);
    const icicle = (x, y, z, L) => {
      const c = new THREE.Mesh(new THREE.ConeGeometry(.014, L, 6), paperMat); c.rotation.x = Math.PI; c.position.set(x, y - L / 2, z); scene.add(c);
      const h = new THREE.Mesh(new THREE.ConeGeometry(.024, L + .02, 6), hullMat); h.rotation.x = Math.PI; h.position.copy(c.position); scene.add(h);
    };
    for (let i = 0; i < 9; i++) icicle(px - 1.05 + i * .12 + (R() - .5) * .04, 1.55 - .31, face + .02, .05 + R() * .14);
    for (let i = 0; i < 4; i++) icicle(px + .5 + i * .08, 1.5 - .25, face + .02, .04 + R() * .08);
    for (let i = 0; i < 16; i++) icicle(px - 1.2 + i * .16 + (R() - .5) * .05, BRIDGE.y - .46, face - .02 + 2.75 * 0, .08 + R() * .3);
  }

  // ---------------- trees
  const pines = [], frost = [];
  const inField = (x, z) => x > -185 && x < -25 && z > -250 && z < -100;
  // windbreak belts: the grid of the dairy farms
  const belt = (x0, z0, x1, z1, step, hMul = 1) => {
    const L = Math.hypot(x1 - x0, z1 - z0), nx = (x1 - x0) / L, nz = (z1 - z0) / L;
    for (let s = 0; s < L; s += step * (.6 + R() * .8)) {
      for (let k = 0; k < 2; k++) {
        const x = x0 + nx * s + (-nz) * (k * 3 + (R() - .5) * 2), z = z0 + nz * s + nx * (k * 3 + (R() - .5) * 2);
        if (riverDist(x, z) < 6) continue;
        const h = (13 + R() * 7) * hMul; pines.push([x, 0, z, h * .5, h, Math.floor(R() * 8)]);
      }
    }
  };
  for (const z of [-262, -640, -1080]) belt(-1500, z, 1500, z - 20, 2.6, .8);
  for (const x of [-760, -250, 500]) belt(x, -262, x - 15, -1080, 2.8, .8);
  for (const z of [-640]) belt(1500, z, 2600, z - 40, 2.8, .8);
  // west of the river, south: scattered pines and a few belts
  for (const z of [140, 420]) belt(-1500, z, -60, z + 15, 2.8);
  belt(-260, 520, -280, -60, 3);
  // frosted alders and willows along both banks
  for (let i = 0; i <= 1600; i += 1) {
    const u = i / 1600, f = riverFrame(u);
    if (f.p.x > 900 || f.p.z > 560) continue;
    for (const side of [-1, 1]) {
      if (R() < (f.p.z > -40 ? .62 : .5)) continue;
      const pool = f.p.x > 30 && f.p.x < 280;
      if (pool && R() < .45) continue;
      const off = f.hw + (pool ? 9 : 3) + Math.pow(R(), 1.3) * 20;
      const x = f.p.x + f.n.x * side * off + (R() - .5) * 2, z = f.p.z + f.n.z * side * off + (R() - .5) * 2;
      if (Math.abs(z - BRIDGE.z) < 9 && Math.abs(x - BRIDGE.x) < 30) continue;
      if (inField(x, z) || onPath(x, z)) continue;
      const h = 7 + R() * 9;
      frost.push([x, -.05, z, h * (.9 + R() * .3), h, Math.floor(R() * 8)]);
    }
  }
  // alder thickets out in the marsh
  for (let k = 0; k < 46; k++) {
    const cx = 120 + R() * 2300, cz = -60 + R() * 1700, rr = 20 + R() * 70, n = 20 + Math.floor(R() * 70);
    if (riverDist(cx, cz) < 30) continue;
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, d = Math.sqrt(R()) * rr;
      const x = cx + Math.cos(a) * d * 1.4, z = cz + Math.sin(a) * d * .8;
      if (riverDist(x, z) < 3) continue;
      const h = 5 + R() * 6; frost.push([x, 0, z, h, h, Math.floor(R() * 8)]);
    }
  }
  // the west side: scattered pines and alders over the snow, as in a printed valley
  for (let i = 0; i < 2600; i++) {
    const x = -900 + R() * 860, z = -240 + R() * 900;
    if (riverDist(x, z) < 5 || inField(x, z)) continue;
    const cl = .5 + .5 * Math.sin(x * .021 + 1.3) * Math.cos(z * .027 - .4);
    if (R() > cl * .7) continue;
    const h = 6 + R() * 7;
    if (R() < .6) pines.push([x, 0, z, h * .5, h, Math.floor(R() * 8)]); else frost.push([x, 0, z, h, h, Math.floor(R() * 8)]);
  }
  const pineMesh = billboards(pines.length, billboardMat(canvasTex(pineAtlas()), 0), true); fillBoards(pineMesh, pines, 8); scene.add(pineMesh);
  const frostTex = canvasTex(frostTreeAtlas());
  const frostMesh = billboards(frost.length, billboardMat(frostTex, 0, { warm: true }), true); fillBoards(frostMesh, frost, 4, 2); scene.add(frostMesh);
  frostMesh.material.uniforms.uTint.value = 1;
  W.trees = { pines: pineMesh, frost: frostMesh };

  // ---------------- river steam: wisps hanging low over the water
  const mist = [];
  for (let i = 0; i <= 700; i++) {
    const f = riverFrame(i / 700);
    if (f.p.x > 700 || f.p.z > 520) continue;
    const n = R() < .5 && Math.abs(f.p.z - BRIDGE.z) > 32 ? 1 : 0;
    for (let k = 0; k < n; k++) {
      const off = (R() - .5) * f.hw * 1.7;
      mist.push({ x: f.p.x + f.n.x * off, z: f.p.z + f.n.z * off, y: WY + .8 + Math.pow(R(), 1.8) * 5, w: 18 + R() * 30, h: 3.5 + R() * 4, v: Math.floor(R() * 4), ph: R() * 6, flip: R() < .5 });
    }
  }
  W.mistList = mist;
  W.mist = billboards(mist.length, billboardMat(canvasTex(mistAtlas()), 0, { warm: true, transparentDepth: true, fade: [12, 55] }), false);
  W.mist.material.uniforms.uTint.value = 1;
  scene.add(W.mist);

  // ---------------- cranes
  const craneTex = canvasTex(craneAtlas());
  const cm = crownMat(proj);
  W.crownMat = cm;
  W.river1 = new Flock(craneTex, cm, 80, 0, true); W.river1.addTo(scene);
  W.flyers = new Flock(craneTex, cm, 80, 1); W.flyers.addTo(scene);
  W.field = new Flock(craneTex, cm, 360, 0); W.field.addTo(scene);

  // ---------------- the feeding field
  const F = W.feed = new THREE.Group(); scene.add(F);
  W.fence = new THREE.Group(); F.add(W.fence);
  const fx0 = -146, fx1 = -52, fz0 = -220, fz1 = -152;
  const post = (x, z) => { box(W.fence, .16, 1.5, .16, x, .75, z, woodMat, true); box(W.fence, .2, .1, .2, x, 1.52, z, paperMat, false); };
  for (let x = fx0; x <= fx1; x += 3.2) { post(x, fz0); if (Math.abs(x - (fx0 + fx1) / 2) > 4) post(x, fz1); }
  for (let z = fz0 + 3.2; z < fz1; z += 3.2) { post(fx0, z); post(fx1, z); }
  for (const yy of [.6, 1.2]) {
    box(W.fence, fx1 - fx0, .07, .07, (fx0 + fx1) / 2, yy, fz0, woodMat, false);
    box(W.fence, fx1 - fx0, .07, .07, (fx0 + fx1) / 2, yy, fz1, woodMat, false);
    box(W.fence, .07, .07, fz1 - fz0, fx0, yy, (fz0 + fz1) / 2, woodMat, false);
    box(W.fence, .07, .07, fz1 - fz0, fx1, yy, (fz0 + fz1) / 2, woodMat, false);
  }
  W.hut1 = hut(-158, -232, .1); F.add(W.hut1);
  W.hut2 = hut(-170, -226, .25, 3.2, 2.6); F.add(W.hut2);
  // the corn: a warm stipple on the snow, its extent set per era
  W.corn = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    uniforms: { ...U, uSpread: { value: 1 } }, transparent: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    vertexShader: `varying vec2 vU; varying vec3 vW; void main(){ vU = uv-.5; vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      uniform vec3 uYellow; uniform float uSpread; varying vec2 vU; varying vec3 vW;
      void main(){
        float r = length(vU*vec2(1., 1.));
        vec2 c = floor(vW.xz*7.); vec2 f = fract(vW.xz*7.)-.5;
        float dens = (1.-smoothstep(.12, .5, r/uSpread)) * .75;
        if (h21(c) > dens || length(f) > .32) discard;
        gl_FragColor = vec4(uYellow, 1.);
      }`,
  }));
  W.corn.rotation.x = -Math.PI / 2; W.corn.position.set(-99, .04, -186); W.corn.scale.set(44, 22, 1); F.add(W.corn);
  W.fieldRect = { x0: fx0, x1: fx1, z0: fz0, z1: fz1 };
  // long low-sun shadows of the fence posts, cut into the snow
  { const pos = [], idx = []; const sd = [-.95, .3], L = 4.2, w = .09;
    const add = (x, z) => { const n = pos.length / 3, nx = -sd[1] * w, nz = sd[0] * w;
      pos.push(x + nx, .03, z + nz, x - nx, .03, z - nz, x + sd[0] * L - nx * .4, .03, z + sd[1] * L - nz * .4, x + sd[0] * L + nx * .4, .03, z + sd[1] * L + nz * .4);
      idx.push(n, n + 1, n + 2, n, n + 2, n + 3); };
    for (let x = fx0; x <= fx1; x += 3.2) { add(x, fz0); if (Math.abs(x - (fx0 + fx1) / 2) > 4) add(x, fz1); }
    for (let z = fz0 + 3.2; z < fz1; z += 3.2) { add(fx0, z); add(fx1, z); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    F.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: C.ink, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }))); }
  // crane tracks in the snow: three toes forward, walks that wander round the corn; more of them in later years
  { const c = document.createElement('canvas'); c.width = 2048; c.height = 1536; const g = c.getContext('2d'), R = mulberry(4040);
    const sx = 2048 / 100, sz = 1536 / 75;   // 100 × 75 m centred on the corn
    for (let k = 0; k < 110; k++) {
      const era = R(), ang0 = R() * 6.28, r0 = 4 + Math.pow(R(), .7) * 30 * (.4 + era * .6);
      let x = Math.cos(ang0) * r0, z = Math.sin(ang0) * r0 * .7, a = R() * 6.28;
      g.fillStyle = `rgb(${Math.round(era * 255)},0,0)`; g.strokeStyle = g.fillStyle; g.lineWidth = 1.1; g.lineCap = 'round';
      for (let st = 0; st < 26; st++) {
        a += (R() - .5) * .5; x += Math.cos(a) * .55; z += Math.sin(a) * .55;
        const side = st % 2 ? 1 : -1, px = (x + 50 + Math.cos(a + 1.57) * .12 * side) * sx, pz = (z + 37.5 + Math.sin(a + 1.57) * .12 * side) * sz;
        for (const d of [-.45, 0, .45]) { g.beginPath(); g.moveTo(px, pz); g.lineTo(px + Math.cos(a + d) * 2.6, pz + Math.sin(a + d) * 2.6); g.stroke(); }
        g.beginPath(); g.moveTo(px, pz); g.lineTo(px - Math.cos(a) * 2.2, pz - Math.sin(a) * 2.2); g.stroke();
      }
    }
    const tex = canvasTex(c); tex.flipY = false;
    W.tracks = new THREE.Mesh(new THREE.PlaneGeometry(100, 75), new THREE.ShaderMaterial({
      uniforms: { tMap: { value: tex }, uTrack: { value: 1 }, uInk: U.uInk },
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      vertexShader: `varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform sampler2D tMap; uniform float uTrack; uniform vec3 uInk; varying vec2 vU;
        void main(){ vec4 c = texture2D(tMap, vec2(vU.x, 1.-vU.y)); if (c.a < .4 || c.r > uTrack) discard; gl_FragColor = vec4(uInk, 1.); }`,
    }));
    W.tracks.rotation.x = -Math.PI / 2; W.tracks.position.set(-99, .025, -184); F.add(W.tracks); }
  // the board at the gate: two posts, a plank face with a canvas that is re-cut as the film goes
  const sign = W.sign = new THREE.Group(); F.add(sign);
  const bw = 1.8, bh = bw * BOARD.H / BOARD.W;
  W.boardCanvas = boardCanvas(null, { carve: 0, strike: 0, stamp: 0 });
  W.boardTex = canvasTex(W.boardCanvas);
  W.boardFace = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), new THREE.MeshBasicMaterial({ map: W.boardTex }));
  W.boardFace.position.set(0, 1.45, .046); sign.add(W.boardFace);
  box(sign, bw + .1, bh + .1, .08, 0, 1.45, 0, woodMat);
  box(sign, bw + .16, .1, .14, 0, 1.45 + bh / 2 + .1, 0, paperMat, false);      // snow on the top edge
  for (const sx of [-1, 1]) box(sign, .12, 2.25, .12, sx * (bw / 2 - .12), 1.1, -.1, woodMat);
  sign.position.set(-112.4, 0, -149.2); sign.rotation.y = .2;
  W.board = { w: bw, h: bh };

  return W;
}

export { fillBoards };
