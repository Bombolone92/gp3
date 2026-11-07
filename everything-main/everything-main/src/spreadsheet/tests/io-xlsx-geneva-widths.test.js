import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { xlsxColumnPixels } from '../src/core/xlsx-styles.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';

it.each([[8, 7], [10, 9], [14, 12], [20, 18]])('uses Geneva maximum digit advances at %s points', (sz, mdw) => {
  for (const width of [0, .125, 1.25, 7.33203125, 24.75, 96.625, 255]) {
    const pixels = Math.floor((256 * width + Math.floor(128 / mdw)) / 256 * mdw);
    expect(xlsxColumnPixels({ width }, { name: 'Geneva', sz })).toBe(pixels);
    expect(xlsxColumnPixels({ width }, { name: 'GENEVA', sz })).toBe(pixels);
  }
});

it.each([10, 14])('preserves Geneva Normal-style geometry with different cell fonts through native editing/export at %s points', async sz => {
  const input = otherProgramsXlsx({
    sheetXml: { Data: {
      head: '<sheetFormatPr defaultColWidth="11.25"/><cols><col min="1" max="2" width="26.75" customWidth="1"/><col min="4" max="4" width="5.25" hidden="1"/></cols>',
      rows: '<row r="1"><c r="A1" s="1" t="inlineStr"><is><t>Longer labels use a different font</t></is></c><c r="B1"><v>7</v></c></row>',
      tail: '<mergeCells count="1"><mergeCell ref="A2:B2"/></mergeCells>',
    } },
    patch: { '/xl/styles.xml': () => '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + `<fonts count="2"><font><sz val="${sz}"/><name val="Geneva"/></font><font><sz val="12"/><name val="Calibri"/></font></fonts>`
      + '<fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders>'
      + '<cellStyleXfs count="1"><xf fontId="0" numFmtId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + '<cellXfs count="2"><xf fontId="0" numFmtId="0" fillId="0" borderId="0" xfId="0"/><xf fontId="1" numFmtId="0" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1"/></xf></cellXfs>'
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
  });
  let wb = await workbookFromFile(input, 'mixed-fonts.xlsx');
  const expected = sz === 10 ? [241, 241, 101, 47] : [321, 321, 135, 63];
  for (let pass = 0; pass < 2; pass++) {
    const sheet = wb.activeSheet;
    expect([...([0, 1, 2].map(c => wb.colWidth(sheet.id, c))), sheet.colWidths.get(3)]).toEqual(expected);
    expect(wb.colWidth(sheet.id, 3)).toBe(0);
    expect(wb.getCell(sheet.id, 0, 0).s).toMatchObject({ font: 'calibri', size: 16, wrap: true });
    expect(sheet.hiddenCols.has(3)).toBe(true);
    expect(sheet.merges).toEqual([{ r1: 1, c1: 0, r2: 1, c2: 1 }]);
    if (pass) break;
    wb.setColWidth(sheet.id, 1, 173); expected[1] = 173;
    const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
    part.size = part.content.length;
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
  }
});
