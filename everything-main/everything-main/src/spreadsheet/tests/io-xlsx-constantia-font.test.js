// @vitest-environment jsdom
import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { fontKeyFor, fontStack } from '../src/core/format.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';

it('keeps Constantia invoice text and column geometry in native XLSX and external HTML', async () => {
  const input = otherProgramsXlsx({
    sheetNames: ['Invoice'],
    sheetXml: { Invoice: {
      head: '<sheetFormatPr defaultColWidth="17.33203125"/><cols>'
        + '<col min="1" max="1" width="2.58203125" customWidth="1"/>'
        + '<col min="2" max="2" width="30.58203125" customWidth="1"/>'
        + '<col min="3" max="3" width="14.58203125" customWidth="1"/></cols>',
      rows: '<row r="1"><c r="A1" t="inlineStr"><is><t>INVOICE</t></is></c></row>',
    } },
    patch: { '/xl/styles.xml': xml => xml.replace('<scheme val="minor"/>', '').replace('<sz val="12"/>', '<sz val="11"/>').replace('<name val="Calibri"/>', '<name val="Constantia"/>') },
  });
  let wb = await workbookFromFile(input, 'invoice.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const s = wb.activeSheet, style = wb.styleAt(s.id, 0, 0);
    expect(style.font).toBe('constantia');
    expect([0, 1, 2, 3].map(c => wb.colWidth(s.id, c))).toEqual([21, 245, 117, 139]);
    const html = cellsToHtml([['INVOICE']], [[wb.getCell(s.id, 0, 0)]], [[style]])
      .replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
    expect(new DOMParser().parseFromString(html, 'text/html').querySelector('td').style.fontFamily).toBe('\"Constantia\"');
    const rows = parseHtmlClipboard(html).rows;
    expect(cellsFromHtmlRows(rows)[0].cell.s.font).toBe('constantia');
    if (pass) break;
    const saved = await workbookToXlsx(wb);
    const bytes = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsArrayBuffer(saved); });
    const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' });
    const styles = new TextDecoder().decode(X.CFB.find(zip, '/xl/styles.xml').content);
    expect(styles).toContain('<name val="Constantia"/>');
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
    part.size = part.content.length;
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx');
  }
  expect(fontKeyFor('Constantia (Body)')).toBe('constantia');
  expect(fontStack('constantia')).toBe('Constantia, Georgia, "Times New Roman", serif');
});
