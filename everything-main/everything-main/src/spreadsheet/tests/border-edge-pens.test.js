import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { borderSnapshot, cellBorderGesturePatch } from '../src/core/border-regions.js';
import { parseRange } from '../src/core/cell.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';

const sides = ['bt', 'bb', 'bl', 'br'];
const range = parseRange('C3:E5');
const kinds = ['all', 'outer', 'inner', 'horizontal', 'vertical', 'top', 'bottom', 'left', 'right'];
function fixture() {
  const wb = new Workbook({ sheets: [{ id: 's', name: 'Sheet', cells: {
    '2,2': { v: 3, s: { bl: true, bs: 'thick', bc: '#112233', bold: true, bg: '#eeeeff' } },
    '3,3': { f: 'C3*2', s: { bt: true, br: true, btBorder: { bs: 'dotted', bc: '#ff0000' }, brBorder: { bs: 'double', bc: '#0000ff' } } },
  } }] });
  wb.sheet('s').colStyles.set(3, { bb: true, bbBorder: { bs: 'thin', bc: '#abcdef' } });
  wb.sheet('s').rowStyles.set(4, { bl: true, bs: 'medium', bc: '#998877' });
  wb.clearHistory(); return wb;
}

it.each(kinds.flatMap(kind => [false, true].map(remove => [kind, remove])))
  ('matches per-cell/native gesture semantics for %s, remove=%s, including inherited pens', (kind, remove) => {
    const expected = fixture(), actual = new Workbook(expected.toJSON());
    const options = { perSide: true, remove, color: '#456789', style: 'double' };
    expected.applyBorders('s', range, kind, options);
    for (let r = range.r1; r <= range.r2; r++) for (let c = range.c1; c <= range.c2; c++) {
      const patch = cellBorderGesturePatch(actual.styleAt('s', r, c), range, r, c, kind, options);
      if (patch) actual.applyStyle('s', { r1: r, r2: r, c1: c, c2: c }, patch);
      expect(borderSnapshot(actual.styleAt('s', r, c))).toEqual(borderSnapshot(expected.styleAt('s', r, c)));
      expect(actual.getValue('s', r, c)).toEqual(expected.getValue('s', r, c));
    }
    expect(expected.styleAt('s', 2, 2)).toMatchObject({ bold: true, bg: '#eeeeff' });
    expect(expected.getCell('s', 3, 3).f).toBe('C3*2');
  });

it('keeps independent top/bottom pens and removes only the requested side in one transaction', () => {
  const wb = fixture(), before = wb.toJSON();
  wb.transaction('Format cells', () => {
    wb.applyBorders('s', range, 'top', { perSide: true, style: 'thin', color: '#ff0000' });
    wb.applyBorders('s', range, 'bottom', { perSide: true, style: 'double', color: '#0000ff' });
    wb.applyBorders('s', range, 'left', { perSide: true, remove: true });
  });
  expect(borderSnapshot(wb.styleAt('s', 2, 2))).toMatchObject({ bt: true, btBorder: { bs: 'thin', bc: '#ff0000' }, bl: false });
  expect(borderSnapshot(wb.styleAt('s', 4, 2))).toMatchObject({ bb: true, bbBorder: { bs: 'double', bc: '#0000ff' }, bl: false });
  expect(borderSnapshot(wb.styleAt('s', 3, 3))).toMatchObject({ btBorder: { bs: 'dotted', bc: '#ff0000' }, brBorder: { bs: 'double', bc: '#0000ff' } });
  expect(wb.undoLabels()).toEqual(['Format cells']);
  wb.undo(); expect(wb.toJSON()).toEqual(before);
});

it('clears the last inherited side over a large empty area without allocating every cell', () => {
  const wb = new Workbook({ sheets: [{ id: 's', name: 'Sheet', rows: 100000, cols: 26 }] });
  wb.sheet('s').colStyles.set(1, { bl: true, bs: 'double', bc: '#112233', fmt: 'number' });
  const before = wb.toJSON(), large = { r1: 0, r2: 99999, c1: 1, c2: 2 };
  wb.applyBorders('s', large, 'left', { perSide: true, remove: true });
  for (const r of [0, 50000, 99999]) {
    expect(wb.styleAt('s', r, 1).bl).toBe(false);
    expect(wb.styleAt('s', r, 1).fmt).toBe('number');
  }
  expect(wb.sheet('s').cells.size).toBe(0);
  expect(wb.sheet('s').styleResets.length).toBeLessThan(10);
  wb.undo(); expect(wb.toJSON()).toEqual(before);
});

it('retains a whole-column side removal for future rows and keeps its other edge', () => {
  const wb = new Workbook({ sheets: [{ id: 's', name: 'Sheet' }] });
  wb.sheet('s').colStyles.set(1, { bl: true, br: true, bs: 'double', bc: '#112233' });
  wb.applyBorders('s', { r1: 0, r2: 99, c1: 1, c2: 1, scope: 'columns' }, 'left', { remove: true, perSide: true });
  for (const r of [0, 99, 500000]) expect(borderSnapshot(wb.styleAt('s', r, 1))).toMatchObject({ bl: false, br: true, brBorder: { bs: 'double', bc: '#112233' } });
  expect(wb.sheet('s').cells.size).toBe(0);
});

it('refuses an affected protected edge before any write and leaves an absent-edge removal out of history', () => {
  const wb = fixture();
  wb.sheet('s').protectedRanges.push({ name: 'Protected', range: parseRange('C3') });
  const before = wb.toJSON();
  wb.applyBorders('s', range, 'top', { perSide: true, color: '#456789' });
  expect(wb.toJSON()).toEqual(before); expect(wb.undoLabels()).toEqual([]);
  const empty = new Workbook(); empty.clearHistory();
  empty.applyBorders(empty.activeSheetId, parseRange('A1:C3'), 'top', { perSide: true, remove: true });
  expect(empty.undoLabels()).toEqual([]); expect(empty.sheets[0].cells.size).toBe(0);
  empty.applyBorders(empty.activeSheetId, { r1: 0, r2: 99, c1: 1, c2: 1, scope: 'columns' }, 'left', { perSide: true, remove: true });
  expect(empty.undoLabels()).toEqual([]); expect(empty.sheets[0].colStyles.size).toBe(0);
});

it('retains independent merged-cell perimeter pens and restores the anchor summary on Undo', () => {
  const wb = new Workbook({ sheets: [{ id: 's', name: 'Sheet', merges: [range], cells: { '2,2': { v: 'Synthetic merged cell', s: { bold: true } } } }] });
  const before = wb.toJSON();
  wb.transaction('Format cells', () => {
    wb.applyBorders('s', range, 'top', { perSide: true, style: 'thin', color: '#ff0000' });
    wb.applyBorders('s', range, 'bottom', { perSide: true, style: 'double', color: '#0000ff' });
  });
  expect(borderSnapshot(wb.styleAt('s', 2, 2))).toMatchObject({ btBorder: { bs: 'thin', bc: '#ff0000' }, bbBorder: { bs: 'double', bc: '#0000ff' } });
  expect(borderSnapshot(wb.styleAt('s', 4, 2)).bbBorder).toEqual({ bs: 'double', bc: '#0000ff' });
  expect(wb.getValue('s', 2, 2)).toBe('Synthetic merged cell');
  wb.undo(); expect(wb.toJSON()).toEqual(before);
});

it('retains the legacy shared-pen repaint behavior for existing commands', () => {
  const wb = fixture();
  wb.applyBorders('s', parseRange('C3'), 'top', { style: 'thin', color: '#456789' });
  expect(borderSnapshot(wb.styleAt('s', 2, 2))).toMatchObject({ btBorder: { bs: 'thin', bc: '#456789' }, blBorder: { bs: 'thin', bc: '#456789' } });
});

it.each([['XLSX', workbookToXlsx, 'edges.xlsx'], ['ODS', workbookToOds, 'edges.ods']])
  ('round trips independent pens and a removed inherited side through %s', async (_, write, name) => {
    const wb = fixture();
    wb.applyBorders('s', range, 'top', { perSide: true, style: 'dashed', color: '#456789' });
    wb.applyBorders('s', range, 'left', { perSide: true, remove: true });
    const restored = await workbookFromFile(await write(wb), name), id = restored.sheets[0].id;
    for (let r = 2; r <= 4; r++) for (let c = 2; c <= 4; c++) {
      const wanted = borderSnapshot(wb.styleAt('s', r, c)), got = borderSnapshot(restored.styleAt(id, r, c));
      for (const side of sides) { expect(got[side]).toBe(wanted[side]); if (wanted[side]) expect(got[`${side}Border`]).toEqual(wanted[`${side}Border`]); }
    }
    expect(restored.getValue(id, 3, 3)).toBe(6);
  });
