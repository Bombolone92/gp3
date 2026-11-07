import { externalProvenance } from './external-provenance.js';
import { normalizeExternalVisibility } from './external-visibility.js';
import { parseModelXml, modelChildren } from './data-model-metadata.js';
import { decodeXlsxString, encodeXlsxAttribute } from './xlsx-string.js';
import { xmlTag, xmlText } from './xlsx-export-styles.js';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS = 'urn:puter:spreadsheet:external-visibility:1';
const children = (node, name, ns = MAIN) => modelChildren(node, name, ns);
// ExternalRow has no hidden attribute. This optional application extension is
// not an Excel visibility feature. Ordinary chart caches still contain the
// visible plot. Do not trust this snapshot after another producer changes the
// source identity, cache contents, sheet identity or refresh status.
const signature = (target, sheet) => externalProvenance([target, sheet.name, sheet.cells, !!sheet.refreshError]).signature;
export function readExternalVisibility(root, target, sheets) {
  const entries = children(root, 'extLst').flatMap(list => children(list, 'ext'))
    .filter(ext => ext.getAttribute('uri') === NS)
    .flatMap(ext => children(ext, 'visibility', NS)).flatMap(v => children(v, 'sheet', NS));
  const byName = new Map();
  for (const entry of entries) {
    const name = decodeXlsxString(entry.getAttribute('name'));
    byName.set(name, byName.has(name) ? null : entry);
  }
  for (const sheet of sheets) {
    const entry = byName.get(sheet.name);
    if (!entry || sheet.cells == null || entry.getAttribute('signature') !== signature(target, sheet)) continue;
    try {
      const visibility = normalizeExternalVisibility(JSON.parse(entry.textContent));
      if (visibility) sheet.visibility = visibility;
    } catch { /* Optional malformed extensions cannot invalidate native values. */ }
  }
}
export function writeExternalVisibility(root, book) {
  const lists = children(root, 'extLst');
  for (const list of lists) for (const ext of children(list, 'ext')) if (ext.getAttribute('uri') === NS) list.removeChild(ext);
  const entries = book.sheets.filter(s => s.visibility && s.cells != null).map(sheet => xmlTag('v:sheet', {
    name: encodeXlsxAttribute(sheet.name), signature: signature(book.target, sheet),
  }, xmlText(JSON.stringify(sheet.visibility)))).join('');
  if (entries) {
    let list = lists[0];
    if (!list) { list = root.ownerDocument.createElementNS(MAIN, 'extLst'); root.appendChild(list); }
    const ext = parseModelXml(xmlTag('ext', { xmlns: MAIN, uri: NS }, xmlTag('v:visibility', { 'xmlns:v': NS }, entries)));
    list.appendChild(root.ownerDocument.importNode(ext, true));
  }
  for (const list of children(root, 'extLst')) if (!children(list, 'ext').length) root.removeChild(list);
}
