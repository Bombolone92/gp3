import { describe, it, expect } from 'vitest';
import {
  parseRefText, refToText, shiftFormula, adjustFormula, renameSheetInFormula, extractRefs, MAX_ROW,
} from '../src/core/refs.js';

describe('parseRefText / refToText', () => {
  it('round-trips cells, ranges, and anchors', () => {
    for (const t of ['A1', '$A$1', 'A$1', '$A1', 'A1:B2', '$A$1:$B$2', 'A:A', '1:3', '$B:$C']) {
      expect(refToText(parseRefText(t))).toBe(t);
    }
  });

  it('normalizes reversed ranges', () => {
    expect(refToText(parseRefText('B2:A1'))).toBe('A1:B2');
  });

  it('keeps sheet names, quoting when needed', () => {
    expect(refToText(parseRefText('A1', 'Data'))).toBe('Data!A1');
    expect(refToText(parseRefText('A1', 'My Sheet'))).toBe("'My Sheet'!A1");
    expect(refToText(parseRefText('A1', "Bob's"))).toBe("'Bob''s'!A1");
  });

  it('marks whole columns as spanning every row', () => {
    const ref = parseRefText('A:C');
    expect(ref.kind).toBe('cols');
    expect(ref.r2).toBe(MAX_ROW);
  });
});

describe('shiftFormula', () => {
  it('moves relative refs and leaves absolute ones', () => {
    expect(shiftFormula('A1+$B$2+C$3+$D4', 2, 1)).toBe('B3+$B$2+D$3+$D6');
  });

  it('shifts both ends of a range', () => {
    expect(shiftFormula('SUM(A1:A3)', 0, 2)).toBe('SUM(C1:C3)');
  });

  it('turns out-of-sheet refs into #REF!', () => {
    expect(shiftFormula('A1+1', -1, 0)).toBe('#REF!+1');
  });

  it('does not touch strings or function names that look like refs', () => {
    expect(shiftFormula('IF(A1="B2","AB12",LOG10(A1))', 1, 0)).toBe('IF(A2="B2","AB12",LOG10(A2))');
  });

  it('leaves whole-column refs alone on the anchored axis', () => {
    expect(shiftFormula('SUM(A:A)', 5, 1)).toBe('SUM(B:B)');
  });

  it('shifts refs to other sheets too', () => {
    expect(shiftFormula('Data!A1*2', 1, 1)).toBe('Data!B2*2');
  });
});

describe('adjustFormula (insert / delete)', () => {
  const on = (sheetName = 'Sheet1', ownerSheet = 'Sheet1') => ({ sheetName, ownerSheet });

  it('shifts refs at or below an inserted row', () => {
    expect(adjustFormula('A1+A5+A10', { ...on(), axis: 'row', at: 4, count: 2 })).toBe('A1+A7+A12');
  });

  it('grows a range that spans the insertion point', () => {
    expect(adjustFormula('SUM(A1:A10)', { ...on(), axis: 'row', at: 4, count: 3 })).toBe('SUM(A1:A13)');
    expect(adjustFormula('SUM(A1:C1)', { ...on(), axis: 'col', at: 1, count: 1 })).toBe('SUM(A1:D1)');
  });

  it('does not grow a range when inserting right after it', () => {
    expect(adjustFormula('SUM(A1:A3)', { ...on(), axis: 'row', at: 3, count: 1 })).toBe('SUM(A1:A3)');
  });

  it('shrinks ranges and #REF!s cells inside a deleted band', () => {
    expect(adjustFormula('SUM(A1:A10)', { ...on(), axis: 'row', at: 2, count: 3, remove: true })).toBe('SUM(A1:A7)');
    expect(adjustFormula('A3*2', { ...on(), axis: 'row', at: 2, count: 1, remove: true })).toBe('#REF!*2');
    expect(adjustFormula('A9', { ...on(), axis: 'row', at: 2, count: 3, remove: true })).toBe('A6');
    expect(adjustFormula('SUM(B1:B2)', { ...on(), axis: 'col', at: 1, count: 1, remove: true })).toBe('SUM(#REF!)');
  });

  it('only touches refs that point at the edited sheet', () => {
    expect(adjustFormula('A5+Other!A5', { ...on('Other'), axis: 'row', at: 0, count: 1 })).toBe('A5+Other!A6');
    expect(adjustFormula('A5+Other!A5', { ...on('Sheet1'), axis: 'row', at: 0, count: 1 })).toBe('A6+Other!A5');
  });
});

describe('sheet renames and extraction', () => {
  it('renames qualified refs, quoting as needed', () => {
    expect(renameSheetInFormula('Data!A1+SUM(data!B1:B2)', 'Data', 'Q3 Data')).toBe("'Q3 Data'!A1+SUM('Q3 Data'!B1:B2)");
    expect(renameSheetInFormula('SUM(Jan:Data!A1)', 'Data', 'Q3 Data')).toBe("SUM('Jan:Q3 Data'!A1)");
    expect(refToText(parseRefText('A1:B2', 'Jan', 'Q3 Data'))).toBe("'Jan:Q3 Data'!A1:B2");
    expect(parseRefText('A1', 'Jan', 'Mar')).toMatchObject({ sheet: 'Jan', sheetEnd: 'Mar', kind: 'cell' });
    expect(parseRefText('A1', 'Jan')).not.toHaveProperty('sheetEnd');
  });

  it('extracts refs with their positions', () => {
    const refs = extractRefs('A1+SUM(B2:C3)');
    expect(refs.map((r) => r.ref.kind)).toEqual(['cell', 'range']);
    expect(refs[1].start).toBe(7);
    expect(refs[1].end).toBe(12);
  });
});
