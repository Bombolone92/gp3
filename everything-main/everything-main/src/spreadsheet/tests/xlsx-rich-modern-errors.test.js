import fs from 'node:fs';
import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { readXlsxRichValues } from '../src/core/xlsx-rich-values.js';
import { dashboardImage } from './helpers/xlsx-dashboard-fixture.js';

const errors = ['#SPILL!', '#CONNECT!', '#BLOCKED!', '#UNKNOWN!', '#FIELD!', '#CALC!'];
const xml = (z, p) => new TextDecoder().decode(X.CFB.find(z, p)?.content);
const set = (z, p, s) => X.CFB.utils.cfb_add(z, p, new TextEncoder().encode(s));
const bytes = z => X.CFB.write(z, { type: 'array', fileType: 'zip' });
const read = z => readXlsxRichValues(X.read(bytes(z), { type: 'array', bookFiles: true }));
async function native(w) {
  const z = X.CFB.read(new Uint8Array(await (await workbookToXlsx(w)).arrayBuffer()), { type: 'array' });
  set(z, '/xl/workbook.xml', xml(z, '/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  return z;
}

it.each([false, true])('round trips all modern error kinds alongside images and dynamic arrays (pictures=%s)', async pictures => {
  const w = new Workbook(), id = w.activeSheetId;
  errors.forEach((error, r) => {
    w.setCells(id, [{ r, c: 0, cell: { v: { error } } }, { r, c: 2, cell: { v: error } }]);
    w.setInput(id, r, 1, `=A${r + 1}`);
    w.setInput(id, r, 3, `=ERROR.TYPE(A${r + 1})`);
  });
  w.setInput(id, 8, 0, '=SEQUENCE(3,2)'); w.setInput(id, 9, 1, 'blocked');
  w.setInput(id, 8, 3, '=SEQUENCE(2)');
  const picture = { image: `data:image/png;base64,${dashboardImage}`, fit: 'contain' };
  if (pictures) w.setCells(id, [{ r: 12, c: 1, cell: { v: picture } }]);
  let z = await native(w);
  for (let pass = 0; pass < 2; pass++) {
    const sheet = xml(z, '/xl/worksheets/sheet1.xml');
    // String lookalikes keep their string type; error caches use legal legacy values.
    for (const cell of sheet.matchAll(/<c\b[^>]*t="e"[^>]*>[\s\S]*?<\/c>/g)) {
      expect(cell[0]).toMatch(/vm="\d+"/);
      expect(cell[0]).toContain('<v>#VALUE!</v>');
    }
    expect(read(z).size).toBe(errors.length + Number(pictures));
    const back = await workbookFromFile(bytes(z), 'native-errors.xlsx'), bid = back.activeSheetId;
    errors.forEach((error, r) => {
      expect(back.getValue(bid, r, 0)).toEqual({ error });
      expect(back.getValue(bid, r, 1)).toEqual({ error });
      expect(back.getValue(bid, r, 2)).toBe(error);
      expect(back.getValue(bid, r, 3)).toBe(r + 9);
    });
    expect(back.getValue(bid, 8, 0)).toEqual({ error: '#SPILL!' });
    expect(back.getValue(bid, 9, 3)).toBe(2);
    if (pictures) expect(back.getValue(bid, 12, 1)).toEqual(picture);
    back.setInput(bid, 9, 1, ''); expect(back.getValue(bid, 10, 1)).toBe(6);
    back.undo(); expect(back.getValue(bid, 8, 0)).toEqual({ error: '#SPILL!' });
    z = await native(back);
  }
});

it('reads the six errors and formula caches saved by desktop Excel', async () => {
  // Opened and saved in Excel for Mac. Row seven is a separate transient BUSY
  // control which Excel replaced with zero on save; it is not one of these six.
  const data = fs.readFileSync(new URL('./fixtures/reference-rich-error-values.xlsx', import.meta.url));
  const raw = X.read(data, { type: 'buffer' }), w = await workbookFromFile(data, 'excel.xlsx');
  errors.forEach((error, r) => {
    expect(w.getValue(w.activeSheetId, r, 1)).toEqual({ error });
    expect(raw.Sheets.Sheet1[`C${r + 1}`].v).toBe(true);
    expect(w.getValue(w.activeSheetId, r, 2)).toBe(true);
    expect(raw.Sheets.Sheet1[`D${r + 1}`].v).toBe(r + 9);
    expect(w.getValue(w.activeSheetId, r, 3)).toBe(r + 9);
  });
});

it.each(['', '-8', '8.0', '8e0', '0x8', 'Infinity', '99'])('keeps the fallback for malformed or unknown rich error identifiers: %s', async value => {
  const w = new Workbook(); w.setCells(w.activeSheetId, [{ r: 0, c: 0, cell: { v: { error: '#SPILL!' } } }]);
  const z = await native(w);
  set(z, '/xl/richData/rdrichvalue.xml', xml(z, '/xl/richData/rdrichvalue.xml').replace('<v>8</v>', `<v>${value}</v>`));
  expect(read(z).size).toBe(0);
  const back = await workbookFromFile(bytes(z), 'malformed.xlsx');
  expect(back.getValue(back.activeSheetId, 0, 0)).toEqual({ error: '#VALUE!' });
});
