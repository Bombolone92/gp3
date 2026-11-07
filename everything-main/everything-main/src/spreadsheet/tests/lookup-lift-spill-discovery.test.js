import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// A lookup lifted over an array of lookup values (or of column indexes) spills one answer per
// value. The workbook settles every formula that can spill before any cell is read, so a
// dependent reading a spilled cell before the anchor was computed sees the value, not a blank:
// that needs the candidate walk to know a lookup's lifted arguments produce an array.
describe('spill discovery for lookups lifted over an array', () => {
  function book(anchor) {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    for (let r = 0; r < 3; r++) {
      wb.setInput(id, r, 0, String(r + 1));
      wb.setInput(id, r, 1, String((r + 1) * 10));
    }
    wb.setInput(id, 8, 0, '=SEQUENCE(2)'); // A9# = {1;2}
    wb.setInput(id, 19, 3, anchor); // D20 spills into D21
    wb.setInput(id, 0, 5, '=D21+0'); // F1 reads the spilled cell before the anchor is computed
    return { wb, id };
  }

  it.each([
    ['=MATCH({1;2},A9#,0)', 2],
    ['=XMATCH({1;2},A9#)', 2],
    ['=VLOOKUP(A1:A2,A1:B3,2,0)', 20],
    ['=LOOKUP({1;2},A9#,A9#*10)', 20],
    ['=HLOOKUP(2,{1,2;10,20;100,200},{2;3},0)', 200],
  ])('%s is settled before a dependent reads its spilled cell', (formula, expected) => {
    const { wb, id } = book(formula);
    expect(wb.getValue(id, 0, 5)).toBe(expected);
    expect(wb.getValue(id, 20, 3)).toBe(expected);
  });

  it('keeps an ordinary scalar lookup lazy', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '=MATCH(2,{1,2,3},0)');
    expect(wb._isArrayCandidate(wb._ast('MATCH(2,{1,2,3},0)'))).toBe(false);
    expect(wb.getValue(id, 0, 0)).toBe(2);
  });
});
