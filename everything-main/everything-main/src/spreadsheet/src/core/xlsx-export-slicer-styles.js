import { modelChildren, parseModelXml, standaloneModelXml } from './data-model-metadata.js';
import { normalizeSlicerFormat } from './slicer-format.js';
import { fontColorXml, fillColorXml, xmlTag } from './xlsx-export-styles.js';
import { xlsxFontName } from './xlsx-style-projection.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const X14 = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main';
// MS-XLSX 2.2.4.9: item DXFs are distinct from the ordinary frame DXFs.
const DXFS = '{46F421CA-312F-682F-3DD2-61675219B42D}';
const STYLES = '{EB79DEF2-80B8-43E5-95BD-54CBDDF9020C}';
const rgb = value => `FF${value.slice(1).toUpperCase()}`;

/** Serialize differential paint without introducing defaults for absent properties. */
export function slicerPaintXml(raw, palette = null) {
  const s = normalizeSlicerFormat({ frame: { wholeTable: raw } }).frame.wholeTable;
  if (!s) throw new Error('Missing slicer paint');
  let font = '', fill = '', border = '';
  for (const [key, tag] of [['bold', 'b'], ['italic', 'i'], ['strike', 'strike']]) {
    if (s[key] != null) font += xmlTag(tag, { val: s[key] ? 1 : 0 });
  }
  if (s.underline != null) font += xmlTag('u', { val: s.underline });
  if (s.size != null) font += xmlTag('sz', { val: s.size });
  font += fontColorXml(s.color, palette);
  if (s.font != null) font += xmlTag('name', { val: xlsxFontName(s.font) });
  if (s.gradient) {
    const { stops, ...attrs } = s.gradient;
    fill = xmlTag('gradientFill', attrs, stops.map(stop => xmlTag('stop', { position: stop.position }, xmlTag('color', { rgb: rgb(stop.color) }))).join(''));
  } else if (s.bg != null) {
    fill = s.bg === 'transparent' ? xmlTag('patternFill', { patternType: 'none' })
      : xmlTag('patternFill', {}, fillColorXml(s.bg, palette, 'bgColor'));
  }
  // CT_Border orders vertical before horizontal. A false flag is an explicit clear.
  for (const [key, side] of [['bl', 'left'], ['br', 'right'], ['bt', 'top'], ['bb', 'bottom'], ['bv', 'vertical'], ['bh', 'horizontal']]) {
    if (s[key] == null) continue;
    const edge = s[`${key}Border`] || s;
    border += s[key] ? xmlTag(side, { style: edge.bs || 'thin' }, xmlTag('color', edge.bc ? { rgb: rgb(edge.bc) } : { auto: 1 })) : xmlTag(side);
  }
  return xmlTag('dxf', { xmlns: MAIN }, (font ? xmlTag('font', {}, font) : '') + (fill ? xmlTag('fill', {}, fill) : '') + (border ? xmlTag('border', {}, border) : ''));
}

/** Append custom slicer styles to a completed styles part; existing references stay valid.
 * Returned names correspond to input paints. Equivalent paints share one definition.
 */
export function appendSlicerStyles(xml, paints, palette = null) {
  if (!paints.length) return { xml, names: [] };
  const formats = paints.map(paint => {
    if (paint == null) throw new Error('Missing slicer paint');
    return normalizeSlicerFormat(paint);
  });
  const root = parseModelXml(xml), doc = root.ownerDocument;
  if (root.namespaceURI !== MAIN || root.localName !== 'styleSheet') throw new Error('Invalid slicer styles part');
  const kids = (node, name, ns = MAIN) => modelChildren(node, name, ns);
  const single = (node, name, ns = MAIN) => {
    const found = kids(node, name, ns);
    if (found.length > 1) throw new Error(`Ambiguous slicer styles ${name}`);
    return found[0];
  };
  const create = (name, ns = MAIN) => doc.createElementNS(ns, ns === MAIN ? name : `x14:${name}`);
  const section = (name, following) => {
    let node = single(root, name);
    if (!node) {
      node = create(name);
      const next = Array.from(root.childNodes).find(n => n.namespaceURI === MAIN && following.includes(n.localName));
      root.insertBefore(node, next || null);
    }
    return node;
  };
  const ordinary = section('dxfs', ['tableStyles', 'colors', 'extLst']);
  const tables = section('tableStyles', ['colors', 'extLst']);
  const extensions = section('extLst', []);
  const extension = (uri, name) => {
    const found = kids(extensions, 'ext').filter(n => n.getAttribute('uri')?.toUpperCase() === uri);
    if (found.length > 1) throw new Error(`Ambiguous slicer styles ${name} extension`);
    let ext = found[0];
    if (!ext) { ext = create('ext'); ext.setAttribute('uri', uri); extensions.appendChild(ext); }
    let node = single(ext, name, X14);
    if (!node) { node = create(name, X14); ext.appendChild(node); }
    return node;
  };
  const extended = extension(DXFS, 'dxfs'), definitions = extension(STYLES, 'slicerStyles');
  if (!definitions.hasAttribute('defaultSlicerStyle')) definitions.setAttribute('defaultSlicerStyle', 'SlicerStyleLight1');
  const used = new Set([...kids(tables, 'tableStyle'), ...kids(definitions, 'slicerStyle', X14)].map(n => n.getAttribute('name').toLowerCase()));
  const intern = parent => {
    const entries = kids(parent, 'dxf'), indexes = new Map(entries.map((node, i) => [standaloneModelXml(node), i]));
    return paint => {
      const value = slicerPaintXml(paint, palette);
      if (!indexes.has(value)) {
        indexes.set(value, entries.length);
        const node = doc.importNode(parseModelXml(value), true);
        entries.push(node); parent.appendChild(node);
      }
      parent.setAttribute('count', String(entries.length));
      return indexes.get(value);
    };
  };
  const frameDxf = intern(ordinary), itemDxf = intern(extended), shared = new Map();
  let serial = 1;
  const names = formats.map(format => {
    const key = JSON.stringify(format);
    if (shared.has(key)) return shared.get(key);
    let name;
    do { name = `PuterSlicerStyle${serial++}`; } while (used.has(name.toLowerCase()));
    used.add(name.toLowerCase()); shared.set(key, name);
    const table = create('tableStyle');
    for (const [key, value] of Object.entries({ name, pivot: 0, table: 0, count: Object.keys(format.frame).length })) table.setAttribute(key, String(value));
    for (const [type, paint] of Object.entries(format.frame)) {
      const part = create('tableStyleElement'); part.setAttribute('type', type); part.setAttribute('dxfId', String(frameDxf(paint))); table.appendChild(part);
    }
    tables.appendChild(table);
    const style = create('slicerStyle', X14); style.setAttribute('name', name);
    const elements = create('slicerStyleElements', X14);
    for (const [type, paint] of Object.entries(format.items)) {
      const part = create('slicerStyleElement', X14); part.setAttribute('type', type); part.setAttribute('dxfId', String(itemDxf(paint))); elements.appendChild(part);
    }
    if (elements.childNodes.length) style.appendChild(elements);
    definitions.appendChild(style);
    return name;
  });
  for (const node of [ordinary, extended]) node.setAttribute('count', String(kids(node, 'dxf').length));
  tables.setAttribute('count', String(kids(tables, 'tableStyle').length));
  return { xml: standaloneModelXml(root), names };
}
