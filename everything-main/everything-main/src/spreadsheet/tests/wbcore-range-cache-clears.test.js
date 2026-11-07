import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

function lookups(rows, count) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.ensureSize(id, rows + 1, 6);
  const entries = [];
  for (let r = 0; r < rows; r++) {
    entries.push({ r, c: 0, cell: { v: r + 1, f: null } });
    entries.push({ r, c: 1, cell: { v: (r * 7) % 1000, f: null } });
  }
  for (let r = 0; r < count; r++) entries.push({ r, c: 3, cell: { v: null, f: `INDEX($B$1:$B$${rows},MATCH(${r + 1},$A$1:$A$${rows},0))` } });
  wb.setCells(id, entries, 'fill');
  return { wb, id };
}

// Every formula that could have spilled but gave one value emptied the shared range cache
// on its way out, so 300 INDEX/MATCH lookups over 20,000 rows each re-read both columns.
describe('the shared range cache and formulas that could have spilled', () => {
  it('is kept while such formulas give single values', () => {
    const { wb, id } = lookups(2000, 300);
    let clears = 0;
    const clear = wb._rangeCache.clear.bind(wb._rangeCache);
    wb._rangeCache.clear = () => { clears++; clear(); };
    for (let r = 0; r < 300; r++) expect(wb.getValue(id, r, 3)).toBe((r * 7) % 1000);
    expect(clears).toBe(0);
  });

  it('still drops ranges that a spill lands on or leaves', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 6, '=SUM(F1:F3)');
    wb.setInput(id, 1, 6, '=COUNTA(F1:F3)');
    expect(wb.getValue(id, 0, 6)).toBe(0);
    wb.setInput(id, 0, 5, '=SEQUENCE(3)');
    expect(wb.getValue(id, 1, 6)).toBe(3);
    expect(wb.getValue(id, 0, 6)).toBe(6);
    wb.setInput(id, 0, 5, '=SEQUENCE(2)');
    expect(wb.getValue(id, 1, 6)).toBe(2);
    expect(wb.getValue(id, 0, 6)).toBe(3);
    wb.setInput(id, 0, 5, '=IF(TRUE, 5, SEQUENCE(2))'); // could spill, gives one value
    expect(wb.getValue(id, 0, 6)).toBe(5);
    expect(wb.getValue(id, 1, 6)).toBe(1);
  });

  it('makes lookups over a long table cost about what the reads cost', () => {
    const { wb, id } = lookups(20000, 300);
    const t0 = performance.now();
    for (let r = 0; r < 300; r++) wb.getValue(id, r, 3);
    // About 200 ms when the columns are read once; over 6 s when every formula re-read them.
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});
