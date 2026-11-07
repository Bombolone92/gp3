import { parseModelXml, modelChildren } from './data-model-metadata.js';
import { xmlTag, xmlText } from './xlsx-export-styles.js';
import { normalizeNativeSparklineGroups, nativeSparklineFlags as flags, nativeSparklineColors as colors, nativeSparklineChoices as choices } from './native-sparklines.js';
export { normalizeNativeSparklineGroups } from './native-sparklines.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const X14 = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main';
const XM = 'http://schemas.microsoft.com/office/excel/2006/main';
const XR2 = 'http://schemas.microsoft.com/office/spreadsheetml/2015/revision2';
const URI = '{05C60535-1F16-4fd2-B633-F4F36F0B64E0}';
const fail = field => { throw new Error(`Invalid native sparkline ${field}`); };
const kids = (node, name, ns = X14) => modelChildren(node, name, ns);
const single = (node, name, ns = X14, required = false) => {
  const nodes = kids(node, name, ns);
  if (nodes.length > 1 || required && !nodes.length) fail(name);
  return nodes[0];
};
/** Read only worksheet-level extension content, never similarly named XML
 * in cell text, nested unrelated extensions, or a foreign namespace. */
export function readNativeSparklineGroups(xml) {
  if (!xml || !xml.includes('sparklineGroups')) return [];
  // Walk tags without building a DOM for the cell grid. Metadata limits apply
  // to the extensions, not to the worksheet's potentially millions of cells.
  let depth = 0, head = '', rootName = '', start = -1, extensions = '';
  const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE\b|<!ENTITY\b|<\/?[^!?\s<>/](?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
  for (const match of xml.matchAll(tokens)) {
    const tag = match[0];
    if (/^<!DOCTYPE|^<!ENTITY/i.test(tag)) throw new Error('XML declarations are unsupported');
    if (tag.startsWith('<!') || tag.startsWith('<?')) continue;
    const closing = tag.startsWith('</'), selfClosing = /\/\s*>$/.test(tag);
    const name = /^<\/?([^\s/>]+)/.exec(tag)[1];
    if (!closing && depth === 0) { head = tag; rootName = name; }
    if (!closing && depth === 1 && name.split(':').at(-1) === 'extLst') start = match.index;
    if (!closing && !selfClosing) depth++;
    if (closing) depth--;
    if (start >= 0 && depth === 1) { extensions += xml.slice(start, match.index + tag.length); start = -1; }
  }
  if (!head || !extensions) return [];
  const root = parseModelXml(`${head}${extensions}</${rootName}>`);
  if (root.localName !== 'worksheet' || root.namespaceURI !== MAIN) return [];
  const lists = kids(root, 'extLst', MAIN).flatMap(list => kids(list, 'ext', MAIN))
    .flatMap(ext => kids(ext, 'sparklineGroups'));
  const groups = lists.flatMap(list => kids(list, 'sparklineGroup')).map(node => {
    const group = {};
    for (const field of [...flags, ...Object.keys(choices), 'lineWeight', 'manualMin', 'manualMax']) {
      if (node.hasAttribute(field)) group[field] = node.getAttribute(field);
    }
    if (node.hasAttributeNS(XR2, 'uid')) group.uid = node.getAttributeNS(XR2, 'uid');
    for (const field of colors) {
      const entry = single(node, field);
      if (!entry) continue;
      if (entry.hasAttribute('auto')) fail('automatic color');
      group[field] = Object.fromEntries(['rgb', 'theme', 'indexed', 'tint'].filter(key => entry.hasAttribute(key)).map(key => [key, entry.getAttribute(key)]));
    }
    const dates = single(node, 'f', XM);
    if (dates) group.dateFormula = dates.textContent;
    group.sparklines = kids(single(node, 'sparklines', X14, true), 'sparkline').map(spark => ({
      ...(single(spark, 'f', XM) ? { formula: single(spark, 'f', XM).textContent } : {}),
      ref: single(spark, 'sqref', XM, true).textContent,
    }));
    return group;
  });
  return normalizeNativeSparklineGroups(groups);
}

/** Return an ext element for the worksheet's extLst. Existing unrelated
 * extensions must be retained by the caller. */
export function nativeSparklineExtension(groups) {
  const normalized = normalizeNativeSparklineGroups(groups);
  if (!normalized.length) return '';
  return xmlTag('ext', { uri: URI, 'xmlns:x14': X14, 'xmlns:xm': XM, ...(normalized.some(g => g.uid) ? { 'xmlns:xr2': XR2 } : {}) },
    xmlTag('x14:sparklineGroups', {}, normalized.map(group => {
      const attrs = {};
      for (const key of Object.keys(choices)) attrs[key] = group[key];
      for (const key of flags) attrs[key] = Number(group[key]);
      for (const key of ['lineWeight', 'manualMin', 'manualMax']) if (group[key] != null) attrs[key] = group[key];
      if (group.uid) attrs['xr2:uid'] = group.uid;
      return xmlTag('x14:sparklineGroup', attrs,
        colors.map(key => group[key] ? xmlTag(`x14:${key}`, group[key]) : '').join('')
        + (group.dateFormula ? xmlTag('xm:f', {}, xmlText(group.dateFormula)) : '')
        + xmlTag('x14:sparklines', {}, group.sparklines.map(spark => xmlTag('x14:sparkline', {},
          (spark.formula != null ? xmlTag('xm:f', {}, xmlText(spark.formula)) : '') + xmlTag('xm:sqref', {}, xmlText(spark.ref)))).join('')));
    }).join('')));
}
