import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { dataBar, barColorOf, DEFAULT_BAR_COLOR } from '../src/core/condformat.js';

const hostile = "red 0%, transparent 0%), url('https://attacker.example/pixel.png'), linear-gradient(red";

it('only lets a plain hex color into a data bar gradient', () => {
  expect(barColorOf({ barColor: '#9FDCB4' })).toBe('#9FDCB4');
  expect(barColorOf({ barColor: hostile })).toBe(DEFAULT_BAR_COLOR);
  expect(barColorOf({ barColor: 'red' })).toBe(DEFAULT_BAR_COLOR);
  expect(barColorOf({})).toBe(DEFAULT_BAR_COLOR);
  expect(dataBar({ type: 'databar', barColor: hostile }, 5, 0, 10)).toEqual({ bar: 0.5, barColor: DEFAULT_BAR_COLOR });
});

it('drops a hostile bar color while loading a file and when painting cells', () => {
  const wb = new Workbook({ sheets: [{ name: 'S', cells: { '0,0': { v: 5 }, '1,0': { v: 10 } },
    rules: [{ id: 'r1', type: 'databar', range: { r1: 0, c1: 0, r2: 1, c2: 0 }, barColor: hostile }] }] });
  const id = wb.activeSheetId;
  expect(wb.sheet(id).rules[0].barColor).toBe(DEFAULT_BAR_COLOR);
  expect(wb.conditionalStyle(id, 0, 0, 5)).toMatchObject({ bar: 0.5, barColor: DEFAULT_BAR_COLOR });
  // A rule added at runtime with a bad color paints the default too.
  wb.addRule(id, { type: 'databar', range: { r1: 0, c1: 0, r2: 1, c2: 0 }, barColor: 'url(x)' });
  expect(wb.conditionalStyle(id, 1, 0, 10).barColor).toBe(DEFAULT_BAR_COLOR);
});
