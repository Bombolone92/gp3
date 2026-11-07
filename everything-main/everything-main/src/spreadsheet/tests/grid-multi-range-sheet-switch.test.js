// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => { document.body.replaceChildren(); });

// Each sheet's selection and scroll position were remembered across a switch, but not the ranges
// added with Ctrl/Cmd+click: coming back to the sheet found only the last of them.
it('keeps each sheet\'s ranges added with Ctrl/Cmd+click across a switch to another sheet and back', () => {
  const wb = new Workbook();
  const one = wb.sheets[0].id;
  const two = wb.addSheet('Two').id;
  const grid = createGrid({ wb, sheetId: one, announce() {} });
  document.body.replaceChildren(grid.el);
  const A1A2 = { r1: 0, c1: 0, r2: 1, c2: 0 };
  const C1C2 = { r1: 0, c1: 2, r2: 1, c2: 2 };
  const E5 = { r1: 4, c1: 4, r2: 4, c2: 4 };
  const G7 = { r1: 6, c1: 6, r2: 6, c2: 6 };
  grid.setRanges([A1A2, C1C2], { r: 1, c: 2 });
  grid.setSheet(two);
  expect(grid.ranges).toEqual([{ r1: 0, c1: 0, r2: 0, c2: 0 }]); // a fresh sheet starts at A1 alone
  grid.setRanges([E5, G7]);
  grid.setSheet(one);
  expect(grid.ranges).toEqual([A1A2, C1C2]);
  expect(grid.active).toEqual({ r: 1, c: 2 });
  grid.setSheet(two);
  expect(grid.ranges).toEqual([E5, G7]);
  grid.setSheet(one);
  grid.setSelection({ active: { r: 0, c: 0 }, anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 } }); // a plain selection ends the multi-range one
  grid.setSheet(two);
  grid.setSheet(one);
  expect(grid.ranges).toEqual([{ r1: 0, c1: 0, r2: 0, c2: 0 }]);
  grid.destroy();
});

it.each(['B1:B1048576', 'A4:XFD4', 'A1:XFD1048576'])('restores full-line selections sparsely and retains their native extent: %s', async sqref => {
  const wb = await workbookFromFile(otherProgramsXlsx({ sheetXml: { Data: {
    head: `<sheetViews><sheetView workbookViewId="0"><selection sqref="${sqref}"/></sheetView></sheetViews>`,
  } } }), 'lines.xlsx');
  const original = wb.activeSheet.viewSelection.ranges;
  expect(wb.activeSheet.rows).toBe(100); expect(wb.activeSheet.cols).toBe(26);
  const grid = createGrid({ wb, sheetId: wb.activeSheetId });
  expect(wb.activeSheet.viewSelection.ranges).toEqual(original);
  expect(wb.activeSheet.rows).toBe(100); expect(wb.activeSheet.cols).toBe(26);
  expect(wb.activeSheet.cells.size).toBe(0);
  grid.destroy();
});

it('restores native selections at mount and sheet switches, then exports navigation changes', async () => {
  const wb = await workbookFromFile(otherProgramsXlsx({ sheetNames: ['First', 'Second'], sheetXml: {
    First: { head: '<sheetViews><sheetView workbookViewId="0"><selection activeCell="D7" activeCellId="0" sqref="C5:F9 H2:I3"/></sheetView></sheetViews>' },
    Second: { head: '<sheetViews><sheetView workbookViewId="0"><selection activeCell="AD502" sqref="AD502"/></sheetView></sheetViews>' },
  } }), 'views.xlsx');
  const grid = createGrid({ wb, sheetId: wb.sheets[0].id });
  document.body.replaceChildren(grid.el);
  expect(grid.active).toEqual({ r: 6, c: 3 });
  expect(grid.ranges).toEqual([{ r1: 1, c1: 7, r2: 2, c2: 8 }, { r1: 4, c1: 2, r2: 8, c2: 5 }]);
  grid.setSheet(wb.sheets[1].id);
  expect(grid.active).toEqual({ r: 501, c: 29 });
  expect(wb.dirty).toBe(false);
  grid.selectByName('Q15:R18');
  expect(wb.dirty).toBe(false);
  grid.setSheet(wb.sheets[0].id);
  expect(grid.active).toEqual({ r: 6, c: 3 });
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsArrayBuffer(blob); });
  const back = await workbookFromFile(bytes, 'navigation.xlsx');
  expect(back.sheets[0].viewSelection.active).toEqual({ r: 6, c: 3 });
  expect(back.sheets[1].viewSelection.ranges).toEqual([{ r1: 14, c1: 16, r2: 17, c2: 17 }]);
  expect(back.sheets[1].viewSelection.active).toEqual({ r: 14, c: 16 });
  grid.destroy();
});
