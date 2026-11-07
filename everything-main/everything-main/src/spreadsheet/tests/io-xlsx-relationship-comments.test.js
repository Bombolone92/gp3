import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

const wrappers = [
  { kind: 'comment', wrap: (text) => `<!-- ${text} -->` },
  { kind: 'instruction', wrap: (text) => `<?note ${text} ?>` },
  { kind: 'stylesheet instruction', wrap: (text) => `<?xml-stylesheet ${text} ?>` },
];
const actualTarget = 'https://example.com/actual?x=1&y=2';

function relationshipFile(kind, wrap, position) {
  const book = XLSX.utils.book_new();
  if (kind === 'hyperlink') XLSX.utils.book_append_sheet(book, {
    '!ref': 'A1:B1', A1: { t: 's', v: 'Link', l: { Target: actualTarget } }, B1: { t: 'n', v: 17 },
  }, 'Data');
  else {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[42]]), 'Data');
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[99]]), 'Other');
  }
  const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  const entry = zip.FileIndex.find((e) => e.name === (kind === 'hyperlink' ? 'sheet1.xml.rels' : 'workbook.xml.rels'));
  let xml = new TextDecoder().decode(entry.content);
  const real = xml.match(/<Relationship\b[^>]*\/>/)[0];
  const phantom = kind === 'hyperlink' ? real.replace('/actual?', '/phantom?') : real.replace('sheet1.xml', 'sheet2.xml');
  const ignored = wrap(phantom);
  xml = xml.replace(real, position === 'before' ? ignored + real : real + ignored);
  entry.content = new TextEncoder().encode(xml);
  entry.size = entry.content.length;
  return XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' });
}

it.each(wrappers.flatMap(({ kind, wrap }) => ['before', 'after'].map((position) => ({ kind, wrap, position }))))(
  'keeps hyperlink targets despite a $kind $position the real relationship', async ({ wrap, position }) => {
    const bytes = relationshipFile('hyperlink', wrap, position);
    const raw = XLSX.read(bytes, { type: 'array' });
    expect(raw.Sheets.Data.A1.l.Target).toBe(actualTarget);
    let wb = await workbookFromFile(bytes, 'links.xlsx');
    for (let round = 0; round < 2; ++round) {
      expect(wb.linkAt(wb.activeSheetId, 0, 0)).toEqual({ url: actualTarget, label: 'Link' });
      expect(wb.getCell(wb.activeSheetId, 0, 0).hyperlink).toBe(actualTarget);
      expect(wb.getCell(wb.activeSheetId, 0, 0).f).toBeNull();
      expect(wb.getValue(wb.activeSheetId, 0, 1)).toBe(17);
      wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
    }
  },
);

it.each(wrappers.flatMap(({ kind, wrap }) => ['before', 'after'].map((position) => ({ kind, wrap, position }))))(
  'keeps worksheet data despite a $kind $position the real relationship', async ({ wrap, position }) => {
    let wb = await workbookFromFile(relationshipFile('worksheet', wrap, position), 'sheets.xlsx');
    for (let round = 0; round < 2; ++round) {
      expect(wb.sheets.map((s) => s.name)).toEqual(['Data', 'Other']);
      expect(wb.getValue(wb.sheetByName('Data').id, 0, 0)).toBe(42);
      expect(wb.getValue(wb.sheetByName('Other').id, 0, 0)).toBe(99);
      wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
    }
  },
);
