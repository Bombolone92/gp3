import { expect, it } from 'vitest';
import { workbookFromFile } from '../src/core/io.js';

const enc = (text) => new TextEncoder().encode(text);

it('keeps a leading apostrophe in a CSV field as part of the text', async () => {
  const wb = await workbookFromFile(enc("'abc,'123,'=SUM(1),plain,=1+1,12\n"), 'quotes.csv');
  const id = wb.sheets[0].id;
  expect(wb.getCell(id, 0, 0)).toMatchObject({ v: "'abc", f: null });
  expect(wb.getCell(id, 0, 1)).toMatchObject({ v: "'123", f: null });
  // Before formula-shaped text the apostrophe is the guard mark an export writes so the field
  // would not run when opened, never data: it comes off, and the text stays text.
  expect(wb.getCell(id, 0, 2)).toMatchObject({ v: '=SUM(1)', f: null });
  expect(wb.getDisplay(id, 0, 0)).toBe("'abc");
  // The rest of the row still reads as usual: text, a formula, a number.
  expect(wb.getCell(id, 0, 3)).toMatchObject({ v: 'plain' });
  expect(wb.getValue(id, 0, 4)).toBe(2);
  expect(wb.getValue(id, 0, 5)).toBe(12);
});

it('does the same for tab-separated text', async () => {
  const wb = await workbookFromFile(enc("'x\t'0042\n"), 'quotes.tsv');
  const id = wb.sheets[0].id;
  expect(wb.getCell(id, 0, 0)).toMatchObject({ v: "'x", f: null });
  expect(wb.getCell(id, 0, 1)).toMatchObject({ v: "'0042", f: null });
});
