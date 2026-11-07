import { expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it('skips empty cells in a large dropdown source and retains reading order', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 9999, 25, 'Last');
  wb.setInput(id, 0, 1, 'Second');
  wb.setInput(id, 0, 0, 'First');
  const compute = vi.spyOn(wb, '_compute');
  expect(wb.listOptionsFor(id, { type: 'list', source: 'A1:Z10000' })).toEqual(['First', 'Second', 'Last']);
  expect(compute.mock.calls.length).toBeLessThanOrEqual(3);
});

it('interleaves stored and spilled options without duplicating styled spill cells', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 1, 2, 'Tail');
  wb.setInput(id, 0, 2, 'FALSE');
  wb.setInput(id, 2, 2, "'4");
  wb.setInput(id, 0, 0, '=SEQUENCE(2,2)');
  wb.applyStyle(id, { r1: 1, c1: 1, r2: 1, c2: 1 }, { italic: true });
  wb.setInput(id, 3, 2, '=1/0');
  wb.setInput(id, 4, 2, '=""');
  const rule = { type: 'list', source: 'A1:C100' };
  expect(wb.listOptionsFor(id, rule, { typed: true })).toEqual([1, 2, false, 3, 4, 'Tail', '4']);
  expect(wb.listOptionsFor(id, rule)).toEqual(['1', '2', 'FALSE', '3', '4', 'Tail']);
  expect(wb.listOptionsFor(id, { ...rule, source: 'B1:B100' }, { typed: true })).toEqual([2, 4]);
});

it('resolves a dropdown source once while rendering and validating many chips', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, Array.from({ length: 1000 }, (_, r) => ({ r, c: 0, cell: { v: `Option ${r}`, f: null } })));
  wb.setCells(id, Array.from({ length: 40 }, (_, r) => ({ r, c: 1, cell: { v: `Option ${r}`, f: null } })));
  wb.addValidation(id, { range: { r1: 0, c1: 1, r2: 39, c2: 1 }, type: 'list', source: 'A1:A1000', chips: true });
  const compute = vi.spyOn(wb, '_compute');
  for (let r = 0; r < 40; r++) {
    expect(wb.chipAt(id, r, 1)).not.toBeNull();
    expect(wb.validateCell(id, r, 1).ok).toBe(true);
  }
  expect(compute.mock.calls.filter(([, , c]) => c === 0)).toHaveLength(1000);
});

it('refreshes dropdown sources after edits, undo, redo, and spill resizing', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const source = wb.addSheet('Lists').id;
  wb.setInput(source, 0, 0, '=SEQUENCE(3)');
  const rule = { type: 'list', source: 'Lists!A1:A5' };
  const options = () => wb.listOptionsFor(id, rule, { typed: true });
  expect(options()).toEqual([1, 2, 3]);
  wb.setInput(source, 0, 0, '=SEQUENCE(2,1,8)');
  expect(options()).toEqual([8, 9]);
  wb.undo();
  expect(options()).toEqual([1, 2, 3]);
  wb.redo();
  expect(options()).toEqual([8, 9]);
});

it.each([
  ['=SEQUENCE(150)', 'A1:A150', 1, 150],
  ['=SEQUENCE(150)', 'A101:A150', 101, 50],
  ['=SEQUENCE(1,30)', 'A1:AD1', 1, 30],
  ['=SEQUENCE(1,30)', 'AA1:AD1', 27, 4],
])('includes a newly expanded spill from %s in source %s on its first use', (formula, source, start, count) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, formula);
  const rule = { type: 'list', source };
  const expected = Array.from({ length: count }, (_, i) => start + i);
  expect(wb.listOptionsFor(id, rule, { typed: true })).toEqual(expected);
  expect(wb.listOptionsFor(id, rule, { typed: true })).toEqual(expected);
});

it('keeps relative sources and typed labels separate and does not expose cached arrays', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const other = wb.addSheet('Other').id;
  wb.setInput(id, 0, 0, '5');
  wb.setInput(id, 1, 0, "'5");
  wb.setInput(other, 0, 0, 'Different');
  const rule = { type: 'list', source: 'A1:A2' };
  expect(wb.listOptionsFor(id, rule)).toEqual(['5']);
  const typed = wb.listOptionsFor(id, rule, { typed: true });
  expect(typed).toEqual([5, '5']);
  typed.splice(0, 2, 'Changed');
  expect(wb.listOptionsFor(id, rule, { typed: true })).toEqual([5, '5']);
  expect(wb.listOptionsFor(other, rule)).toEqual(['Different']);
});

it('refreshes cached dropdown values when volatile formulas recalculate', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.25);
  try {
    wb.setInput(id, 0, 0, '=RAND()');
    const rule = { type: 'list', source: 'A1:A2' };
    expect(wb.listOptionsFor(id, rule, { typed: true })).toEqual([0.25]);
    random.mockReturnValue(0.75);
    wb.refreshVolatile();
    expect(wb.listOptionsFor(id, rule, { typed: true })).toEqual([0.75]);
  } finally {
    random.mockRestore();
  }
});
