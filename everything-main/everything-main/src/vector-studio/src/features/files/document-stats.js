/**
 * Document statistics shared by File > Document Info and the Document Info
 * panel: object counts by kind, anchors, fonts, colors, images.
 */

/**
 * Counts and lists for a document (pure, for tests). With `ids`, only those
 * objects and everything inside them count (the Document Info panel's
 * Selection Only).
 */
export function documentStats(doc, { ids = null } = {}) {
  const counts = { path: 0, compound: 0, group: 0, clip: 0, text: 0, image: 0, layer: 0, hidden: 0, locked: 0, pointText: 0, areaText: 0, pathText: 0, live: 0, effects: 0 };
  const fonts = new Map();
  const colors = new Set();
  const swatchRefs = new Set();
  let anchors = 0;
  const count = (n) => {
    if (n.type === 'group' && n.clip) counts.clip++;
    else if (counts[n.type] != null) counts[n.type]++;
    if (n.type === 'text') counts[n.kind === 'area' ? 'areaText' : n.kind === 'path' ? 'pathText' : 'pointText']++;
    if (n.live || n.blend) counts.live++;
    if (n.effects?.some((e) => e && !e.hidden)) counts.effects++;
    if (n.hidden) counts.hidden++;
    if (n.locked) counts.locked++;
    if (n.anchors) anchors += n.anchors.length;
    if (n.type === 'text' && n.char) {
      const key = `${n.char.fontFamily} ${n.char.fontWeight || 400}${n.char.fontStyle === 'italic' ? ' Italic' : ''}`;
      fonts.set(key, (fonts.get(key) || 0) + 1);
    }
    for (const p of [n.fill, n.stroke]) {
      if (!p) continue;
      if (p.swatchId) swatchRefs.add(p.swatchId);
      if (p.type === 'solid') colors.add(p.color.toLowerCase());
      else for (const st of p.stops || []) colors.add(st.color.toLowerCase());
    }
  };
  const assets = new Set();
  if (ids) {
    const seen = new Set();
    const visit = (id) => {
      const n = doc.get(id);
      if (!n || seen.has(id)) return;
      seen.add(id);
      count(n);
      if (n.type === 'image') assets.add(n.asset);
      for (const c of n.children || []) visit(c);
    };
    for (const id of ids) visit(id);
  } else {
    doc.walk((n) => {
      count(n);
      if (n.type === 'image') assets.add(n.asset);
    });
    for (const id of doc.assets.keys()) assets.add(id);
  }
  let imageBytes = 0;
  for (const id of assets) imageBytes += Math.round(((doc.assets.get(id)?.data?.length || 0) * 3) / 4);
  return { counts, anchors, fonts: [...fonts.keys()].sort(), images: assets.size, imageBytes, swatches: (doc.root.swatches || []).length, colors, swatchRefs };
}
