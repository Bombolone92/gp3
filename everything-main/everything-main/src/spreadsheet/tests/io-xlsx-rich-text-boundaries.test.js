import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

const cases = [
  ...Array.from({ length: 6 }, (_, i) => ({
    runs: ['_x0041_'.slice(0, i + 1), '_x0041_'.slice(i + 1)], expected: '_x0041_',
  })),
  { runs: ['_', 'x', '0', '0', '4', '1', '_'], expected: '_x0041_' },
  { runs: ['before_x00', '0D_\nafter'], expected: 'before_x000D_\nafter' },
  { runs: ['_x0041_', '_x0042_'], expected: 'AB' },
  { runs: ['_x005F_x0041_', '_x0042_'], expected: '_x0041_B' },
  { runs: ['_xD83D_', '_xDE00_'], expected: '😀' },
  { runs: ['😀_x00', '41_😀'], expected: '😀_x0041_😀' },
  { runs: ['&#x1F600;', '&#128512;'], expected: '😀😀' },
  { runs: ['&amp;', 'amp;'], expected: '&amp;' },
  { runs: ['before_x000D_', '\nafter'], expected: 'before\r\nafter' },
  { runs: ['', ' plain ', '', 'text ', ''], expected: ' plain text ' },
];

function richTextFile(runs, mode, namespaced) {
  const book = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['SENTINEL']]);
  ws.A2 = { t: 's', v: 'cached', f: 'A1' };
  ws['!ref'] = 'A1:A2';
  XLSX.utils.book_append_sheet(book, ws, 'Data');
  const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx', bookSST: mode === 'shared' })), { type: 'array' });
  const entry = zip.FileIndex.find((e) => e.name === (mode === 'shared' ? 'sharedStrings.xml' : 'sheet1.xml'));
  const prefix = namespaced ? 'q:' : '';
  const namespace = namespaced ? ' xmlns:q="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' : '';
  const rich = runs.map((run, i) => `<${prefix}r${namespace}><${prefix}rPr><${prefix}${i % 2 ? 'i' : 'b'}/></${prefix}rPr><${prefix}t xml:space="preserve">${run}</${prefix}t></${prefix}r>`).join('')
    + `<${prefix}rPh${namespace} sb="0" eb="1"><${prefix}t>phonetic annotation</${prefix}t></${prefix}rPh>`;
  let xml = new TextDecoder().decode(entry.content);
  if (mode === 'shared') xml = xml.replace('<t>SENTINEL</t>', rich);
  else xml = xml.replace('t="str"', 't="inlineStr"').replace('<v>SENTINEL</v>', `<is>${rich}</is>`);
  expect(xml).not.toContain('SENTINEL');
  entry.content = new TextEncoder().encode(xml);
  entry.size = entry.content.length;
  return XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' });
}

it.each(['shared', 'inline'].flatMap((mode) => [false, true].flatMap((namespaced) => cases.map((c) => ({ mode, namespaced, ...c })))))(
  'decodes each rich-text run independently: %j', async ({ mode, namespaced, runs, expected }) => {
    const bytes = richTextFile(runs, mode, namespaced);
    const raw = XLSX.read(bytes, { type: 'array' });
    expect(raw.Sheets.Data.A1.v).toBe(expected);
    // The library can also save the original rich-text XML instead of flattening it.
    const resaved = XLSX.write(raw, { type: 'array', bookType: 'xlsx', bookSST: true });
    expect(XLSX.read(resaved, { type: 'array' }).Sheets.Data.A1.v).toBe(expected);
    let wb = await workbookFromFile(bytes, 'rich.xlsx');
    for (let round = 0; round < 2; ++round) {
      expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(expected);
      expect(wb.getValue(wb.activeSheetId, 1, 0)).toBe(expected);
      wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
    }
  },
);
