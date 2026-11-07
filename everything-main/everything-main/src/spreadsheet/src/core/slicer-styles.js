import { modelChildren, standaloneModelXml } from './data-model-metadata.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const X14 = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main';
const kids = (node, name, ns = MAIN) => modelChildren(node, name, ns);
const fail = message => { throw new Error(`Invalid slicer style: ${message}`); };
const one = (nodes, label) => { if (nodes.length !== 1) fail(`missing or ambiguous ${label}`); return nodes[0]; };
const optional = (nodes, label) => { if (nodes.length > 1) fail(`ambiguous ${label}`); return nodes[0]; };
const extensions = (root, name) => kids(root, 'extLst').flatMap(n => kids(n, 'ext')).flatMap(n => kids(n, name, X14));
const styleName = (node, attr) => {
  const value = node.getAttribute(attr);
  if (!value || value.length > 255) fail(attr);
  return value;
};
const builtIn = name => /^SlicerStyle(?:(?:Light|Dark)[1-6]|Other[12])$/.test(name);
const itemTypes = new Set(['unselectedItemWithData', 'unselectedItemWithNoData', 'selectedItemWithData', 'selectedItemWithNoData',
  'hoveredUnselectedItemWithData', 'hoveredSelectedItemWithData', 'hoveredUnselectedItemWithNoData', 'hoveredSelectedItemWithNoData']);

/** MS-XLSX 2.3.2.4: frame/header parts refer to ordinary dxfs; slicer item
 * states refer to the x14 dxfs extension. Keep exact DXF XML, including gradient
 * fills and theme colors, for subsequent rendering and native serialization.
 */
export function readSlicerStyles(root, requested = []) {
  if (root && (root.namespaceURI !== MAIN || root.localName !== 'styleSheet')) fail('root');
  const list = optional(extensions(root, 'slicerStyles'), 'slicerStyles');
  const defaultStyle = list ? styleName(list, 'defaultSlicerStyle') : null;
  const ordinary = kids(optional(kids(root, 'dxfs'), 'dxfs'), 'dxf');
  const extended = kids(optional(extensions(root, 'dxfs'), 'extended dxfs'), 'dxf');
  const definitions = kids(list, 'slicerStyle', X14), byName = new Map();
  for (const definition of definitions) {
    const name = styleName(definition, 'name');
    if (byName.has(name)) fail('duplicate slicer style');
    byName.set(name, definition);
  }
  const tables = kids(optional(kids(root, 'tableStyles'), 'tableStyles'), 'tableStyle');
  const dxf = (part, source) => {
    if (!part.hasAttribute('dxfId')) return null;
    const text = part.getAttribute('dxfId').trim(), id = Number(text);
    if (!/^\+?\d+$/.test(text) || !Number.isSafeInteger(id) || !source[id]) fail('dxf reference');
    return standaloneModelXml(source[id]);
  };
  const result = [];
  for (const name of new Set(requested.map(name => name || defaultStyle).filter(Boolean))) {
    const definition = byName.get(name);
    if (!definition) {
      if (!builtIn(name)) fail(`missing definition ${name}`);
      result.push({ name, builtIn: true }); continue;
    }
    const table = one(tables.filter(t => t.getAttribute('name') === name), 'base table style');
    if (!['0', 'false'].includes(table.getAttribute('table')) || !['0', 'false'].includes(table.getAttribute('pivot'))) fail('base table style flags');
    const frame = {}, items = {};
    for (const part of kids(table, 'tableStyleElement')) {
      const type = part.getAttribute('type');
      if (!type || Object.hasOwn(frame, type)) fail('duplicate or missing table style element');
      Object.defineProperty(frame, type, { value: dxf(part, ordinary), enumerable: true });
    }
    const itemList = optional(kids(definition, 'slicerStyleElements', X14), 'slicerStyleElements');
    for (const part of kids(itemList, 'slicerStyleElement', X14)) {
      const type = part.getAttribute('type');
      if (!itemTypes.has(type) || Object.hasOwn(items, type)) fail('duplicate or invalid item style element');
      items[type] = dxf(part, extended);
    }
    result.push({ name, builtIn: false, frame, items,
      tableXml: standaloneModelXml(table), slicerXml: standaloneModelXml(definition) });
  }
  return { defaultStyle, styles: result };
}
