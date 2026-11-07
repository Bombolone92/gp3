import { describe, expect, it, vi } from 'vitest';

// The tokenizer is wrapped, not replaced, so every call still parses for real; the counter is how the
// cost of a structural edit is measured without a wall clock on a shared machine.
const calls = vi.hoisted(() => ({ n: 0 }));
vi.mock('../src/core/formula/tokenizer.js', async (original) => {
  const real = await original();
  return { ...real, tokenize: (src) => { calls.n++; return real.tokenize(src); } };
});

const { Workbook } = await import('../src/core/workbook.js');
const { adjustFormula, renameSheetInFormula } = await import('../src/core/refs.js');

// An unqualified reference is relative to the sheet its formula lives on, so an insert, a delete, a
// move or a rename on one sheet can only reach a formula on another sheet through a sheet-qualified
// reference — and every one of those spells the sheet before a "!".
describe('a structural edit on one sheet leaves other sheets\' unqualified formulas alone', () => {
  const book = () => {
    const wb = new Workbook();
    const one = wb.activeSheetId;
    wb.renameSheet(one, 'Sheet1');
    const two = wb.addSheet('Sheet2').id;
    const three = wb.addSheet('Sheet3').id;
    for (const id of [one, two, three]) for (let r = 0; r < 8; r++) wb.setInput(id, r, 0, String(r + 1));
    return { wb, one, two, three };
  };

  it('still moves qualified references, 3D spans and same-sheet references when a row is inserted', () => {
    const { wb, one, two } = book();
    wb.setInput(two, 0, 2, '=Sheet1!A5');
    wb.setInput(two, 1, 2, '=SUM(Sheet1:Sheet3!A5)');
    wb.setInput(two, 2, 2, '=A5');
    wb.setInput(one, 10, 2, '=A5');
    wb.insertRows(one, 0, 1);
    expect(wb.getCell(two, 0, 2).f).toBe('Sheet1!A6');
    expect(wb.getCell(two, 1, 2).f).toBe('SUM(Sheet1:Sheet3!A6)');
    expect(wb.getCell(two, 2, 2).f).toBe('A5');
    expect(wb.getCell(one, 11, 2).f).toBe('A6');
  });

  it('still moves them when rows are deleted', () => {
    const { wb, one, two } = book();
    wb.setInput(two, 0, 2, '=Sheet1!A5');
    wb.setInput(two, 1, 2, '=SUM(Sheet1:Sheet3!A5)');
    wb.setInput(two, 2, 2, '=A5');
    wb.setInput(one, 10, 2, '=A5');
    wb.deleteRows(one, 0, 1);
    expect(wb.getCell(two, 0, 2).f).toBe('Sheet1!A4');
    expect(wb.getCell(two, 1, 2).f).toBe('SUM(Sheet1:Sheet3!A4)');
    expect(wb.getCell(two, 2, 2).f).toBe('A5');
    expect(wb.getCell(one, 9, 2).f).toBe('A4');
  });

  it('still moves them when a column is inserted and when lines are moved', () => {
    const { wb, one, two } = book();
    wb.setInput(two, 0, 2, '=Sheet1!C1');
    wb.setInput(two, 1, 2, '=C1');
    wb.insertCols(one, 0, 1);
    expect(wb.getCell(two, 0, 2).f).toBe('Sheet1!D1');
    expect(wb.getCell(two, 1, 2).f).toBe('C1');
  });

  it('still renames qualified references and sheet-qualified names on other sheets', () => {
    const { wb, one, two } = book();
    expect(wb.defineName('Total', 'Sheet1!$A$1', 'Sheet1')).toBe(null);
    wb.setInput(two, 0, 2, '=Sheet1!A1');
    wb.setInput(two, 1, 2, '=Sheet1!Total');
    wb.setInput(two, 2, 2, '=A1');
    wb.renameSheet(one, 'Budget');
    expect(wb.getCell(two, 0, 2).f).toBe('Budget!A1');
    expect(wb.getCell(two, 1, 2).f).toBe('Budget!Total');
    expect(wb.getCell(two, 2, 2).f).toBe('A1');
    expect(wb.names.find((n) => n.name === 'Total').ref).toBe('Budget!$A$1');
  });

  it('moves a scoped name\'s own reference when its sheet is edited', () => {
    const { wb, one } = book();
    expect(wb.defineName('Anchor', 'Sheet1!$A$5', 'Sheet1')).toBe(null);
    wb.insertRows(one, 0, 1);
    expect(wb.names.find((n) => n.name === 'Anchor').ref).toBe('Sheet1!$A$6');
  });

  // The skipped formula is now returned as it was written, where re-rendering every reference used to
  // upper-case and reorder it in passing. That tidying was never the point of a structural edit, and
  // an edit on another sheet is no reason to rewrite a formula the user typed.
  it('leaves an untouched formula spelled exactly as it was written', () => {
    const o = { ownerSheet: 'Other', sheetName: 'Sheet1', axis: 'row', at: 0, count: 1, remove: false };
    expect(adjustFormula('sum(b2:a1)*c3', o)).toBe('sum(b2:a1)*c3');
    expect(renameSheetInFormula('sum(b2:a1)*c3', 'Sheet1', 'New')).toBe('sum(b2:a1)*c3');
    // On the edited sheet, and for anything naming a sheet, the rewrite runs exactly as before.
    expect(adjustFormula('a1*2', { ...o, sheetName: 'Other' })).toBe('A2*2');
    expect(adjustFormula("'Other'!a1", o)).toBe('Other!A1');
  });

  it('does not tokenize the formulas of sheets the edit cannot reach', { timeout: 60000 }, () => {
    const wb = new Workbook();
    const one = wb.activeSheetId;
    wb.renameSheet(one, 'Sheet1');
    const OTHER_SHEETS = 4, PER_SHEET = 1500, ON_EDITED = 20;
    for (let r = 0; r < ON_EDITED; r++) wb.setInput(one, r, 3, `=SUM(A${r + 1}:C${r + 1})`);
    for (let k = 1; k <= OTHER_SHEETS; k++) {
      const id = wb.addSheet(`S${k}`).id;
      for (let r = 0; r < PER_SHEET; r++) wb.setInput(id, r, 3, `=SUM(A${r + 1}:C${r + 1})`);
    }
    const measure = (run) => { calls.n = 0; run(); return calls.n; };
    measure(() => wb.insertRows(one, 0, 1)); // warm: fill the caches an edit shares with the one measured
    const inserting = measure(() => wb.insertRows(one, 0, 1));
    const renaming = measure(() => wb.renameSheet(one, 'Budget'));
    // 6,000 formulas sit on sheets no reference reaches, and the edit used to tokenize every one of
    // them: 6,020 calls for the insert. It now costs the edited sheet's own 20, and the rename none;
    // the cap is several times that quiet count, and far below one unreachable sheet's worth.
    expect(inserting).toBeLessThan(ON_EDITED * 5);
    expect(renaming).toBeLessThan(ON_EDITED * 5);
    expect(inserting + renaming).toBeLessThan(PER_SHEET);
  });
});
