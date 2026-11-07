import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

// setInput looks the table up before it writes, so a formula typed straight into the empty column beside a
// table found none: the table then grew over the column but the formula filled its own row alone, the
// table's calc stayed empty, and rows added later got nothing. Typing the header first and the formula
// afterwards worked. A column a table grows over now becomes a calculated column the same way.
function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  [['Item', 'Qty', 'Price'], ['a', 1, 10], ['b', 2, 20], ['c', 3, 30]].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, String(v))));
  const tid = wb.addTable(id, parseRange('A1:C4'), { name: 'T' });
  const col = (c, n = 5) => Array.from({ length: n }, (_, r) => wb.getCell(id, r, c)?.f ?? wb.getValue(id, r, c) ?? null);
  return { wb, id, tid, col, table: () => wb.tableById(id, tid) };
}

const FILLED = ['[@Qty]*[@Price]', '[@Qty]*[@Price]', '[@Qty]*[@Price]'];

describe('a column a table grows over', () => {
  it('takes a formula typed straight into it as its calculated column', () => {
    const { wb, id, col, table } = book();
    wb.setInput(id, 1, 3, '=[@Qty]*[@Price]');
    expect(table().range).toEqual(parseRange('A1:D4'));
    expect(col(3)).toEqual(['Column4', ...FILLED, null]);
    expect(table().calc).toEqual({ 3: '[@Qty]*[@Price]' });
    expect([1, 2, 3].map((r) => wb.getValue(id, r, 3))).toEqual([10, 40, 90]);
  });

  it('reaches the same place when the header is typed first', () => {
    const { wb, id, col, table } = book();
    wb.setInput(id, 0, 3, 'Total');
    wb.setInput(id, 1, 3, '=[@Qty]*[@Price]');
    expect(table().range).toEqual(parseRange('A1:D4'));
    expect(col(3)).toEqual(['Total', ...FILLED, null]);
    expect(table().calc).toEqual({ 3: '[@Qty]*[@Price]' });
  });

  it('takes one up when the table is resized over it, as dragging the corner handle does', () => {
    const { wb, id, col, table } = book();
    wb.setInput(id, 1, 3, '=B2*C2');
    expect(wb.resizeTable(id, table().id, parseRange('A1:D4'))).toBe(true);
    expect(col(3)).toEqual(['Column4', 'B2*C2', 'B3*C3', 'B4*C4', null]);
    expect(table().calc).toEqual({ 3: 'B2*C2' });
  });

  it('gives the column to rows added later', () => {
    const { wb, id, tid, col } = book();
    wb.setInput(id, 1, 3, '=[@Qty]*[@Price]');
    expect(wb.addTableRow(id, tid)).toBe(4);
    wb.setInput(id, 4, 1, '4');
    wb.setInput(id, 4, 2, '40');
    expect(col(3, 6)).toEqual(['Column4', ...FILLED, '[@Qty]*[@Price]', null]);
    expect(wb.getValue(id, 4, 3)).toBe(160);
  });

  it('undoes the growth and the fill together, and redoes them together', () => {
    const { wb, id, col, table } = book();
    wb.setInput(id, 1, 3, '=[@Qty]*[@Price]');
    wb.undo();
    expect(table().range).toEqual(parseRange('A1:C4'));
    expect(table().calc).toEqual({});
    expect(col(3)).toEqual([null, null, null, null, null]);
    wb.redo();
    expect(table().range).toEqual(parseRange('A1:D4'));
    expect(table().calc).toEqual({ 3: '[@Qty]*[@Price]' });
    expect(col(3)).toEqual(['Column4', ...FILLED, null]);
  });

  it('leaves a column holding data of its own, or no formula, as it is', () => {
    const { wb, id, tid, col, table } = book();
    [7, 8, 9].forEach((v, i) => wb.setInput(id, i + 1, 3, String(v)));
    expect(wb.resizeTable(id, tid, parseRange('A1:D4'))).toBe(true);
    expect(table().calc).toEqual({});
    expect(col(3)).toEqual(['Column4', 7, 8, 9, null]);

    const plain = book();
    plain.wb.setInput(plain.id, 1, 3, '5');
    expect(plain.table().range).toEqual(parseRange('A1:D4'));
    expect(plain.table().calc).toEqual({});
    expect(plain.col(3)).toEqual(['Column4', 5, null, null, null]);
  });

  it('refuses the fill and says so when a protected cell is in the way', () => {
    const { wb, id, col, table } = book();
    const refused = [];
    wb.addEventListener('change', (e) => { if (e.detail.type === 'protected') refused.push(e.detail); });
    wb.protectRange(id, parseRange('D3:D3'), 'keep');
    wb.setInput(id, 1, 3, '=[@Qty]*[@Price]');
    expect(table().range).toEqual(parseRange('A1:D4'));
    expect(table().calc).toEqual({});
    expect(col(3)).toEqual(['Column4', '[@Qty]*[@Price]', null, null, null]);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ range: parseRange('D3:D3'), description: 'keep' });
  });
});
