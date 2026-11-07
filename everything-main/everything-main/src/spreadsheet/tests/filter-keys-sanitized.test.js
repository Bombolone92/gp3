import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const book = (criterion) => new Workbook({ sheets: [{ name: 'S',
  cells: { '0,0': { v: 'V' }, '1,0': { v: 5 }, '2,0': { v: 7 }, '3,0': { v: 5, s: { fmt: 'number', dec: 2 } } },
  filter: { range: { r1: 0, c1: 0, r2: 3, c2: 0 }, criteria: { 0: criterion } } }] });

// The keys beside a value filter's texts come from a file's sidecar like the texts do, so a stale or hostile
// one could hand the filter any shape; only a list of strings is taken, and the texts still judge the rows.
it.each([42, 'x', {}, ['5', 6], [null], [['5']]])('drops keys shaped like %j when opening the cell data, keeping the filter', (keys) => {
  const wb = book({ values: ['5'], keys });
  expect(wb.activeSheet.filter.criteria).toEqual({ 0: { values: ['5'] } });
  expect([...wb.activeSheet.filterHidden].sort()).toEqual([2, 3]);
});

it('keeps well-formed keys and judges rows by them as well', () => {
  const wb = book({ values: ['5'], keys: ['5|fmt=number,dec=2'] });
  expect(wb.activeSheet.filter.criteria).toEqual({ 0: { values: ['5'], keys: ['5|fmt=number,dec=2'] } });
  expect([...wb.activeSheet.filterHidden]).toEqual([2]);
});
