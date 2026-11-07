import { expect, it } from 'vitest';
import { Workbook, cloneCell } from '../src/core/workbook.js';

const area = (r1, c1, r2 = r1, c2 = c1) => ({ r1, c1, r2, c2 });
const edge = { bs: 'double', bc: '#3467ab' };
const columnStyle = () => ({ bt: true, bb: true, btBorder: { ...edge }, bbBorder: { bs: 'dashed', bc: '#ab6734' } });
const book = () => new Workbook({ sheets: [{ name: 'Borders', rows: 2000, cols: 80,
  colStyles: { 4: columnStyle() }, rowStyles: { 8: { bl: true, br: true, bs: 'thick', bc: '#389561' } },
  cells: { '6,4': { v: 5 }, '7,4': { f: 'E7*2' } } }] });

it('retains shared and per-side border descriptors in line defaults and JSON', () => {
  const wb = book(), id = wb.activeSheetId;
  expect(wb.styleAt(id, 700, 4)).toMatchObject(columnStyle());
  expect(wb.styleAt(id, 8, 70)).toMatchObject({ bl: true, br: true, bs: 'thick', bc: '#389561' });
  const back = new Workbook(wb.toJSON());
  expect(back.styleAt(back.activeSheetId, 700, 4)).toEqual(wb.styleAt(id, 700, 4));
  expect(back.styleAt(back.activeSheetId, 8, 70)).toEqual(wb.styleAt(id, 8, 70));
});

it('copies inherited descriptors into independent cells and format-only pastes', () => {
  const wb = book(), id = wb.activeSheetId;
  const copied = wb.copyRange(id, area(6, 4, 7, 4));
  wb.pasteCells(id, copied, 20, 12, { r: 6, c: 4 });
  expect(wb.getValue(id, 21, 12)).toBe(10);
  expect(wb.styleAt(id, 21, 12)).toMatchObject(columnStyle());
  wb.setInput(id, 30, 12, '=3*7');
  wb.pasteStyles(id, copied, 30, 12);
  expect(wb.getValue(id, 30, 12)).toBe(21);
  expect(wb.styleAt(id, 30, 12)).toMatchObject(columnStyle());
  copied[0][0].s.btBorder.bc = '#ffffff';
  expect(wb.styleAt(id, 6, 4).btBorder).toEqual(edge);
  expect(wb.styleAt(id, 20, 12).btBorder).toEqual(edge);
  expect(wb.styleAt(id, 30, 12).btBorder).toEqual(edge);
});

it('keeps descriptor inputs, JSON, duplicated sheets and line-format history independent', () => {
  const style = columnStyle();
  const wb = new Workbook({ sheets: [{ name: 'Borders', colStyles: { 4: style } }] }), id = wb.activeSheetId;
  style.btBorder.bc = '#ffffff';
  const json = wb.toJSON(); json.sheets[0].colStyles[4].btBorder.bc = '#ffffff';
  expect(wb.styleAt(id, 40, 4).btBorder).toEqual(edge);
  const dup = wb.duplicateSheet(id);
  dup.colStyles.get(4).btBorder.bc = '#ff0000';
  expect(wb.styleAt(id, 40, 4).btBorder).toEqual(edge);
  const patch = { btBorder: { bs: 'medium', bc: '#448899' } };
  wb.applyStyle(id, area(0, 4, wb.sheet(id).rows - 1, 4), patch);
  patch.btBorder.bc = '#ffffff';
  expect(wb.styleAt(id, 300, 4).btBorder).toEqual({ bs: 'medium', bc: '#448899' });
  wb.undo(); expect(wb.styleAt(id, 300, 4).btBorder).toEqual(edge);
  wb.redo(); expect(wb.styleAt(id, 300, 4).btBorder).toEqual({ bs: 'medium', bc: '#448899' });
});

it('keeps cleared inherited borders sparse through JSON, typing, copying and Undo', () => {
  const wb = book(), id = wb.activeSheetId;
  wb.clearRange(id, area(1, 4, 1200, 60), { contents: false, styles: true });
  expect(wb.activeSheet.cells.size).toBe(2);
  const check = (book, sid) => {
    for (const [r, c] of [[6, 4], [7, 4], [1199, 4], [8, 55]]) {
      const style = book.styleAt(sid, r, c);
      for (const side of ['bt', 'bb', 'bl', 'br']) expect(style[side]).toBeFalsy();
      for (const key of ['bs', 'bc', 'btBorder', 'bbBorder']) expect(style[key]).toBeFalsy();
    }
    expect(book.styleAt(sid, 1201, 4)).toMatchObject(columnStyle());
  };
  check(wb, id);
  const back = new Workbook(wb.toJSON()); check(back, back.activeSheetId);
  wb.undo(); expect(wb.styleAt(id, 1199, 4)).toMatchObject(columnStyle());
  wb.redo(); check(wb, id);
  wb.setInput(id, 500, 4, '8');
  expect(wb.styleAt(id, 500, 4).bt).toBeFalsy();
  const copy = wb.copyRange(id, area(500, 4));
  wb.pasteCells(id, copy, 1300, 4);
  expect(wb.styleAt(id, 1300, 4).bt).toBeFalsy();
});

it('shifts row and column defaults with structural edits and undo', () => {
  const wb = book(), id = wb.activeSheetId;
  wb.insertRows(id, 4, 3); wb.insertCols(id, 2, 2);
  expect(wb.styleAt(id, 1500, 6)).toMatchObject(columnStyle());
  expect(wb.styleAt(id, 11, 65)).toMatchObject({ bs: 'thick', bc: '#389561' });
  wb.undo(); wb.undo();
  expect(wb.styleAt(id, 1500, 4)).toMatchObject(columnStyle());
  expect(wb.styleAt(id, 8, 65)).toMatchObject({ bs: 'thick', bc: '#389561' });
});

it('updates existing per-side descriptors with shared border style patches', () => {
  const wb = book(), id = wb.activeSheetId;
  wb.applyStyle(id, area(0, 4, 1999, 4), { bs: 'medium', bc: '#778899' });
  expect(wb.styleAt(id, 1500, 4).btBorder).toEqual({ bs: 'medium', bc: '#778899' });
  expect(wb.styleAt(id, 1500, 4).bbBorder).toEqual({ bs: 'medium', bc: '#778899' });
  wb.undo(); expect(wb.styleAt(id, 1500, 4)).toMatchObject(columnStyle());
});

it('normalizes malformed descriptor containers and copies only scalar edge fields', () => {
  expect(cloneCell({ s: { bt: true, bs: [], bc: {} } }).s).toEqual({ bt: true });
  for (const btBorder of ['bad', 5, []]) expect(cloneCell({ s: { bt: true, btBorder } }).s.btBorder).toBeUndefined();
  const src = { bs: 'thin', bc: null, unknown: { mutable: true } };
  const cell = cloneCell({ s: { btBorder: src, brBorder: null, bbBorder: { bs: [] } } });
  expect(cell.s).toEqual({ btBorder: { bs: 'thin', bc: null }, brBorder: null, bbBorder: {} });
  expect(cell.s.btBorder).not.toBe(src);
});
