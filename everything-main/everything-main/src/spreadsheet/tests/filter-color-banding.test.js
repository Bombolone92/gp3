import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { tableStyle } from '../src/core/tables.js';

const grid = (rows) => rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } })));
const BAND = tableStyle('blue').band;

// An eight-row banded table; an unrelated conditional format elsewhere on the sheet makes the fill
// lookup consult the rules, which is where banding used to leak into filter by colour.
function banded({ rule = true } = {}) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['Item', 'Qty'], ...Array.from({ length: 8 }, (_, i) => [`i${i + 1}`, 8 - i])]));
  wb.addTable(id, { r1: 0, c1: 0, r2: 8, c2: 1 }, { name: 'T' });
  if (rule) wb.addRule(id, { range: { r1: 20, c1: 5, r2: 20, c2: 5 }, type: 'gt', value: 1, style: { bg: '#00ff00' } });
  const visible = () => [1, 2, 3, 4, 5, 6, 7, 8].filter((r) => !wb.isRowHidden(id, r));
  return { wb, id, visible };
}

it('lists the same fills for a banded table whether or not the sheet has a conditional format', () => {
  const without = banded({ rule: false });
  const withRule = banded();
  expect(without.wb.filterColors(without.id, 0)).toEqual([{ color: '', count: 8 }]);
  expect(withRule.wb.filterColors(withRule.id, 0)).toEqual([{ color: '', count: 8 }]);
  expect(withRule.wb.conditionalStyle(withRule.id, 1, 0, 'i1')?.bg).toBe(BAND);
});

it('offers a cell\'s own fill and a rule\'s fill on a banded row, not the band', () => {
  const { wb, id, visible } = banded();
  wb.applyStyle(id, { r1: 1, c1: 0, r2: 1, c2: 0 }, { bg: '#ff0000' });
  wb.addRule(id, { range: { r1: 1, c1: 0, r2: 8, c2: 0 }, type: 'eq', value: 'i3', style: { bg: '#00ff00' } });
  expect(wb.filterColors(id, 0)).toEqual([{ color: '#ff0000', count: 1 }, { color: '#00ff00', count: 1 }, { color: '', count: 6 }]);
  wb.setFilterCriteria(id, 0, { color: '#ff0000' });
  expect(visible()).toEqual([1]);
  wb.setFilterCriteria(id, 0, { color: '#00ff00' });
  expect(visible()).toEqual([3]);
  wb.setFilterCriteria(id, 0, { color: '' });
  expect(visible()).toEqual([2, 4, 5, 6, 7, 8]);
});

it('keeps a filter by colour stable when it is applied again, narrowed, widened, or undone', () => {
  const { wb, id, visible } = banded();
  for (const r of [1, 3, 5, 7]) wb.applyStyle(id, { r1: r, c1: 0, r2: r, c2: 0 }, { bg: '#ff0000' });
  expect(wb.filterColors(id, 0)).toEqual([{ color: '#ff0000', count: 4 }, { color: '', count: 4 }]);
  wb.setFilterCriteria(id, 0, { color: '#ff0000' });
  expect(visible()).toEqual([1, 3, 5, 7]);
  wb.reapplyFilter(id);
  expect(visible()).toEqual([1, 3, 5, 7]);
  // The header menu's sort re-applies the filter to the rearranged rows.
  wb.sortRangeBy(id, { r1: 1, c1: 0, r2: 8, c2: 1 }, [{ col: 1, ascending: true }]);
  wb.reapplyFilter(id);
  expect(visible()).toHaveLength(4);
  wb.setFilterCriteria(id, 1, { op: 'gt', value: 4 });
  expect(visible()).toHaveLength(2);
  wb.setFilterCriteria(id, 1, null);
  expect(visible()).toHaveLength(4);
  wb.undo();
  wb.undo();
  expect(visible()).toHaveLength(4);
});

it('leaves an alternating-colours rule out of the fills a filter offers, since its colours move with the rows in view', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (let r = 0; r < 6; r++) wb.setInput(id, r, 0, r === 0 ? 'Head' : `v${r}`);
  wb.addRule(id, { range: { r1: 0, c1: 0, r2: 5, c2: 0 }, type: 'bands', color1: '#111111', color2: '#222222', headerColor: '#333333' });
  wb.applyStyle(id, { r1: 2, c1: 0, r2: 2, c2: 0 }, { bg: '#ff0000' });
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: 5, c2: 0 });
  expect(wb.filterColors(id, 0)).toEqual([{ color: '#ff0000', count: 1 }, { color: '', count: 4 }]);
  wb.setFilterCriteria(id, 0, { color: '#ff0000' });
  expect([...wb.sheet(id).filterHidden].sort((a, b) => a - b)).toEqual([1, 3, 4, 5]);
});
