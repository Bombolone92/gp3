import { parseModelXml, modelChildren, standaloneModelXml } from './data-model-metadata.js';
import { parseRefText, refToText, MAX_ROW, MAX_COL } from './refs.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const TYPES = new Set(['data', 'default', 'sum', 'countA', 'avg', 'max', 'min', 'product', 'count', 'stdDev', 'stdDevP', 'var', 'varP', 'grand', 'blank']);
const fail = message => { throw new Error(`Invalid rebuilt pivot axis: ${message}`); };
const children = (node, name) => modelChildren(node, name, MAIN);
const one = (nodes, name) => { if (nodes.length !== 1) fail(name); return nodes[0]; };
// CT_PivotTableDefinition's child sequence, used when an optional axis is absent.
const order = ['location', 'pivotFields', 'rowFields', 'rowItems', 'colFields', 'colItems', 'pageFields', 'dataFields',
  'formats', 'conditionalFormats', 'chartFormats', 'pivotHierarchies', 'pivotTableStyleInfo', 'filters',
  'rowHierarchiesUsage', 'colHierarchiesUsage', 'extLst'];

/** Serialize rebuilt member axes. The caller must also update worksheet values,
 * styles and filter selections in the same transaction; this function only
 * returns new native metadata and a resized report range, without mutations.
 * CT_I r is a leading prefix of the preceding item; x addresses field items,
 * not cache shared items. The i attribute independently identifies the measure.
 */
export function writeNativePivotAxes(pivot, layout, { maxItems = 1048576 } = {}) {
  if (!Number.isSafeInteger(maxItems) || maxItems < 0) fail('item limit');
  const root = parseModelXml(pivot.xml);
  if (root.namespaceURI !== MAIN || root.localName !== 'pivotTableDefinition') fail('definition root');
  const doc = root.ownerDocument, make = name => doc.createElementNS(MAIN, root.prefix ? `${root.prefix}:${name}` : name);
  const location = one(children(root, 'location'), 'location');
  const range = parseRefText(pivot.ref || location.getAttribute('ref'));
  if (!range || !['cell', 'range'].includes(range.kind) || range.sheet) fail('report range');
  const fields = children(one(children(root, 'pivotFields'), 'pivot fields'), 'pivotField');
  const fieldItems = fields.map(field => {
    const lists = children(field, 'items'); if (lists.length > 1) fail('duplicate field items');
    return children(lists[0], 'item');
  });
  const measures = children(children(root, 'dataFields')[0], 'dataField').length;
  const replace = (name, node) => {
    const old = children(root, name);
    if (old.length > 1) fail(`duplicate ${name}`);
    if (old.length) root.replaceChild(node, old[0]);
    else {
      const after = Array.from(root.childNodes).find(child => child.nodeType === 1 && child.namespaceURI === MAIN && order.indexOf(child.localName) > order.indexOf(name));
      root.insertBefore(node, after || null);
    }
  };
  for (const [name, axis] of [['row', layout.rows], ['col', layout.columns]]) {
    if (!Array.isArray(axis?.fields) || !Array.isArray(axis.items) || axis.items.length > maxItems) fail('axis or item limit');
    if (children(root, `${name}Fields`).length > 1 || children(root, `${name}Items`).length > 1) fail('duplicate axis');
    const indexes = children(children(root, `${name}Fields`)[0], 'field').map(field => Number(field.getAttribute('x')));
    if (JSON.stringify(indexes) !== JSON.stringify(axis.fields)) fail('changed axis field order');
    const dimensions = indexes.filter(field => field !== -2);
    const hasMeasures = indexes.includes(-2);
    if (new Set(indexes).size !== indexes.length || dimensions.some(field => !Number.isInteger(field) || field < 0 || !fields[field])) fail('field index');
    if (hasMeasures && indexes.at(-1) !== -2) fail('outer measure layout');
    const node = make(`${name}Items`); node.setAttribute('count', String(axis.items.length));
    let previous = [];
    for (const entry of axis.items) {
      if (!TYPES.has(entry.type) || !Number.isInteger(entry.measure) || entry.measure < 0 || entry.measure >= Math.max(1, measures) || !hasMeasures && entry.measure !== 0) fail('item type or measure');
      if (!Array.isArray(entry.members) || entry.members.length > dimensions.length) fail('member prefix');
      const marker = entry.type === 'grand' || entry.type === 'blank';
      if (marker && entry.members.length) fail('marker members');
      const values = entry.members.map((member, position) => {
        if (member.field !== dimensions[position] || !Number.isInteger(member.item) || member.item < 0 || !Number.isInteger(member.index) || member.index < 0 || member.index > 4294967295) fail('member field order');
        const item = fieldItems[member.field][member.item];
        if (!item || (item.getAttribute('t') || 'data') !== 'data' || !item.hasAttribute('x') || Number(item.getAttribute('x')) !== member.index) fail('member identity');
        return member.item;
      });
      if (!marker && hasMeasures && values.length === dimensions.length) values.push(entry.measure);
      if (!values.length) values.push(0); // Native dummy index for totals/fieldless axes.
      let repeat = 0;
      if (!marker) while (repeat < Math.min(previous.length, values.length - 1) && previous[repeat] === values[repeat]) repeat++;
      const item = make('i');
      if (entry.type !== 'data') item.setAttribute('t', entry.type);
      if (entry.measure) item.setAttribute('i', String(entry.measure));
      if (repeat) item.setAttribute('r', String(repeat));
      for (const value of values.slice(repeat)) {
        const x = make('x'); if (value) x.setAttribute('v', String(value)); item.appendChild(x);
      }
      node.appendChild(item); previous = marker ? [] : values;
    }
    // CT_RowItems/CT_ColItems require at least one item when present.
    if (!axis.items.length) {
      for (const old of children(root, `${name}Items`)) root.removeChild(old);
    } else replace(`${name}Items`, node);
  }
  const offset = name => {
    const text = location.getAttribute(name), value = Number(text);
    if (!/^\d+$/.test(text || '') || !Number.isSafeInteger(value)) fail('data offset');
    return value;
  };
  const r2 = range.r1 + Math.max(1, offset('firstDataRow') + layout.rows.items.length) - 1;
  const c2 = range.c1 + Math.max(1, offset('firstDataCol') + layout.columns.items.length) - 1;
  if (r2 > MAX_ROW || c2 > MAX_COL) fail('worksheet bounds');
  const ref = refToText({ ...range, kind: 'range', r2, c2 });
  location.setAttribute('ref', ref);
  const xml = standaloneModelXml(root);
  // Enforce the same XML size/node/depth limits as the import boundary.
  parseModelXml(xml);
  return { ...pivot, ref, xml };
}
