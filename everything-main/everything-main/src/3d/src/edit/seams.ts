import { edges, type Topology } from './topology';
export const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
export function seamEdges(t: Topology) {
  const result = new Set<string>();
  for (let f = 0; f < t.offsets.length - 1; f++)
    for (let c = t.offsets[f]; c < t.offsets[f + 1]; c++)
      if (t.seams?.[c]) result.add(edgeKey(t.indices[c], t.indices[nextCorner(t, f, c)]));
  return result;
}
export function nextCorner(t: Topology, f: number, c: number) {
  return c + 1 === t.offsets[f + 1] ? t.offsets[f] : c + 1;
}
export function markSeams(t: Topology, ids: number[], marked: boolean): Topology {
  const es = edges(t);
  if (!ids.length || ids.some((i) => !Number.isInteger(i) || !es[i]))
    throw new Error('Select edges to mark or clear seams.');
  const chosen = new Set(ids.map((i) => edgeKey(es[i].a, es[i].b)));
  const seams = t.seams?.slice() ?? new Uint32Array(t.indices.length);
  for (let f = 0; f < t.offsets.length - 1; f++)
    for (let c = t.offsets[f]; c < t.offsets[f + 1]; c++)
      if (chosen.has(edgeKey(t.indices[c], t.indices[nextCorner(t, f, c)])))
        seams[c] = Number(marked);
  return { ...t, seams };
}
