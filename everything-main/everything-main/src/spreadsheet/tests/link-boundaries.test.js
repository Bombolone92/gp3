import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

it.each(['XFE1', 'A1048577', 'A1:XFE2', 'XFE2:A1', 'A1:B1048577', 'B1048577:A1'])(
  'refuses to create an unresolvable link to %s', (address) => {
    const wb = new Workbook();
    expect(wb.internalLinkFor(wb.activeSheetId, parseRange(address))).toBeNull();
  },
);
it.each(['XFD1048576', 'XFC1048575:XFD1048576', 'XFD1048576:XFC1048575', '$B$2:$C$3'])(
  'creates resolvable links at valid coordinates: %s', (address) => {
    const wb = new Workbook({ sheets: [{ name: 'Sheet1', rows: 1048576, cols: 16384 }] });
    const id = wb.activeSheetId, range = parseRange(address);
    const link = wb.internalLinkFor(id, range);
    expect(link).not.toBeNull();
    expect(wb.resolveLink(link)).toEqual({ sheetId: id, range });
  },
);
it.each([
  { r1: -1, c1: 0, r2: 2, c2: 1 },
  { r1: 0, c1: -1, r2: 2, c2: 1 },
  { r1: 0.5, c1: 0, r2: 2, c2: 1 },
  { r1: 0, c1: 0, r2: Infinity, c2: 1 },
])('rejects invalid numeric coordinates %j', (range) => {
  const wb = new Workbook(); expect(wb.internalLinkFor(wb.activeSheetId, range)).toBeNull();
});
