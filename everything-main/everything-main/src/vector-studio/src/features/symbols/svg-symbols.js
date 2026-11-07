/**
 * SVG <symbol> elements placed with <use> arrive from the importer as
 * groups marked `importedSymbol` ({ key, name, m }: which symbol, its name
 * and the matrix the use placed it with). Here they become real symbols:
 * the first use of each symbol supplies the master (mapped back into the
 * symbol's own coordinates) and every use becomes an instance.
 */
import { invert } from '../../lib/matrix.js';
import { transformPatches } from '../../model/geometry.js';
import { addDefinition, createInstance, masterBounds, updateDefinition, onPage } from './model.js';

function depth(doc, id) {
  let d = 0;
  let n = doc.get(id);
  while (n?.parent) {
    d++;
    n = doc.get(n.parent);
  }
  return d;
}

const isMarked = (n) => n?.type === 'group' && n.importedSymbol;

/** Marked groups among some ids (default: the whole page). */
export function importedSymbolGroups(doc, ids = null) {
  const out = [];
  if (ids) {
    for (const id of ids) if (isMarked(doc.get(id)) && onPage(doc, id)) out.push(id);
  } else for (const n of doc.nodes.values()) if (isMarked(n) && onPage(doc, n.id)) out.push(n.id);
  return out;
}

/** Turn marked groups into symbols and instances (inside a transaction). Returns the new instance ids. */
export function convertImportedSymbols(doc, ids = importedSymbolGroups(doc)) {
  // Inner uses first, so outer masters contain instances of the inner symbols.
  const order = [...ids].sort((a, b) => depth(doc, b) - depth(doc, a));
  const byKey = new Map();
  const out = [];
  for (const gid of order) {
    const g = doc.get(gid);
    if (!isMarked(g)) continue;
    const { key, name, m } = g.importedSymbol;
    let defId = byKey.get(key);
    if (!defId) {
      const def = addDefinition(doc, { name: name || 'Symbol' });
      const inv = invert(m);
      const patches = new Map();
      for (const c of g.children) {
        const copy = doc.importSubtree(doc.exportSubtree(c), def.id);
        transformPatches(doc, copy, inv, { scaleStrokes: true, scaleCorners: true }, patches);
      }
      for (const [id, p] of patches) doc.update(id, p);
      const b = masterBounds(doc, doc.get(def.id));
      if (b) updateDefinition(doc, def.id, { reg: { x: b.x + b.w / 2, y: b.y + b.h / 2 } });
      defId = def.id;
      byKey.set(key, defId);
    }
    const parent = doc.get(g.parent);
    const index = parent.children.indexOf(gid);
    const inst = createInstance(defId, m, { name: g.name || '', opacity: g.opacity ?? 1, blendMode: g.blendMode || 'normal', effects: g.effects || [] });
    doc.remove(gid);
    doc.insert(inst, parent.id, index);
    out.push(inst.id);
  }
  return out;
}
