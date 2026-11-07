import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

function filtered() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Name');
  for (const [r, v] of [[1, 'a'], [2, 'b'], [3, 'a'], [4, 'c']]) wb.setInput(id, r, 0, v);
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: 4, c2: 0 });
  wb.setFilterCriteria(id, 0, { values: ['a'] });
  return { wb, id };
}

describe('a row inserted inside a filtered list', () => {
  it('stays visible until the filter is applied again', () => {
    const { wb, id } = filtered();
    expect([...wb.sheet(id).filterHidden].sort()).toEqual([2, 4]);
    wb.insertRows(id, 2, 1);
    expect(wb.sheet(id).filterHidden.has(2)).toBe(false);
    expect([...wb.sheet(id).filterHidden].sort()).toEqual([3, 5]);
    wb.insertRows(id, 4, 2);
    expect([4, 5].some((r) => wb.sheet(id).filterHidden.has(r))).toBe(false);
    // Reapplying the filter hides the blank rows again, as a user would expect.
    wb.reapplyFilter?.(id);
  });
});

function tableBook() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (const [r, a, b] of [[0, 'Name', 'Qty'], [1, 'b', '2'], [2, 'a', '1'], [3, 'c', '3']]) { wb.setInput(id, r, 0, a); wb.setInput(id, r, 1, b); }
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 3, c2: 1 }, { name: 'T' });
  wb.setTableTotals(id, tid, true);
  return { wb, id, tid };
}

describe('row tools over a table', () => {
  it('sort the data rows only, never the header or totals row', () => {
    const { wb, id } = tableBook();
    expect(wb.getCell(id, 4, 1).f).toMatch(/SUBTOTAL/);
    wb.sortRangeBy(id, { r1: 0, c1: 0, r2: 4, c2: 1 }, [{ col: 1, ascending: false }]);
    expect([0, 1, 2, 3].map((r) => wb.getValue(id, r, 0))).toEqual(['Name', 'c', 'b', 'a']);
    expect(wb.getCell(id, 4, 1).f).toMatch(/SUBTOTAL/);
    expect(wb.getValue(id, 4, 1)).toBe(6);
  });

  it('shuffle and remove duplicates keep the header and totals in place', () => {
    const { wb, id } = tableBook();
    wb.setInput(id, 1, 0, 'a'); wb.setInput(id, 1, 1, '1'); // row 2 now duplicates row 3
    const removed = wb.removeDuplicates(id, { r1: 0, c1: 0, r2: 4, c2: 1 }, { header: true });
    expect(removed).toBe(1);
    expect(wb.getValue(id, 0, 0)).toBe('Name');
    expect(wb.getCell(id, 4, 1)?.f ?? wb.getCell(id, 3, 1)?.f).toMatch(/SUBTOTAL/);
    const { wb: w2, id: i2 } = tableBook();
    for (let i = 0; i < 5; i++) w2.shuffleRows(i2, { r1: 0, c1: 0, r2: 4, c2: 1 }, { random: () => 0.1 * (i + 1) });
    expect(w2.getValue(i2, 0, 0)).toBe('Name');
    expect(w2.getCell(i2, 4, 1).f).toMatch(/SUBTOTAL/);
  });

  it('refuse a range that only partly overlaps a table', () => {
    const { wb, id } = tableBook();
    wb.setInput(id, 6, 0, 'z');
    const before = JSON.stringify(wb.toJSON());
    wb.sortRangeBy(id, { r1: 2, c1: 0, r2: 6, c2: 1 }, [{ col: 0, ascending: true }]);
    expect(wb.shuffleRows(id, { r1: 2, c1: 0, r2: 6, c2: 1 })).toBe(0);
    expect(JSON.stringify(wb.toJSON())).toBe(before);
  });
});

describe('rearranging rows through merges or a spilled array', () => {
  it('is refused when a merge would hide data or an array would scatter', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    for (const [r, a, b] of [[0, 'c', 3], [1, 'a', 1], [2, 'b', 2]]) { wb.setInput(id, r, 0, a); wb.setInput(id, r, 1, String(b)); }
    wb.mergeCells(id, { r1: 1, c1: 0, r2: 1, c2: 1 });
    const before = JSON.stringify(wb.toJSON());
    expect(wb.sortRangeBy(id, { r1: 0, c1: 0, r2: 2, c2: 1 }, [{ col: 0, ascending: true }])).toBe(false);
    expect(JSON.stringify(wb.toJSON())).toBe(before);
    expect(wb.shuffleRows(id, { r1: 0, c1: 0, r2: 2, c2: 1 })).toBe(0);
    // A refusal is told apart from a range with nothing to remove.
    expect(wb.removeDuplicates(id, { r1: 0, c1: 0, r2: 2, c2: 1 })).toBe(false);
    // A tall merge is refused too.
    const w2 = new Workbook();
    const i2 = w2.activeSheetId;
    for (const [r, a] of [[0, 'Zed'], [2, 'Alpha']]) w2.setInput(i2, r, 0, a);
    w2.mergeCells(i2, { r1: 0, c1: 0, r2: 1, c2: 0 });
    w2.sortRangeBy(i2, { r1: 0, c1: 0, r2: 2, c2: 1 }, [{ col: 0, ascending: true }]);
    expect(w2.getValue(i2, 0, 0)).toBe('Zed');
    // So is a range holding a spilled array.
    const w3 = new Workbook();
    const i3 = w3.activeSheetId;
    w3.setInput(i3, 0, 0, '=SEQUENCE(3)');
    for (const [r, v] of [[0, 'a'], [1, 'b'], [2, 'c']]) w3.setInput(i3, r, 1, v);
    w3.sortRangeBy(i3, { r1: 0, c1: 0, r2: 2, c2: 1 }, [{ col: 0, ascending: false }]);
    expect(w3.getCell(i3, 0, 0).f).toBe('SEQUENCE(3)');
    expect([0, 1, 2].map((r) => w3.getValue(i3, r, 1))).toEqual(['a', 'b', 'c']);
  });

  it('still works when every row carries the same one-row merge', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    for (const [r, a, c] of [[0, 'c', 'z'], [1, 'a', 'x'], [2, 'b', 'y']]) { wb.setInput(id, r, 0, a); wb.setInput(id, r, 2, c); }
    for (let r = 0; r < 3; r++) wb.mergeCells(id, { r1: r, c1: 0, r2: r, c2: 1 });
    wb.sortRangeBy(id, { r1: 0, c1: 0, r2: 2, c2: 2 }, [{ col: 0, ascending: true }]);
    expect([0, 1, 2].map((r) => wb.getValue(id, r, 0))).toEqual(['a', 'b', 'c']);
    expect([0, 1, 2].map((r) => wb.getValue(id, r, 2))).toEqual(['x', 'y', 'z']);
    expect(wb.sheets[0].merges).toHaveLength(3);
  });
});

describe('a table header', () => {
  it('keeps structured references working when it is cleared, and cannot be merged away', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    for (const [r, a, b] of [[0, 'Name', 'Amt'], [1, 'x', '5'], [2, 'y', '7']]) { wb.setInput(id, r, 0, a); wb.setInput(id, r, 1, b); }
    wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 1 }, { name: 'T' });
    wb.setInput(id, 5, 5, '=SUM(T[Amt])');
    expect(wb.getValue(id, 5, 5)).toBe(12);
    wb.clearRange(id, { r1: 0, c1: 1, r2: 0, c2: 1 }, { contents: true });
    expect(wb.getValue(id, 5, 5)).toBe(12);
    expect(wb.getCell(id, 5, 5).f).toMatch(/^SUM\(T\[Column\d\]\)$/);
    wb.mergeCells(id, { r1: 0, c1: 0, r2: 0, c2: 1 });
    expect(wb.sheets[0].merges).toEqual([]);
    expect(wb.getValue(id, 5, 5)).toBe(12);
  });
});

describe('shrinking a filtered table', () => {
  it('drops the criteria of columns that leave the table so no row stays hidden by a vanished filter', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    for (const [r, a, b, c] of [[0, 'A', 'B', 'C'], [1, '1', '1', 'x'], [2, '2', '2', 'y'], [3, '3', '3', 'x']]) { wb.setInput(id, r, 0, a); wb.setInput(id, r, 1, b); wb.setInput(id, r, 2, c); }
    const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 3, c2: 2 }, { name: 'T' });
    wb.setFilterCriteria(id, 2, { values: ['x'] });
    expect([...wb.sheet(id).filterHidden]).toEqual([2]);
    expect(wb.resizeTable(id, tid, { r1: 0, c1: 0, r2: 3, c2: 1 })).toBe(true);
    expect(wb.sheet(id).filter.range.c2).toBe(1);
    expect(wb.sheet(id).filter.criteria).toEqual({});
    expect(wb.sheet(id).filterHidden.size).toBe(0);
  });
});

describe('a spill meeting a merged block', () => {
  it('is #SPILL! rather than flowing under the merge', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.mergeCells(id, { r1: 1, c1: 0, r2: 1, c2: 1 });
    wb.setInput(id, 0, 0, '=SEQUENCE(3)');
    expect(wb.getValue(id, 0, 0)).toEqual({ error: '#SPILL!' });
    expect(wb.getValue(id, 1, 0)).toBeNull();
    wb.unmergeCells(id, { r1: 1, c1: 0, r2: 1, c2: 1 });
    expect(wb.getValue(id, 0, 0)).toBe(1);
    expect(wb.getValue(id, 2, 0)).toBe(3);
    // A merged anchor cannot spill either.
    const w2 = new Workbook();
    const i2 = w2.activeSheetId;
    w2.mergeCells(i2, { r1: 0, c1: 0, r2: 0, c2: 1 });
    w2.setInput(i2, 0, 0, '=SEQUENCE(1,3)');
    expect(w2.getValue(i2, 0, 0)).toEqual({ error: '#SPILL!' });
    w2.setInput(i2, 0, 0, '=SEQUENCE(3)');
    expect(w2.getValue(i2, 0, 0)).toEqual({ error: '#SPILL!' });
    // A single-cell result is not a spill and shows in a merged cell as usual.
    w2.setInput(i2, 0, 0, '=SEQUENCE(1)');
    expect(w2.getValue(i2, 0, 0)).toBe(1);
  });
});

describe('layout metadata from a file or draft', () => {
  it('keeps only finite sizes and grid-bound indexes', () => {
    const wb = new Workbook({ sheets: [{ name: 'S', rows: 10, cols: 5,
      colWidths: { 0: 'abc', 1: -50, 2: 1e9, 3: 120, x: 200 }, rowHeights: { 0: 'tall', 1: -1, 2: NaN, 3: 40 },
      hiddenRows: [1, Infinity, 1e9, -2], hiddenCols: [2, 5e6], merges: [{ r1: 0, c1: 0, r2: Infinity, c2: 1 }, { r1: 2, c1: 0, r2: 3, c2: 1 }] }] });
    const s = wb.sheets[0];
    expect([...s.colWidths.entries()]).toEqual([[1, 24], [2, 4096], [3, 120]]);
    expect([...s.rowHeights.entries()]).toEqual([[1, 18], [3, 40]]);
    expect([...s.hiddenRows]).toEqual([1]);
    expect([...s.hiddenCols]).toEqual([2]);
    expect(s.merges).toEqual([{ r1: 2, c1: 0, r2: 3, c2: 1 }]);
  });
});

describe('trimming whitespace', () => {
  it('collapses spaces but keeps the line breaks of wrapped text', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '  line one  \n  line   two ');
    wb.setInput(id, 1, 0, '  a   b  ');
    expect(wb.transformText(id, { r1: 0, c1: 0, r2: 1, c2: 0 }, 'trim')).toBe(2);
    expect(wb.getValue(id, 0, 0)).toBe('line one\nline two');
    expect(wb.getValue(id, 1, 0)).toBe('a b');
  });
});

describe('filling a numeric run', () => {
  it('continues large values without overflowing', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '1e300');
    wb.setInput(id, 1, 0, '2e300');
    wb.fill(id, { r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 0, r2: 3, c2: 0 });
    expect(wb.getValue(id, 2, 0)).toBe(3e300);
    expect(wb.getValue(id, 3, 0)).toBe(4e300);
    wb.setInput(id, 0, 1, '0.1');
    wb.setInput(id, 1, 1, '0.2');
    wb.fill(id, { r1: 0, c1: 1, r2: 1, c2: 1 }, { r1: 0, c1: 1, r2: 3, c2: 1 });
    expect(wb.getValue(id, 2, 1)).toBe(0.3);
    expect(wb.getValue(id, 3, 1)).toBe(0.4);
  });
});

describe('splitting text to columns', () => {
  it('honours quoted fields like a CSV', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '"Smith, John",42');
    wb.setInput(id, 1, 0, 'a,b,c');
    const out = wb.splitTextToColumns(id, { r1: 0, c1: 0, r2: 1, c2: 0 }, ',');
    expect(out.rows).toBe(2);
    expect([wb.getValue(id, 0, 0), wb.getValue(id, 0, 1), wb.getValue(id, 0, 2)]).toEqual(['Smith, John', 42, null]);
    expect([wb.getValue(id, 1, 0), wb.getValue(id, 1, 1), wb.getValue(id, 1, 2)]).toEqual(['a', 'b', 'c']);
  });
});

describe('the fill handle on dates and numbered text', () => {
  const dateCell = (y, m, d, fmt = 'date') => ({ v: Date.UTC(y, m - 1, d) / 86400000 + 25569, s: { fmt } });
  const ymd = (serial) => { const d = new Date(Math.round((serial - 25569) * 86400000)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; };

  it('counts a lone date up by days and a lone time by hours', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setCells(id, [{ r: 0, c: 0, cell: dateCell(2024, 1, 15) }, { r: 0, c: 1, cell: { v: 10 / 24, s: { fmt: 'time' } } }]);
    wb.fill(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { r1: 0, c1: 0, r2: 3, c2: 0 });
    expect([1, 2, 3].map((r) => ymd(wb.getValue(id, r, 0)))).toEqual(['2024-01-16', '2024-01-17', '2024-01-18']);
    wb.fill(id, { r1: 0, c1: 1, r2: 0, c2: 1 }, { r1: 0, c1: 1, r2: 2, c2: 1 });
    expect([1, 2].map((r) => Math.round(wb.getValue(id, r, 1) * 24))).toEqual([11, 12]);
    // A lone plain number still repeats unless Ctrl is held.
    wb.setInput(id, 0, 2, '5');
    wb.fill(id, { r1: 0, c1: 2, r2: 0, c2: 2 }, { r1: 0, c1: 2, r2: 2, c2: 2 });
    expect([1, 2].map((r) => wb.getValue(id, r, 2))).toEqual([5, 5]);
  });

  it('steps by months or years when the dates do, keeping month ends', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setCells(id, [{ r: 0, c: 0, cell: dateCell(2024, 1, 31) }, { r: 1, c: 0, cell: dateCell(2024, 2, 29) }]);
    wb.fill(id, { r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 0, r2: 4, c2: 0 });
    expect([2, 3, 4].map((r) => ymd(wb.getValue(id, r, 0)))).toEqual(['2024-03-31', '2024-04-30', '2024-05-31']);
    wb.setCells(id, [{ r: 0, c: 1, cell: dateCell(2024, 1, 1) }, { r: 1, c: 1, cell: dateCell(2024, 2, 1) }]);
    wb.fill(id, { r1: 0, c1: 1, r2: 1, c2: 1 }, { r1: 0, c1: 1, r2: 3, c2: 1 });
    expect([2, 3].map((r) => ymd(wb.getValue(id, r, 1)))).toEqual(['2024-03-01', '2024-04-01']);
    wb.setCells(id, [{ r: 0, c: 2, cell: dateCell(2020, 1, 1) }, { r: 1, c: 2, cell: dateCell(2021, 1, 1) }]);
    wb.fill(id, { r1: 0, c1: 2, r2: 1, c2: 2 }, { r1: 0, c1: 2, r2: 3, c2: 2 });
    expect([2, 3].map((r) => ymd(wb.getValue(id, r, 2)))).toEqual(['2022-01-01', '2023-01-01']);
    // Consecutive days stay a day series.
    wb.setCells(id, [{ r: 0, c: 3, cell: dateCell(2024, 3, 1) }, { r: 1, c: 3, cell: dateCell(2024, 3, 2) }]);
    wb.fill(id, { r1: 0, c1: 3, r2: 1, c2: 3 }, { r1: 0, c1: 3, r2: 2, c2: 3 });
    expect(ymd(wb.getValue(id, 2, 3))).toBe('2024-03-03');
  });

  it('continues numbered text with the run\'s own step', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'Item 1');
    wb.setInput(id, 1, 0, 'Item 3');
    wb.fill(id, { r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 0, r2: 3, c2: 0 });
    expect([2, 3].map((r) => wb.getValue(id, r, 0))).toEqual(['Item 5', 'Item 7']);
    wb.setInput(id, 0, 1, 'Week 5');
    wb.setInput(id, 1, 1, 'Week 6');
    wb.fill(id, { r1: 0, c1: 1, r2: 1, c2: 1 }, { r1: 0, c1: 1, r2: 3, c2: 1 });
    expect([2, 3].map((r) => wb.getValue(id, r, 1))).toEqual(['Week 7', 'Week 8']);
    wb.setInput(id, 5, 0, 'Q1');
    wb.fill(id, { r1: 5, c1: 0, r2: 5, c2: 0 }, { r1: 5, c1: 0, r2: 7, c2: 0 });
    expect([6, 7].map((r) => wb.getValue(id, r, 0))).toEqual(['Q2', 'Q3']);
  });
});

describe('a table header with surrounding spaces', () => {
  it('still resolves its structured references', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    for (const [r, a, b] of [[0, 'Name', ' Qty '], [1, 'x', '5'], [2, 'y', '7']]) { wb.setInput(id, r, 0, a); wb.setInput(id, r, 1, b); }
    wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 1 }, { name: 'T' });
    wb.setInput(id, 5, 5, '=SUM(T[Qty])');
    expect(wb.getValue(id, 5, 5)).toBe(12);
    wb.setInput(id, 6, 5, '=SUM(T[ Qty ])');
    expect(wb.getValue(id, 6, 5)).toBe(12);
    // Renaming the header to another padded name follows through.
    wb.setInput(id, 0, 1, ' Amount ');
    expect(wb.getCell(id, 5, 5).f).toMatch(/Amount/);
    expect(wb.getValue(id, 5, 5)).toBe(12);
  });
});
describe('moving rows under rules with formulas', () => {
  it('renumbers conditional-format, validation and filter formulas like cell formulas', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    for (let r = 0; r < 10; r++) { wb.setInput(id, r, 0, String(r + 1)); wb.setInput(id, r, 2, String((r + 1) * 10)); }
    wb.addRule(id, { type: 'formula', value: '=$A$5>4', range: { r1: 0, c1: 1, r2: 9, c2: 1 }, style: { bg: '#ffff00' } });
    wb.addValidation(id, { type: 'formula', source: '=C1<$A$5', range: { r1: 0, c1: 2, r2: 9, c2: 2 } });
    wb.setInput(id, 20, 0, '=$A$5');
    wb.moveRows(id, 4, 1, 0); // row 5 goes to the top
    expect(wb.getCell(id, 20, 0).f).toBe('$A$1');
    expect(wb.sheet(id).rules[0].value).toBe('=$A$1>4');
    expect(wb.sheet(id).validations[0].source).toBe('=C1<$A$1'); // C1 is relative to each cell of the rule's range and stays
    expect(wb.undoLabel()).toBe('Move rows');
    wb.undo();
    expect(wb.sheet(id).rules[0].value).toBe('=$A$5>4');
    expect(wb.sheet(id).validations[0].source).toBe('=C1<$A$5');
    expect(wb.getCell(id, 20, 0).f).toBe('$A$5');
  });
});
