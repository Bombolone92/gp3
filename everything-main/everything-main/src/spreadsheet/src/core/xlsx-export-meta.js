/** Refresh the private sidecar after native export baselines are known. */
import { xmlTag as tag, xmlText } from './xlsx-export-styles.js';
import { xlsxAttr } from './xlsx-styles.js';
import { stringifyXlsxMetadata } from './xlsx-metadata-codec.js';

export function writeExportMetadata(X, book, { get, set }) {
  const meta = book.PuterExportMeta;
  if (!meta) return;
  const json = stringifyXlsxMetadata(meta.data), chunks = [];
  // Excel's per-cell string limit is 32,767 UTF-16 code units. Leave the same
  // headroom as the metadata writer, and never split a surrogate pair.
  for (let start = 0; start < json.length;) {
    let end = Math.min(start + 30000, json.length);
    if (end < json.length && /[\uD800-\uDBFF]/.test(json[end - 1])) end++;
    chunks.push(json.slice(start, end)); start = end;
  }
  const part = `/xl/worksheets/sheet${book.SheetNames.indexOf(meta.name) + 1}.xml`;
  let xml = get(part);
  const rows = new Map();
  for (const m of xml.matchAll(/<row\b[^>]*>[\s\S]*?<\/row>/g)) {
    const r = Number(xlsxAttr(m[0], 'r'));
    // Validation helper lists occupy other columns on this same hidden sheet.
    rows.set(r, m[0].replace(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g, cell => /^A\d+$/.test(xlsxAttr(cell, 'r') || '') ? '' : cell));
  }
  chunks.forEach((chunk, i) => {
    // SpreadsheetML inline strings use ST_Xstring escapes in addition to XML
    // entities. Escape literal markers first, then XML-disallowed code units.
    const text = chunk.replace(/_x[\da-f]{4}_/gi, s => '_x005F_' + s.slice(1))
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, ch => `_x${ch.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()}_`);
    const r = i + 1, cell = tag('c', { r: `A${r}`, t: 'inlineStr' }, tag('is', {}, tag('t', { 'xml:space': 'preserve' }, xmlText(text))));
    rows.set(r, rows.has(r) ? rows.get(r).replace(/<row\b[^>]*>/, head => head + cell) : tag('row', { r }, cell));
  });
  xml = xml.replace(/<sheetData>[\s\S]*?<\/sheetData>/, () => tag('sheetData', {}, [...rows].sort(([a], [b]) => a - b).map(([, row]) => row).join('')));
  const dimension = xml.match(/<dimension\b[^>]*\/>/)?.[0], ref = dimension && xlsxAttr(dimension, 'ref');
  if (ref) {
    const range = X.utils.decode_range(ref); range.e.r = Math.max(range.e.r, chunks.length - 1);
    xml = xml.replace(dimension, tag('dimension', { ref: X.utils.encode_range(range) }));
  }
  set(part, xml);
}
