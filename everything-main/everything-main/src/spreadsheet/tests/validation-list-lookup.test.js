import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { chipFor, listOptionIndex, listOptions } from '../src/core/validation.js';

function book(optionCount) {
  const wb = new Workbook({ sheets: [{ name: 'S', rows: Math.max(optionCount, 400), cols: 2, cells: Object.fromEntries(Array.from({ length: optionCount }, (_, r) => [`${r},0`, { v: `Option ${r}` }])) }] });
  const id = wb.activeSheetId;
  wb.setCells(id, Array.from({ length: 400 }, (_, r) => ({ r, c: 1, cell: { v: r % 5 === 0 ? 'nope' : `Option ${r % optionCount}` } })));
  wb.addValidation(id, { range: { r1: 0, c1: 1, r2: 399, c2: 1 }, type: 'list', source: `A1:A${optionCount}`, chips: true });
  return { wb, id };
}

/** What the grid asks per drawn list cell: the check twice and the chip colour. */
function draw(wb, id) {
  const started = performance.now();
  let bad = 0;
  for (let r = 0; r < 400; r++) {
    if (!wb.validateCell(id, r, 1).ok) bad++;
    wb.validateCell(id, r, 1);
    wb.chipAt(id, r, 1);
  }
  return { ms: performance.now() - started, bad };
}

it('checks and colours list cells in about the same time however long the source', () => {
  const small = book(20);
  const large = book(20000);
  draw(small.wb, small.id);
  draw(large.wb, large.id);
  const a = draw(small.wb, small.id);
  const b = draw(large.wb, large.id);
  expect(a.bad).toBe(80);
  expect(b.bad).toBe(80);
  expect(b.ms).toBeLessThan(Math.max(50, a.ms * 20));
});

it('finds the chip colour of a value by its place in the list', () => {
  const rule = { type: 'list', source: ['Red', 'Green', ' Blue '], chips: true };
  expect(listOptionIndex(rule, null, 'blue')).toBe(2);
  expect(listOptionIndex(rule, null, 'Nope')).toBe(-1);
  expect(chipFor(rule, 'Blue', 2)).toEqual(chipFor(rule, 'Blue', listOptions(rule)));
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'blue');
  wb.addValidation(id, { range: { r1: 0, c1: 0, r2: 0, c2: 0 }, type: 'list', source: ['Red', 'Green', ' Blue '], chips: true });
  expect(wb.chipAt(id, 0, 0)).toEqual(chipFor(rule, 'blue', ['Red', 'Green', ' Blue ']));
  expect(wb.chipAt(id, 0, 0).bg).not.toBe(chipFor(rule, 'Red', 0).bg);
});

it('still accepts numbers typed as text and follows edits to the source', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '10');
  wb.setInput(id, 1, 0, 'Ten');
  wb.addValidation(id, { range: { r1: 0, c1: 1, r2: 5, c2: 1 }, type: 'list', source: 'A1:A3' });
  expect(wb.validateInput(id, 0, 1, '10.0').ok).toBe(true);
  expect(wb.validateInput(id, 0, 1, 'ten').ok).toBe(true);
  expect(wb.validateInput(id, 0, 1, '11').ok).toBe(false);
  expect(wb.validateInput(id, 0, 1, '11').message).toBe('Pick one of: 10, Ten');
  wb.setInput(id, 2, 0, '11');
  expect(wb.validateInput(id, 0, 1, '11').ok).toBe(true);
  wb.undo();
  expect(wb.validateInput(id, 0, 1, '11').ok).toBe(false);
  expect(wb.listOptionsFor(id, { type: 'list', source: 'Yes, No' })).toEqual(['Yes', 'No']);
  expect(wb.validateInput(id, 0, 1, 'yes').ok).toBe(false);
});
