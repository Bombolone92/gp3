// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { dataTableFormula } from '../src/core/xlsx-export.js';
import * as X from '../src/vendor/xlsx.mjs';

vi.stubGlobal('Blob', NodeBlob);

// The three kinds of What-If data table: column, row and two-input. The expected values are what Excel calculated for the
// same workbook, exported by the app and opened there (its formulas read back as =TABLE(,E1), =TABLE(F1,E1), =TABLE(E1,)).
function book() {
  const wb = new Workbook(); const id = wb.activeSheetId;
  const set = (ref, v) => { const m = /([A-Z])(\d+)/.exec(ref); wb.setInput(id, +m[2] - 1, m[1].charCodeAt(0) - 65, v); };
  set('E1', '5'); set('E2', '=E1+1'); set('B2', '=E2*10'); set('C2', '=E1^2');
  set('A3', '1'); set('A4', '2'); set('A5', '3');
  expect(wb.setArrayFormula(id, { r1: 2, c1: 1, r2: 4, c2: 2 }, '=TABLE(,E1)')).toBe(true);
  set('G1', '=E1*F1'); set('F1', '2'); set('H1', '1'); set('I1', '2'); set('G2', '10'); set('G3', '20');
  expect(wb.setArrayFormula(id, { r1: 1, c1: 7, r2: 2, c2: 8 }, '=TABLE(F1,E1)')).toBe(true);
  set('B7', '1'); set('C7', '2'); set('D7', '3'); set('A8', '=E1*100'); set('A9', '=E1+0.5');
  expect(wb.setArrayFormula(id, { r1: 7, c1: 1, r2: 8, c2: 3 }, '=TABLE(E1,)')).toBe(true);
  return { wb, id, set };
}
const values = (wb, id, r1, c1, r2, c2) => wb.rangeValues(id, { r1, c1, r2, c2 });
function expectExcelResults(wb, id) {
  expect(values(wb, id, 2, 1, 4, 2)).toEqual([[20, 1], [30, 4], [40, 9]]);
  expect(values(wb, id, 1, 7, 2, 8)).toEqual([[10, 20], [20, 40]]);
  expect(values(wb, id, 7, 1, 8, 3)).toEqual([[100, 200, 300], [1.5, 2.5, 3.5]]);
}

it('calculates column, row and two-input data tables, leaving the inputs as they are', () => {
  const { wb, id, set } = book();
  expectExcelResults(wb, id);
  // The sheet's own formulas still see the input cells' real values.
  expect(wb.getValue(id, 1, 1)).toBe(60);
  expect(wb.getValue(id, 0, 6)).toBe(10);
  // The results follow the substituted values and formulas, not the input cell's value.
  set('E1', '7');
  expectExcelResults(wb, id);
  expect(wb.getValue(id, 1, 1)).toBe(80);
  set('A3', '10');
  expect(wb.getValue(id, 2, 1)).toBe(110);
  expect(wb.getValue(id, 2, 2)).toBe(100);
});

it('writes data tables as dataTable formulas in the file and reads them back', async () => {
  expect(dataTableFormula('B3:C5', '', 'E1')).toBe('<f t="dataTable" ref="B3:C5" dt2D="0" dtr="0" r1="E1"/>');
  expect(dataTableFormula('B8:D9', '$E$1', '')).toBe('<f t="dataTable" ref="B8:D9" dt2D="0" dtr="1" r1="E1"/>');
  expect(dataTableFormula('H2:I3', 'F1', 'E1')).toBe('<f t="dataTable" ref="H2:I3" dt2D="1" dtr="1" r1="F1" r2="E1"/>');
  expect(dataTableFormula('H2:I3', 'Sheet2!F1', 'E1')).toBeNull();
  const { wb } = book();
  const back = await workbookFromFile(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), 'tables.xlsx');
  const id = back.activeSheetId;
  expectExcelResults(back, id);
  expect(back.sheet(id).cells.get('2,1')).toMatchObject({ f: 'TABLE(,E1)', array: { rows: 3, cols: 2 } });
  expect(back.sheet(id).cells.get('1,7')).toMatchObject({ f: 'TABLE(F1,E1)', array: { rows: 2, cols: 2 } });
  expect(back.sheet(id).cells.get('7,1')).toMatchObject({ f: 'TABLE(E1,)', array: { rows: 2, cols: 3 } });
});

it('reads the data tables of a file Excel wrote, without the app\'s own notes', async () => {
  const { wb } = book();
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const edit = (path, fn) => { const part = X.CFB.find(zip, path); part.content = new TextEncoder().encode(fn(new TextDecoder().decode(part.content))); part.size = part.content.length; };
  edit('/xl/workbook.xml', s => s.replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  // As Excel writes them: absolute input cells are allowed, and attributes in any order.
  edit('/xl/worksheets/sheet1.xml', s => s.replace('<f t="dataTable" ref="B3:C5" dt2D="0" dtr="0" r1="E1"/>', '<f t="dataTable" ref="B3:C5" dt2D="0" dtr="0" r1="$E$1" ca="1"/>'));
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'excel.xlsx');
  const id = back.sheets.find(s => s.name === 'Sheet1').id;
  expectExcelResults(back, id);
  back.setInput(id, 3, 0, '4');
  expect(back.getValue(id, 3, 1)).toBe(50);
});

it('builds a data table with the Data Table dialog of the What-If Analysis menu', async () => {
  const { Doc } = await import('../src/lib/doc.js');
  const { editorView } = await import('../src/views/editor.js');
  const { closeAllModals } = await import('../src/ui/modal.js');
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  Element.prototype.scrollIntoView = () => {}; Element.prototype.scrollTo = () => {};
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: text => ({ width: text.length * 7 }), font: '' });
  const doc = new Doc({ name: 'What if' }); const wb = doc.wb; const id = wb.activeSheetId;
  // A loan payment for rates down column A: =PMT(rate/12, 360, -200000) with the rate in B1.
  wb.setInput(id, 0, 1, '0.05'); wb.setInput(id, 1, 1, '=PMT(B1/12,360,-200000)');
  ['0.04', '0.05', '0.06'].forEach((v, i) => wb.setInput(id, 2 + i, 0, v));
  const view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.body.append(view.el); await vi.advanceTimersByTimeAsync(1);
  try {
    view.goTo('A2:B5'); await vi.advanceTimersByTimeAsync(1);
    [...view.el.querySelectorAll('.ribbon [role="tab"]')].find(n => n.textContent === 'Data').click(); await vi.advanceTimersByTimeAsync(1);
    [...view.el.querySelectorAll('.ribbon-panels button')].find(b => b.getAttribute('aria-label') === 'What-If Analysis').click(); await vi.advanceTimersByTimeAsync(1);
    [...document.querySelectorAll('.menu-item')].find(n => n.textContent.includes('Data Table…')).click(); await vi.advanceTimersByTimeAsync(1);
    const dialog = document.querySelector('.data-table-dialog');
    dialog.querySelector('[aria-label="Column input cell"]').value = '$B$1';
    dialog.requestSubmit(); await vi.advanceTimersByTimeAsync(1);
    expect(wb.sheet(id).cells.get('2,1')).toMatchObject({ f: 'TABLE(,B1)', array: { rows: 3, cols: 1 } });
    // PMT(0.04/12,360,-200000) and so on, to the cent.
    expect(wb.rangeValues(id, { r1: 2, c1: 1, r2: 4, c2: 1 }).map(([v]) => Math.round(v * 100) / 100)).toEqual([954.83, 1073.64, 1199.10]);
    expect(wb.undoLabels()[0]).toBe('Data table');
  } finally {
    closeAllModals(); view.destroy(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.stubGlobal('Blob', NodeBlob); document.body.replaceChildren();
  }
});
