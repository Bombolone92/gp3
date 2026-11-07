import { afterEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { META_SHEET, workbookFromFile } from '../src/core/io.js';

afterEach(() => vi.restoreAllMocks());

// Fail quickly on an empty-coordinate scan, rather than hanging the test on a full-size grid.
function sparseSheet(cells) {
  let reads = 0;
  return new Proxy({ '!ref': 'A1:XFD1048576', ...cells }, {
    get(target, key) {
      if (/^[A-Z]+\d+$/.test(String(key)) && ++reads > 100) throw new Error('Scanned empty worksheet coordinates');
      return target[key];
    },
  });
}

describe('sparse workbook import', () => {
  it('reads stored cells without scanning a worksheet-sized declared range', async () => {
    vi.spyOn(XLSX, 'read').mockReturnValue({
      SheetNames: ['Data'],
      Sheets: { Data: sparseSheet({ ZZ20000: { t: 'n', v: 42 }, A1: { t: 's', v: 'First' } }) },
    });
    const wb = await workbookFromFile(new Uint8Array(), 'sparse.xlsx');
    const id = wb.sheets[0].id;
    expect(wb.getValue(id, 0, 0)).toBe('First');
    expect(wb.getValue(id, 19999, 701)).toBe(42);
    expect(wb.sheets[0].cells.size).toBe(2);
    expect([...wb.sheets[0].cells.keys()]).toEqual(['0,0', '19999,701']);
  });

  it('reads sparse metadata chunks in row order', async () => {
    vi.spyOn(XLSX, 'read').mockReturnValue({
      SheetNames: ['Data', META_SHEET],
      Sheets: {
        Data: { '!ref': 'A1', A1: { t: 'n', v: 42 } },
        [META_SHEET]: sparseSheet({
          A1048576: { t: 's', v: '"styles":{"0,0":{"bold":true}}}}}' },
          A1: { t: 's', v: '{"sheets":{"Data":{' },
        }),
      },
    });
    const wb = await workbookFromFile(new Uint8Array(), 'sparse-meta.xlsx');
    expect(wb.sheets).toHaveLength(1);
    expect(wb.getCell(wb.sheets[0].id, 0, 0).s.bold).toBe(true);
  });
});
