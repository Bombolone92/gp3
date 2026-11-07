// Convert Entities: projects model edges into a sketch as fixed curves.
// Lines become lines; circles and arcs parallel to the sketch plane become
// circles and arcs. End points shared by several converted edges are reused.

import type { EdgeInfo } from '../kernel/protocol';
import { type Frame, type Vec2, cross, len, normalize, toLocal } from '../math/vec';
import type { Id, SketchFeature } from '../model/types';

export function convertEdges(sk: SketchFeature, fr: Frame, edges: EdgeInfo[], newId: (p: string) => Id): { ids: Id[]; skipped: number } {
  const ids: Id[] = [];
  let skipped = 0;
  const pointAt = (p: Vec2) => {
    for (const e of sk.entities) if (e.t === 'point' && Math.hypot(e.x - p[0], e.y - p[1]) < 1e-6) return e.id;
    const id = newId('p');
    sk.entities.push({ id, t: 'point', x: p[0], y: p[1] });
    return id;
  };
  for (const e of edges) {
    const a = toLocal(fr, e.a), b = toLocal(fr, e.b);
    if (e.type === 'line') {
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9) { skipped++; continue; }
      const id = newId('l');
      sk.entities.push({ id, t: 'line', a: pointAt(a), b: pointAt(b) });
      sk.constraints.push({ id: newId('r'), type: 'fix', refs: [id] });
      ids.push(id);
    } else if (e.type === 'circle' && e.center && e.axis && e.radius && len(cross(normalize(e.axis), fr.n)) < 1e-6) {
      const c = toLocal(fr, e.center);
      const full = Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-7;
      if (full) {
        const cid = newId('p');
        sk.entities.push({ id: cid, t: 'point', x: c[0], y: c[1] });
        const id = newId('c');
        sk.entities.push({ id, t: 'circle', c: cid, r: e.radius });
        sk.constraints.push({ id: newId('r'), type: 'fix', refs: [id] });
        ids.push(id);
      } else {
        const cid = pointAt(c);
        const m = toLocal(fr, e.mid);
        const ccw = (a[0] - c[0]) * (m[1] - c[1]) - (a[1] - c[1]) * (m[0] - c[0]) > 0;
        const id = newId('a');
        sk.entities.push(ccw ? { id, t: 'arc', c: cid, a: pointAt(a), b: pointAt(b) } : { id, t: 'arc', c: cid, a: pointAt(b), b: pointAt(a) });
        sk.constraints.push({ id: newId('r'), type: 'fix', refs: [id] });
        ids.push(id);
      }
    } else skipped++;
  }
  return { ids, skipped };
}
