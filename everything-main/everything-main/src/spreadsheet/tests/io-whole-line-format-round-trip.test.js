import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';

/**
 * Whole-line defaults remain on their lines rather than narrowing to stored
 * cells. XLSX has native line XFs; the sidecar also preserves the app's partial
 * inheritance semantics and the ODS writer's missing line defaults.
 */
const wholeCol = (wb, id, c) => ({ r1: 0, c1: c, r2: wb.sheet(id).rows - 1, c2: c });
const wholeRow = (wb, id, r) => ({ r1: r, c1: 0, r2: r, c2: wb.sheet(id).cols - 1 });

function book() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, 'Item');
  wb.setInput(id, 0, 1, 'Price');
  wb.applyStyle(id, wholeCol(wb, id, 1), { fmt: 'currency', cur: 'USD', dec: 2, bg: '#ffeeee' });
  wb.applyStyle(id, wholeRow(wb, id, 7), { bold: true });
  wb.ensureSize(id, 400, 26);
  wb.setInput(id, 200, 1, '7');
  return { wb, id };
}

async function reopen(wb, kind) {
  const blob = kind === 'xlsx' ? await workbookToXlsx(wb) : await workbookToOds(wb);
  const back = await workbookFromFile(await blob.arrayBuffer(), `Prices.${kind}`);
  return { wb: back, id: back.sheets[0].id };
}

describe.each(['xlsx', 'ods'])('a whole-line format through a .%s round trip', (kind) => {
  it('comes back on the line, so a value typed below the stored cells still takes it', async () => {
    const { wb } = book();
    const again = await reopen(wb, kind);
    expect(again.wb.sheet(again.id).colStyles.get(1)).toMatchObject({ fmt: 'currency', cur: 'USD', dec: 2, bg: '#ffeeee' });
    expect(again.wb.sheet(again.id).rowStyles.get(7)).toEqual({ bold: true });
    expect(again.wb.getDisplay(again.id, 200, 1)).toBe('$7.00');
    again.wb.ensureSize(again.id, 400, 26);
    again.wb.setInput(again.id, 250, 1, '3');
    expect(again.wb.getDisplay(again.id, 250, 1)).toBe('$3.00');
    expect(again.wb.styleAt(again.id, 7, 20)).toEqual({ bold: true });
    // And the cell's own format still stands over the column's.
    again.wb.setCells(again.id, [{ r: 251, c: 1, cell: { v: 0.25, f: null, s: { fmt: 'percent', dec: 0 } } }], 'Import');
    expect(again.wb.getDisplay(again.id, 251, 1)).toBe('25%');
  });

  it('is gone from the file once Clear formats takes it off the line', async () => {
    const { wb, id } = book();
    wb.clearRange(id, wholeCol(wb, id, 1), { contents: false, styles: true });
    const again = await reopen(wb, kind);
    expect(again.wb.sheet(again.id).colStyles.size).toBe(0);
  });
});

it('ignores a sidecar whose line formats are malformed, and opens the book all the same', async () => {
  const { wb, id } = book();
  const blob = await workbookToXlsx(wb);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // Reach into the saved sidecar and replace the recorded formats with rubbish of every shape.
  const X = await import('../src/vendor/xlsx.mjs');
  const readBack = X.read(bytes, { type: 'array', cellStyles: true, cellFormula: true, cellNF: true });
  const metaName = readBack.SheetNames.find((n) => /^_puter_meta/i.test(n));
  const meta = JSON.parse(X.utils.sheet_to_json(readBack.Sheets[metaName], { header: 1 }).map((row) => row[0]).join(''));
  const name = wb.sheet(id).name;
  meta.sheets[name].colStyles = { 1: { bold: true }, '-3': { bold: true }, '1e3': { bold: true }, 99999999: { bold: true }, two: { bold: true }, 4: 'bold', 5: null, 6: ['bold'] };
  meta.sheets[name].rowStyles = 'nonsense';
  const rewritten = X.utils.aoa_to_sheet([[JSON.stringify(meta)]]);
  readBack.Sheets[metaName] = rewritten;
  const again = await workbookFromFile(X.write(readBack, { bookType: 'xlsx', type: 'array' }), 'Prices.xlsx');
  const sheet = again.sheet(again.sheets[0].id);
  // The vendor rewrite also removes native line XFs. A stale private font
  // must not revive a whole-column bold default absent from the actual file.
  expect(sheet.colStyles.size).toBe(0);
  expect(sheet.rowStyles.size).toBe(0);
  expect(again.getDisplay(again.sheets[0].id, 0, 0)).toBe('Item');
});
