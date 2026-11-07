// Nested boards: corridor (km) ⊃ city (10 m) ⊃ street (10 cm) ⊃ charger (mm). Each child board sits in its parent at
// `at` (parent units) with `s` parent units per child unit. A camera is always held in one level's own units, so
// the canvas never sees huge numbers; the stack renderer starts from the outermost level that still has to be
// drawn and composites every visible child into its footprint.
import { Board, camMatrix, toScreen } from './render.js';

export function makeLevels(defs, W, H) {
  const L = {};
  for (const d of defs) L[d.name] = { ...d, cv: new OffscreenCanvas(W, H), kids: [] };
  for (const d of defs) { const l = L[d.name]; l.ctx = l.cv.getContext('2d'); l.board = new Board(l.cv, d.world, { unit: d.unit }); if (d.parent) L[d.parent].kids.push(l); }
  return L;
}
// camera conversions between a level and its parent
export const toChild = (cam, k) => ({ x: (cam.x - k.at[0]) / k.s, y: (cam.y - k.at[1]) / k.s, z: cam.z * k.s, r: cam.r || 0 });
export const toParent = (cam, k) => ({ x: cam.x * k.s + k.at[0], y: cam.y * k.s + k.at[1], z: cam.z / k.s, r: cam.r || 0 });
function covers(l, cam, W, H) {
  const M = camMatrix(cam), det = M[0] * M[3] - M[1] * M[2], B = l.world.BOARD;
  const inv = p => { const x = p[0] - M[4], y = p[1] - M[5]; return [(M[3] * x - M[2] * y) / det, (-M[1] * x + M[0] * y) / det]; };
  return [[0, 0], [W, 0], [0, H], [W, H]].every(p => { const q = inv(p); return q[0] > B.x0 && q[0] < B.x1 && q[1] > B.y0 && q[1] < B.y1; });
}
// the outermost level to draw for a camera held in level `name`
export function baseOf(L, name, cam, W, H) {
  let l = L[name], c = cam;
  while (l.parent && !covers(l, c, W, H)) { c = toParent(c, l); l = L[l.parent]; }
  return { l, cam: c };
}
// draw level l (and its visible children) into l.cv; returns the list of [level, cam, clipRect] drawn (for texts)
export function drawLevel(L, l, cam, sceneFor, W, H, out = []) {
  l.board.frame(cam, sceneFor(l.name));
  out.push([l, cam, null]);
  const M = camMatrix(cam);
  for (const k of l.kids) {
    const B = k.world.BOARD, p0 = toScreen(M, [k.at[0] + B.x0 * k.s, k.at[1] + B.y0 * k.s]), p1 = toScreen(M, [k.at[0] + B.x1 * k.s, k.at[1] + B.y1 * k.s]);
    const x0 = Math.min(p0[0], p1[0]), x1 = Math.max(p0[0], p1[0]), y0 = Math.min(p0[1], p1[1]), y1 = Math.max(p0[1], p1[1]);
    if (x1 - x0 < 3 || x1 < 0 || y1 < 0 || x0 > W || y0 > H) continue;
    const kc = toChild(cam, k), n = out.length;
    drawLevel(L, k, kc, sceneFor, W, H, out);
    for (let i = n; i < out.length; i++) out[i][2] = out[i][2] || [x0, y0, x1, y1];
    const g = l.ctx; g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
    // the child footprint follows the camera's rotation: clip to its rotated outline
    const c = [[B.x0, B.y0], [B.x1, B.y0], [B.x1, B.y1], [B.x0, B.y1]].map(q => toScreen(M, [k.at[0] + q[0] * k.s, k.at[1] + q[1] * k.s]));
    g.beginPath(); g.moveTo(...c[0]); for (const q of c.slice(1)) g.lineTo(...q); g.closePath(); g.clip();
    g.drawImage(k.cv, 0, 0); g.restore();
  }
  return out;
}
