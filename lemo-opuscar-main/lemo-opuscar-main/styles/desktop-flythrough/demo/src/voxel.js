// Pixel monster → voxel toy. One instanced column per pixel: thin at the silhouette, thicker inside, eyes stand proud.
// Hierarchy: root (feet position, yaw) → hingeG (lies flat ↔ stands, about the feet line) → squashG (scale at the feet) → spinG (centre: flips, tilts) → mesh
// set({pos, yaw, e, hinge, sq, tiltX, tiltZ, spinX, spinZ, scale, vis})
//   e: 0 flat sticker … 1 full toy (cells extrude in a ripple from the centre); hinge: 0 lying on the paper … 1 standing; sq: squash (<1) / stretch (>1)
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp, hash, back } from '/core/lib.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// bevelled cells: each voxel keeps a thin rounded edge that catches the low sun (toy plastic, not CG boxes)
const box = new RoundedBoxGeometry(1, 1, 1, 2, .16);

export function makeMonster(data, cell, name = '', depthK = 1) {
  const { w, h, cells } = data, key = (i, j) => i + ',' + j;
  const occ = new Set(cells.map(([i, j]) => key(i, j)));
  const dist = new Map(), q = [];
  for (const [i, j] of cells) if (DIRS.some(([a, b]) => !occ.has(key(i + a, j + b)))) { dist.set(key(i, j), 1); q.push([i, j]); }
  for (let k = 0; k < q.length; k++) {
    const [i, j] = q[k], d = dist.get(key(i, j));
    for (const [a, b] of DIRS) { const n = key(i + a, j + b); if (occ.has(n) && !dist.has(n)) { dist.set(n, d + 1); q.push([i + a, j + b]); } }
  }
  const mesh = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ roughness: .48, metalness: 0 }), cells.length);
  mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false;
  const cx = w / 2, cyMid = h / 2;
  // the dominant body colour (for trails, tiny stand-ins)
  const tally = {}; cells.forEach(([, , c]) => tally[c] = (tally[c] || 0) + 1);
  const main = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
  const info = cells.map(([i, j, c], k) => {
    const col = new THREE.Color(c), lum = .2126 * col.r + .7152 * col.g + .0722 * col.b;
    const d = dist.get(key(i, j)), eye = lum < .02;
    const r = Math.hypot(i + .5 - cx, (j + .5 - cyMid) * 1.1) / Math.hypot(cx, cyMid);
    mesh.setColorAt(k, col);
    return { x: (i + .5 - cx) * cell, y: (h - j - .5) * cell, dep: (2.2 + Math.min(d - 1, 3.2) * 1.15) * cell * depthK, eye, delay: r * .55 + hash(k * 7.3 + w) * .12 };
  });
  const H_ = h * cell;
  const root = new THREE.Group(), hingeG = new THREE.Group(), squashG = new THREE.Group(), spinG = new THREE.Group();
  root.add(hingeG); hingeG.add(squashG); squashG.add(spinG); spinG.add(mesh);
  spinG.position.y = H_ / 2; mesh.position.y = -H_ / 2;
  const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), s = new THREE.Vector3(), qq = new THREE.Quaternion();
  const M = { name, root, mesh, info, w, h, cell, height: H_, width: w * cell, main, e: -1 };
  M.extrude = e => {
    if (Math.abs(e - M.e) < 1e-4) return; M.e = e;
    info.forEach((o, k) => {
      const ek = clamp((e * 1.45 - o.delay) / .55), g = ek <= 0 ? 0 : back(ek, 1.6);
      const dz = Math.max(cell * .2, o.dep * g) + (o.eye ? cell * .9 * g : 0);
      p.set(o.x, o.y, (o.eye ? cell * .45 * g : 0)); s.set(cell * .94, cell * .94, dz);
      m4.compose(p, qq, s); mesh.setMatrixAt(k, m4);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  M.set = (st = {}) => {
    const { pos, yaw = 0, e = 1, hinge = 1, sq = 1, tiltX = 0, tiltZ = 0, spinX = 0, spinZ = 0, scale = 1, vis = true } = st;
    root.visible = vis && scale > .001; if (!root.visible) return;
    if (pos) root.position.copy(pos);
    root.rotation.y = yaw;
    hingeG.rotation.x = -Math.PI / 2 * (1 - clamp(hinge));
    const sxz = 1 / Math.sqrt(Math.max(.2, sq));
    squashG.scale.set(sxz * scale, sq * scale, sxz * scale);
    spinG.rotation.set(tiltX + spinX, 0, tiltZ + spinZ);
    M.extrude(e);
  };
  // blink: eye cells (pure black) take the colour of the cell above them while closed
  const eyes = info.map((o, k) => o.eye ? k : -1).filter(k => k >= 0), lid = new THREE.Color(), eyeCol = new THREE.Color('#0d0d0d');
  const above = eyes.map(k => { const [i, j] = cells[k]; const up = cells.findIndex(([a, b2, c]) => a === i && b2 === j - 1 && new THREE.Color(c).getHex() !== 0x0d0d0d); return up >= 0 ? new THREE.Color(cells[up][2]) : eyeCol; });
  let closed = false;
  M.blink = on => { if (on === closed || !eyes.length) return; closed = on; eyes.forEach((k, n) => mesh.setColorAt(k, on ? above[n] : eyeCol)); mesh.instanceColor.needsUpdate = true; };
  M.extrude(1);
  return M;
}
