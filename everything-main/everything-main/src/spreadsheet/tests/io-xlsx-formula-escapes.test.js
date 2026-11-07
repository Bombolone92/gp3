import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

it.each(['&#x1F600;', '&#128512;'])('decodes Unicode XML references consistently across workbook parts: %s', async (encoded) => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, { '!ref': 'A1', A1: { t: 'n', v: 7, z: '0" SENTINEL"' } }, 'SENTINEL');
  XLSX.utils.book_append_sheet(book, {
    '!ref': 'A1:C1', A1: { t: 'n', v: 7, f: "'SENTINEL'!A1" },
    B1: { t: 's', v: 'SENTINEL', f: '"SENTINEL"' }, C1: { t: 'n', v: 7, f: 'SourceValue' },
  }, 'Results');
  book.Workbook = { Names: [{ Name: 'SourceValue', Ref: "'SENTINEL'!$A$1" }] };
  const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  for (const entry of zip.FileIndex) {
    if (!entry.name.endsWith('.xml')) continue;
    entry.content = new TextEncoder().encode(new TextDecoder().decode(entry.content).replaceAll('SENTINEL', encoded));
    entry.size = entry.content.length;
  }
  let wb = await workbookFromFile(XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'unicode.xlsx');
  for (let round = 0; round < 2; ++round) {
    expect(wb.sheets.map((s) => s.name)).toEqual(['😀', 'Results']);
    const sourceId = wb.sheetByName('😀').id;
    expect(wb.getCell(sourceId, 0, 0).s.code).toBe('0" 😀"');
    expect(wb.getDisplay(sourceId, 0, 0)).toBe('7 😀');
    const resultId = wb.sheetByName('Results').id;
    expect(wb.getCell(resultId, 0, 0).f).toBe("'😀'!A1");
    expect(wb.getCell(resultId, 0, 1).f).toBe('"😀"');
    expect(wb.names.find((n) => n.name === 'SourceValue').ref).toBe("'😀'!$A$1");
    expect([0, 1, 2].map((c) => wb.getValue(resultId, 0, c))).toEqual([7, '😀', 7]);
    wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  }
});

it.each(['_x0041_', '_x005F_', '_x005F_x0041_', '_x0041_x0042_', '_X00aF_', '_xD83D__xDE00_', '&amp;', 'a < b & "quoted"', 'line\r_x000D_', '😀_x0041_', 'before\r\nafter', '\r\n', 'a\rb\nc\r\nd\r\r\ne', '😀\r\n_x000D_\r\n'])(
  'preserves formula literals through repeated XLSX saves: %j', async (literal) => {
    const quoted = `"${literal.replaceAll('"', '""')}"`;
    const formulas = [quoted, `${quoted}&A1`, `IF(A1=5,${quoted},"no")`];
    let wb = new Workbook();
    wb.setCells(wb.activeSheetId, [
      { r: 0, c: 0, cell: { v: 5 } },
      ...formulas.map((f, r) => ({ r, c: 1, cell: { f } })),
    ]);
    for (let round = 0; round < 3; ++round) {
      const data = await (await workbookToXlsx(wb)).arrayBuffer();
      const raw = XLSX.read(data, { type: 'array' });
      const sheet = raw.Sheets[raw.SheetNames[0]];
      for (let r = 0; r < 3; ++r) expect(sheet[`B${r + 1}`].f).toBe(formulas[r]);
      wb = await workbookFromFile(data, 'formulas.xlsx');
      for (let r = 0; r < 3; ++r) {
        expect(wb.getCell(wb.activeSheetId, r, 1).f).toBe(formulas[r]);
        expect(wb.getValue(wb.activeSheetId, r, 1)).toBe(r === 1 ? `${literal}5` : literal);
      }
    }
  },
);

it.each(['_x0041_', '_x0041_x0042_', 'Data_x005F_', "O'Brien_x0041_"])(
  'keeps sheet names, direct references, named references, and sidecar styling consistent: %s', async (name) => {
    let wb = new Workbook();
    wb.renameSheet(wb.activeSheetId, name);
    wb.setCells(wb.activeSheetId, [{ r: 0, c: 0, cell: { v: 42, s: { bold: true } } }]);
    const ref = `'${name.replaceAll("'", "''")}'!$A$1`;
    expect(wb.defineName('SourceValue', ref)).toBeNull();
    expect(wb.defineName('Label', '"_x0041_"')).toBeNull();
    const result = wb.addSheet('Results');
    wb.setCells(result.id, [{ r: 0, c: 0, cell: { f: ref } }, { r: 1, c: 0, cell: { f: 'SourceValue' } }, { r: 2, c: 0, cell: { f: 'Label' } }]);
    for (let round = 0; round < 2; ++round) {
      wb = await workbookFromFile(await workbookToXlsx(wb), 'references.xlsx');
      expect(wb.sheets.map((s) => s.name)).toEqual([name, 'Results']);
      expect(wb.getCell(wb.sheetByName(name).id, 0, 0).s.bold).toBe(true);
      const id = wb.sheetByName('Results').id;
      expect(wb.getCell(id, 0, 0).f).toBe(ref);
      expect(wb.names.find((n) => n.name === 'SourceValue').ref).toBe(ref);
      expect(wb.getValue(id, 0, 0)).toBe(42);
      expect(wb.getValue(id, 1, 0)).toBe(42);
      expect(wb.getValue(id, 2, 0)).toBe('_x0041_');
    }
  },
);

it('preserves escaped literals when importing and resaving shared formulas', async () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, { '!ref': 'A1:B2', A1: { t: 's', v: '_x0041_5', f: '"SENTINEL"&B1' }, A2: { t: 's', v: '_x0041_6', f: '"SENTINEL"&B2' }, B1: { t: 'n', v: 5 }, B2: { t: 'n', v: 6 } }, 'Data');
  const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  const entry = zip.FileIndex.find((e) => e.name === 'sheet1.xml');
  const xml = new TextDecoder().decode(entry.content)
    .replace('<f>&quot;SENTINEL&quot;&amp;B1</f>', '<f t="shared" si="0" ref="A1:A2">&quot;_x005F_x0041_&quot;&amp;B1</f>')
    .replace('<f>&quot;SENTINEL&quot;&amp;B2</f>', '<f t="shared" si="0"/>');
  expect(xml).toContain('t="shared"');
  entry.content = new TextEncoder().encode(xml);
  entry.size = entry.content.length;
  let wb = await workbookFromFile(XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'shared.xlsx');
  for (let round = 0; round < 2; ++round) {
    for (let r = 0; r < 2; ++r) {
      expect(wb.getCell(wb.activeSheetId, r, 0).f).toBe(`"_x0041_"&B${r + 1}`);
      expect(wb.getValue(wb.activeSheetId, r, 0)).toBe(`_x0041_${r + 5}`);
    }
    wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  }
});

it.each([
  ['before_x000D_\nafter', 'before\r\nafter'],
  ['before&#13;&#10;after', 'before\r\nafter'],
  ['before\r\nafter', 'before\nafter'], ['before\rafter', 'before\nafter'],
])('keeps line endings consistent in shared formula anchors and followers: %j', async (encoded, expected) => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, {
    '!ref': 'A1:B2', A1: { t: 's', v: 'cached', f: '"SENTINEL"&B1' },
    A2: { t: 's', v: 'cached', f: '"SENTINEL"&B2' }, B1: { t: 'n', v: 5 }, B2: { t: 'n', v: 6 },
  }, 'Data');
  const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  const entry = zip.FileIndex.find((e) => e.name === 'sheet1.xml');
  const xml = new TextDecoder().decode(entry.content)
    .replace('<f>&quot;SENTINEL&quot;&amp;B1</f>', `<f t="shared" si="0" ref="A1:A2">&quot;${encoded}&quot;&amp;B1</f>`)
    .replace('<f>&quot;SENTINEL&quot;&amp;B2</f>', '<f t="shared" si="0"/>');
  expect(xml).toContain('t="shared"');
  entry.content = new TextEncoder().encode(xml);
  entry.size = entry.content.length;
  let wb = await workbookFromFile(XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'shared.xlsx');
  for (let round = 0; round < 2; ++round) {
    for (let r = 0; r < 2; ++r) {
      expect(wb.getCell(wb.activeSheetId, r, 0).f).toBe(`"${expected}"&B${r + 1}`);
      expect(wb.getValue(wb.activeSheetId, r, 0)).toBe(`${expected}${r + 5}`);
    }
    wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  }
});
