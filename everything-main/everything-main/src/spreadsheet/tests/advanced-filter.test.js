import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { advancedFilter, clearSheetFilters, reapplySheetFilters, advancedMatcher, sheetHasFiltering } from '../src/core/advanced-filter.js';
import { toggleDetail, detailGroup } from '../src/core/outline-detail.js';

function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const rows = [['Region', 'Item', 'Sales'], ['West', 'Apple', 100], ['East', 'Pear', 250], ['West', 'Apricot', 300], ['North', 'Apple', 50], ['West', 'Apple', 100]];
  const entries = [];
  rows.forEach((row, r) => row.forEach((v, c) => entries.push({ r, c, cell: { v } })));
  wb.setCells(id, entries);
  return { wb, id, list: { r1: 0, c1: 0, r2: 5, c2: 2 } };
}
const setCriteria = (wb, id, at, rows) => wb.setCells(id, rows.flatMap((row, i) => row.map((v, j) => ({ r: at.r + i, c: at.c + j, cell: v == null ? null : typeof v === 'string' && v.startsWith('=') ? { f: v.slice(1) } : { v } }))));

describe('Advanced Filter', () => {
  it('matches text as a prefix, comparisons and exact matches', () => {
    expect(advancedMatcher('Ap')('Apricot')).toBe(true);
    expect(advancedMatcher('Ap')('Grape')).toBe(false);
    expect(advancedMatcher('>100')(250)).toBe(true);
    expect(advancedMatcher('=Apple')('Apple')).toBe(true);
    expect(advancedMatcher('=Apple')('Apples')).toBe(false);
    expect(advancedMatcher(100)(100)).toBe(true);
  });

  it('filters the list in place by OR rows of AND conditions, and Clear shows it again', () => {
    const { wb, id, list } = book();
    setCriteria(wb, id, { r: 8, c: 0 }, [['Region', 'Sales'], ['West', '>100'], ['North', null]]);
    const out = advancedFilter(wb, id, { list, criteria: { range: { r1: 8, c1: 0, r2: 10, c2: 1 } } });
    expect(out).toEqual({ shown: 2, hidden: 3 });
    expect([1, 2, 3, 4, 5].map((r) => wb.sheet(id).hiddenRows.has(r))).toEqual([true, true, false, false, true]);
    expect(sheetHasFiltering(wb, id)).toBe(true);
    clearSheetFilters(wb, id);
    expect(wb.sheet(id).hiddenRows.size).toBe(0);
  });

  it('copies matching records, unique only, to another place with chosen columns', () => {
    const { wb, id, list } = book();
    setCriteria(wb, id, { r: 8, c: 0 }, [['Item'], ['Apple']]);
    setCriteria(wb, id, { r: 0, c: 5 }, [['Sales', 'Region']]);
    const out = advancedFilter(wb, id, { list, criteria: { range: { r1: 8, c1: 0, r2: 9, c2: 0 } }, copyTo: { range: { r1: 0, c1: 5, r2: 0, c2: 6 } }, unique: true });
    expect(out.copied).toBe(2);
    expect(wb.rangeValues(id, { r1: 0, c1: 5, r2: 3, c2: 6 })).toEqual([['Sales', 'Region'], [100, 'West'], [50, 'North'], [null, null]]);
    wb.undo();
    expect(wb.getValue(id, 1, 5)).toBe(null);
  });

  it('judges computed criteria written for the first record', () => {
    const { wb, id, list } = book();
    setCriteria(wb, id, { r: 8, c: 4 }, [['Big'], ['=C2>AVERAGE($C$2:$C$6)']]);
    const out = advancedFilter(wb, id, { list, criteria: { range: { r1: 8, c1: 4, r2: 9, c2: 4 } }, copyTo: { range: { r1: 12, c1: 0, r2: 12, c2: 0 } } });
    expect(out.copied).toBe(2);
    expect(wb.getValue(id, 13, 2)).toBe(250);
    expect(wb.getValue(id, 14, 2)).toBe(300);
  });

  it('refuses unknown criteria headers and reapplies after edits', () => {
    const { wb, id, list } = book();
    setCriteria(wb, id, { r: 8, c: 0 }, [['Nope'], ['x']]);
    expect(advancedFilter(wb, id, { list, criteria: { range: { r1: 8, c1: 0, r2: 9, c2: 0 } } }).error).toMatch(/names no column/);
    setCriteria(wb, id, { r: 8, c: 0 }, [['Region'], ['East']]);
    advancedFilter(wb, id, { list, criteria: { range: { r1: 8, c1: 0, r2: 9, c2: 0 } } });
    expect(wb.sheet(id).hiddenRows.has(1)).toBe(true);
    wb.setInput(id, 1, 0, 'East');
    reapplySheetFilters(wb, id);
    expect(wb.sheet(id).hiddenRows.has(1)).toBe(false);
  });
});

describe('Show Detail and Hide Detail', () => {
  it('collapses the group at the cell and expands it from its summary row', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.groupLines(id, 'row', 1, 3);
    wb.groupLines(id, 'row', 2, 3);
    expect(toggleDetail(wb, id, { active: { r: 2, c: 0 } }, false)).toBe(true); // innermost: rows 3-4
    expect(wb.sheet(id).groups.rows.find((g) => g.from === 2).collapsed).toBe(true);
    expect(toggleDetail(wb, id, { active: { r: 4, c: 0 } }, false)).toBe(true); // summary row of the outer group
    expect(wb.sheet(id).groups.rows.find((g) => g.from === 1).collapsed).toBe(true);
    expect(detailGroup(wb, id, { active: { r: 4, c: 0 } }, true)).toEqual({ axis: 'row', from: 1, to: 3 });
    toggleDetail(wb, id, { active: { r: 4, c: 0 } }, true);
    expect(wb.sheet(id).hiddenRows.has(1)).toBe(false);
    expect(wb.sheet(id).hiddenRows.has(2)).toBe(true); // the inner group stays closed
    expect(toggleDetail(wb, id, { active: { r: 20, c: 0 } }, true)).toBe(false);
  });
});
