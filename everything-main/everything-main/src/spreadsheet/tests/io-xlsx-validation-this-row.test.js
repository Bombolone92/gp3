import { JSDOM } from 'jsdom';
const { DOMParser } = new JSDOM('').window;
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

async function sheetXml(wb) {
  const blob = await workbookToXlsx(wb);
  const zip = X.CFB.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
  const xml = new TextDecoder().decode(X.CFB.find(zip, '/xl/worksheets/sheet1.xml').content);
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  return doc;
}

// Excel reads a validation formula relative to the first cell of its range, so a rule over B2:B4
// written as $B$2*10=$C$2 would check every row against row 2. A [@Col] reference must stay
// relative in its row, while a whole-column reference keeps its anchors.
it('writes a this-row table reference in a multi-row validation relative to its row', async () => {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  [['Item', 'Qty', 'Amt'], ['a', 1, 10], ['b', 2, 20], ['c', 3, 35]].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, String(v))));
  wb.addTable(id, parseRange('A1:C4'), { name: 'T' });
  wb.addValidation(id, { type: 'formula', range: parseRange('B2:B4'), source: '[@Qty]*10=[@Amt]', strict: true });
  wb.addValidation(id, { type: 'formula', range: parseRange('E2:E4'), source: 'E2<=MAX(T[Amt])', strict: true });
  const doc = await sheetXml(wb);
  const formulas = [...doc.querySelectorAll('dataValidation')].map((n) => [n.getAttribute('sqref'), n.querySelector('formula1').textContent]);
  expect(formulas).toEqual([
    ['B2:B4', '$B2*10=$C2'],
    ['E2:E4', 'E2<=MAX($C$2:$C$4)'],
  ]);
});
