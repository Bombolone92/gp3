import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { tableStyle } from '../src/core/tables.js';

const grid = (rows) => rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } })));
const BAND = tableStyle('blue').band;

function table() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['Name', 'Amt'], ['a', 1], ['b', 2], ['c', 3], ['d', 4], ['e', 5]]));
  wb.addTable(id, { r1: 0, c1: 0, r2: 5, c2: 1 }, { name: 'T' });
  const bands = () => [1, 2, 3, 4, 5].filter((r) => !wb.isRowHidden(id, r)).map((r) => (wb.conditionalStyle(id, r, 0, 'x')?.bg === BAND ? 'band' : 'plain'));
  return { wb, id, bands };
}

it('alternates table bands over the rows a filter leaves visible', () => {
  const { wb, id, bands } = table();
  expect(bands()).toEqual(['band', 'plain', 'band', 'plain', 'band']);
  wb.setFilterCriteria(id, 0, { values: ['a', 'c', 'd', 'e'] });
  expect([...wb.sheet(id).filterHidden]).toEqual([2]);
  expect(bands()).toEqual(['band', 'plain', 'band', 'plain']);
  wb.setFilterCriteria(id, 0, { values: ['c', 'd', 'e'] });
  expect(bands()).toEqual(['band', 'plain', 'band']);
  wb.setFilterCriteria(id, 0, null);
  expect(bands()).toEqual(['band', 'plain', 'band', 'plain', 'band']);
});

it('alternates table bands over the rows left after hiding some by hand', () => {
  const { wb, id, bands } = table();
  wb.setHidden(id, 'row', [1], true);
  expect(bands()).toEqual(['band', 'plain', 'band', 'plain']);
  wb.undo();
  expect(bands()).toEqual(['band', 'plain', 'band', 'plain', 'band']);
});

it('alternates an alternating-colors rule over visible rows, keeping its header', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (let r = 0; r < 6; r++) wb.setInput(id, r, 0, r === 0 ? 'Head' : `v${r}`);
  wb.addRule(id, { range: { r1: 0, c1: 0, r2: 5, c2: 0 }, type: 'bands', color1: '#111111', color2: '#222222', headerColor: '#333333' });
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: 5, c2: 0 });
  const fills = () => [0, 1, 2, 3, 4, 5].filter((r) => !wb.isRowHidden(id, r)).map((r) => wb.conditionalStyle(id, r, 0, 'x')?.bg);
  expect(fills()).toEqual(['#333333', '#111111', '#222222', '#111111', '#222222', '#111111']);
  wb.setFilterCriteria(id, 0, { values: ['v1', 'v3', 'v4', 'v5'] });
  expect(fills()).toEqual(['#333333', '#111111', '#222222', '#111111', '#222222']);
});
