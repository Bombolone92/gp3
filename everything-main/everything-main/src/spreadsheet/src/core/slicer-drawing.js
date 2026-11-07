import { modelChildren, standaloneModelXml } from './data-model-metadata.js';

const XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const SLE = 'http://schemas.microsoft.com/office/drawing/2010/slicer';
const SLE15 = 'http://schemas.microsoft.com/office/drawing/2012/slicer';
const supported = new Set([XDR, A, SLE, SLE15, 'http://schemas.microsoft.com/office/drawing/2010/main']);
const kids = (node, name, ns = XDR) => modelChildren(node, name, ns);
const fail = message => { throw new Error(`Invalid slicer drawing: ${message}`); };
const one = (nodes, label) => { if (nodes.length !== 1) fail(`missing or ambiguous ${label}`); return nodes[0]; };
const children = node => Array.from(node?.childNodes || []).filter(n => n.nodeType === 1);
// Do not read both Choice and Fallback, or select a Choice by its prefix spelling.
function effectiveChildren(node) {
  return children(node).flatMap(n => {
    if (n.namespaceURI !== MC || n.localName !== 'AlternateContent') return [n];
    const selected = kids(n, 'Choice', MC).find(c => {
      const requires = (c.getAttribute('Requires') || '').trim().split(/\s+/);
      return requires.length && requires.every(prefix => prefix && supported.has(c.lookupNamespaceURI(prefix)));
    }) || kids(n, 'Fallback', MC)[0];
    return selected ? effectiveChildren(selected) : [];
  });
}
const integer = (value, min, max, label) => {
  const text = String(value ?? '').trim(), number = Number(text);
  if (!/^[+-]?\d+$/.test(text) || !Number.isSafeInteger(number) || number < min || number > max) fail(label);
  return number;
};
const coordinate = (node, attr, min = -Number.MAX_SAFE_INTEGER) => integer(node.getAttribute(attr), min, Number.MAX_SAFE_INTEGER, attr);
const flag = (node, attr, fallback) => {
  if (!node?.hasAttribute(attr)) return fallback;
  const text = node.getAttribute(attr).trim();
  if (!['0', '1', 'true', 'false'].includes(text)) fail(attr);
  return text === '1' || text === 'true';
};
function marker(node) {
  const value = (name, min, max) => integer(one(kids(node, name), name).textContent, min, max, name);
  return { r: value('row', 0, 1048575), c: value('col', 0, 16383),
    dx: value('colOff', -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER) / 9525,
    dy: value('rowOff', -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER) / 9525 };
}

/** Resolve native slicer frames in the selected markup-compatibility branch.
 * Geometry is in pixels but keeps both cell markers, so later sheet resizing
 * can honor editAs. Grouped frames retain their source anchor and are marked;
 * they must not be flattened to the group's outer rectangle.
 */
export function readSlicerDrawing(root) {
  if (root.localName !== 'wsDr' || root.namespaceURI !== XDR) fail('root');
  const output = [];
  for (const anchor of effectiveChildren(root)) {
    if (anchor.namespaceURI !== XDR || !['twoCellAnchor', 'oneCellAnchor', 'absoluteAnchor'].includes(anchor.localName)) continue;
    const frames = [];
    const visit = (node, grouped = false) => {
      for (const child of effectiveChildren(node)) {
        if (child.namespaceURI !== XDR) continue;
        if (child.localName === 'graphicFrame') frames.push({ node: child, grouped });
        else if (child.localName === 'grpSp') visit(child, true);
      }
    };
    visit(anchor);
    for (const { node, grouped } of frames) {
      const graphic = kids(node, 'graphic', A), data = graphic.flatMap(g => kids(g, 'graphicData', A));
      const entries = data.filter(d => d.getAttribute('uri') === SLE).flatMap(d => kids(d, 'slicer', SLE));
      if (!entries.length) continue;
      const entry = one(entries, 'slicer reference'), name = entry.getAttribute('name');
      if (!name || name.length > 65534 || [...name].length > 32767) fail('slicer name');
      const kind = anchor.localName, props = one(kids(one(kids(node, 'nvGraphicFramePr'), 'frame properties'), 'cNvPr'), 'drawing properties');
      const record = { name, shapeId: integer(props.getAttribute('id'), 0, 4294967295, 'shape id'),
        description: props.getAttribute('descr') || '', hidden: flag(props, 'hidden', false),
        print: flag(kids(anchor, 'clientData')[0], 'fPrintsWithSheet', true), kind, grouped,
        xml: standaloneModelXml(anchor) };
      if (kind === 'absoluteAnchor') {
        const pos = one(kids(anchor, 'pos'), 'position'); record.x = coordinate(pos, 'x'); record.y = coordinate(pos, 'y');
        record.x /= 9525; record.y /= 9525;
      } else record.from = marker(one(kids(anchor, 'from'), 'from'));
      if (kind === 'twoCellAnchor') {
        record.to = marker(one(kids(anchor, 'to'), 'to'));
        record.editAs = anchor.getAttribute('editAs') || 'twoCell';
        if (!['absolute', 'oneCell', 'twoCell'].includes(record.editAs)) fail('editAs');
        if (record.to.r < record.from.r || record.to.c < record.from.c) fail('reversed markers');
      } else {
        const ext = one(kids(anchor, 'ext'), 'extent'); record.w = coordinate(ext, 'cx', 0) / 9525; record.h = coordinate(ext, 'cy', 0) / 9525;
      }
      output.push(record);
    }
  }
  return output;
}

/** Resolve cell-marker dimensions from sparse sheet metrics without expanding
 * every row/column spanned. Filter visibility belongs to the caller's metrics.
 */
export function slicerDrawingBounds(drawing, sheet) {
  if (drawing.grouped) throw new Error('Grouped slicer geometry requires its group transforms');
  const span = (start, end, axis) => {
    const raw = sheet[axis === 'r' ? 'rowHeights' : 'colWidths'] || {}, sizes = raw instanceof Map ? raw : new Map(Object.entries(raw).map(([i, value]) => [Number(i), value]));
    const hidden = new Set(sheet[axis === 'r' ? 'hiddenRows' : 'hiddenCols'] || []);
    const fallback = sheet[axis === 'r' ? 'defaultRowHeight' : 'defaultColWidth'] || (axis === 'r' ? 26 : 100);
    let pixels = (end - start) * fallback;
    for (const [index, size] of sizes) if (index >= start && index < end) pixels += hidden.has(index) ? -fallback : size - fallback;
    for (const index of hidden) if (index >= start && index < end && !sizes.has(index)) pixels -= fallback;
    return pixels;
  };
  if (drawing.kind === 'absoluteAnchor') return { anchor: { r: 0, c: 0 }, anchorMode: 'absolute', dx: drawing.x, dy: drawing.y, w: drawing.w, h: drawing.h };
  const { r, c, dx, dy } = drawing.from;
  const w = drawing.to ? span(c, drawing.to.c, 'c') + drawing.to.dx - dx : drawing.w;
  const h = drawing.to ? span(r, drawing.to.r, 'r') + drawing.to.dy - dy : drawing.h;
  if (![w, h].every(v => Number.isFinite(v) && v >= 0)) fail('dimensions');
  if (drawing.editAs === 'absolute') return { anchor: { r: 0, c: 0 }, anchorMode: 'absolute', dx: span(0, c, 'c') + dx, dy: span(0, r, 'r') + dy, w, h };
  return { anchor: { r, c }, dx, dy, w, h };
}
