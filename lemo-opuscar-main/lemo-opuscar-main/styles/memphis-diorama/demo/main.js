// Four Seasons in Pomelo Town: one river bend through four seasons in one take, 10 s each.
// Every change of season starts with the big tree on the plaza squatting down and springing back; a wave spreads from it.
// Page contract (core/README.md): window.READY, window.render(t), window.DUR, window.TEXTS(t).
import * as THREE from 'three';
import { Diorama, setNight, setLamps, setWave, setZone, setDusk, setSeason, setHalftone, flat, mesh, box, rng, clamp01, lerp, INK, FRAME } from './memphis.js';
import { person, walk, limb } from './people.js';

const FPS = 60;
const dio = new Diorama(document.getElementById('gl'), document.getElementById('c').getContext('2d'));
const W = new THREE.Group(); dio.scene.add(W);
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const c01 = clamp01;
const io = (x) => { x = c01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const sm = (x) => { x = c01(x); return x * x * (3 - 2 * x); };
const seg = (t, a, b) => c01((t - a) / (b - a));
const backOut = (x) => { x = c01(x); const s = 1.9; return 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2); };
const R = rng(2026);
const rr = (a, b) => a + (b - a) * R();
const R2 = rng(77), rr2 = (a, b) => a + (b - a) * R2();  // autumn/winter additions use a separate RNG so spring/summer layout stays put

// ---------- Season colours: each changing material carries [spring, summer, autumn, winter] ----------
const SEASONAL = [];
function S(cols, o = {}) {
  const pats = o.patCols;
  const m = flat(cols[0], { ...o, patCol: pats ? pats[0] : o.patCol, col2: cols[1], patCol2: pats ? pats[1] : o.patCol });
  m.userData.cols = cols.map((c) => new THREE.Color(c)); if (pats) m.userData.pats = pats.map((c) => new THREE.Color(c));
  SEASONAL.push(m); return m;
}
const cache = new Map();
const M = (hex, o = {}) => { const k = hex + JSON.stringify(o); if (!cache.has(k)) cache.set(k, flat(hex, o)); return cache.get(k); };

const lt = (hex, k) => '#' + new THREE.Color(hex).lerp(new THREE.Color(k > 0 ? '#FFFFFF' : '#3A2F66'), Math.abs(k)).getHexString();
// Canopy: base colour + bright clumps on the sun side + spring blossom dots
const CS = (cols, pats, bloom) => ({ main: S(cols, { pat: 1, patCols: pats, patScale: 0.75 }), hi: S(cols.map((c, i) => (i === 3 ? '#FFFFFF' : lt(c, i === 0 ? 0.3 : 0.17))), { pat: 1, patCols: pats.map((c, i) => (i === 3 ? '#DCE6FA' : lt(c, i === 0 ? 0.28 : 0.15))), patScale: 0.6 }), bloom });
const MAT = {
  grass: S(['#9DE8A6', '#6FD889', '#D6E68E', '#FBFCFF'], { pat: 1, patCols: ['#7DDC8C', '#47B868', '#BCD26E', '#E3EAFA'], patScale: 2.4 }),
  paddy: S(['#A6E3FB', '#A4E35F', '#F2C14E', '#FBFCFF'], { pat: 6, patCols: ['#92E3A0', '#78C93F', '#E0A23A', '#E3EAFA'], patScale: 1.2 }),
  rapeField: S(['#FFD234', '#A4E35F', '#F2C14E', '#FBFCFF'], { pat: 1, patCols: ['#FFF3A6', '#78C93F', '#E0A23A', '#E3EAFA'], patScale: 2.0 }),
  ridge: S(['#FFE6BD', '#FFE6BD', '#F7D49B', '#DCD0F2'], { pat: 1, patCols: ['#FFD39A', '#FFD39A', '#E9B97A', '#CBBDEB'], patScale: 0.8 }),
  rape: S(['#FFD234', '#3CBE7E', '#FFC23A', '#FFFFFF'], { pat: 1, patCols: ['#FFF3A6', '#2FA866', '#F39C12', '#E3EAFA'], patScale: 0.45 }),
  sprout: S(['#B8F07A', '#3CBE7E', '#FFC23A', '#FFFFFF'], { pat: 1, patCols: ['#8FDB55', '#2FA866', '#F39C12', '#E3EAFA'], patScale: 0.45 }),
  water: S(['#8ED8F7', '#72C9F3', '#7BBFE8', '#9FD0F4'], { pat: 1, patCols: ['#B5E7FB', '#9ED9F7', '#A5D2F0', '#D3E9FB'], patScale: 1.5 }),
  deep: S(['#55B6EE', '#3FA2E2', '#4C9BD6', '#79B8EA'], { pat: 1, patCols: ['#7FCBF4', '#62B8EC', '#6FB0E0', '#A9D3F4'], patScale: 1.3 }),
  lane: M('#FFE6BD', { pat: 1, patCol: '#FFD39A', patScale: 1.2 }),
  bank: M('#EFE6F7', { pat: 1, patCol: '#D3CAE8', patScale: 0.45 }),
  trunk: M('#A8705A'),
};
const CROWN = {
  pink: CS(['#FFB8D9', '#3CBE7E', '#FF6F61', '#E6DCFF'], ['#FF8DB5', '#2FA866', '#E8463C', '#FFFFFF'], ['#FFFFFF', '#FF4F93']),
  white: CS(['#FFF1F7', '#2FCB7A', '#FFD21F', '#D6EAFF'], ['#FFC4DA', '#1FA862', '#F3B51A', '#FFFFFF'], ['#FF8DB5', '#FFD234']),
  ginkgo: CS(['#B8F07A', '#2FCB7A', '#FFD21F', '#D3F1E6'], ['#9BE15D', '#1FA862', '#F3B51A', '#FFFFFF']),
  big: CS(['#FF9EC8', '#2FB57A', '#FF7A45', '#EBDDFF'], ['#FF7FAA', '#1F9C64', '#E85A2A', '#FFFFFF'], ['#FFFFFF', '#FF4F93']),
  teal: CS(['#62E0C8', '#14B8A0', '#FF9C6B', '#CDEFF0'], ['#B8F0DC', '#0E9A86', '#FF7A45', '#FFFFFF']),
};

// ---------- Terrain: grass + a winding river ----------
const xr = (z) => -8 + 9 * Math.sin(z / 28 + 0.6);   // river centre line
const RW = 5.5;                                        // river half-width
const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2), MAT.grass); ground.receiveShadow = true; W.add(ground);
function ribbon(halfW, y, mat, off = 0, wob = 0, z0 = -160, z1 = 160, n = 320) {
  const pos = [], idx = [];
  for (let i = 0; i <= n; i++) { const z = lerp(z0, z1, i / n), x = xr(z) + off + wob * Math.sin(z * 0.9 + off * 3); pos.push(x - halfW, y, z, x + halfW, y, z); }
  for (let i = 0; i < n; i++) { const a = 2 * i; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; W.add(m); return m;
}
ribbon(RW + 1.1, 0.04, MAT.bank);
ribbon(RW, 0.08, MAT.water);
ribbon(RW * 0.42, 0.1, MAT.deep, -0.6, 0.5);
const foamMat = new THREE.MeshBasicMaterial({ color: '#FFFFFF' });
for (const sd of [-1, 1]) ribbon(0.16, 0.11, foamMat, sd * (RW - 0.32), 0.16).userData.noOutline = true;
// Grass: patches of varied shade to break up the flat expanse
{
  const pa = S(['#B3F0A8', '#74DA8E', '#E4EEA2', '#FFFFFF'], { pat: 1, patCols: ['#95E596', '#5ACB7A', '#CCDC80', '#E3EAFA'], patScale: 2.2 });
  const pb = S(['#8EE292', '#54C878', '#F2D27A', '#F2F5FF'], { pat: 1, patCols: ['#74D886', '#3FB868', '#E2BC5E', '#E3EAFA'], patScale: 2.2 });
  for (let i = 0; i < 80; i++) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(rr(3, 8), 28).rotateX(-Math.PI / 2).scale(rr(1, 1.9), 1, rr(0.7, 1.2)), i % 2 ? pa : pb);
    m.position.set(rr(-130, 130), 0.012 + i * 0.0001, rr(-110, 110)); m.rotation.y = rr(0, 6.28); m.receiveShadow = true; W.add(m);
  }
}

// ---------- Fields: a grid of plots, rapeseed / flooded paddies in spring, all green rice in summer ----------
const ROWS = [], HAYSPOTS = [];  // crop rows per plot (short in spring, grow at the season change)
function mergeBoxes(list) {
  const pos = [], nor = [], idx = []; let base = 0;
  for (const [w, h, d, x, y, z] of list) {
    const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y + h / 2, z);
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array);
    for (const k of g.index.array) idx.push(k + base); base += g.attributes.position.count;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx); return g;
}
function plot(x0, z0, w, d, kind, near) {
  mesh(box(w + 0.7, 0.12, d + 0.7), MAT.ridge, x0 + w / 2, 0, z0 + d / 2, W).castShadow = false;
  mesh(box(w, 0.18, d), kind === 'rape' ? MAT.rapeField : MAT.paddy, x0 + w / 2, 0, z0 + d / 2, W).castShadow = false;
  if (near) { HAYSPOTS.push([x0 + w * rr2(0.2, 0.42), z0 + d * rr2(0.3, 0.7)]); if (R2() < 0.55) HAYSPOTS.push([x0 + w * rr2(0.62, 0.8), z0 + d * rr2(0.3, 0.7)]); }
  if (!near || kind !== 'rape') return;
  const rows = []; const n = 3;
  for (let i = 0; i < n; i++) rows.push([w - 1.2, 0.8, 1.3, 0, 0, -d / 2 + (i + 0.5) * d / n]);
  const m = new THREE.Mesh(mergeBoxes(rows), kind === 'rape' ? MAT.rape : MAT.sprout); m.castShadow = m.receiveShadow = true;
  m.position.set(x0 + w / 2, 0.18, z0 + d / 2); W.add(m);
  ROWS.push({ m, kind, p: m.position.clone(), h0: 1.1, h1: 0.001 });
}
const PW = 10, PD = 8;
const avoid = [];  // no fields on the village, plaza or pond
const blocked = (x, z, w, d) => avoid.some(([a, b, c, e]) => x < c && x + w > a && z < e && z + d > b);
avoid.push([5, -22, 76, 27], [18, 5, 66, 30]);
for (let gx = -130; gx < 130; gx += PW + 0.7) for (let gz = -120; gz < 120; gz += PD + 0.7) {
  const cx = gx + PW / 2, cz = gz + PD / 2;
  if (Math.abs(cx - xr(cz)) < RW + 9 || Math.abs(gx + PW - xr(gz + PD) - 0) < 0) continue;
  if (Math.abs(gx - xr(gz)) < RW + 9 || Math.abs(gx + PW - xr(gz)) < RW + 9 || Math.abs(gx - xr(gz + PD)) < RW + 9 || Math.abs(gx + PW - xr(gz + PD)) < RW + 9) continue;
  if (blocked(gx, gz, PW, PD)) continue;
  const near = Math.hypot(cx - 14, cz - 4) < 58;
  const rape = Math.sin(gx * 0.045 + 1.3) + Math.cos(gz * 0.07) > 0.25;
  plot(gx, gz, PW, PD, rape ? 'rape' : 'sprout', near);
}

// ---------- Trees ----------
const TREES = [], BLOOMS = [];
function tree(x, z, kind, cs, s = 1) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s); W.add(g);
  const th = kind === 'column' ? 1.5 : 2.1;
  mesh(new THREE.CylinderGeometry(0.16, 0.32, th, 8).translate(0, th / 2, 0), MAT.trunk, 0, 0, 0, g);
  const br = mesh(new THREE.CylinderGeometry(0.06, 0.1, 1.0, 6).translate(0, 0.5, 0), MAT.trunk, 0.05, th * 0.55, 0, g); br.rotation.z = -0.75;
  const c = new THREE.Group(); c.position.y = th; g.add(c);
  const lobes = [];
  const L = (geo, mat, px, py, pz) => { const m = mesh(geo, mat, px, py, pz, c); lobes.push(m); return m; };
  if (kind === 'cloud') {
    for (const [dx, dy, dz, r] of [[0, 1.7, 0, 1.45], [1.15, 1.05, 0.35, 1.1], [-1.05, 1.15, -0.3, 1.15], [0.25, 2.5, -0.35, 1.0], [-0.4, 1.0, 0.95, 0.95], [0.6, 1.2, -1.0, 0.9]]) L(new THREE.SphereGeometry(r, 18, 12), cs.main, dx, dy, dz);
    for (const [dx, dy, dz, r] of [[-0.75, 2.35, 0.6, 0.62], [-1.45, 1.6, 0.5, 0.5]]) L(new THREE.SphereGeometry(r, 14, 10), cs.hi, dx, dy, dz);
  }
  if (kind === 'round') { L(new THREE.SphereGeometry(1.85, 22, 14).scale(1, 0.92, 1), cs.main, 0, 1.5, 0); L(new THREE.SphereGeometry(0.85, 14, 10), cs.hi, -0.85, 2.3, 0.78); L(new THREE.SphereGeometry(0.52, 12, 8), cs.hi, -1.48, 1.55, 0.6); }
  if (kind === 'egg') { L(new THREE.SphereGeometry(1.45, 18, 12).scale(0.85, 1.35, 0.85), cs.main, 0, 1.8, 0); L(new THREE.SphereGeometry(0.6, 14, 10).scale(0.85, 1.25, 0.85), cs.hi, -0.55, 2.5, 0.5); }
  if (kind === 'cone') { for (const [r, h, y] of [[1.9, 2.0, 0.9], [1.5, 1.8, 2.0], [1.05, 1.6, 3.0]]) L(new THREE.ConeGeometry(r, h, 18), cs.main, 0, y, 0); L(new THREE.SphereGeometry(0.3, 10, 8), cs.hi, 0, 3.85, 0); }
  if (kind === 'column') { L(new THREE.CapsuleGeometry(0.9, 2.6, 6, 14), cs.main, 0, 2.0, 0); L(new THREE.CapsuleGeometry(0.38, 1.3, 6, 10), cs.hi, -0.55, 2.6, 0.45); }
  if (cs.bloom) for (let i = 0; i < 16; i++) {
    const lb = lobes[i % lobes.length], r = lb.geometry.parameters.radius || 1.2, u = R() * 6.28, v = R() * 1.3 - 0.15;
    const q = V3(Math.cos(u) * Math.cos(v), Math.sin(v), Math.sin(u) * Math.cos(v)).multiplyScalar(r * 0.97).add(lb.position);
    const b = mesh(new THREE.SphereGeometry(0.17, 8, 6), M(cs.bloom[i % 2]), q.x, q.y, q.z, c); b.castShadow = false; BLOOMS.push({ m: b, p: V3(x, 0, z) });
  }
  TREES.push({ g, c, lobes, p: g.position.clone(), crown: cs, ph: R() * 6.28 }); return g;
}
// Riverbank: alternating pink and white blossom trees
for (let z = -110; z < 110; z += 9.5) for (const side of [-1, 1]) {
  if (Math.abs(z + 4) < 6) continue;
  const x = xr(z) + side * (RW + 3.4);
  if (side > 0 && x > 2 && z > -24 && z < 34) continue;
  const pink = (Math.round(z / 9.5) + (side > 0 ? 1 : 0)) % 2 === 0;
  tree(x, z, pink ? 'cloud' : 'round', pink ? CROWN.pink : CROWN.white, rr(0.85, 1.05));
}

// ---------- Village: a lane + two rows of houses + ginkgos ----------
const LZ = -4;  // lane
mesh(box(70, 0.14, 4.2), MAT.lane, 3 + 35, 0, LZ, W).castShadow = false;
const WALLS = ['#FFEFA8', '#FFB8D9', '#5EDFB0', '#B9A0FF', '#FF9C6B', '#FFFFFF', '#5CC8FF'];
const ROOFS = [['#FF5A5F', '#FFE0DF'], ['#2F5BFF', '#FFFFFF'], ['#14B8A0', '#B8F0DC'], ['#FFD234', '#F39C12'], ['#4A4468', '#8D86C0']];
const CHIMNEYS = [], WINS = [], DOORLAMPS = [];
function house(x, z, face, w, d, i) {
  const g = new THREE.Group(); g.position.set(x, 0, z); W.add(g);
  const wc = WALLS[i % WALLS.length], two = i % 3 === 1, h = two ? 6.4 : 4.0, B = 0.45, F = face * (d / 2);
  mesh(box(w + 0.5, B, d + 0.5), M('#DCD4EE', { pat: 1, patCol: '#C9C0E3', patScale: 0.32 }), 0, 0, 0, g);                 // plinth
  mesh(box(w, h, d), M(wc, { pat: 6, patCol: lt(wc, -0.07), patScale: 0.5 }), 0, B, 0, g);                                  // walls (horizontal boards)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) mesh(box(0.24, h, 0.24), M('#FFFFFF'), sx * (w / 2 - 0.04), B, sz * (d / 2 - 0.04), g);
  // roof: two slopes + ridge + gables
  const [rc, rp] = ROOFS[(i * 3 + 1) % ROOFS.length], run = d / 2 + 0.7, rise = 2.5, Ls = Math.hypot(run, rise), th = Math.atan2(rise, run);
  const roofM = S([rc, rc, rc, '#FFFFFF'], { pat: 6, patCols: [rp, rp, rp, '#E3EAFA'], patScale: 0.55 });
  for (const sd of [-1, 1]) { const sl = mesh(new THREE.BoxGeometry(w + 1.1, 0.3, Ls), roofM, 0, B + h + rise / 2 + 0.05, sd * run / 2, g); sl.rotation.x = sd * th; }
  mesh(new THREE.CylinderGeometry(0.2, 0.2, w + 1.25, 10).rotateZ(Math.PI / 2), M(lt(rc, -0.15)), 0, B + h + rise + 0.12, 0, g);
  const gs = new THREE.Shape(); gs.moveTo(-d / 2, 0); gs.lineTo(d / 2, 0); gs.lineTo(0, rise - 0.15); gs.closePath();
  mesh(new THREE.ExtrudeGeometry(gs, { depth: w - 0.02, bevelEnabled: false }).translate(0, 0, -(w - 0.02) / 2).rotateY(Math.PI / 2), M(wc), 0, B + h, 0, g);
  WINS.push({ m: mesh(new THREE.CircleGeometry(0.42, 18).rotateY(Math.PI / 2), flat('#BFE4FF', { lit: true }), w / 2 + 0.01, B + h + 0.8, 0, g).material, T: 35.4 + rr2(0, 3.0) });   // round gable window
  // windows: white frame + glass + coloured shutters + flower box
  const shut = ['#2F5BFF', '#FF5A5F', '#14B8A0', '#FFD234', '#FF7EB3'][i % 5];
  const floors = two ? [B + 1.55, B + 4.1] : [B + 1.55];
  for (const fy of floors) for (const sx of [-w / 4 - 0.15, w / 4 + 0.15]) {
    mesh(box(1.25, 1.3, 0.1), M('#FFFFFF'), sx, fy - 0.08, F + face * 0.03, g);
    WINS.push({ m: mesh(box(0.98, 1.05, 0.14), flat('#BFE4FF', { lit: true }), sx, fy + 0.04, F + face * 0.05, g).material, T: 34.9 + rr2(0, 3.4) });
    mesh(box(0.07, 1.05, 0.16), M('#FFFFFF'), sx, fy + 0.04, F + face * 0.06, g);
    for (const ss of [-1, 1]) mesh(box(0.38, 1.15, 0.08), M(shut, { pat: 6, patCol: lt(shut, -0.2), patScale: 0.18 }), sx + ss * 0.85, fy - 0.03, F + face * 0.04, g);
    if (fy < B + 2) {
      mesh(box(1.35, 0.32, 0.45), M('#FFFFFF'), sx, fy - 0.42, F + face * 0.24, g);
      [-0.42, -0.14, 0.14, 0.42].forEach((k, j) => mesh(new THREE.SphereGeometry(0.17, 8, 6), M(['#FF5A5F', '#FFD234', '#FF7EB3', '#7FB2FF'][(i + j) % 4]), sx + k, fy - 0.05, F + face * 0.28, g));
    }
  }
  // door: frame + step + awning + lamp + two pots of flowers
  const dc = ['#2F5BFF', '#FF5A5F', '#14B8A0'][i % 3];
  mesh(box(1.25, 2.15, 0.1), M('#FFFFFF'), 0, B, F + face * 0.03, g);
  mesh(box(0.95, 1.95, 0.16), M(dc, { pat: 6, patCol: lt(dc, -0.18), patScale: 0.3 }), 0, B, F + face * 0.05, g);
  mesh(new THREE.SphereGeometry(0.07, 8, 6), M('#FFD234'), 0.3, B + 1.0, F + face * 0.15, g);
  mesh(box(1.6, 0.18, 0.7), M('#DCD4EE'), 0, 0, F + face * 0.5, g);
  const aw = mesh(box(1.7, 0.1, 0.8), M(['#FF5A5F', '#2F5BFF', '#FFD234'][(i + 1) % 3], { pat: 4, patCol: '#FFFFFF', patScale: 0.28 }), 0, B + 2.3, F + face * 0.42, g); aw.rotation.x = face * 0.3;
  DOORLAMPS.push({ m: mesh(new THREE.SphereGeometry(0.16, 10, 8), flat('#FFE38A', { lit: true }), 0.85, B + 2.0, F + face * 0.12, g).material, p: V3(x + 0.85, B + 2.0, z + F + face * 2.3), T: 34.6 + rr2(0, 3.0) });
  for (const sx of [-1.0, 1.0]) { mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.38, 10), M('#FF9C6B'), sx, B, F + face * 0.55, g).geometry.translate(0, 0.19, 0); mesh(new THREE.SphereGeometry(0.32, 10, 8), M('#3CBE7E', { pat: 1, patCol: '#FF7EB3', patScale: 0.18 }), sx, B + 0.62, F + face * 0.55, g); }
  if (two) {  // first-floor balcony
    mesh(box(2.4, 0.16, 0.9), M('#FFFFFF'), 0, B + 3.0, F + face * 0.45, g);
    for (let k = -1.1; k <= 1.11; k += 0.37) mesh(box(0.07, 0.6, 0.07), M('#FFFFFF'), k, B + 3.16, F + face * 0.85, g);
    mesh(box(2.4, 0.08, 0.08), M('#FFFFFF'), 0, B + 3.76, F + face * 0.85, g);
  }
  const ch = mesh(box(0.7, 1.7, 0.7), M('#FF7EB3', { pat: 6, patCol: '#E8679C', patScale: 0.3 }), w / 2 - 1.1, B + h + 1.0, -face * 0.7, g); CHIMNEYS.push(ch);
  mesh(box(0.9, 0.16, 0.9), M('#4A4468'), w / 2 - 1.1, B + h + 2.7, -face * 0.7, g);
  return g;
}
let hi = 0;
for (const x of [12, 21.5, 31, 40.5, 50, 59.5, 69]) house(x, LZ - 7.5, 1, rr(7, 8.4), 6, hi++);
for (const x of [12, 21.5, 69]) house(x, LZ + 7.5, -1, rr(7, 8.4), 6, hi++);
for (let x = 7; x < 74; x += 9.5) { tree(x + 4.7, LZ - 3.2, 'egg', CROWN.ginkgo, 0.75); }
// Plaza + big tree
const PLAZA = V3(31, 0, 15);
mesh(new THREE.CylinderGeometry(8, 8, 0.14, 40), MAT.lane, PLAZA.x, 0.07, PLAZA.z, W).castShadow = false;
const bigTree = new THREE.Group(); bigTree.position.copy(PLAZA); W.add(bigTree);
mesh(new THREE.CylinderGeometry(0.6, 0.9, 5, 10).translate(0, 2.5, 0), MAT.trunk, 0, 0, 0, bigTree);
const bigC = new THREE.Group(); bigTree.add(bigC);
for (const [dx, dy, dz, r] of [[0, 7.2, 0, 3.6], [2.6, 6.0, 0.8, 2.6], [-2.5, 6.2, -0.6, 2.8], [0.6, 6.0, 2.6, 2.4], [-0.4, 9.2, -0.5, 2.4], [1.8, 8.2, -1.6, 2.0]]) mesh(new THREE.SphereGeometry(r, 22, 16), CROWN.big.main, dx, dy, dz, bigC);
for (const [dx, dy, dz, r] of [[-1.6, 9.0, 1.3, 1.4], [-2.9, 7.4, 1.4, 1.1], [-0.6, 10.6, 0.4, 0.9]]) mesh(new THREE.SphereGeometry(r, 16, 12), CROWN.big.hi, dx, dy, dz, bigC);
for (let i = 0; i < 40; i++) { const u = R() * 6.28, v = R() * 1.3 - 0.2, r = 3.5; const b = mesh(new THREE.SphereGeometry(0.22, 8, 6), M(CROWN.big.bloom[i % 2]), Math.cos(u) * Math.cos(v) * r * 1.05, 7.0 + Math.sin(v) * r, Math.sin(u) * Math.cos(v) * r, bigC); b.castShadow = false; BLOOMS.push({ m: b, p: PLAZA.clone() }); }
TREES.push({ g: bigTree, c: bigC, p: PLAZA.clone(), crown: CROWN.big, ph: 0, big: true });
for (const [x, z] of [[24, 9], [38, 9], [25, 21], [37, 21]]) mesh(box(1.6, 0.5, 0.6), M('#2F5BFF'), x, 0.14, z, W);   // benches
// Pond
const POND = V3(54, 0, 18), PR = 7.5;
mesh(new THREE.CylinderGeometry(PR + 0.9, PR + 0.9, 0.16, 48), MAT.bank, POND.x, 0, POND.z, W).castShadow = false;
mesh(new THREE.CylinderGeometry(PR, PR, 0.2, 48), MAT.water, POND.x, 0, POND.z, W).castShadow = false;
mesh(new THREE.CylinderGeometry(PR * 0.55, PR * 0.55, 0.22, 40), MAT.deep, POND.x + 0.6, 0, POND.z - 0.4, W).castShadow = false;
{ const f = new THREE.Mesh(new THREE.RingGeometry(PR - 0.42, PR - 0.16, 64).rotateX(-Math.PI / 2), foamMat); f.position.set(POND.x, 0.115, POND.z); f.userData.noOutline = true; W.add(f); }
const PADS = [], LOTUS = [];
const padMat = S(['#7DDC8C', '#2FB57A', '#C9B04A', '#E3EAFA'], { pat: 1, patCols: ['#5FC874', '#1F9C64', '#A88E35', '#FFFFFF'], patScale: 0.4 });
for (let i = 0; i < 16; i++) {
  const a = rr(0, 6.28), r = Math.sqrt(R()) * (PR - 1.4), x = POND.x + Math.cos(a) * r, z = POND.z + Math.sin(a) * r;
  const pad = mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.06, 20, 1, false, 0.4, 5.6), padMat, x, 0.22, z, W); pad.rotation.y = rr(0, 6.28); pad.castShadow = false;
  PADS.push({ m: pad, p: pad.position.clone(), s0: rr(0.45, 0.6) });
  if (i % 2 === 0) {
    const f = new THREE.Group(); f.position.set(x + 0.2, 0.3, z); f.userData.s = 1.7; W.add(f);
    for (let k = 0; k < 6; k++) { const pt = mesh(new THREE.SphereGeometry(0.42, 12, 8).scale(0.55, 1, 0.35).translate(0, 0.38, 0), M('#FF8DB5', { lit: true }), 0, 0, 0, f); pt.rotation.set(0.5, k * Math.PI / 3, 0, 'YXZ'); }
    mesh(new THREE.CylinderGeometry(0.2, 0.14, 0.2, 12), M('#FFD234', { lit: true }), 0, 0.3, 0, f);
    LOTUS.push({ g: f, p: f.position.clone(), d: i * 0.07 });
  }
}
// Bridge: three spans, arched in the middle
const BZ = LZ, BX = xr(BZ);
const stone = M('#FFF4DD', { pat: 1, patCol: '#F2DFC2', patScale: 0.6 });
for (const [dx, len, rot, y] of [[-6.4, 5.4, 0.16, 0.0], [0, 7.6, 0, 0.86], [6.4, 5.4, -0.16, 0.0]]) {
  const b = mesh(box(len, 0.5, 3.6), stone, BX + dx, y, BZ, W); b.rotation.z = rot; if (rot) b.position.y = 0.43;
}
for (const s of [-1, 1]) for (const [dx, len, rot, y] of [[-6.4, 5.4, 0.16, 0.43], [0, 7.6, 0, 0.86], [6.4, 5.4, -0.16, 0.43]]) { const b = mesh(box(len, 0.14, 0.18), M('#FF5A5F'), BX + dx, y + 1.18, BZ + s * 1.65, W); b.rotation.z = rot; }
for (const s of [-1, 1]) for (let dx = -8; dx <= 8; dx += 2) {
  const y = Math.abs(dx) < 4 ? 1.36 : 1.36 - (Math.abs(dx) - 4) * 0.16 - 0.1;
  mesh(box(0.28, 0.75, 0.28), M('#FF5A5F'), BX + dx, y, BZ + s * 1.65, W);
}
// Path: lane → plaza → pond, flower clumps along the way
const BUSHES = [];
{
  const pts = [[24, -2], [27, 8], [38, 18], [46, 19], [50, 26], [44, 36], [30, 42], [14, 44]];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1], len = Math.hypot(x1 - x0, z1 - z0);
    const m = mesh(box(len + 2.0, 0.1, 2.0), MAT.lane, (x0 + x1) / 2, 0.02, (z0 + z1) / 2, W); m.rotation.y = -Math.atan2(z1 - z0, x1 - x0); m.castShadow = false;
  }
  const bushA = S(['#FF9EC8', '#3CBE7E', '#FF9C6B', '#FFFFFF'], { pat: 1, patCols: ['#FFFFFF', '#7FB2FF', '#FFD234', '#E3EAFA'], patScale: 0.5 });
  const bushB = S(['#FFE066', '#2FCB7A', '#E85A2A', '#FFFFFF'], { pat: 1, patCols: ['#FF7EB3', '#FF8DB5', '#FFD234', '#E3EAFA'], patScale: 0.5 });
  for (const [x, z, s, b] of [[18, 36, 1.2, 0], [22, 39, 0.9, 1], [36, 34, 1.1, 1], [40, 40, 1.3, 0], [8, 40, 1.0, 0], [52, 34, 1.0, 1], [30, 48, 1.2, 1], [44, 47, 0.9, 0], [12, 30, 0.9, 1], [60, 30, 1.1, 0]]) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s); W.add(g);
    for (const [dx, dz, r] of [[0, 0, 1.1], [1.0, 0.3, 0.8], [-0.9, 0.2, 0.85], [0.2, -0.8, 0.75]]) mesh(new THREE.SphereGeometry(r, 14, 10).scale(1, 0.75, 1), b ? bushB : bushA, dx, r * 0.6, dz, g);
    BUSHES.push({ g, p: g.position.clone(), ph: R() * 6 });
  }
  tree(4, 34, 'round', CROWN.teal, 1.1); tree(58, 42, 'cone', CROWN.teal, 1.0); tree(26, 52, 'egg', CROWN.ginkgo, 1.0);
}
// Ice-shop parasols on the plaza (open only in summer)
const UMB = [];
for (const [x, z, col] of [[26, 12, '#FF5A5F'], [36, 13, '#2F5BFF'], [32, 20, '#FFD234']]) {
  const g = new THREE.Group(); g.position.set(x, 0.14, z); W.add(g);
  mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 8).translate(0, 1.3, 0), M(INK), 0, 0, 0, g);
  mesh(new THREE.ConeGeometry(1.7, 0.7, 10).translate(0, 2.75, 0), M(col, { pat: 4, patCol: '#FFFFFF', patScale: 0.5 }), 0, 0, 0, g);
  mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.08, 16), M('#FFFFFF'), 0, 0.9, 0, g);
  UMB.push({ g, p: g.position.clone() });
}

// ---------- Small moving things ----------
// Boats: drift slowly downstream
const boat = new THREE.Group(); W.add(boat);
mesh(new THREE.CylinderGeometry(0.9, 0.6, 4.2, 12, 1).rotateZ(Math.PI / 2).scale(1, 0.45, 0.75), M('#FF9C6B'), 0, 0.35, 0, boat);
mesh(new THREE.ConeGeometry(0.9, 0.5, 12, 1, true).rotateX(Math.PI).translate(0, 1.6, 0).scale(1.3, 1, 1), M('#FFD234', { pat: 4, patCol: '#FFFFFF', patScale: 0.4 }), 0.6, 0, 0, boat);
const boatman = person(boat, { col: '#2F5BFF', hat: '#FFD234' }); boatman.g.position.set(-0.9, 0.3, 0); boatman.g.scale.setScalar(0.8);
// Ducks: circle the pond
const DUCKS = [0, 1, 2].map((i) => {
  const g = new THREE.Group(); W.add(g); g.scale.setScalar(0.9 - i * 0.18);
  mesh(new THREE.SphereGeometry(0.55, 14, 10).scale(1.3, 0.8, 0.9), M('#FFFFFF'), 0, 0.42, 0, g);
  mesh(new THREE.SphereGeometry(0.3, 12, 8), M('#FFFFFF'), 0.62, 0.92, 0, g);
  mesh(new THREE.ConeGeometry(0.12, 0.34, 8).rotateZ(-Math.PI / 2), M('#FF9C6B'), 0.98, 0.9, 0, g);
  return g;
});
// People strolling in the lane (background detail)
const WALKERS = [
  person(W, { col: '#FF5A5F' }), person(W, { col: '#14B8A0' }), person(W, { col: '#B9A0FF', hat: '#FFD234' }),
];
// Kite flying (spring): people on the field ridge + two kites
const flyer = person(W, { col: '#FF7EB3', hat: '#2F5BFF' }); flyer.g.position.set(-32, 0.12, 6.35); flyer.g.rotation.y = 0.8;
const KITES = [[-40, 22, -10, '#FF5A5F', '#FFD234'], [-58, 26, 18, '#2F5BFF', '#FF7EB3']].map(([x, y, z, c1, c2], i) => {
  const g = new THREE.Group(); W.add(g);
  const k = mesh(new THREE.OctahedronGeometry(1.6, 0).scale(1, 1.35, 0.12), M(c1, { pat: 4, patCol: c2, patScale: 0.8, lit: true }), 0, 0, 0, g);
  const tail = [0, 1, 2, 3].map((j) => mesh(box(0.5, 0.25, 0.08), M(c2, { lit: true }), 0, -2.6 - j * 0.9, 0, g));
  const line = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 4), new THREE.MeshBasicMaterial({ color: INK })); line.userData.noOutline = true; W.add(line);
  return { g, k, tail, line, base: V3(x, y, z), ph: i * 2.1, hand: i === 0 ? null : V3(-60, 1.3, 26) };
});
const flyer2 = person(W, { col: '#FFD234', hat: '#FF5A5F' }); flyer2.g.position.set(-60, 0.12, 27.6);
// Swallows
const SWALLOWS = [0, 1, 2, 3, 4].map((i) => {
  const g = new THREE.Group(); W.add(g); const wm = M(INK);
  const wl = mesh(box(0.15, 0.06, 1.1).translate(0, 0, 0.55), wm, 0, 0, 0, g), wr = mesh(box(0.15, 0.06, 1.1).translate(0, 0, -0.55), wm, 0, 0, 0, g);
  mesh(new THREE.ConeGeometry(0.2, 0.9, 6).rotateZ(-Math.PI / 2), wm, 0, 0, 0, g);
  return { g, wl, wr, r: rr(18, 34), h: rr(10, 16), w: rr(0.35, 0.55) * (i % 2 ? 1 : -1), ph: rr(0, 6.28), c: V3(rr(-30, 30), 0, rr(-10, 25)) };
});
// Petals
const pinkTrees = TREES.filter((t) => t.crown === CROWN.pink || t.crown === CROWN.white || t.big);
const petalMat = [new THREE.MeshBasicMaterial({ color: '#FF9EC8', side: THREE.DoubleSide }), new THREE.MeshBasicMaterial({ color: '#FFFFFF', side: THREE.DoubleSide })];
const PETALS = Array.from({ length: 110 }, (_, i) => {
  const m = new THREE.Mesh(new THREE.CircleGeometry(0.32, 6).scale(1, 0.6, 1), petalMat[i % 2]); m.userData.noOutline = true; W.add(m);
  return { m, t: pinkTrees[i % pinkTrees.length], ph: R() * 4, sx: rr(-1, 1), sz: rr(-1, 1) };
});
// Reeds: clumps along the river and pond
const REEDS = [];
{
  const reedM = S(['#7ED957', '#2FA866', '#E0B04A', '#C9A27A']);
  const clump = (x, z) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); W.add(g);
    for (let k = 0; k < 6; k++) {
      const hh = rr(1.0, 1.9), st = mesh(new THREE.CylinderGeometry(0.07, 0.11, hh, 6).translate(0, hh / 2, 0), reedM, rr(-0.5, 0.5), 0, rr(-0.5, 0.5), g);
      st.rotation.set(rr(-0.2, 0.2), 0, rr(-0.25, 0.25)); st.castShadow = false; st.userData.noOutline = true;
      if (k < 2) mesh(new THREE.CapsuleGeometry(0.13, 0.4, 4, 8), M('#C98A5E'), 0, hh - 0.05, 0, st);
    }
    REEDS.push({ g, ph: R() * 6.28 });
  };
  for (let z = -100; z < 100; z += rr(4.5, 8)) for (const sd of [-1, 1]) { if (R() < 0.45 || Math.abs(z + 4) < 7) continue; clump(xr(z) + sd * (RW + 0.25), z); }
  for (let k = 0; k < 7; k++) { const a = k / 7 * 6.28 + 0.3; if (k % 3 === 1) continue; clump(POND.x + Math.cos(a) * (PR + 0.2), POND.z + Math.sin(a) * (PR + 0.2)); }
}
// Ripples: little white Memphis squiggles, drifting downstream
const squigGeo = (() => { const pts = []; for (let i = 0; i <= 8; i++) pts.push(V3((i - 4) * 0.24, 0, Math.sin(i * 1.5) * 0.13)); return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 28, 0.06, 5); })();
const GLINTS = Array.from({ length: 70 }, () => {
  const m = new THREE.Mesh(squigGeo, foamMat); m.userData.noOutline = true; W.add(m);
  return { m, z0: rr(-110, 110), off: rr(-0.75, 0.75), ph: R(), sp: rr(2.0, 3.0) };
});
const PGL = Array.from({ length: 9 }, (_, i) => { const m = new THREE.Mesh(squigGeo, foamMat); m.userData.noOutline = true; W.add(m); return { m, a: i / 9 * 6.28, r: rr(1.5, PR - 1.5), ph: R() }; });
// Summer shower: a grey-violet cloud drifts west to east, trailing rain, rings on the water
const rainCloud = new THREE.Group(); W.add(rainCloud);
for (const [dx, dy, dz, r] of [[0, 0, 0, 7], [6, -1, 2, 5.5], [-6, -1.2, -1, 5.5], [2, 3, -2, 5], [-3, 2, 3, 4.5]]) { const c = mesh(new THREE.SphereGeometry(r, 18, 12).scale(1, 0.62, 0.9), M('#E4DEF6', { lit: true, shadow: false }), dx, dy, dz, rainCloud); c.castShadow = true; c.receiveShadow = false; }
const rainMat = new THREE.MeshBasicMaterial({ color: '#6E9BEA', transparent: true, opacity: 0.85 });
const DROPS = Array.from({ length: 300 }, () => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.6, 0.14), rainMat); m.userData.noOutline = true; W.add(m); return { m, dx: rr(-13, 13), dz: rr(-9, 9), ph: R() }; });
const ringMat = new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, depthWrite: false });
const RINGS = Array.from({ length: 160 }, () => { const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 24).rotateX(-Math.PI / 2), ringMat.clone()); m.userData.noOutline = true; W.add(m); return { m, dx: rr(-13, 13), dz: rr(-9, 9), ph: R() }; });
// White clouds (drift high, cast shadows)
const CLOUDS = [[-60, 46, -40, 1.0], [40, 52, -70, 1.3], [90, 48, 40, 1.1]].map(([x, y, z, s]) => {
  const g = new THREE.Group(); g.position.set(x, y, z); g.scale.setScalar(s * 4); W.add(g);
  for (const [dx, dy, dz, r] of [[0, 0, 0, 1.4], [1.3, -0.2, 0.2, 1.1], [-1.3, -0.25, 0, 1.0], [0.5, 0.6, -0.2, 0.9]]) { const m = mesh(new THREE.SphereGeometry(r, 18, 12).scale(1, 0.7, 1), M('#FFFFFF', { lit: true, shadow: false }), dx, dy, dz, g); m.receiveShadow = false; }
  return { g, x0: x };
});

// ---------- Autumn- and winter-only things ----------
// Haystacks: pop up after the autumn harvest, snow-capped in winter
const HAY = [];
{
  const body = M('#FFC23A', { pat: 6, patCol: '#F39C12', patScale: 0.32 });
  const cap = S(['#FFD86B', '#FFD86B', '#FFD86B', '#FFFFFF'], { pat: 6, patCols: ['#F3B51A', '#F3B51A', '#F3B51A', '#DCE6FA'], patScale: 0.32 });
  for (const [px, pz] of HAYSPOTS) {
    const g = new THREE.Group(); g.position.set(px, 0.18, pz); g.rotation.y = rr2(0, 6.28); W.add(g);
    mesh(new THREE.CylinderGeometry(0.95, 1.1, 1.2, 14), body, 0, 0.6, 0, g);
    mesh(new THREE.ConeGeometry(1.25, 1.4, 14), cap, 0, 1.9, 0, g);
    HAY.push({ g, T: 22.0 + rr2(0, 5.5) });
  }
}
// Falling leaves: drift from every tree in autumn
const leafMat = ['#FF7A45', '#FFD21F', '#FF5A5F', '#FFB020'].map((c) => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
const LEAVES = Array.from({ length: 160 }, (_, i) => {
  const m = new THREE.Mesh(new THREE.CircleGeometry(0.4, 4).scale(0.7, 1, 1), leafMat[i % 4]); m.userData.noOutline = true; W.add(m);
  return { m, t: TREES[(i * 7) % TREES.length], ph: R2() * 4, sx: rr2(-1, 1), sz: rr2(-1, 1) };
});
// Geese: V formation flying south-west
const GEESE = Array.from({ length: 9 }, (_, i) => {
  const g = new THREE.Group(); W.add(g); const m = M(INK);
  const wl = mesh(box(0.22, 0.07, 1.5).translate(0, 0, 0.75), m, 0, 0, 0, g), wr = mesh(box(0.22, 0.07, 1.5).translate(0, 0, -0.75), m, 0, 0, 0, g);
  mesh(new THREE.SphereGeometry(0.3, 10, 6).scale(2.2, 0.8, 0.8), m, 0, 0, 0, g);
  mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.9, 6).rotateZ(Math.PI / 2), m, -0.95, 0.1, 0, g);
  const row = Math.ceil(i / 2), side = i === 0 ? 0 : (i % 2 ? 1 : -1);
  return { g, wl, wr, off: V3(row * 2.6, 0, side * row * 2.1), ph: i * 0.7 };
});
// Snow
const flakeGeo = new THREE.IcosahedronGeometry(0.27, 0), snowMat = new THREE.MeshBasicMaterial({ color: '#FFFFFF' });
const SNOW = Array.from({ length: 1000 }, () => { const m = new THREE.Mesh(flakeGeo, snowMat); m.userData.noOutline = true; W.add(m); return { m, x: rr2(-60, 115), z: rr2(-55, 80), ph: R2(), sp: rr2(0.8, 1.2) }; });
// Chimney smoke (winter)
W.updateMatrixWorld(true);
const SMOKE = CHIMNEYS.flatMap((ch, ci) => {
  const p = ch.getWorldPosition(V3(0, 0, 0));
  return [0, 1, 2, 3].map((k) => { const m = mesh(new THREE.SphereGeometry(0.55, 12, 8), M('#FFFFFF', { lit: true, shadow: false }), p.x, p.y, p.z, W); m.castShadow = false; return { m, p: V3(p.x, p.y + 2.9, p.z), ph: k / 4 + ci * 0.37 }; });
});
// Snowman on the plaza
const snowman = new THREE.Group(); snowman.position.set(26.0, 0.14, 18.4); snowman.rotation.y = 0.8; W.add(snowman);
mesh(new THREE.SphereGeometry(1.0, 18, 12), M('#FFFFFF'), 0, 0.9, 0, snowman);
mesh(new THREE.SphereGeometry(0.68, 16, 10), M('#FFFFFF'), 0, 2.2, 0, snowman);
mesh(new THREE.ConeGeometry(0.12, 0.6, 8).rotateX(Math.PI / 2), M('#FF9C6B'), 0, 2.2, 0.9, snowman);
for (const ex of [-0.24, 0.24]) mesh(new THREE.SphereGeometry(0.08, 8, 6), M(INK), ex, 2.42, 0.6, snowman);
mesh(new THREE.TorusGeometry(0.52, 0.15, 8, 20).rotateX(Math.PI / 2), M('#FF5A5F', { pat: 6, patCol: '#FFFFFF', patScale: 0.2 }), 0, 1.66, 0, snowman);
mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.08, 16), M('#2F5BFF'), 0, 2.78, 0, snowman);
mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.62, 16), M('#2F5BFF', { pat: 6, patCol: '#FFD234', patScale: 0.25 }), 0, 3.1, 0, snowman);

// ---------- Timeline ----------
const DUR = 45;
const WAVES = [
  { t0: 9.3, t1: 11.9, c: [PLAZA.x, PLAZA.z] },  // spring → summer: sweeps out from the big tree
  { t0: 19.3, t1: 21.9, c: [PLAZA.x, PLAZA.z] }, // summer → autumn
  { t0: 29.3, t1: 31.9, c: [PLAZA.x, PLAZA.z] }, // autumn → winter: each time the tree squats and the wave sweeps out from it
];
const WAVE_MAX = 240;
function seasonState(t) {
  let i = 0; while (i < WAVES.length && t >= WAVES[i].t1) i++;
  const w = WAVES[i];
  const r = w && t > w.t0 ? WAVE_MAX * io(seg(t, w.t0, w.t1)) : -1;
  return { i, r, c: w ? w.c : [0, 0] };
}
// progress (0 → 1) after the season wave passes a point; drives growing, blooming, opening parasols
const passed = (st, p, len = 1) => { if (st.r < 0) return 0; const d = Math.hypot(p.x - st.c[0], p.z - st.c[1]); return c01((st.r - d) / (16 * len)); };
const CENTER = V3(22, 0, 9);
function camAt(t) {
  // first 18 s match the spring/summer cut; then the camera eases to 0.3x, same framing through autumn/winter
  const te = t < 18 ? t : t < 22 ? t - 0.7 * (t - 18) ** 2 / 8 : 20.6 + 0.3 * (t - 22);
  const a = 0.1 + 0.02 * te, Rr = 92 - 0.4 * te, H = 70 - 0.3 * te;
  return { pos: V3(CENTER.x + Math.sin(a) * Rr, H, CENTER.z + Math.cos(a) * Rr), look: CENTER.clone().add(V3(0, 0, 0)), fov: 30 };
}
const TEXT = [
  ['春 · 油菜花开了，水田灌满了   Spring · rapeseed in bloom, paddies filling up', '春分 Spring Equinox · 03.20     柚子城 · 河湾   Pomelo Town · River Bend'],
  ['夏 · 一阵雨过去，荷花开了   Summer · a passing shower, lotus in bloom', '小暑 Minor Heat · 07.07     柚子城 · 河湾   Pomelo Town · River Bend'],
  ['秋 · 稻子黄了，大雁往南飞   Autumn · golden rice, geese flying south', '秋分 Autumn Equinox · 09.22     柚子城 · 河湾   Pomelo Town · River Bend'],
  ['冬 · 下雪了，窗户一盏盏亮起来   Winter · first snow, windows lighting up', '大雪 Major Snow · 12.07     柚子城 · 河湾   Pomelo Town · River Bend'],
  ['Eian × LemoLab × Claude Opus 5.5', '孟菲斯微缩景观 · MEMPHIS DIORAMA'],  // end card: same three lines, over the lit village; the sign-off is line 2, drawn strong
];
const TITLE = '柚子城的四季  Four Seasons in Pomelo Town';
const SWAPS = [10.45, 20.45, 30.45, 39.3];  // lines 2 and 3 change halfway through each wave, then once more for the end card

setNight(0); setDusk(0); setWave(1e5); setZone([0, 0, 0, 0], 1); setLamps([]); setHalftone(1);
dio.scene.background = new THREE.Color('#8FD6FF');

function place(t) {
  const st = seasonState(t), si = Math.min(st.i, 1);
  // materials: this season → next
  for (const m of SEASONAL) {
    const k = Math.min(st.i, m.userData.cols.length - 1), k2 = Math.min(k + 1, m.userData.cols.length - 1);
    m.uniforms.uCol.value.copy(m.userData.cols[k]); m.uniforms.uCol2.value.copy(m.userData.cols[k2]);
    if (m.userData.pats) { m.uniforms.uPatCol.value.copy(m.userData.pats[k]); m.uniforms.uPatCol2.value.copy(m.userData.pats[k2]); }
  }
  setSeason(st.c[0], st.c[1], st.r);
  const at = (n, p, len) => (st.i >= n ? 1 : st.i === n - 1 ? passed(st, p, len) : 0);
  const summer = (p, len) => at(1, p, len), autumn = (p, len) => at(2, p, len), winter = (p, len) => at(3, p, len);
  const popOf = (p) => [1, 2, 3].reduce((a, n) => a + Math.sin(Math.PI * c01(at(n, p) * 1.4)), 0);  // bounce as each wave passes
  // crops: tall rapeseed, short seedlings in spring; all grow into green rice once the wave passes (with a little overshoot)
  for (const r of ROWS) { const k = summer(r.p); r.m.visible = k < 0.99; r.m.scale.y = lerp(r.h0, r.h1, sm(k)) * (1 + 0.04 * Math.sin(t * 2.2 + r.p.x * 0.3)); }
  // trees: sway gently in the wind; bounce as the wave passes
  for (const tr of TREES) { const pop = tr.big ? 0 : popOf(tr.p) * 0.12; tr.c.rotation.z = (tr.big ? 0.012 : 0.03) * Math.sin(t * 1.3 + tr.ph); tr.c.rotation.x = 0.015 * Math.sin(t * 1.1 + tr.ph * 2); tr.c.scale.setScalar(1 + pop); }
  // the big tree squats (0.5 s) and springs back: the season changes
  {
    let sy = 1;
    for (const w of WAVES) {
      if (t > w.t0 - 0.5 && t < w.t0) sy = 1 - 0.2 * io(seg(t, w.t0 - 0.5, w.t0));
      else if (t >= w.t0 && t < w.t0 + 0.7) sy = lerp(0.8, 1, backOut(seg(t, w.t0, w.t0 + 0.6)));
    }
    bigTree.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
  }
  // lotus leaves grow, flowers open after the rain
  for (const p of PADS) { const w = sm(winter(p.p)); p.m.scale.setScalar(Math.max(lerp(p.s0, 1, backOut(summer(p.p))) * (1 - w), 0.001)); p.m.visible = w < 0.99; }
  for (const l of LOTUS) { const wilt = st.i >= 2 ? sm(seg(t, 22.4 + l.d * 3, 23.6 + l.d * 3)) : 0, k = (st.i >= 1 ? backOut(seg(t, 16.6 + l.d, 17.3 + l.d)) : 0) * (1 - wilt); l.g.scale.setScalar(Math.max(k, 0.001) * 1.7); l.g.visible = k > 0.01; l.g.rotation.y = 0.2 * Math.sin(t + l.d * 9); }
  for (const u of UMB) { const k = backOut(c01(summer(u.p) * 1.2 - 0.2)) * (1 - sm(c01(autumn(u.p) * 1.3))); u.g.scale.set(Math.max(k, 0.001), Math.max(k, 0.001), Math.max(k, 0.001)); u.g.visible = k > 0.01; }
  // boats
  { const z = -70 + 3.4 * t, x = xr(z) + 1.2, z2 = z + 0.5, h = Math.atan2(-(xr(z2) + 1.2 - x), z2 - z); boat.position.set(x, 0.12 + 0.05 * Math.sin(t * 2), z); boat.rotation.set(0.03 * Math.sin(t * 1.7), h - Math.PI / 2, 0); }
  boatman.body.rotation.z = 0.05 * Math.sin(t * 1.6);
  // ducks
  DUCKS.forEach((d, i) => { const a = 0.22 * t + i * 0.32, r = 4.6; d.position.set(POND.x + Math.cos(a) * r, 0.1 + 0.03 * Math.sin(t * 3 + i), POND.z + Math.sin(a) * r * 0.8); d.rotation.y = -a - Math.PI / 2 + Math.PI; d.rotation.z = 0.06 * Math.sin(t * 3 + i); });
  // strollers
  WALKERS.forEach((p, i) => { const s = ((i * 23 + (i === 1 ? -1 : 1) * 1.15 * t) % 66 + 66) % 66; walk(p, 8 + s, LZ + (i - 1) * 0.9, i === 1 ? Math.PI : 0, t * 2.8 + i); p.g.scale.setScalar(0.9); });
  // kites (spring only, reeled in when the summer wave arrives)
  for (const k of KITES) {
    const gone = summer(k.base, 1);
    const p = k.base.clone().add(V3(1.6 * Math.sin(t * 0.8 + k.ph), 1.2 * Math.sin(t * 1.1 + k.ph) + 30 * gone * gone, 0.8 * Math.cos(t * 0.7 + k.ph)));
    k.g.position.copy(p); k.g.rotation.set(0, 0.6, 0.25 * Math.sin(t * 1.3 + k.ph)); k.g.visible = gone < 0.98;
    k.tail.forEach((b, j) => { b.position.x = 0.35 * Math.sin(t * 3 + j * 0.9 + k.ph); b.rotation.z = 0.5 * Math.sin(t * 3 + j); });
    const hand = k.hand || flyer.g.position.clone().add(V3(0, 1.6, 0));
    limb(k.line, hand, p.clone().add(V3(0, -0.4, 0))); k.line.visible = k.g.visible;
  }
  flyer.arms[1].rotation.set(0, 0, -2.4 + 0.1 * Math.sin(t * 1.3)); flyer2.arms[0].rotation.set(0, 0, -2.3 + 0.1 * Math.sin(t * 1.1));
  // swallows
  for (const s of SWALLOWS) {
    const a = s.ph + s.w * t, p = s.c.clone().add(V3(Math.cos(a) * s.r, s.h + 2 * Math.sin(t * 0.9 + s.ph), Math.sin(a) * s.r * 0.7));
    const away = autumn(p); p.y += 30 * away * away; s.g.visible = away < 0.98;  // swallows leave when the autumn wave arrives
    s.g.position.copy(p); s.g.rotation.y = -a - Math.sign(s.w) * Math.PI / 2 * -1 + (s.w > 0 ? Math.PI : 0); s.g.rotation.x = 0.4 * Math.sign(s.w);
    const f = 0.7 * Math.sin(t * 14 + s.ph); s.wl.rotation.x = f; s.wr.rotation.x = -f;
  }
  // petals: fall from the blossom trees, blown east; stop once the summer wave passes
  for (const pe of PETALS) {
    const tp = pe.t.p, u = ((t * 0.28 + pe.ph / 4) % 1), age = u * 4;
    const born = Math.floor(t * 0.28 + pe.ph / 4) * 4;  // which cycle this petal was born in
    const top = pe.t.big ? 7 : 3.4;
    const pos = V3(tp.x + pe.sx * 2 + age * 2.2 + 0.6 * Math.sin(age * 2.5 + pe.ph), top - age * (top / 4) * 0.95 + 0.25, tp.z + pe.sz * 2 + 0.5 * Math.cos(age * 2 + pe.ph));
    pe.m.position.copy(pos); pe.m.rotation.set(age * 3 + pe.ph, age * 2, age * 1.3);
    pe.m.visible = summer(tp) < 0.02 && t < 9.3 + 2.6;
  }
  // water glints: drift downstream
  for (const g of GLINTS) {
    const u = (t * 0.35 + g.ph) % 1, z = ((g.z0 + g.sp * t + 110) % 220) - 110, x = xr(z) + g.off * RW;
    g.m.position.set(x, 0.13, z); g.m.rotation.y = Math.atan2(-(xr(z + 1) - xr(z)), 1) + Math.PI / 2; g.m.scale.setScalar(Math.max(Math.sin(Math.PI * u), 0.001) * 1.25);
  }
  for (const g of PGL) { const u = (t * 0.3 + g.ph) % 1, a = g.a + 0.05 * t; g.m.position.set(POND.x + Math.cos(a) * g.r, 0.13, POND.z + Math.sin(a) * g.r * 0.9); g.m.rotation.y = -a; g.m.scale.setScalar(Math.max(Math.sin(Math.PI * u), 0.001)); }
  for (const r of REEDS) r.g.rotation.set(0.05 * Math.sin(t * 1.5 + r.ph), 0, 0.07 * Math.sin(t * 1.9 + r.ph));
  for (const b of BLOOMS) { const k = summer(b.p); b.m.scale.setScalar(Math.max(1 - sm(k * 1.6), 0.001)); b.m.visible = k < 0.62; }
  // rain
  const cloudX = lerp(-100, 110, seg(t, 11.2, 19.2)), cloudZ = 26;
  rainCloud.position.set(cloudX, 17, cloudZ); rainCloud.visible = (st.i >= 1 || t > 11.2) && t < 19.4;
  const raining = st.i >= 1 && t > 12.2 && t < 17.8;
  for (const d of DROPS) {
    const u = (t * 1.6 + d.ph) % 1;
    d.m.position.set(cloudX + d.dx - u * 2.5, 14 - u * 14, cloudZ + d.dz); d.m.rotation.z = 0.11; d.m.visible = raining && d.m.position.y > 0.3;
  }
  for (const r of RINGS) {
    const u = (t * 1.1 + r.ph) % 1, x = cloudX + r.dx, z = cloudZ + r.dz;
    const onRiver = Math.abs(x - xr(z)) < RW - 0.4, onPond = Math.hypot(x - POND.x, z - POND.z) < PR - 0.6;
    r.m.position.set(x, 0.22, z); r.m.scale.setScalar(0.4 + 1.6 * u); r.m.material.opacity = 0.9 * (1 - u);
    r.m.visible = raining && (onRiver || onPond);
  }
  for (const c of CLOUDS) c.g.position.x = c.x0 + 1.2 * t;
  for (const b of BUSHES) { b.g.scale.y = b.g.scale.x * (1 + 0.15 * popOf(b.p)); b.g.rotation.y = 0.04 * Math.sin(t * 1.2 + b.ph); }
  // autumn: haystacks pop up one by one; falling leaves; geese
  for (const h of HAY) { const k = st.i >= 2 ? backOut(seg(t, h.T, h.T + 0.5)) : 0; h.g.scale.setScalar(Math.max(k, 0.001)); h.g.visible = k > 0.01; }
  for (const lf of LEAVES) {
    const tp = lf.t.p, age = ((t * 0.25 + lf.ph / 4) % 1) * 4, top = lf.t.big ? 7 : 3.4;
    lf.m.position.set(tp.x + lf.sx * 2 + age * 1.8 + 0.8 * Math.sin(age * 2.2 + lf.ph), top - age * (top / 4) * 0.95 + 0.25, tp.z + lf.sz * 2 + 0.6 * Math.cos(age * 1.8 + lf.ph));
    lf.m.rotation.set(age * 2.5 + lf.ph, age * 1.7, age);
    lf.m.visible = autumn(tp) > 0.3 && winter(tp) < 0.02;
  }
  {
    const u = seg(t, 21.2, 30.6), lead = V3(lerp(98, -66, u), 15 + 0.6 * Math.sin(t * 0.8), lerp(-22, 12, u)), th = Math.atan2(34, 164);
    for (const gs of GEESE) {
      gs.g.position.copy(lead).add(gs.off.clone().applyAxisAngle(V3(0, 1, 0), th)); gs.g.position.y += 0.3 * Math.sin(t * 1.4 + gs.ph);
      gs.g.rotation.set(0, th, 0); gs.g.visible = u > 0 && u < 1;
      const f = 0.55 * Math.sin(t * 6 + gs.ph); gs.wl.rotation.x = f; gs.wr.rotation.x = -f;
    }
  }
  // winter: snow, chimney smoke, the snowman; at dusk the windows light up one by one
  for (const s of SNOW) {
    const u = (t * 0.11 * s.sp + s.ph) % 1, y = 32 * (1 - u);
    s.m.position.set(s.x + 1.2 * Math.sin(t * 0.9 + s.ph * 9), y, s.z + 0.8 * Math.cos(t * 0.7 + s.ph * 7));
    s.m.visible = y > 0.2 && winter(s.m.position) > 0;
  }
  for (const pf of SMOKE) {
    const u = (t * 0.33 + pf.ph) % 1, sc = (0.35 + u) * Math.min(1, (1 - u) * 4) * sm(winter(pf.p));
    pf.m.position.set(pf.p.x + u * 2.4 + 0.3 * Math.sin(u * 6 + pf.ph), pf.p.y + u * 4.2, pf.p.z - u * 0.6); pf.m.scale.setScalar(Math.max(sc, 0.001)); pf.m.visible = sc > 0.01;
  }
  { const k = st.i >= 3 ? backOut(seg(t, 32.6, 33.2)) : 0; snowman.scale.setScalar(Math.max(k, 0.001)); snowman.visible = k > 0.01; }
  setNight(0.62 * sm(seg(t, 33.8, 37.2))); setDusk(1 - 0.35 * sm(seg(t, 35.5, 39)));
  for (const w of WINS) { const on = t > w.T; w.m.uniforms.uEmit.value = on ? 1 : 0; w.m.uniforms.uCol.value.set(on ? '#FFD36E' : '#BFE4FF'); }
  const pools = [];
  for (const d of DOORLAMPS) { const on = t > d.T; d.m.uniforms.uEmit.value = on ? 1 : 0; d.m.uniforms.uCol.value.set(on ? '#FFD36E' : '#FFE38A'); if (on) pools.push([d.p.x, d.p.y, d.p.z, 2.6 * backOut(seg(t, d.T, d.T + 0.4))]); }
  setLamps(pools);
  return { st, si };
}

function render(t) {
  const f = Math.round(t * FPS);
  const { st } = place(t);
  const c = camAt(t);
  dio.cam.fov = c.fov; dio.cam.position.copy(c.pos); dio.cam.up.set(0, 1, 0); dio.cam.lookAt(c.look); dio.cam.updateProjectionMatrix();
  dio.fitShadow(V3(22, 0, 9), 100);
  // type: lines 2 and 3 switch halfway through the season wave
  const near = SWAPS.find((s) => Math.abs(t - s) < 0.45);
  const sw = near !== undefined, ti = SWAPS.filter((s) => t >= s).length;
  let grow = 1e9;
  if (t < 1.2) grow = 1300 * Math.pow(t / 1.2, 0.8);
  else if (t > DUR - 1.0) grow = 1300 * (1 - io((t - (DUR - 1.0)) / 0.95));
  const base = Math.min(sm(seg(t, 0.8, 1.6)), 1 - sm(seg(t, DUR - 1.0, DUR - 0.25)));
  const swapA = sw ? Math.abs(t - near) / 0.45 : 1;
  dio.render(t, f, { grow, text: [TITLE, ...TEXT[ti]], textAlpha: base, strong2: ti === 4 });
  if (sw) {  // on a switch: fade the old text out, then reveal the new (line 1 stays)
    const g = dio.ctx; g.save(); g.globalAlpha = 1 - swapA; g.fillStyle = '#FFFCF6'; g.fillRect(0, 948, 1920, 60); g.restore();
  }
}
// every on-screen text with its box, for core/render/readcheck.mjs
const textAlphaAt = (t) => Math.min(sm(seg(t, 0.8, 1.6)), 1 - sm(seg(t, DUR - 1.0, DUR - 0.25)));
function TEXTS(t) {
  if (textAlphaAt(t) <= 0) return [];
  const g = dio.ctx, y0 = FRAME.cy + FRAME.hh + 64;
  const tbox = (text, font, dy, size) => { g.save(); g.font = font; const w = g.measureText(text).width; g.restore(); return { x0: 960 - w / 2, x1: 960 + w / 2, y0: y0 + dy - size, y1: y0 + dy + size * 0.3 }; };
  const out = [{ id: 'title', text: TITLE, ...tbox(TITLE, '600 25px IT, SC', 34, 25) }];
  const ti = SWAPS.filter((s) => t >= s).length;
  if (SWAPS.some((s) => Math.abs(t - s) < 0.45)) return out;  // lines 2 and 3 are being swapped
  out.push({ id: 'season', text: TEXT[ti][0], ...(ti === 4 ? tbox(TEXT[ti][0], '600 21px IT, SC', 64, 21) : tbox(TEXT[ti][0], '400 18px IT, SC', 64, 18)) });
  out.push({ id: 'info', text: TEXT[ti][1], ...tbox(TEXT[ti][1], '400 15px PM, SC', 91, 15) });
  return out;
}
window.DUR = DUR;
window.render = render;
window.TEXTS = TEXTS;
await Promise.all(['600 25px IT', '400 18px IT', '600 25px SC', '400 18px SC', '400 15px PM'].map((f) => document.fonts.load(f, '柚子城 Aa')));
render(0);
window.READY = true;
