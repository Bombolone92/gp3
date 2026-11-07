import { DEFAULT_FONT_COLOR } from '../src/core/font-color.js';
import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';

// The reader's table of number formats belongs to the vendor's module, not to the file being
// read: a file's own <numFmt> codes were added to it and never taken out, so a code carrying
// user text ("Confidential "0.00) from a file someone shared travelled into the next file the
// user opened and into every document they saved afterwards. Each read and write starts again
// from the built-in table. The fixtures are built here, before any file is read, since the
// fixture helper writes through the vendor itself and would otherwise bake a leaked code in.

const custom = (id, code) => `<numFmt numFmtId="${id}" formatCode="${code}"/>`;
const xf = (id) => `<xf numFmtId="${id}" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>`;
const rows = (v = 1234.5) => `<row r="1"><c r="A1" s="1"><v>${v}</v></c></row>`;
const fixture = (numFmts, id, v) => otherProgramsXlsx({ sheetXml: { Data: { rows: rows(v) } }, styles: { numFmts, cellXfs: [xf(id)] } });

const shared = fixture([custom(165, '&quot;QQQ&quot;0.00')], 165);
const namesOnly = fixture([], 165);
const redefined = fixture([custom(14, '&quot;ZZZ&quot;0')], 14, 45000);
const plainDate = fixture([], 14, 45000);

async function saved(wb) {
  const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  const xml = new TextDecoder().decode(X.CFB.find(X.CFB.read(bytes, { type: 'array' }), '/xl/styles.xml').content);
  return { bytes, codes: [...xml.matchAll(/<numFmt numFmtId="\d+" formatCode="([^"]*)"/g)].map((m) => m[1]) };
}

it('keeps one file\'s custom format code out of the next document saved', async () => {
  const opened = await workbookFromFile(shared, 'shared.xlsx');
  expect(opened.getCell(opened.activeSheetId, 0, 0).s).toEqual({ valign: 'bottom', fmt: 'custom', code: '"QQQ"0.00', font: 'calibri', scheme: 'minor', size: 16, color: DEFAULT_FONT_COLOR });
  const fresh = new Workbook();
  fresh.setInput(fresh.activeSheetId, 0, 0, '1');
  expect((await saved(fresh)).codes.some((code) => code.includes('QQQ'))).toBe(false);
});

it('does not lend a custom code to a later file that names its id without defining it', async () => {
  await workbookFromFile(shared, 'shared.xlsx');
  const second = await workbookFromFile(namesOnly, 'truncated.xlsx');
  expect(second.getCell(second.activeSheetId, 0, 0).s).toEqual({ valign: 'bottom', font: 'calibri', scheme: 'minor', size: 16, color: DEFAULT_FONT_COLOR });
  expect(second.getDisplay(second.activeSheetId, 0, 0)).toBe('1234.5');
});

it('leaves a built-in id a file redefines to that file alone', async () => {
  const odd = await workbookFromFile(redefined, 'odd.xlsx');
  expect(odd.getDisplay(odd.activeSheetId, 0, 0)).toBe('ZZZ45000');
  const back = await workbookFromFile(plainDate, 'plain.xlsx');
  expect(back.getDisplay(back.activeSheetId, 0, 0)).not.toContain('ZZZ');
});

it('still saves and reopens a document\'s own custom code', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1234.5');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'custom', code: '"QQQ"0.00' });
  expect(wb.getDisplay(id, 0, 0)).toBe('QQQ1234.50');
  const { bytes, codes } = await saved(wb);
  expect(codes.some((code) => code.includes('QQQ'))).toBe(true);
  const back = await workbookFromFile(bytes, 'own.xlsx');
  expect(back.getCell(back.activeSheetId, 0, 0).s).toMatchObject({ fmt: 'custom', code: '"QQQ"0.00' });
  expect(back.getDisplay(back.activeSheetId, 0, 0)).toBe('QQQ1234.50');
});
