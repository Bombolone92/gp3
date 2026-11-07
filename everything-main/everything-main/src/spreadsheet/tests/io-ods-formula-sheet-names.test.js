import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds } from '../src/core/io.js';

const parser = new (new JSDOM('').window.DOMParser)();
const tableNS = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';

it.each(['A,B', 'A;B', 'A|B', 'A~B', 'COM.MICROSOFT.Data', "Plan's A1", 'A"B', 'literal &amp;'])(
  'preserves the quoted formula sheet name %s', async (name) => {
    let wb = new Workbook();
    wb.renameSheet(wb.activeSheetId, name);
    wb.setInput(wb.activeSheetId, 0, 0, '42');
    const summary = wb.addSheet('Summary');
    const quoted = `'${name.replaceAll("'", "''")}'`, formula = `${quoted}!A1+1`;
    wb.setInput(summary.id, 0, 0, `=${formula}`);
    for (let round = 0; round < 2; round++) {
      const bytes = new Uint8Array(await (await workbookToOds(wb)).arrayBuffer());
      const zip = XLSX.CFB.read(bytes, { type: 'array' });
      const doc = parser.parseFromString(new TextDecoder().decode(XLSX.CFB.find(zip, 'content.xml').content), 'application/xml');
      expect(doc.querySelector('parsererror')?.textContent).toBeUndefined();
      const cells = [...doc.getElementsByTagNameNS(tableNS, 'table-cell')];
      const exported = cells.find((cell) => cell.hasAttributeNS(tableNS, 'formula')).getAttributeNS(tableNS, 'formula');
      expect(exported.match(/'(?:[^']|'')*'/)?.[0]).toBe(quoted);
      wb = await workbookFromFile(bytes, 'sheet-names.ods');
      const id = wb.sheetByName('Summary').id;
      expect(wb.getCell(id, 0, 0).f).toBe(formula);
      expect(wb.getValue(id, 0, 0)).toBe(43);
    }
  },
);
