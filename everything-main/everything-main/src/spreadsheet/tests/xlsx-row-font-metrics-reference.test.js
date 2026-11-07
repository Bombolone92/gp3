import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { workbookFromFile } from '../src/core/io.js';
import { fontName } from '../src/core/format.js';
import { rowFontMetricsXlsx } from './helpers/xlsx-row-font-metrics-fixture.js';

// Saved by Excel for Mac after opening the undersized automatic-height control.
// It is an interoperability reference, not an expected-height table for the
// app's layout algorithm: automatic fitting is device/font dependent.
const excel = readFileSync(new URL('./fixtures/reference-row-font-metrics.xlsx', import.meta.url));

it('imports Excel-calculated automatic row caches and literal fonts across families and sizes', async () => {
  const wb = await workbookFromFile(excel, 'reference-row-font-metrics.xlsx');
  const cases = rowFontMetricsXlsx().cases;
  expect(wb.sheets).toHaveLength(7);
  expect(cases).toHaveLength(210);

  for (const { sheet: name, row, family, size, lines } of cases) {
    const sheet = wb.sheetByName(name);
    expect(sheet.rowHeightModes.get(row - 1)).toBe('auto');
    expect(fontName(wb.styleAt(sheet.id, row - 1, 0).font)).toBe(family);
    expect(wb.styleAt(sheet.id, row - 1, 0).size).toBeCloseTo(size * 4 / 3);
    expect(wb.getValue(sheet.id, row - 1, 0).split('\n')).toHaveLength(lines);
  }

  for (const sheet of wb.sheets) {
    for (let start = 0; start < 30; start += 3) {
      const first = wb.rowHeight(sheet.id, start);
      const second = wb.rowHeight(sheet.id, start + 1);
      const third = wb.rowHeight(sheet.id, start + 2);
      // Excel's saved two- and three-line rows share a per-line increment.
      expect(third).toBeCloseTo(second * 1.5);
      expect(second).toBeGreaterThan(first);
    }
  }

  expect(wb.rowHeight(wb.sheets[0].id, 21)).toBe(28); // Arial 16pt, one line: 21pt
  expect(wb.rowHeight(wb.sheets[1].id, 21)).toBeCloseTo(22 * 4 / 3); // Calibri 16pt
  expect(wb.rowHeight(wb.sheets[2].id, 21)).toBeCloseTo(23 * 4 / 3); // Courier New 16pt
});
