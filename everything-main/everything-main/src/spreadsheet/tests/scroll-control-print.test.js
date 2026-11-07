// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { buildPrintSheet } from '../src/ui/print.js';

it.each([true, false])('honors the native print setting (%s)', print => {
  const wb = new Workbook({ sheets: [{ name: 'Data', cells: { '0,0': { v: 1 } }, charts: [{ type: 'scroll', anchor: { r: 9, c: 8 }, w: 160, h: 20, min: 0, max: 20, value: 9, print }] }] });
  const root = buildPrintSheet(wb, wb.activeSheetId, {});
  expect(root.querySelectorAll('.form-scroll')).toHaveLength(Number(print));
  if (print) expect(root.querySelector('[role=scrollbar]').getAttribute('aria-valuenow')).toBe('9');
  else expect(root.querySelectorAll('tbody tr')).toHaveLength(1);
});
