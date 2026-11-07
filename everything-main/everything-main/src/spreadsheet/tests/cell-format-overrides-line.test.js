import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds, workbookToXlsx } from '../src/core/io.js';

const one = (r, c = 1) => ({ r1: r, c1: c, r2: r, c2: c });
function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.applyStyle(id, { r1: 0, c1: 1, r2: 99, c2: 1 }, { bold: true, bg: '#ffff00', wrap: true });
  wb.ensureSize(id, 400, 26);
  return { wb, id };
}

describe('removing an individual format inherited from a column or row', () => {
  it.each([4, 250])('turns off bold on row %i without changing neighboring cells', (r) => {
    const { wb, id } = book();
    wb.toggleStyle(id, one(r), 'bold', { r, c: 1 });
    expect(wb.styleAt(id, r, 1)?.bold).toBeFalsy();
    expect(wb.styleAt(id, r + 1, 1)?.bold).toBe(true);
    wb.undo();
    expect(wb.styleAt(id, r, 1)?.bold).toBe(true);
    wb.redo();
    expect(wb.styleAt(id, r, 1)?.bold).toBeFalsy();
    wb.toggleStyle(id, one(r), 'bold', { r, c: 1 });
    expect(wb.styleAt(id, r, 1)?.bold).toBe(true);
  });

  it('resets only the requested properties and keeps the reset when text is entered', () => {
    const { wb, id } = book();
    wb.applyStyle(id, one(250), { bg: null, wrap: false });
    wb.setInput(id, 250, 1, 'Text');
    expect(wb.styleAt(id, 250, 1)?.bg).toBeFalsy();
    expect(wb.styleAt(id, 250, 1)?.wrap).toBeFalsy();
    expect(wb.styleAt(id, 250, 1)?.bold).toBe(true);
    expect(wb.styleAt(id, 251, 1)?.bg).toBe('#ffff00');
  });

  it('overrides a row format as well as a column format', () => {
    const { wb, id } = book();
    wb.applyStyle(id, { r1: 250, c1: 0, r2: 250, c2: 25 }, { italic: true, bg: '#00ff00' });
    wb.applyStyle(id, one(250), { italic: null, bg: null });
    expect(wb.styleAt(id, 250, 1)?.italic).toBeFalsy();
    expect(wb.styleAt(id, 250, 1)?.bg).toBeFalsy();
    expect(wb.styleAt(id, 250, 2)).toMatchObject({ italic: true, bg: '#00ff00' });
  });

  it('copies and pastes the reset into another formatted column', () => {
    const { wb, id } = book();
    wb.applyStyle(id, one(250), { bold: null, bg: null });
    wb.pasteCells(id, wb.copyRange(id, one(250)), 251, 1);
    expect(wb.styleAt(id, 251, 1)?.bold).toBeFalsy();
    expect(wb.styleAt(id, 251, 1)?.bg).toBeFalsy();
    expect(wb.styleAt(id, 251, 1)?.wrap).toBe(true);
  });

  it('offers a reset fill as No fill in the color filter', () => {
    const { wb, id } = book();
    wb.setInput(id, 0, 1, 'Item');
    wb.setInput(id, 1, 1, 'A');
    wb.setInput(id, 2, 1, 'B');
    wb.applyStyle(id, one(1), { bg: null });
    wb.setFilterRange(id, { r1: 0, c1: 1, r2: 2, c2: 1 });
    expect(wb.filterColors(id, 1)).toContainEqual({ color: '', count: 1 });
    wb.setFilterCriteria(id, 1, { color: '' });
    expect(wb.isRowHidden(id, 1)).toBe(false);
    expect(wb.isRowHidden(id, 2)).toBe(true);
  });

  it.each(['xlsx', 'ods'])('keeps reset appearance and number-format details through %s save and reopen', async (kind) => {
    const { wb, id } = book();
    wb.applyStyle(id, { r1: 0, c1: 1, r2: 399, c2: 1 }, { fmt: 'number', dec: 4, align: 'right', indent: 2 });
    wb.setInput(id, 250, 1, '12.5');
    wb.applyStyle(id, one(250), { bold: null, bg: null, wrap: null, fmt: null, dec: null, align: null, indent: null });
    expect(wb.getDisplay(id, 250, 1)).toBe('12.5');
    const blob = await (kind === 'xlsx' ? workbookToXlsx(wb) : workbookToOds(wb));
    const back = await workbookFromFile(await blob.arrayBuffer(), `Reset.${kind}`);
    const bid = back.activeSheetId;
    expect(back.getDisplay(bid, 250, 1)).toBe('12.5');
    for (const key of ['bold', 'bg', 'wrap', 'fmt', 'dec', 'align', 'indent']) expect(back.styleAt(bid, 250, 1)?.[key], key).toBeFalsy();
    expect(back.styleAt(bid, 251, 1)).toMatchObject({ bold: true, bg: '#ffff00', fmt: 'number', dec: 4 });
  });

  it('still removes unused style keys when there is no inherited format', () => {
    const wb = new Workbook(); const id = wb.activeSheetId;
    wb.applyStyle(id, one(1), { bold: true, bg: '#ffff00' });
    wb.applyStyle(id, one(1), { bold: null, bg: null });
    expect(wb.getCell(id, 1, 1)).toBeUndefined();
  });
});
