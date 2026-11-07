import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const REACHES_OUT = 'IMPORTDATA("https://e.test"'; // one parenthesis short: only completing it shows what it does

/**
 * Completing an unclosed formula that reaches outside the file withdraws the document's trust in
 * external content (98a8372). That must follow the write, not precede the checks that may refuse it:
 * a paste onto a protected sheet, or one whose block fell off the grid, wrote nothing.
 */
describe('external-content trust and a write that never lands', () => {
  it('keeps external content on when a protected sheet refuses the batch', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setSheetProtected(id, true);
    expect(wb.setCells(id, [{ r: 0, c: 0, cell: { v: null, f: REACHES_OUT } }])).toBe(0);
    expect(wb.externalAllowed).toBe(true);
  });

  it('keeps external content on when a protected range refuses the batch', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.protectRange(id, { r1: 0, c1: 0, r2: 4, c2: 4 });
    expect(wb.setCells(id, [{ r: 0, c: 0, cell: { v: null, f: REACHES_OUT } }])).toBe(0);
    expect(wb.externalAllowed).toBe(true);
  });

  it('keeps external content on when every entry falls off the grid', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    expect(wb.setCells(id, [{ r: 1048576, c: 0, cell: { v: null, f: REACHES_OUT } }])).toBe(0);
    expect(wb.externalAllowed).toBe(true);
  });

  it('still withdraws trust for a completed formula that is written', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    expect(wb.setCells(id, [{ r: 0, c: 0, cell: { v: null, f: REACHES_OUT } }])).toBe(1);
    expect(wb.getCell(id, 0, 0).f).toBe('IMPORTDATA("https://e.test")');
    expect(wb.externalAllowed).toBe(false);
    expect(wb.getValue(id, 0, 0)).toEqual({ error: '#BLOCKED!' });
  });

  it('withdraws trust for the entries that land when others fall off the grid', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    expect(wb.setCells(id, [{ r: 1048576, c: 0, cell: { v: 1, f: null } }, { r: 2, c: 0, cell: { v: null, f: REACHES_OUT } }])).toBe(1);
    expect(wb.externalAllowed).toBe(false);
  });

  it('announces the withdrawal with the transaction, after the cells it is about', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const seen = [];
    let inBody = true;
    wb.addEventListener('change', (e) => { if (e.detail.type === 'cells') seen.push({ body: inBody, f: wb.getCell(id, 0, 0)?.f ?? null }); });
    wb.transaction('Paste', () => {
      wb.setCells(id, [{ r: 0, c: 0, cell: { v: null, f: REACHES_OUT } }]);
      inBody = false;
    });
    expect(wb.externalAllowed).toBe(false);
    // Nothing is announced while the transaction is open, and the cell is there by the time it is.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => !s.body && s.f === 'IMPORTDATA("https://e.test")')).toBe(true);
  });
});
