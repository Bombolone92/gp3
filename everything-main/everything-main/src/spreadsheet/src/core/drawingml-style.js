/** Resolve DrawingML style-matrix links before moving shapes between workbooks. */
const child = (n, name) => n?.children?.find(c => c.name === name);
const node = (name, children = [], attrs = {}) => ({ name, attrs, children });
const fills = new Set(['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill']);
const colors = new Set(['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr', 'hslClr']);
const choices = [fills, colors, new Set(['prstDash', 'custDash']), new Set(['round', 'bevel', 'miter']), new Set(['effectLst', 'effectDag']), new Set(['lin', 'path'])];
const key = n => { const i = choices.findIndex(c => c.has(n.name)); return i < 0 ? n.name : `choice${i}`; };
// MS-OI29500 2.1.1284: these lists are inherited as a whole; even an empty
// explicit effect list blocks inheritance. Colors likewise carry their own
// ordered transforms rather than inheriting transforms from a different paint.
const atomic = new Set(['gsLst', 'custDash', 'effectLst', 'effectDag', 'scene3d', 'sp3d', 'extLst', ...colors]);
const order = {
  spPr: ['xfrm', 'prstGeom', 'custGeom', ...fills, 'ln', 'effectLst', 'effectDag', 'scene3d', 'sp3d', 'extLst'],
  ln: [...fills, 'prstDash', 'custDash', 'round', 'bevel', 'miter', 'headEnd', 'tailEnd', 'extLst'],
  gradFill: ['gsLst', 'lin', 'path', 'tileRect', 'extLst'],
};
function merge(direct, inherited) {
  if (!direct) return inherited;
  if (!inherited || direct.name !== inherited.name || atomic.has(direct.name)) return direct;
  const children = [...direct.children];
  for (const fallback of inherited.children) {
    const i = children.findIndex(c => key(c) === key(fallback));
    if (i < 0) children.push(fallback);
    else children[i] = merge(children[i], fallback);
  }
  const sequence = order[direct.name];
  if (sequence) children.sort((a, b) => {
    const index = n => { const i = sequence.indexOf(n.name); return i < 0 ? sequence.length : i; };
    return index(a) - index(b);
  });
  return { ...direct, attrs: { ...inherited.attrs, ...direct.attrs }, children };
}

/**
 * Direct formatting fills gaps from the selected theme style. Fill indices
 * 1–999 select fillStyleLst; 1001+ select bgFillStyleLst (0/1000 mean no fill).
 * Keep all inherited nodes, including effects, for the native serializer to
 * validate; unsupported content must not disappear merely to enable export.
 */
export function resolveDrawingStyle(root, formatScheme) {
  let budget = 10000;
  const copy = (n, placeholder, depth = 0) => {
    if (!n || depth > 24 || --budget < 0) throw new Error('Invalid DrawingML style');
    if (n.name === 'schemeClr' && n.attrs.val === 'phClr') {
      if (!placeholder || placeholder.name === 'schemeClr' && placeholder.attrs.val === 'phClr') throw new Error('Unresolved style color');
      // Reference transforms are applied before the style's transforms.
      return { ...placeholder, attrs: { ...placeholder.attrs }, children: [...placeholder.children, ...n.children].map(c => copy(c, null, depth + 1)) };
    }
    return { ...n, attrs: { ...n.attrs }, children: n.children.map(c => copy(c, placeholder, depth + 1)) };
  };
  const lookup = (ref, list, offset = 1) => {
    const idx = Number(ref.attrs.idx);
    if (!Number.isInteger(idx) || idx < offset) throw new Error('Invalid style index');
    const source = child(formatScheme, list)?.children[idx - offset];
    if (!source) throw new Error('Missing style matrix entry');
    return copy(source, ref.children.find(c => colors.has(c.name)));
  };
  const shape = (n, depth = 0) => {
    if (depth > 24 || --budget < 0) throw new Error('Invalid DrawingML shape');
    if (n.name === 'grpSp') return { ...n, children: n.children.map(c => ['sp', 'cxnSp', 'grpSp'].includes(c.name) ? shape(c, depth + 1) : c) };
    if (!['sp', 'cxnSp'].includes(n.name)) return n;
    const style = child(n, 'style');
    if (!style) return n;
    const inherited = [];
    for (const ref of style.children) {
      const idx = Number(ref.attrs.idx);
      if (ref.name === 'fillRef') inherited.push(idx === 0 || idx === 1000 ? node('noFill')
        : lookup(ref, idx > 1000 ? 'bgFillStyleLst' : 'fillStyleLst', idx > 1000 ? 1001 : 1));
      else if (ref.name === 'lnRef') inherited.push(idx === 0 ? node('ln', [node('noFill')]) : lookup(ref, 'lnStyleLst'));
      else if (ref.name === 'effectRef' && idx !== 0) inherited.push(...lookup(ref, 'effectStyleLst').children);
    }
    const props = merge(child(n, 'spPr') || node('spPr'), node('spPr', inherited));
    // Keep the declarations for font defaults and consumers that inspect the
    // source theme links. The native writer removes them after materializing
    // their properties, so no workbook-local indices escape into the export.
    const children = n.children.filter(c => c.name !== 'spPr');
    children.push(props);
    const sequence = ['nvSpPr', 'spPr', 'style', 'txBody', 'extLst'];
    children.sort((a, b) => sequence.indexOf(a.name) - sequence.indexOf(b.name));
    return { ...n, children };
  };
  return shape(root);
}
