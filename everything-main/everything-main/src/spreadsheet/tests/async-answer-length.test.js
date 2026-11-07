import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { MAX_TEXT } from '../src/core/cell.js';

const tick = () => new Promise(setImmediate);

// An answer from AI() or an IMPORT function was stored whole, so a cell could hold more text than
// one may be given, and the functions reading it (A1&"") answered #VALUE!.
async function answered(answer, { name = 'AI', formula = 'AI("x")' } = {}) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setAsyncProvider(name, async () => answer);
  wb.setInput(id, 0, 0, `=${formula}`);
  wb.setInput(id, 1, 0, '=LEN(A1)');
  wb.setInput(id, 2, 0, '=LEN(A1&"")');
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#BUSY!' });
  await tick();
  return { wb, id };
}

it('keeps a long answer to the length a cell holds', async () => {
  const { wb, id } = await answered('x'.repeat(40000));
  expect(wb.getValue(id, 1, 0)).toBe(MAX_TEXT);
  expect(wb.getValue(id, 2, 0)).toBe(MAX_TEXT);
});

it('does not cut a surrogate pair in two at the limit', async () => {
  // 32766 letters and one emoji of two code units: the cut at 32767 would leave the emoji's first half.
  const { wb, id } = await answered(`${'x'.repeat(MAX_TEXT - 1)}\u{1F600}`);
  expect(wb.getValue(id, 1, 0)).toBe(MAX_TEXT - 1);
  expect(wb.getValue(id, 0, 0)).toBe('x'.repeat(MAX_TEXT - 1));
});

it('keeps the cells of a block of rows to the limit too', async () => {
  const { wb, id } = await answered([['y'.repeat(40000), 'z']], { name: 'IMPORTDATA', formula: 'IMPORTDATA("https://example.com/rows.csv")' });
  expect(wb.spillRangeAt(id, 0, 0)).toEqual({ r1: 0, c1: 0, r2: 0, c2: 1 });
  expect(wb.getValue(id, 1, 0)).toBe(MAX_TEXT);
  expect(wb.getValue(id, 0, 1)).toBe('z');
});
