import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds } from '../src/core/io.js';

const parser = new (new JSDOM('').window.DOMParser)();
const ns = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const quote = (s) => `'${s.replaceAll("'", "''")}'`;
const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const docOf = (bytes) => {
  const zip = X.CFB.read(bytes, { type: 'array' });
  return parser.parseFromString(new TextDecoder().decode(X.CFB.find(zip, 'content.xml').content), 'application/xml');
};
const spans = [
  { names: ['First', 'Last'], qualifier: 'First:Last', ends: ['First', 'Last'] },
  ...[['Jan Data', 'Mar Data'], ["Jan's.data", "Mar's!data"], ['一月', '三月'], ['A & B', 'C "D"']].map((names) =>
    ({ names, qualifier: quote(names.join(':')), ends: names.map(quote) })),
  { names: ['Jan Data', 'Mar Data'], qualifier: "'Jan Data':'Mar Data'", ends: ["'Jan Data'", "'Mar Data'"] },
];

it.each(spans.flatMap((span) => [false, true].map((range) => ({ ...span, range }))))(
  'preserves named span $qualifier (range=$range) through repeated ODS saves', async ({ names, qualifier, ends, range }) => {
    let wb = new Workbook(); wb.renameSheet(wb.activeSheetId, names[0]);
    wb.addSheet('Middle'); wb.addSheet(names[1]);
    for (const sheet of wb.sheets) { wb.setInput(sheet.id, 0, 0, '10'); wb.setInput(sheet.id, 1, 1, '2'); }
    const cells = range ? '$A$1:$B$2' : '$A$1';
    wb.defineName('Across', `${qualifier}!${cells}`);
    wb.setInput(wb.sheets[0].id, 3, 3, '=SUM(Across)');
    expect(wb.getValue(wb.sheets[0].id, 3, 3)).toBe(range ? 36 : 30);
    for (let i = 0; i < 2; i++) {
      const bytes = new Uint8Array(await (await workbookToOds(wb)).arrayBuffer());
      const node = docOf(bytes).getElementsByTagNameNS(ns, 'named-range')[0];
      expect(node.getAttributeNS(ns, 'cell-range-address')).toBe(`$${ends[0]}.$A$1:$${ends[1]}.${range ? '$B$2' : '$A$1'}`);
      expect(node.getAttributeNS(ns, 'base-cell-address')).toBe(`$${ends[0]}.$A$1`);
      wb = await workbookFromFile(bytes, 'spans.ods');
      expect(wb.getValue(wb.sheets[0].id, 3, 3)).toBe(range ? 36 : 30);
    }
    wb.setInput(wb.sheets[2].id, 0, 0, '40');
    expect(wb.getValue(wb.sheets[0].id, 3, 3)).toBe(range ? 66 : 60);
    wb.undo(); expect(wb.getValue(wb.sheets[0].id, 3, 3)).toBe(range ? 36 : 30);
    wb.renameSheet(wb.sheets[2].id, 'Renamed end');
    expect(wb.getValue(wb.sheets[0].id, 3, 3)).toBe(range ? 36 : 30);
  },
);

it.each(spans.slice(1, 5))('exports the quoted span $qualifier in ordinary formulas too', async ({ names, qualifier, ends }) => {
  const wb = new Workbook(); wb.renameSheet(wb.activeSheetId, names[0]); wb.addSheet(names[1]);
  for (const sheet of wb.sheets) wb.setInput(sheet.id, 0, 0, '10');
  wb.setInput(wb.sheets[0].id, 1, 1, `=SUM(${qualifier}!A1)`);
  const bytes = new Uint8Array(await (await workbookToOds(wb)).arrayBuffer());
  const cells = [...docOf(bytes).getElementsByTagNameNS(ns, 'table-cell')];
  expect(cells.find((n) => n.hasAttributeNS(ns, 'formula')).getAttributeNS(ns, 'formula'))
    .toBe(`of:=SUM([$${ends[0]}.A1:$${ends[1]}.A1])`);
  const copy = await workbookFromFile(bytes, 'formula-span.ods');
  expect(copy.getValue(copy.sheets[0].id, 1, 1)).toBe(20);
});

it.each(['fods', 'ods'].flatMap((format) => [false, true].map((local) => ({ format, local }))))(
  'reads a hand-written named span from $format (local=$local)', async ({ format, local }) => {
    const name = `<table:named-expressions><table:named-range table:name="Across" table:cell-range-address="$'Jan Data'.$A$1:$'Mar Data'.$A$1" table:base-cell-address="$'Jan Data'.$A$1"/></table:named-expressions>`;
    const root = format === 'ods' ? 'document-content' : 'document';
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<office:${root} xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="${ns}" office:mimetype="application/vnd.oasis.opendocument.spreadsheet" office:version="1.2"><office:body><office:spreadsheet>${['Jan Data', 'Middle', 'Mar Data'].map((s, i) => `<table:table table:name="${escape(s)}"><table:table-row><table:table-cell office:value-type="float" office:value="${i + 1}"/></table:table-row>${local && i === 0 ? name : ''}</table:table>`).join('')}${local ? '' : name}</office:spreadsheet></office:body></office:${root}>`;
    let bytes = new TextEncoder().encode(xml);
    if (format === 'ods') {
      const book = X.utils.book_new(); X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([[0]]), 'Data');
      const zip = X.CFB.read(new Uint8Array(X.write(book, { type: 'array', bookType: 'ods' })), { type: 'array' });
      X.CFB.utils.cfb_add(zip, 'content.xml', bytes); bytes = X.CFB.write(zip, { type: 'array', fileType: 'zip' });
    }
    const raw = X.read(bytes, { type: 'array' });
    expect(raw.Workbook.Names[0]).toEqual({ Name: 'Across', Ref: "'Jan Data:Mar Data'!$A$1:$A$1", ...(local ? { Sheet: 0 } : {}) });
    const wb = await workbookFromFile(bytes, `independent.${format}`);
    wb.setInput(wb.sheets[0].id, 1, 1, '=SUM(Across)');
    expect(wb.getValue(wb.sheets[0].id, 1, 1)).toBe(6);
  },
);
