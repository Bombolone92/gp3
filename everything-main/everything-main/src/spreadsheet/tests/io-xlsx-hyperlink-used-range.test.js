import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

function hyperlinkFile({ dataCell = 'A1', dimension = 'A1', refs = ['C5'] } = {}) {
  const book = XLSX.utils.book_new();
  const ws = dataCell ? { '!ref': dataCell, [dataCell]: { t: 's', v: 'Keep' } } : {};
  XLSX.utils.book_append_sheet(book, ws, 'Data');
  const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  const entry = zip.FileIndex.find((e) => e.name === 'sheet1.xml');
  let xml = new TextDecoder().decode(entry.content).replace(/<dimension\b[^>]*\/>/, dimension ? `<dimension ref="${dimension}"/>` : '');
  xml = xml.replace('</worksheet>', `<hyperlinks>${refs.map((ref) => `<hyperlink ref="${ref}" location="Data!A1"/>`).join('')}</hyperlinks></worksheet>`);
  entry.content = new TextEncoder().encode(xml);
  entry.size = entry.content.length;
  return XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' });
}

const scenarios = [
  { name: 'outside declared bounds', options: {}, range: 'A1:C5', cells: ['C5'] },
  { name: 'without a dimension', options: { dimension: null }, range: 'A1:C5', cells: ['C5'] },
  { name: 'above existing data', options: { dataCell: 'D8', dimension: 'D8', refs: ['A1'] }, range: 'A1:D8', cells: ['A1'] },
  { name: 'an otherwise empty sheet', options: { dataCell: null, dimension: null }, range: 'C5', cells: ['C5'] },
  { name: 'multiple hyperlink ranges', options: { refs: ['C5:D6', 'F8'] }, range: 'A1:F8', cells: ['C5', 'D5', 'C6', 'D6', 'F8'] },
];

it.each(scenarios.flatMap((scenario) => [false, true].map((dense) => ({ ...scenario, dense }))))(
  'retains links $name with dense=$dense', async ({ options, range, cells, dense }) => {
    const bytes = hyperlinkFile(options);
    const raw = XLSX.read(bytes, { type: 'array', dense });
    expect(raw.Sheets.Data['!ref']).toBe(range);
    for (const address of cells) {
      const { r, c } = XLSX.utils.decode_cell(address);
      expect((dense ? raw.Sheets.Data['!data'][r][c] : raw.Sheets.Data[address]).l.Target).toBe('#Data!A1');
    }
    let wb = await workbookFromFile(bytes, 'used-range.xlsx');
    for (let round = 0; round < 2; ++round) {
      for (const address of cells) {
        const { r, c } = XLSX.utils.decode_cell(address);
        expect(wb.linkAt(wb.activeSheetId, r, c)?.url).toBe('#Data!A1');
      }
      if (options.dataCell !== null) {
        const { r, c } = XLSX.utils.decode_cell(options.dataCell || 'A1');
        expect(wb.getValue(wb.activeSheetId, r, c)).toBe('Keep');
      }
      wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
    }
  },
);

it.each([false, true].flatMap((dense) => [null, 'A1'].map((dimension) => ({ dense, dimension }))))(
  'respects sheetRows while tracking the full hyperlink extent: %j', ({ dense, dimension }) => {
    const sheet = XLSX.read(hyperlinkFile({ dimension, refs: ['C2:C5', 'E8'] }), { type: 'array', dense, sheetRows: 3 }).Sheets.Data;
    expect(sheet['!ref']).toBe('A1:C3');
    expect(sheet['!fullref']).toBe('A1:E8');
    for (const r of [1, 2]) expect((dense ? sheet['!data'][r][2] : sheet[`C${r + 1}`]).l.Target).toBe('#Data!A1');
    if (dense) expect(sheet['!data']).toHaveLength(3);
    else for (const address of ['C4', 'C5', 'E8']) expect(sheet[address]).toBeUndefined();
  },
);

it('keeps nodim behavior while including blank linked cells', () => {
  const sheet = XLSX.read(hyperlinkFile({ dataCell: 'D8', dimension: 'A1:XFD1048576', refs: ['F9'] }), { type: 'array', nodim: true }).Sheets.Data;
  expect(sheet['!ref']).toBe('A1:F9');
  expect(sheet.F9.l.Target).toBe('#Data!A1');
});

it.each(['XFE1', 'A1 trailing'])('does not extend used bounds for invalid hyperlink reference %s', (ref) => {
  const sheet = XLSX.read(hyperlinkFile({ refs: [ref] }), { type: 'array' }).Sheets.Data;
  expect(sheet['!ref']).toBe('A1');
});
