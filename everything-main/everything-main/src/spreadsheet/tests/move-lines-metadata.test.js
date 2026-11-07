import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

/** Rows 1..20 hold 1..20 in column A (and 10x that in column B). */
function numbered() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (let r = 0; r < 20; r++) { wb.setInput(id, r, 0, String(r + 1)); wb.setInput(id, r, 1, String((r + 1) * 10)); }
  return { wb, id };
}

const spans = (list) => list.map((x) => [x.range.r1, x.range.r2]).sort((a, b) => a[0] - b[0]);

describe('moving lines out of the middle of a rule, chart, or filter', () => {
  it('splits a rule into the rows that stayed and the rows that moved, instead of spanning both', () => {
    const { wb, id } = numbered();
    wb.addRule(id, { type: 'formula', range: parseRange('A1:A10'), value: '=A1>4', style: { bold: true } });
    wb.addValidation(id, { type: 'list', range: parseRange('A1:A10'), source: ['x'], strict: false });
    const before = wb.toJSON();
    wb.clearHistory();
    expect(wb.moveRows(id, 4, 2, 19)).toBe(17); // rows 5-6 (values 5, 6) go to the end
    const sheet = wb.sheet(id);
    expect(spans(sheet.rules)).toEqual([[0, 7], [17, 18]]);
    expect(spans(sheet.validations)).toEqual([[0, 7], [17, 18]]);
    expect(new Set(sheet.rules.map((r) => r.id)).size).toBe(2);
    // Each piece still judges its own cells: 4 (row 4) is not bold, 7 (now row 5) and the moved 5 (row 18) are.
    expect(wb.getValue(id, 4, 0)).toBe(7);
    expect(wb.conditionalStyle(id, 3, 0, wb.getValue(id, 3, 0))?.bold).not.toBe(true);
    expect(wb.conditionalStyle(id, 4, 0, wb.getValue(id, 4, 0))?.bold).toBe(true);
    expect(wb.getValue(id, 17, 0)).toBe(5);
    expect(wb.conditionalStyle(id, 17, 0, 5)?.bold).toBe(true);
    // Rows 9-17 were never covered by the rule and still are not.
    expect(wb.conditionalStyle(id, 10, 0, wb.getValue(id, 10, 0))?.bold).not.toBe(true);
    expect(wb.validationAt(id, 10, 0)).toBeNull();
    expect(wb.validationAt(id, 17, 0)).not.toBeNull();
    wb.undo();
    expect(wb.toJSON()).toEqual(before);
  });

  it('keeps a chart and a filter on the rows that stayed, and hides only rows the filter covers', () => {
    const { wb, id } = numbered();
    wb.addChart(id, { type: 'bar', range: parseRange('A1:A10'), anchor: { r: 0, c: 5 } });
    wb.setFilterRange(id, parseRange('A1:B10'));
    wb.setFilterCriteria(id, 0, { op: 'gt', value: 3 });
    expect(wb.moveRows(id, 4, 2, 19)).toBe(17);
    const sheet = wb.sheet(id);
    expect(sheet.charts[0].range).toEqual({ r1: 0, c1: 0, r2: 7, c2: 0 });
    expect(sheet.filter.range).toEqual({ r1: 0, c1: 0, r2: 7, c2: 1 });
    expect([...sheet.filterHidden].sort((a, b) => a - b)).toEqual([1, 2]);
    expect(wb.filterValues(id, 0).map((v) => v.value)).toEqual(['2', '3', '4', '7', '8', '9', '10']);
  });

  it('follows a filter formula along the rows that stayed', () => {
    const { wb, id } = numbered();
    wb.setFilterRange(id, parseRange('A1:B10'));
    wb.setFilterCriteria(id, 0, { formula: '=A2>3' });
    expect([...wb.sheet(id).filterHidden].sort((a, b) => a - b)).toEqual([1, 2]);
    expect(wb.moveRows(id, 4, 2, 19)).toBe(17);
    const sheet = wb.sheet(id);
    expect(sheet.filter.range).toEqual({ r1: 0, c1: 0, r2: 7, c2: 1 });
    expect([...sheet.filterHidden].sort((a, b) => a - b)).toEqual([1, 2]);
    wb.setInput(id, 4, 0, '1'); // the row that took the moved rows' place is judged too
    wb.reapplyFilter(id);
    expect([...wb.sheet(id).filterHidden].sort((a, b) => a - b)).toEqual([1, 2, 4]);
  });

  it('does the same for columns', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    for (let c = 0; c < 20; c++) wb.setInput(id, 0, c, String(c + 1));
    wb.addRule(id, { type: 'gt', range: parseRange('A1:J1'), value: 4, style: { bold: true } });
    wb.addChart(id, { type: 'bar', range: parseRange('A1:J1'), anchor: { r: 3, c: 0 } });
    expect(wb.moveCols(id, 4, 2, 19)).toBe(17);
    const sheet = wb.sheet(id);
    expect(sheet.rules.map((r) => [r.range.c1, r.range.c2]).sort((a, b) => a[0] - b[0])).toEqual([[0, 7], [17, 18]]);
    expect(sheet.charts[0].range).toEqual({ r1: 0, c1: 0, r2: 0, c2: 7 });
    expect(wb.conditionalStyle(id, 0, 10, wb.getValue(id, 0, 10))?.bold).not.toBe(true);
    expect(wb.conditionalStyle(id, 0, 18, wb.getValue(id, 0, 18))?.bold).toBe(true);
  });

  it('keeps a relative rule formula on its own cells when rows land above the rule', () => {
    const { wb, id } = numbered();
    wb.addRule(id, { type: 'formula', range: parseRange('A1:A10'), value: '=A1>5', style: { bold: true } });
    expect(wb.moveRows(id, 15, 2, 0)).toBe(0); // 16 and 17 go to the top
    const sheet = wb.sheet(id);
    expect(spans(sheet.rules)).toEqual([[2, 11]]);
    expect(sheet.rules[0].value).toBe('=A3>5');
    expect(wb.getValue(id, 2, 0)).toBe(1);
    expect(wb.conditionalStyle(id, 2, 0, 1)?.bold).not.toBe(true);
    expect(wb.conditionalStyle(id, 7, 0, wb.getValue(id, 7, 0))?.bold).toBe(true);
    expect(wb.conditionalStyle(id, 0, 0, 16)).toBeNull();
  });

  it('grows a rule, like a reference, when rows from elsewhere land inside it', () => {
    const { wb, id } = numbered();
    wb.addRule(id, { type: 'gt', range: parseRange('A1:A10'), value: 100, style: { bold: true } });
    expect(wb.moveRows(id, 15, 2, 5)).toBe(5);
    expect(spans(wb.sheet(id).rules)).toEqual([[0, 11]]);
  });
});
