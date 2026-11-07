// @vitest-environment jsdom
import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { fontKeyFor, fontStack } from '../src/core/format.js';
import { xlsxColumnPixels } from '../src/core/xlsx-styles.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';

it.each([
  ['Lucida Sans', 'lucida-sans', 11.83203125, 106],
  ['Lucida Sans', 'lucida-sans', 13.81640625, 124],
  ['Corbel', 'corbel', 35.21875, 282],
  ['Open Sans', 'font:Open Sans', 12.5, 100],
  ['Open Sans Regular', 'font:Open Sans Regular', 27.75, 222],
])('uses %s Normal-font digit widths and preserves the font through XLSX and HTML', async (name, key, width, pixels) => {
  const input = otherProgramsXlsx({ sheetNames: ['Planner'], sheetXml: { Planner: {
    head: `<sheetFormatPr defaultColWidth="${width}"/><cols><col min="2" max="2" width="${width}" customWidth="1"/></cols>`,
    rows: '<row r="1"><c r="B1" t="inlineStr"><is><t>Planner</t></is></c></row>',
  } }, patch: { '/xl/styles.xml': xml => xml.replace('<scheme val="minor"/>', '').replace('<sz val="12"/>', '<sz val="11"/>').replace('<name val="Calibri"/>', `<name val="${name}"/>`) } });
  let wb = await workbookFromFile(input, 'planner.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const sheet = wb.activeSheet;
    expect(wb.colWidth(sheet.id, 1)).toBe(pixels);
    expect(wb.colWidth(sheet.id, 2)).toBe(pixels);
    expect(wb.styleAt(sheet.id, 0, 1).font).toBe(key);
    const html = cellsToHtml([['Planner']], [[wb.getCell(sheet.id, 0, 1)]], [[wb.styleAt(sheet.id, 0, 1)]]);
    const rows = parseHtmlClipboard(html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '')).rows;
    expect(cellsFromHtmlRows(rows)[0].cell.s.font).toBe(key);
    const saved = await workbookToXlsx(wb);
    const bytes = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsArrayBuffer(saved); });
    const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' });
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
    part.size = part.content.length;
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx');
  }
  expect(fontKeyFor(name)).toBe(key);
  expect(fontStack(key)).toContain(name);
  expect(xlsxColumnPixels({ width }, { name, sz: 11 })).toBe(pixels);
});
