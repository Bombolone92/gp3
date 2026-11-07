import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it('keeps a number a number when it becomes a link, and gives it back when the link is removed', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1000');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'currency', cur: 'USD' });
  wb.setInput(id, 1, 0, '=SUM(A1)');
  const shown = wb.getDisplay(id, 0, 0);
  expect(shown).not.toBe('1000');
  expect(wb.setLink(id, 0, 0, 'https://x.com', 1000)).toBe(true);
  expect(wb.getCell(id, 0, 0)).toMatchObject({ v: 1000, f: null, hyperlink: 'https://x.com' });
  expect(wb.getValue(id, 0, 0)).toBe(1000);
  expect(wb.getDisplay(id, 0, 0)).toBe(shown);
  expect(wb.getValue(id, 1, 0)).toBe(1000);
  expect(wb.linkAt(id, 0, 0)).toMatchObject({ label: shown });
  wb.removeLink(id, 0, 0);
  expect(wb.getCell(id, 0, 0)).toMatchObject({ v: 1000, f: null, s: { fmt: 'currency' } });
  expect(wb.getDisplay(id, 0, 0)).toBe(shown);
  expect(wb.getValue(id, 1, 0)).toBe(1000);
});

it('keeps boolean and text labels in their original types', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setLink(id, 0, 0, 'https://x.com', true);
  expect(wb.getCell(id, 0, 0)).toMatchObject({ v: true, f: null, hyperlink: 'https://x.com' });
  expect(wb.getValue(id, 0, 0)).toBe(true);
  wb.setLink(id, 1, 0, 'https://x.com', '1000');
  expect(wb.getCell(id, 1, 0)).toMatchObject({ v: '1000', f: null, hyperlink: 'https://x.com' });
  wb.removeLink(id, 1, 0);
  expect(wb.getCell(id, 1, 0)).toMatchObject({ v: '1000', f: null });
});

it('gives back the value a link\'s label computed to when the link is removed', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 1, 0, '250');
  wb.setInput(id, 0, 0, '=HYPERLINK("https://x.com",A2*2)');
  wb.removeLink(id, 0, 0);
  expect(wb.getCell(id, 0, 0)).toMatchObject({ v: 500, f: null });
});
