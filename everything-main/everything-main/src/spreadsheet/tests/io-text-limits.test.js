import { expect, it } from 'vitest';
import { workbookFromFile } from '../src/core/io.js';

// Delimited text used to stop at 20,000 rows and 702 columns, the scrolling
// caps of a new sheet, while the same data in an .xlsx imported in full.
it('imports a CSV taller than 20,000 rows and wider than 702 columns in full', async () => {
  const rows = 25000;
  const lines = [];
  for (let r = 0; r < rows; r++) lines.push(`${r},${r * 2},x${r}`);
  const tall = await workbookFromFile(new TextEncoder().encode(lines.join('\n')), 'tall.csv');
  const id = tall.activeSheetId;
  expect(tall.sheets[0].cells.size).toBe(rows * 3);
  expect(tall.getValue(id, rows - 1, 2)).toBe(`x${rows - 1}`);
  expect(tall.getValue(id, rows - 1, 1)).toBe((rows - 1) * 2);
  expect(tall.sheets[0].rows).toBeGreaterThanOrEqual(rows);
  const wide = await workbookFromFile(new TextEncoder().encode(Array.from({ length: 1000 }, (_, i) => i).join(',')), 'wide.csv');
  expect(wide.sheets[0].cells.size).toBe(1000);
  expect(wide.getValue(wide.activeSheetId, 0, 999)).toBe(999);
  expect(wide.sheets[0].cols).toBeGreaterThanOrEqual(1000);
});
