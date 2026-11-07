import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const tick = () => new Promise(setImmediate);

// An answer from an async source went through String(): a boolean became the text "true", an object
// "[object Object]", and a nested array was kept as it was, an array in a cell, shown as #VALUE!.
async function answered(answer, { name = 'AI', formula = 'AI("x")' } = {}) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setAsyncProvider(name, async () => answer);
  wb.setInput(id, 0, 0, `=${formula}`);
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#BUSY!' });
  await tick();
  return { wb, id };
}

it('keeps a boolean answer a boolean', async () => {
  const { wb, id } = await answered(true);
  expect(wb.getValue(id, 0, 0)).toBe(true);
  expect(wb.getDisplay(id, 0, 0)).toBe('TRUE');
});

it('reads numbers from text, trims text and shows nothing for no answer', async () => {
  const value = async (answer) => { const { wb, id } = await answered(answer); return wb.getValue(id, 0, 0); };
  expect(await value(' 42 ')).toBe(42);
  expect(await value(' hello ')).toBe('hello');
  expect(await value(null)).toBe('');
});

it('answers #VALUE! for an object or a nested array, which no cell can hold', async () => {
  for (const answer of [{ a: 1 }, new Date(0), [[[1, 2]]]]) {
    const { wb, id } = await answered(answer);
    expect(wb.getValue(id, 0, 0)).toEqual({ error: '#VALUE!' });
    expect(wb.getDisplay(id, 0, 0)).toBe('#VALUE!');
  }
});

it('spills a block of rows with every cell a value, booleans and errors among them', async () => {
  // IMPORTDATA is known for a function whose answer may spill, so the block lands whichever cell is read first.
  const { wb, id } = await answered([[1, 'x', true, null], [[2], { error: '#N/A' }]], { name: 'IMPORTDATA', formula: 'IMPORTDATA("https://example.com/rows.csv")' });
  expect(wb.spillRangeAt(id, 0, 0)).toEqual({ r1: 0, c1: 0, r2: 1, c2: 3 });
  expect(wb.rangeValues(id, { r1: 0, c1: 0, r2: 1, c2: 3 })).toEqual([[1, 'x', true, ''], [{ error: '#VALUE!' }, { error: '#N/A' }, '', '']]);
  expect(wb.getDisplay(id, 0, 2)).toBe('TRUE');
});
