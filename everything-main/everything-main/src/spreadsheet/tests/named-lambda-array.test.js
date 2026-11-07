import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it('spills the array a named LAMBDA returns when it is called like a function', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.defineName('Seq', '=LAMBDA(n, SEQUENCE(n))');
  wb.setInput(id, 0, 0, '=Seq(3)');
  wb.setInput(id, 0, 2, '=SUM(Seq(4))');
  expect([0, 1, 2].map((r) => wb.getValue(id, r, 0))).toEqual([1, 2, 3]);
  expect(wb.getValue(id, 0, 2)).toBe(10);
  // Reading a spilled cell first gives the same answer.
  const again = new Workbook(wb.toJSON());
  expect(again.getValue(id, 2, 0)).toBe(3);
  expect(again.getValue(id, 0, 0)).toBe(1);
  expect(wb.spillRangeAt(id, 0, 0)).toEqual({ r1: 0, c1: 0, r2: 2, c2: 0 });
});

it('keeps an unknown function name as #NAME?', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=NoSuchThing(3)');
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#NAME?' });
  expect(wb.getValue(id, 1, 0)).toBe(null);
});
