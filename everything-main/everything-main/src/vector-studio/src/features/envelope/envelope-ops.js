/**
 * Envelope operations (inside a transaction): Make with Warp / Mesh / Top
 * Object, Reset with Warp / Mesh, options, Edit Contents, Release and
 * Expand.
 */
import { createGroup, createPath } from '../../model/nodes.js';
import { expandLive } from '../../model/live.js';
import { signedArea } from '../../model/bezier.js';
import { normalizeWarp } from '../../model/warp.js';
import { createMesh } from '../mesh/mesh-model.js';
import { isEnvelope, envelopeLive, normalizeOptions, rectMesh, resampleMesh, warpMesh, topMesh, frameOf, envelopeOutline } from './envelope-model.js';
import { contentRect } from './envelope-live.js';

export const RELEASE_GRAY = '#d4d4d4';

/** Can a node be the shape of Make with Top Object? */
export function canBeTop(doc, n) {
  if (!n || isEnvelope(n)) return false;
  if (n.type === 'path') return n.anchors.length >= 2;
  if (n.type === 'compound') return n.children.some((c) => doc.get(c)?.anchors?.length >= 2);
  return false;
}

/** The closed outline of a top object (a compound path uses its largest piece). */
function topOutline(doc, n) {
  if (n.type === 'path') return n.anchors;
  let best = null;
  let area = -1;
  for (const c of n.children) {
    const k = doc.get(c);
    if (!k?.anchors || k.anchors.length < 2) continue;
    const a = Math.abs(signedArea(k.anchors, true));
    if (a > area) {
      area = a;
      best = k.anchors;
    }
  }
  return best;
}

/**
 * Put objects into a new envelope (above the topmost of them). `mode`:
 * 'warp' (with `warp` params), 'mesh' (rows x cols over the contents'
 * bounds) or 'top' (the topmost object becomes the shape). Returns the
 * envelope id, or null when there is nothing to distort.
 */
export function makeEnvelope(doc, ids, { mode = 'warp', warp = null, rows = 4, cols = 4, options = null } = {}) {
  const ordered = doc.sortByPaintOrder(ids.filter((id) => doc.get(id) && doc.get(id).type !== 'layer'));
  if (!ordered.length) return null;
  let contents = ordered;
  let mesh = null;
  const last = doc.get(ordered[ordered.length - 1]);
  const parentId = last.parent;
  let index = doc.get(parentId).children.indexOf(last.id) + 1;
  if (mode === 'top') {
    if (ordered.length < 2 || !canBeTop(doc, last)) return null;
    const outline = topOutline(doc, last);
    if (!outline) return null;
    mesh = topMesh(outline);
    contents = ordered.slice(0, -1);
    index -= 1;
    doc.remove(last.id);
  }
  const live = envelopeLive({ mode: mode === 'warp' ? 'warp' : 'mesh', warp, mesh, top: mode === 'top', options });
  const env = createGroup([], { live });
  doc.insert(env, parentId, index);
  for (const id of contents) doc.move(id, env.id);
  if (mode === 'mesh') {
    const r = contentRect(doc, doc.get(env.id));
    if (!r) {
      doc.remove(env.id);
      return null;
    }
    doc.update(env.id, { live: { ...live, mesh: rectMesh(r, rows, cols) } });
  }
  return env.id;
}

/** Turn an envelope into a warp envelope with the given warp (its frame is kept). */
export function resetWithWarp(doc, id, warp) {
  const env = doc.get(id);
  if (!isEnvelope(env)) return;
  const { mesh, top, ...rest } = env.live;
  doc.update(id, { live: { ...rest, mode: 'warp', warp: normalizeWarp(warp) } });
}

/**
 * Turn an envelope into a rows x cols mesh envelope. With `maintain` the
 * mesh follows the current shape (the warp, or the mesh resampled);
 * otherwise it is a plain grid over the contents.
 */
export function resetWithMesh(doc, id, rows, cols, { maintain = true } = {}) {
  const env = doc.get(id);
  if (!isEnvelope(env)) return;
  const live = env.live;
  const r = contentRect(doc, env);
  if (!r) return;
  const f = frameOf(env);
  let mesh;
  if (!maintain) mesh = rectMesh(r, rows, cols, f);
  else if (live.mode === 'mesh' && live.mesh) mesh = resampleMesh(live.mesh, rows, cols);
  else mesh = warpMesh(live.warp, r, rows, cols, f);
  const { warp, top, ...rest } = live;
  const keepTop = top && maintain && mesh === live.mesh;
  doc.update(id, { live: { ...rest, mode: 'mesh', mesh, ...(keepTop ? { top: true } : {}) } });
}

/** Change an envelope's options. */
export function setEnvelopeOptions(doc, id, options) {
  const env = doc.get(id);
  if (!isEnvelope(env)) return;
  doc.update(id, { live: { ...env.live, options: normalizeOptions({ ...env.live.options, ...options }) } });
}

/** Switch between editing the envelope and editing its contents. */
export function setEditingContents(doc, id, on) {
  const env = doc.get(id);
  if (!isEnvelope(env)) return;
  const { editing, ...rest } = env.live;
  doc.update(id, { live: on ? { ...rest, editing: 'contents' } : rest });
}

/**
 * Release: the contents return to the envelope's place, under the envelope
 * shape as a gray object (a path, or a gradient mesh for meshes with
 * several patches). Returns the released ids (contents, then the shape).
 */
export function releaseEnvelope(doc, id) {
  const env = doc.get(id);
  if (!isEnvelope(env)) return [];
  const live = env.live;
  const r = contentRect(doc, env);
  const parentId = env.parent;
  let index = doc.get(parentId).children.indexOf(id);
  const kids = env.children.slice();
  for (const k of kids) doc.move(k, parentId, index++);
  let shapeId = null;
  const fill = { type: 'solid', color: RELEASE_GRAY };
  if (live.mode === 'mesh' && live.mesh && live.mesh.rows * live.mesh.cols > 1 && !live.top) {
    const m = createMesh(live.mesh.rows, live.mesh.cols, live.mesh.points.map((p) => ({ ...p, c: RELEASE_GRAY, a: 1 })));
    doc.insert(m, parentId, index);
    shapeId = m.id;
  } else {
    const outline = envelopeOutline(live, r);
    if (outline) {
      const p = createPath(outline, true, { fill, stroke: null, strokeWidth: 0 });
      doc.insert(p, parentId, index);
      shapeId = p.id;
    }
  }
  doc.remove(id);
  return shapeId ? [...kids, shapeId] : kids;
}

/** Expand: the distorted artwork as ordinary objects. Returns the new group's id. */
export function expandEnvelope(doc, id) {
  const g = expandLive(doc, id);
  return g?.id || null;
}
