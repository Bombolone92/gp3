import { it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { columnStats } from '../src/core/stats.js';

// The column statistics counted the number 1, the text "1" and TRUE / "TRUE"
// as the same value, so Unique and Top were wrong for mixed columns.
it('tells numbers, text and booleans of the same spelling apart', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const inputs = ['1', "'1", 'TRUE', "'TRUE", '2', "' 1 ", 'abc', 'ABC'];
  inputs.forEach((text, r) => wb.setInput(id, r, 0, text));
  const stats = columnStats(wb, id, 0, { r1: 0, r2: inputs.length - 1 });
  // 1 · "1" (twice, trimmed) · TRUE · "TRUE" · 2 · abc (twice, case-insensitive)
  expect(stats.unique).toBe(6);
  const counts = Object.fromEntries(stats.top.map((t) => [t.value, t.count]));
  expect(counts['1']).toBeLessThanOrEqual(2);
  expect(stats.top.reduce((n, t) => n + t.count, 0)).toBeLessThanOrEqual(inputs.length);
});
