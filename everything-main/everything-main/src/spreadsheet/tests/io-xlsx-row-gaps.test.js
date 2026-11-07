import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';

const scenarios = [
  { name: 'leading gaps', addresses: ['C5'], range: 'A1:C5' },
  { name: 'middle gaps', addresses: ['A1', 'C5'], range: 'A1:C5' },
  { name: 'trailing gaps', addresses: ['A1'], range: 'A1:C5' },
  { name: 'all empty rows', addresses: [], range: 'A1:C5' },
  { name: 'nonzero range start', addresses: ['C3', 'E7'], range: 'C3:E7' },
];

it.each(scenarios.flatMap((scenario) => [false, true].map((dense) => ({ ...scenario, dense }))))(
  'saves $name without losing cells or empty-row formatting, dense=$dense', ({ addresses, range, dense }) => {
    let book = XLSX.utils.book_new();
    const sheet = { '!ref': range, '!rows': [] };
    sheet['!rows'][3] = { hidden: true, hpt: 27, level: 2 };
    sheet['!rows'][8] = { hpt: 31 };
    if (dense) sheet['!data'] = [];
    addresses.forEach((address, index) => {
      const cell = index ? { t: 'n', v: 2, f: '1+1', z: '0.00' } : { t: 's', v: 'Keep' };
      if (dense) {
        const { r, c } = XLSX.utils.decode_cell(address);
        (sheet['!data'][r] ||= [])[c] = cell;
      } else sheet[address] = cell;
    });
    XLSX.utils.book_append_sheet(book, sheet, 'Data');
    for (let round = 0; round < 3; ++round) {
      const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' });
      book = XLSX.read(bytes, { type: 'array', dense, cellStyles: true, cellNF: true });
      const back = book.Sheets.Data;
      expect(back['!ref']).toBe(range);
      expect(back['!rows'][3]).toMatchObject({ hidden: true, hpt: 27, level: 2 });
      expect(back['!rows'][8]).toMatchObject({ hpt: 31 });
      addresses.forEach((address, index) => {
        const { r, c } = XLSX.utils.decode_cell(address);
        const cell = dense ? back['!data'][r][c] : back[address];
        expect(cell.v).toBe(index ? 2 : 'Keep');
        if (index) expect(cell).toMatchObject({ f: '1+1', z: '0.00' });
      });
      if (dense) expect(back['!data'][3]?.filter(Boolean) ?? []).toHaveLength(0);
      else expect(back.A4).toBeUndefined();
    }
  },
);

it.each([false, true])('resaves imported row gaps before a hyperlink-only cell, dense=%s', (dense) => {
  let book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, { '!ref': 'A1', A1: { t: 's', v: 'Keep' } }, 'Data');
  const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  const entry = zip.FileIndex.find((e) => e.name === 'sheet1.xml');
  entry.content = new TextEncoder().encode(new TextDecoder().decode(entry.content).replace('</worksheet>',
    '<hyperlinks><hyperlink ref="C5" location="Data!A1"/></hyperlinks></worksheet>'));
  entry.size = entry.content.length;
  book = XLSX.read(XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' }), { type: 'array', dense });
  for (let round = 0; round < 3; ++round) {
    book = XLSX.read(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), { type: 'array', dense });
    const sheet = book.Sheets.Data;
    expect(sheet['!ref']).toBe('A1:C5');
    expect((dense ? sheet['!data'][4][2] : sheet.C5).l.Target).toBe('#Data!A1');
    expect((dense ? sheet['!data'][0][0] : sheet.A1).v).toBe('Keep');
  }
});
