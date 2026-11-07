import { describe, expect, it } from 'vitest';
import { Workbook, cloneCell } from '../src/core/workbook.js';
import { MAX_FORMAT_CODE_LENGTH } from '../src/core/numfmt.js';

const LONG = '0'.repeat(MAX_FORMAT_CODE_LENGTH + 1);
const LONGEST = '0'.repeat(MAX_FORMAT_CODE_LENGTH);

// Files, sidecars and pastes drop a format code past the 255-character limit at the door; a saved
// workbook's JSON, a recovered draft, or a cell written straight into a sheet did not, and every
// cell shown through such a code cost some ten milliseconds.
describe('a custom format code longer than the 255-character limit', () => {
  it('is dropped, the cell reading General, when a workbook is loaded from JSON or a draft', () => {
    const json = { sheets: [{ name: 'S', cells: {
      '0,0': { v: 1.5, s: { fmt: 'custom', code: LONG, bold: true } },
      '1,0': { v: 2.5, s: { fmt: 'custom', code: LONGEST } },
      '2,0': { v: 3.5, s: { fmt: 'custom', code: LONG } },
    } }] };
    const wb = new Workbook(json);
    const id = wb.sheets[0].id;
    expect(wb.getCell(id, 0, 0)).toEqual({ v: 1.5, f: null, s: { bold: true } });
    expect(wb.getDisplay(id, 0, 0)).toBe('1.5');
    // At the limit the code is kept and used.
    expect(wb.getCell(id, 1, 0).s).toEqual({ fmt: 'custom', code: LONGEST });
    expect(wb.getDisplay(id, 1, 0)).toHaveLength(MAX_FORMAT_CODE_LENGTH);
    // A style left with nothing is left off.
    expect(wb.getCell(id, 2, 0)).toEqual({ v: 3.5, f: null });
    const draft = new Workbook();
    draft.replaceWith(json);
    expect(draft.getCell(draft.sheets[0].id, 0, 0).s).toEqual({ bold: true });
  });

  it('is dropped from cells written into a sheet, and never saved', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setCells(id, [{ r: 0, c: 0, cell: { v: 7, s: { fmt: 'custom', code: LONG, italic: true } } }]);
    expect(wb.getCell(id, 0, 0)).toEqual({ v: 7, f: null, s: { italic: true } });
    expect(wb.getDisplay(id, 0, 0)).toBe('7');
    expect(JSON.stringify(wb.toJSON())).not.toContain(LONG);
    expect(cloneCell({ v: 1, s: { fmt: 'custom', code: LONG } })).toEqual({ v: 1, f: null });
    expect(cloneCell({ v: 1, s: { fmt: 'custom', code: LONGEST } })).toEqual({ v: 1, f: null, s: { fmt: 'custom', code: LONGEST } });
    // A code that is no string is dropped as before, the format name staying.
    expect(cloneCell({ v: 1, s: { fmt: 'custom', code: 42 } })).toEqual({ v: 1, f: null, s: { fmt: 'custom' } });
  });
});
