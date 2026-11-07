import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { MAX_TEXT } from '../src/core/cell.js';

const LONG = 'x'.repeat(MAX_TEXT + 5000);

/**
 * "Text cut to 32,767 characters" is the editor's answer to a `truncated` event. It used to be sent
 * before the write, and whether or not the write happened, so pasting the same long text twice said
 * the text had been shortened again although nothing changed, and a listener reading the cell on the
 * event saw the old value.
 */
describe('the announcement that a cell\'s text was shortened', () => {
  it('is not sent for a write that changes nothing', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const seen = [];
    wb.addEventListener('change', (e) => { if (e.detail.type === 'truncated') seen.push(e.detail); });
    expect(wb.setCells(id, [{ r: 0, c: 0, cell: { v: LONG, f: null } }])).toBe(1);
    expect(seen).toHaveLength(1);
    expect(wb.setCells(id, [{ r: 0, c: 0, cell: { v: LONG, f: null } }])).toBe(0);
    expect(seen).toHaveLength(1);
  });

  it('is sent once the shortened text is in the cell', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const lengths = [];
    wb.addEventListener('change', (e) => { if (e.detail.type === 'truncated') lengths.push(wb.getCell(id, e.detail.r, e.detail.c)?.v?.length ?? 0); });
    wb.setInput(id, 0, 0, LONG);
    expect(lengths).toEqual([MAX_TEXT]);
  });

  it('joins the transaction it belongs to, with its detail', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const seen = [];
    let inBody = true;
    wb.addEventListener('change', (e) => { if (e.detail.type === 'truncated') seen.push({ body: inBody, ...e.detail }); });
    wb.transaction('Paste', () => {
      wb.setCells(id, [{ r: 2, c: 1, cell: { v: LONG, f: null } }]);
      inBody = false;
    });
    expect(seen).toEqual([{ body: false, type: 'truncated', sheetId: id, r: 2, c: 1, max: MAX_TEXT }]);
  });
});
