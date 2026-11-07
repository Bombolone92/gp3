import { expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it('does not rescan a text-only color-scale range for every rendered cell', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, Array.from({ length: 1000 }, (_, r) => ({ r, c: 0, cell: { v: `Label ${r}`, f: null } })));
  wb.addRule(id, { range: { r1: 0, c1: 0, r2: 999, c2: 0 }, type: 'scale', from: '#000000', to: '#ffffff' });
  const evaluate = vi.spyOn(wb, '_compute');
  expect(wb.conditionalStyle(id, 0, 0, 'Label 0')).toBeNull();
  const firstPass = evaluate.mock.calls.length;
  for (let r = 1; r < 100; r++) expect(wb.conditionalStyle(id, r, 0, `Label ${r}`)).toBeNull();
  expect(evaluate.mock.calls.length).toBe(firstPass);
  wb.setInput(id, 0, 0, '10');
  expect(wb.conditionalStyle(id, 0, 0, 10)).toEqual({ bg: '#ffffff' });
});
