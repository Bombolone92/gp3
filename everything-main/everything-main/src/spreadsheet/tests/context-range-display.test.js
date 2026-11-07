import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// A function that hands cells to a reader rather than to a calculation — AI() describing a range —
// wants each cell as the text its format shows, not its raw value: 2026-01-05 rather than 46027,
// 50% rather than 0.5, TRUE rather than true. The evaluation context offers that window beside
// getRangeValues, over the same clamped extent, and null for a sheet that does not exist.
describe('the context\'s display window over a range', () => {
  it('gives each cell as it shows, over the same window as the values', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '2026-01-05');
    wb.setInput(id, 0, 1, '50%');
    wb.setInput(id, 0, 2, 'TRUE');
    wb.setInput(id, 1, 0, '=0.1+0.2');
    wb.setInput(id, 1, 1, '$1,500');
    const ctx = wb.contextFor(id, 5, 5);
    const ref = { kind: 'range', r1: 0, c1: 0, r2: 1, c2: 2 };
    // A typed $1,500 shows the decimals it was typed with, none, as a typed 50% does.
    expect(ctx.getRangeDisplay(ref)).toEqual([
      ['2026-01-05', '50%', 'TRUE'],
      ['0.3', '$1,500', ''],
    ]);
    expect(ctx.getRangeValues(ref)).toEqual([[46027, 0.5, true], [0.30000000000000004, 1500, null]]);
  });

  it('reads another sheet by name and answers null for a missing one', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const other = wb.addSheet('Data');
    wb.setInput(other.id, 0, 0, '12:30');
    const ctx = wb.contextFor(id, 0, 0);
    expect(ctx.getRangeDisplay({ kind: 'cell', sheet: 'Data', r1: 0, c1: 0, r2: 0, c2: 0 })).toEqual([['12:30']]);
    expect(ctx.getRangeDisplay({ kind: 'cell', sheet: 'Nowhere', r1: 0, c1: 0, r2: 0, c2: 0 })).toBeNull();
  });
});
