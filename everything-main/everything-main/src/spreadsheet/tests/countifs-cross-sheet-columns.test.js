import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// A whole column (or row) is read only as far as its own sheet's used area, so the criteria
// ranges of one COUNTIFS can arrive read to different lengths when they sit on different
// sheets. Every cell any of them was read to must be visited: a shorter range is blank there.

/** Sheet1: A1:A5 = "x", the formula in F1 (so A:A is read as five rows). S2: B1:B100 = 1…100. */
function columns() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (let r = 0; r < 5; r++) wb.setInput(id, r, 0, 'x');
  const s2 = wb.addSheet('S2');
  for (let r = 0; r < 100; r++) wb.setInput(s2.id, r, 1, String(r + 1));
  return (f) => { wb.setInput(id, 0, 5, f); return wb.getValue(id, 0, 5); };
}

/** Sheet1: A1:E1 = "x", the formula in A3 (so 1:1 is read as five columns). S2: A1:J1 = 1…10. */
function rows() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (let c = 0; c < 5; c++) wb.setInput(id, 0, c, 'x');
  const s2 = wb.addSheet('S2');
  for (let c = 0; c < 10; c++) wb.setInput(s2.id, 0, c, String(c + 1));
  return (f) => { wb.setInput(id, 2, 0, f); return wb.getValue(id, 2, 0); };
}

describe('COUNTIFS over whole columns read to different lengths on different sheets', () => {
  it('counts the rows the longer range holds when the shorter range comes first', () => {
    const calc = columns();
    // A is blank from row 6 on; B holds 1…100: rows 6…100 are blank in A and positive in B.
    expect(calc('=COUNTIFS(A:A,"",S2!B:B,">0")')).toBe(95);
    // Blank cells differ from "x"; B > 50 in rows 51…100.
    expect(calc('=COUNTIFS(A:A,"<>x",S2!B:B,">50")')).toBe(50);
    // Rows 6…49 have 0 < B < 50 and a blank A.
    expect(calc('=COUNTIFS(A:A,"",S2!B:B,">0",S2!B:B,"<50")')).toBe(44);
  });

  it('counts the same rows when the longer range comes first', () => {
    const calc = columns();
    expect(calc('=COUNTIFS(S2!B:B,">0",A:A,"")')).toBe(95);
    expect(calc('=COUNTIFS(S2!B:B,">50",A:A,"<>x")')).toBe(50);
    expect(calc('=COUNTIFS(S2!B:B,"<50",S2!B:B,">0",A:A,"")')).toBe(44);
  });

  it('counts the blank rows past every range once, whichever range comes first', () => {
    const calc = columns();
    // Both columns are blank from row 101 to the last row: 1048576 − 100.
    expect(calc('=COUNTIFS(A:A,"",S2!B:B,"")')).toBe(1048476);
    expect(calc('=COUNTIFS(S2!B:B,"",A:A,"")')).toBe(1048476);
    // Rows 1…5 hold "x" in A and 1…5 in B: a text criterion, answered from an index of its
    // column, still meets the other range's values, and never a blank past its own five rows.
    expect(calc('=COUNTIFS(A:A,"x",S2!B:B,"<=5")')).toBe(5);
    expect(calc('=COUNTIFS(S2!B:B,"<=5",A:A,"x")')).toBe(5);
    expect(calc('=COUNTIFS(A:A,"x",S2!B:B,"")')).toBe(0);
  });

  it('treats whole rows read to different widths the same way', () => {
    const calc = rows();
    // Row 1 of Sheet1 holds "x" in A…E; S2 row 1 holds 1…10 in A…J: F…J are blank above and positive below.
    expect(calc('=COUNTIFS(1:1,"",S2!1:1,">0")')).toBe(5);
    expect(calc('=COUNTIFS(S2!1:1,">0",1:1,"")')).toBe(5);
    // Both rows are blank from column K to the last column: 16384 − 10.
    expect(calc('=COUNTIFS(1:1,"",S2!1:1,"")')).toBe(16374);
  });

  it('keeps the sum, average, maximum and minimum functions, whose base range decides the cells, unchanged', () => {
    const calc = columns();
    // Rows 6…100 of B, where A is blank: 6 + … + 100 = 5050 − 15 = 5035, over 95 cells.
    expect(calc('=SUMIFS(S2!B:B,A:A,"")')).toBe(5035);
    expect(calc('=SUMIFS(S2!B:B,A:A,"",S2!B:B,">0")')).toBe(5035);
    expect(calc('=AVERAGEIFS(S2!B:B,A:A,"")')).toBe(53);
    expect(calc('=MAXIFS(S2!B:B,A:A,"")')).toBe(100);
    expect(calc('=MINIFS(S2!B:B,A:A,"")')).toBe(6);
    // Column A holds only text, so the sum over it is 0 whatever the criteria select.
    expect(calc('=SUMIFS(A:A,S2!B:B,">0")')).toBe(0);
    expect(calc('=COUNTUNIQUEIFS(S2!B:B,A:A,"")')).toBe(95);
  });
});
