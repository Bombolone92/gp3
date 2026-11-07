/**
 * Gradient mesh objects as live artwork: a leaf node of type 'mesh' whose
 * outline (generated as a filled path) gives bounds and hit testing, drawn
 * by the mesh rasterizer, expanded into a clipping group of small filled
 * cells, and written by the exporters as itself (a PDF mesh shading or an
 * SVG image clipped to the outline).
 */
import { registerLive, virtualId } from '../../model/live.js';
import { meshBoundary, transformPoints, patchOf, evalPatch, patchColor, rgba } from './mesh-model.js';
import { drawMesh, averageColor } from './mesh-raster.js';
import { rgbToHex } from '../../lib/color.js';

export const isMesh = (n) => n?.type === 'mesh';

registerLive('mesh', {
  label: '<Mesh>',
  test: isMesh,
  exportSelf: true,
  generate(doc, node) {
    const id = virtualId(node.id);
    const outline = { id, type: 'path', name: '', anchors: meshBoundary(node), closed: true, fill: { type: 'solid', color: '#808080' }, stroke: null, strokeWidth: 0, opacity: 1, blendMode: 'normal', effects: [], hidden: false, locked: false };
    return { items: [outline], extra: new Map([[id, outline]]) };
  },
  draw: drawMesh,
  expandArtwork: (doc, node) => expandedCells(node),
  transformParams(node, m) {
    return { points: transformPoints(node.points, m) };
  },
});

/** Steps for one patch when expanding: fine enough for its size and color change. */
function expandSteps(mesh, i, j, maxCells) {
  const p = patchOf(mesh, i, j);
  const corners = [p.A, p.B, p.C, p.D].map(rgba);
  let dc = 0;
  for (let k = 0; k < 3; k++) {
    const vals = corners.map((c) => c[k]);
    dc = Math.max(dc, Math.max(...vals) - Math.min(...vals));
  }
  const va = corners.map((c) => c[3] * 255);
  dc = Math.max(dc, Math.max(...va) - Math.min(...va));
  const len = (c) => Math.hypot(c[6] - c[0], c[7] - c[1]) + Math.hypot(c[2] - c[0], c[3] - c[1]) * 0.5;
  const ns = Math.max(1, Math.ceil(dc / 4), Math.ceil(Math.max(len(p.top), len(p.bottom)) / 10));
  const nt = Math.max(1, Math.ceil(dc / 4), Math.ceil(Math.max(len(p.left), len(p.right)) / 10));
  const cap = Math.max(1, Math.floor(Math.sqrt(maxCells)));
  return { ns: Math.min(ns, cap, 48), nt: Math.min(nt, cap, 48) };
}

/**
 * Generated artwork for Object > Expand: a clipping group of quad cells,
 * each filled with the mesh color at its center (opaque cells get a hairline
 * stroke of the same color so neighbors meet without seams), clipped by the
 * mesh outline.
 */
export function expandedCells(mesh, { maxCells = 12000 } = {}) {
  const extra = new Map();
  const cells = [];
  const per = Math.max(1, Math.floor(maxCells / Math.max(1, mesh.rows * mesh.cols)));
  for (let i = 0; i < mesh.rows; i++) {
    for (let j = 0; j < mesh.cols; j++) {
      const p = patchOf(mesh, i, j);
      const { ns, nt } = expandSteps(mesh, i, j, per);
      const grid = [];
      for (let b = 0; b <= nt; b++) for (let a = 0; a <= ns; a++) grid.push(evalPatch(p, a / ns, b / nt));
      for (let b = 0; b < nt; b++) {
        for (let a = 0; a < ns; a++) {
          const q = [grid[b * (ns + 1) + a], grid[b * (ns + 1) + a + 1], grid[(b + 1) * (ns + 1) + a + 1], grid[(b + 1) * (ns + 1) + a]];
          const c = patchColor(mesh, i, j, (a + 0.5) / ns, (b + 0.5) / nt);
          const color = rgbToHex({ r: c[0], g: c[1], b: c[2] });
          const opaque = c[3] >= 0.999;
          const fill = opaque ? { type: 'solid', color } : { type: 'solid', color, opacity: Math.round(c[3] * 1000) / 1000 };
          const id = virtualId(mesh.id);
          const cell = {
            id,
            type: 'path',
            name: '',
            anchors: q.map((pt) => ({ x: pt.x, y: pt.y, ix: pt.x, iy: pt.y, ox: pt.x, oy: pt.y })),
            closed: true,
            fill,
            stroke: opaque ? { type: 'solid', color } : null,
            strokeWidth: opaque ? 0.3 : 0,
            strokeJoin: 'round',
            strokeCap: 'butt',
            strokeAlign: 'center',
            miterLimit: 10,
            dash: [],
            dashOffset: 0,
            opacity: 1,
            blendMode: 'normal',
            effects: [],
            hidden: false,
            locked: false,
          };
          extra.set(id, cell);
          cells.push(id);
        }
      }
    }
  }
  const clipId = virtualId(mesh.id);
  extra.set(clipId, { id: clipId, type: 'path', name: '', anchors: meshBoundary(mesh), closed: true, fill: null, stroke: null, strokeWidth: 0, opacity: 1, blendMode: 'normal', effects: [], hidden: false, locked: false });
  const gid = virtualId(mesh.id);
  extra.set(gid, { id: gid, type: 'group', name: '', clip: true, children: [...cells, clipId], hidden: false, locked: false });
  return { items: [gid], extra };
}

export { averageColor };
