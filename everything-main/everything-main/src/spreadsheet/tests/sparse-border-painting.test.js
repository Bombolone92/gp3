import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { borderSnapshot } from '../src/core/border-regions.js';
import { xlsxResetCells } from '../src/core/xlsx-style-resets.js';
import { MAX_ROW, MAX_COL } from '../src/core/refs.js';
const rect = (r1, c1, r2 = r1, c2 = c1) => ({ r1, c1, r2, c2 });
const block = rect(2, 2, 1300, 60);
const book = extra => new Workbook({ sheets: [{ name: 'Paint', rows: 2000, cols: 80, ...extra }] });
const sides = ['bt', 'bb', 'bl', 'br'];
const snapshot = (wb, r, c) => borderSnapshot(wb.styleAt(wb.activeSheetId, r, c));

it.each(['all', 'outer', 'inner', 'horizontal', 'vertical', 'top', 'bottom', 'left', 'right'])('paints every part of a large finite %s selection with bounded storage', kind => {
  const wb = book(), id = wb.activeSheetId;
  wb.applyBorders(id, block, kind, { color: '#225599', style: 'double' });
  for (const r of [block.r1, 901, block.r2]) for (const c of [block.c1, 42, block.c2]) {
    const edge = { bt: r === block.r1, bb: r === block.r2, bl: c === block.c1, br: c === block.c2 };
    for (const key of sides) {
      const on = kind === 'all' || kind === 'outer' && edge[key] || kind === 'inner' && !edge[key]
        || kind === 'horizontal' && ['bt', 'bb'].includes(key) && !edge[key]
        || kind === 'vertical' && ['bl', 'br'].includes(key) && !edge[key]
        || { top: 'bt', bottom: 'bb', left: 'bl', right: 'br' }[kind] === key && edge[key];
      expect(snapshot(wb, r, c)[key], `${r},${c} ${key}`).toBe(on);
      if (on) expect(snapshot(wb, r, c)[`${key}Border`]).toEqual({ bs: 'double', bc: '#225599' });
    }
  }
  expect(sides.some(k => snapshot(wb, 1301, 42)[k])).toBe(false);
  expect(wb.activeSheet.cells.size).toBe(0); expect(wb.activeSheet.styleResets.length).toBeLessThanOrEqual(9);
  const after = wb.toJSON(); wb.applyBorders(id, block, kind, { color: '#225599', style: 'double' });
  expect(wb.toJSON()).toEqual(after); wb.undo(); expect(wb.canUndo()).toBe(false); expect(wb.activeSheet.styleResets).toEqual([]);
  wb.redo(); expect(wb.toJSON()).toEqual(after);
});

it('preserves own colors, mixed inherited weights, values, formulas and masks when painting new sides', () => {
  const wb = book({ colStyles: { 4: { br: true, bc: '#112233', bs: 'double', bg: '#fff0cc' } },
    rowStyles: { 900: { bt: true, btBorder: { bs: 'dotted', bc: '#118855' } } },
    cells: { '800,4': { v: 8, s: { bc: '#992233', bs: 'thin', bl: false } }, '801,4': { f: 'E801*2' } } }), id = wb.activeSheetId;
  wb.applyBorders(id, block, 'all');
  expect(snapshot(wb, 800, 4).brBorder).toEqual({ bs: 'thin', bc: '#992233' });
  expect(snapshot(wb, 800, 4).bl).toBe(true);
  expect(snapshot(wb, 900, 4).btBorder).toEqual({ bs: 'dotted', bc: '#118855' });
  expect(snapshot(wb, 900, 4).brBorder).toEqual({ bs: 'double', bc: '#112233' });
  expect(wb.getValue(id, 801, 4)).toBe(16); expect(wb.styleAt(id, 801, 4).bg).toBe('#fff0cc');
  expect(wb.activeSheet.cells.size).toBe(2);
});

it('matches native whole-column outline, all-borders and ignored end-cap behavior', () => {
  const wb = book(), id = wb.activeSheetId;
  wb.applyBorders(id, { ...rect(0, 2, 1999, 4), scope: 'columns' }, 'outer', { style: 'double' });
  expect(snapshot(wb, MAX_ROW, 2)).toMatchObject({ bl: true, bt: false, bb: false, br: false });
  expect(snapshot(wb, 0, 4)).toMatchObject({ br: true, bt: false, bb: false, bl: false });
  expect(snapshot(wb, 700000, 3)).toMatchObject({ bt: false, bb: false, bl: false, br: false });
  wb.applyBorders(id, { ...rect(0, 7, 1999, 9), scope: 'columns' }, 'all', { style: 'medium' });
  expect(snapshot(wb, MAX_ROW, 8)).toMatchObject({ bt: true, bb: true, bl: true, br: true });
  const before = wb.toJSON(); wb.applyBorders(id, { ...rect(0, 12, 1999, 14), scope: 'columns' }, 'top', { style: 'thick' });
  expect(wb.toJSON()).toEqual(before);
  expect(wb.activeSheet.cells.size).toBe(0); expect([...xlsxResetCells(wb.activeSheet)]).toHaveLength(0);
});

it('matches native whole-row outline defaults and the first-column edge', () => {
  const wb = book(), id = wb.activeSheetId;
  wb.applyBorders(id, { ...rect(4, 0, 6, 79), scope: 'rows' }, 'outer', { style: 'double' });
  expect(snapshot(wb, 4, 10000)).toMatchObject({ bt: true, bb: false, bl: false, br: false });
  expect(snapshot(wb, 6, MAX_COL)).toMatchObject({ bb: true, bt: false, bl: false, br: false });
  expect(snapshot(wb, 5, 0).bl).toBe(true);
  expect(snapshot(wb, 5, 10000)).toMatchObject({ bt: false, bb: false, bl: false, br: false });
  expect(wb.activeSheet.cells.size).toBe(0); expect([...xlsxResetCells(wb.activeSheet)]).toHaveLength(3);
});

it('keeps a sheet-wide border in line defaults, including future rows and columns', () => {
  const wb = book(), id = wb.activeSheetId;
  wb.applyBorders(id, { ...rect(0, 0, 1999, 79), scope: 'sheet' }, 'all', { color: '#118855', style: 'medium' });
  expect(snapshot(wb, MAX_ROW, MAX_COL)).toMatchObject({ bt: true, bb: true, bl: true, br: true });
  expect(wb.activeSheet.cells.size).toBe(0); expect([...xlsxResetCells(wb.activeSheet)]).toHaveLength(0);
  wb.undo(); expect(wb.activeSheet.colStyles.size).toBe(0); expect(wb.canUndo()).toBe(false);
});

it('keeps future typing, copying, clearing and structural edits consistent with sparse paint', () => {
  const wb = book(), id = wb.activeSheetId;
  wb.applyBorders(id, block, 'all', { style: 'dashed', color: '#225599' });
  wb.setInput(id, 1100, 40, '42'); expect(snapshot(wb, 1100, 40).brBorder.bs).toBe('dashed');
  wb.pasteCells(id, wb.copyRange(id, rect(1100, 40)), 1800, 70);
  expect(snapshot(wb, 1800, 70).brBorder.bs).toBe('dashed');
  const before = wb.toJSON(); wb.insertRows(id, 1000, 2); wb.insertCols(id, 20, 2);
  expect(snapshot(wb, 1302, 62).br).toBe(true); wb.undo(); wb.undo(); expect(wb.toJSON()).toEqual(before);
  wb.applyBorders(id, rect(1000, 40, 1200, 45), 'none'); expect(snapshot(wb, 1100, 40).br).toBe(false);
  wb.undo(); expect(snapshot(wb, 1100, 40).br).toBe(true);
});

it('protects affected empty cells, allows untouched protected interiors for a single side, and checks future line cells', () => {
  const wb = book(), id = wb.activeSheetId;
  wb.activeSheet.protectedRanges.push({ id: 'lock', range: rect(1000, 40) });
  const before = wb.toJSON(); wb.applyBorders(id, block, 'all'); expect(wb.toJSON()).toEqual(before);
  wb.applyBorders(id, block, 'bottom'); expect(snapshot(wb, 1300, 40).bb).toBe(true);
  wb.activeSheet.protectedRanges[0].range = rect(3000, 4);
  const future = wb.toJSON(); wb.applyBorders(id, { ...rect(0, 4, 1999, 4), scope: 'columns' }, 'all'); expect(wb.toJSON()).toEqual(future);
});

it('updates both default axes on Select All without freezing inherited pen components or expanding crossing rows', () => {
  const wb = book({ colStyles: { 3: { br: true, bs: 'double', bc: '#225599' } },
    rowStyles: { 8: { bold: true }, 9: { bt: true } } }), id = wb.activeSheetId;
  wb.applyBorders(id, { ...rect(0, 0, 1999, 79), scope: 'sheet' }, 'all');
  expect(snapshot(wb, 8, 3).btBorder).toEqual({ bs: 'double', bc: '#225599' });
  expect(snapshot(wb, 9, 3).brBorder).toEqual({ bs: 'double', bc: '#225599' });
  expect(wb.activeSheet.styleResets).toHaveLength(0);
  wb.applyBorders(id, { ...rect(0, 0, 1999, 79), scope: 'sheet' }, 'all', { color: '#118855', style: 'medium' });
  expect(snapshot(wb, 9, 3).btBorder).toEqual({ bs: 'medium', bc: '#118855' });
  expect([...xlsxResetCells(wb.activeSheet)]).toHaveLength(0);
});

it.each([false, true])('matches direct-cell painting across mixed styles and repeated gestures (merged=%s)', merged => {
  const styles = [
    { bt: true, bs: 'double', bc: '#225599' },
    { bl: true, blBorder: { bs: 'dotted', bc: '#118855' }, bc: '#aa2233', bs: 'thick' },
    { br: false, bb: true, bs: 'thin', bc: '#663399' },
  ];
  const make = (rows, cols) => {
    const cells = {}, rowStyles = {}, colStyles = {};
    rows.forEach((r, i) => { rowStyles[r] = styles[i]; cells[`${r},${cols[i]}`] = { v: i, s: styles[(i + 1) % 3] }; });
    cols.forEach((c, i) => { colStyles[c] = styles[(i + 2) % 3]; });
    const range = rect(rows[0], cols[0], rows[2], cols[2]);
    return { wb: book({ cells, rowStyles, colStyles, ...(merged ? { merges: [range] } : {}) }), range, rows, cols };
  };
  const small = make([2, 5, 8], [2, 5, 8]), large = make([2, 700, 1300], [2, 30, 60]);
  for (const [kind, options] of [['outer', {}], ['inner', { color: '#112233' }], ['top', { style: 'medium' }],
    ['all', { color: null, style: null }], ['horizontal', { color: '#118855' }], ['vertical', {}]]) {
    for (const item of [small, large]) item.wb.applyBorders(item.wb.activeSheetId, item.range, kind, options);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      expect(snapshot(large.wb, large.rows[i], large.cols[j]), `${kind} ${i},${j}`).toEqual(snapshot(small.wb, small.rows[i], small.cols[j]));
    }
  }
});

it('keeps a latent shared pen on untouched middle columns of a whole-column outline', () => {
  const wb = book({ colStyles: { 3: { bs: 'double', bc: '#225599' } } }), id = wb.activeSheetId;
  wb.applyBorders(id, { ...rect(0, 2, 1999, 4), scope: 'columns' }, 'outer');
  expect(wb.activeSheet.colStyles.get(3)).toEqual({ bs: 'double', bc: '#225599' });
});

it.each(['none', 'restyle'])('keeps a finite %s at the allocated edge inside its requested rectangle', kind => {
  const wb = book({ colStyles: { 3: { bt: true, br: true, bs: 'double', bc: '#225599' } } }), id = wb.activeSheetId;
  wb.applyBorders(id, rect(0, 3, 1999, 3), kind, { style: 'medium', color: '#118855' });
  expect(snapshot(wb, 1999, 3).brBorder).toEqual(kind === 'none' ? null : { bs: 'medium', bc: '#118855' });
  expect(snapshot(wb, 2000, 3).brBorder).toEqual({ bs: 'double', bc: '#225599' });
});

it('matches native Select All: outside edges are absent, inside borders cover every cell', () => {
  const wb = book(), id = wb.activeSheetId, range = { ...rect(0, 0, 1999, 79), scope: 'sheet' };
  wb.applyBorders(id, range, 'outer', { style: 'double' });
  expect(wb.canUndo()).toBe(false);
  wb.applyBorders(id, range, 'inner', { style: 'double' });
  for (const r of [0, 50, MAX_ROW]) for (const c of [0, 50, MAX_COL]) {
    expect(snapshot(wb, r, c)).toMatchObject({ bt: true, bb: true, bl: true, br: true });
    expect(snapshot(wb, r, c).blBorder.bs).toBe('double');
  }
  expect(wb.activeSheet.cells.size).toBe(0); expect(wb.activeSheet.styleResets).toHaveLength(0);
});
