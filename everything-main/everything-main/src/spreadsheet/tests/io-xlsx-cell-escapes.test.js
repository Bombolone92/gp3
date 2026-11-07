import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

it.each(['shared', 'inline'].flatMap((mode) => [
  ['\r', '\n', '\n\n'], ['_x000D_', '\n', '\r\n'],
  ['&#13;', '&#10;', '\r\n'], ['\r\n', '\r', '\n\n'],
].map(([left, right, expected]) => ({ mode, left, right, expected }))))(
  'handles line endings at rich-text run boundaries: %j', async ({ mode, left, right, expected }) => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['SENTINEL']]), 'Data');
    const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx', bookSST: mode === 'shared' })), { type: 'array' });
    const entry = zip.FileIndex.find((e) => e.name === (mode === 'shared' ? 'sharedStrings.xml' : 'sheet1.xml'));
    const runs = `<r><rPr><b/></rPr><t>before${left}</t></r><r><t>${right}after</t></r>`;
    let xml = new TextDecoder().decode(entry.content);
    if (mode === 'shared') xml = xml.replace('<t>SENTINEL</t>', runs);
    else xml = xml.replace('t="str"', 't="inlineStr"').replace('<v>SENTINEL</v>', `<is>${runs}</is>`);
    entry.content = new TextEncoder().encode(xml);
    entry.size = entry.content.length;
    let wb = await workbookFromFile(XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'rich.xlsx');
    expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(`before${expected}after`);
    wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
    expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(`before${expected}after`);
  },
);

const values = [
  '_x0041_', '_x005F_', '_x005F_x0041_', '_x0041_x0042_', '_x0041__x0042_',
  '_X00aF_', '_xD83D__xDE00_', '&_x003C_<', '_x123_', '_xGGGG_',
  '&amp;', '&#65;', '&#x1F600;', '😀 &amp; _x0041_',
  'line\r_x000D_', 'line\n_x000A_', 'tab\t_x0009_', ' plain text ',
  'before\r\nafter', '\r\n', 'a\rb\nc\r\nd\r\r\ne', '😀\r\n_x000D_\r\n',
];
it.each(['app', 'str', 'shared'].flatMap((mode) => values.map((value) => ({ mode, value })) ))(
  'preserves literal cell text and cached formula strings: %j', async ({ mode, value }) => {
    let wb;
    let data;
    if (mode === 'app') {
      wb = new Workbook();
      wb.setCells(wb.activeSheetId, [
        { r: 0, c: 0, cell: { v: value } }, { r: 1, c: 0, cell: { v: value } },
        { r: 2, c: 0, cell: { f: 'A1' } },
        { r: 0, c: 1, cell: { v: 123.125 } }, { r: 1, c: 1, cell: { v: true } },
      ]);
    } else {
      const book = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([[value, 123.125], [value, true]]);
      ws.A3 = { t: 's', v: value, f: 'A1' };
      ws['!ref'] = 'A1:B3';
      XLSX.utils.book_append_sheet(book, ws, 'Data');
      data = XLSX.write(book, { type: 'array', bookType: 'xlsx', bookSST: mode === 'shared' });
    }
    for (let round = 0; round < 3; ++round) {
      if (wb) data = await (await workbookToXlsx(wb)).arrayBuffer();
      const raw = XLSX.read(data, { type: 'array' });
      const sheet = raw.Sheets[raw.SheetNames[0]];
      for (const address of ['A1', 'A2', 'A3']) expect(sheet[address].v).toBe(value);
      expect(sheet.A3.f).toBe('A1');
      expect(sheet.B1).toMatchObject({ t: 'n', v: 123.125 });
      expect(sheet.B2).toMatchObject({ t: 'b', v: true });
      wb = await workbookFromFile(data, 'strings.xlsx');
      for (let r = 0; r < 3; ++r) expect(wb.getValue(wb.activeSheetId, r, 0)).toBe(value);
    }
  },
);

it.each([false, true])('keeps a maximum-length decoded string with bookSST=%s', (bookSST) => {
  const value = '_x0041_'.repeat(4681); // 32767 decoded characters.
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[value]]), 'Data');
  const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx', bookSST });
  const back = XLSX.read(bytes, { type: 'array' });
  expect(back.Sheets.Data.A1.v.length).toBe(value.length);
  expect(back.Sheets.Data.A1.v).toBe(value);
});

it.each([false, true])('writes Xstring protection while retaining XML whitespace with bookSST=%s', (bookSST) => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['_x0041_\n\t\r_x000D_']]), 'Data');
  const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx', bookSST })), { type: 'array' });
  const xml = new TextDecoder().decode(zip.FileIndex.find((entry) => entry.name === (bookSST ? 'sharedStrings.xml' : 'sheet1.xml')).content);
  expect(xml).toContain('_x005F_x0041_\n\t_x000d__x005F_x000D_');
  if (bookSST) expect(xml).toContain('xml:space="preserve"');
});

it.each(['str', 'shared', 'inline', 'rich'].flatMap((mode) => [
  ['_x0041_', 'A'], ['_x005F_x0041_', '_x0041_'], ['&amp;amp;', '&amp;'], ['&#65;', 'A'],
  ['&#x1F600;', '😀'], ['&#128512;', '😀'],
  ['&#x10000;', '\u{10000}'], ['&#65536;', '\u{10000}'],
  ['&#x10FFFF;', '\u{10FFFF}'], ['&#1114111;', '\u{10FFFF}'],
  ['&#x20000;', '\u{20000}'], ['&#x20AC;&#8364;', '€€'],
  ['before &#x1f600; &amp; &#128512; after', 'before 😀 & 😀 after'],
  ['_xD83D__xDE00_', '😀'], ['&amp;#x1F600;', '&#x1F600;'],
  ['&#x110000;', '&#x110000;'], ['&#999999999999999999999999;', '&#999999999999999999999999;'],
  ['before_x000D_\nafter', 'before\r\nafter'],
  ['before&#13;\nafter', 'before\r\nafter'], ['before&#xD;&#xA;after', 'before\r\nafter'],
  ['before_x000D__x000A_after', 'before\r\nafter'],
  ['before\r\nafter', 'before\nafter'], ['before\rafter', 'before\nafter'],
  ['before\r&#10;after', 'before\n\nafter'], ['before\r_x000A_after', 'before\n\nafter'],
  ['before_x005F_x000D_\nafter', 'before_x000D_\nafter'],
].map(([encoded, expected]) => ({ mode, encoded, expected }))))(
  'decodes external cell strings exactly once: %j', async ({ mode, encoded, expected }) => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['SENTINEL']]), 'Data');
    const shared = mode === 'shared' || mode === 'rich';
    const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx', bookSST: shared })), { type: 'array' });
    const entry = zip.FileIndex.find((entry) => entry.name === (shared ? 'sharedStrings.xml' : 'sheet1.xml'));
    let xml = new TextDecoder().decode(entry.content);
    if (mode === 'inline') xml = xml.replace('t="str"', 't="inlineStr"').replace('<v>SENTINEL</v>', '<is><t>SENTINEL</t></is>');
    if (mode === 'rich') xml = xml.replace('<t>SENTINEL</t>', '<r><rPr><b/></rPr><t>SENTINEL</t></r>');
    entry.content = new TextEncoder().encode(xml.replaceAll('SENTINEL', encoded));
    entry.size = entry.content.length;
    const bytes = XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' });
    let wb = await workbookFromFile(bytes, 'external.xlsx');
    expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(expected);
    wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
    expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(expected);
  },
);
