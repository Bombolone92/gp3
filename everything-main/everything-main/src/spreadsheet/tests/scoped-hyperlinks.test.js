import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';

function setup() {
  return new Workbook({ sheets: [{ name: 'One' }, { name: 'Two Data' }], names: [
    { name: 'Target', ref: 'One!$A$1:$B$2' },
    { name: 'Target', ref: "'Two Data'!$C$3:$D$4", sheet: 'Two Data' },
    { name: 'OnlyHere', ref: "'Two Data'!$E$5", sheet: 'Two Data' },
    { name: 'Constant', ref: '42', sheet: 'Two Data' },
  ] });
}
const globalRange = { r1: 0, c1: 0, r2: 1, c2: 1 };
const localRange = { r1: 2, c1: 2, r2: 3, c2: 3 };

it.each([false, true])('resolves bare names using the link source despite active sheet (secondActive=%s)', (secondActive) => {
  const wb = setup(), [one, two] = wb.sheets;
  wb.setActiveSheet(secondActive ? two.id : one.id);
  expect(wb.resolveLink('#Target', one.id)).toEqual({ sheetId: one.id, range: globalRange });
  expect(wb.resolveLink('#Target', two.id)).toEqual({ sheetId: two.id, range: localRange });
  expect(wb.resolveLink('#OnlyHere', one.id)).toBeNull();
  expect(wb.resolveLink('#OnlyHere', two.id)).toMatchObject({ sheetId: two.id, range: { r1: 4, c1: 4 } });
});

it.each(["#'Two Data'!Target", "#'two data'!target", "# 'Two Data'!Target "])(
  'resolves qualified local link %s from either sheet', (url) => {
    const wb = setup(), two = wb.sheets[1];
    for (const from of wb.sheets) expect(wb.resolveLink(url, from.id)).toEqual({ sheetId: two.id, range: localRange });
  },
);

it('uses global fallback on a qualified sheet and rejects missing targets', () => {
  const wb = setup();
  expect(wb.resolveLink('#One!Target', wb.sheets[1].id)).toEqual({ sheetId: wb.sheets[0].id, range: globalRange });
  for (const url of ['#Missing!Target', "#'Two Data'!Missing", "#'Two Data'!Constant", "#'Two Data'!Target+1"]) expect(wb.resolveLink(url)).toBeNull();
});

it.each(["O'Brien", 'A!B', 'A1'])('handles qualified link sheet %s', (name) => {
  const wb = setup(), id = wb.sheets[1].id;
  wb.renameSheet(id, name);
  const qualifier = name === 'A1' ? name : `'${name.replace(/'/g, "''")}'`;
  expect(wb.resolveLink(`#${qualifier}!Target`, wb.sheets[0].id)).toEqual({ sheetId: id, range: localRange });
});

it('follows redefined and structurally moved named targets with undo', () => {
  const wb = setup(), id = wb.sheets[1].id, url = "#'Two Data'!Target";
  expect(wb.resolveLink(url)?.range).toEqual(localRange);
  wb.defineName('Target', "'Two Data'!$F$6", 'Two Data');
  expect(wb.resolveLink(url)?.range).toEqual({ r1: 5, c1: 5, r2: 5, c2: 5 });
  wb.undo(); expect(wb.resolveLink(url)?.range).toEqual(localRange);
  wb.insertRows(id, 0, 1); expect(wb.resolveLink(url)?.range).toEqual({ r1: 3, c1: 2, r2: 4, c2: 3 });
  wb.undo(); expect(wb.resolveLink(url)?.range).toEqual(localRange);
  wb.deleteSheet(id); expect(wb.resolveLink(url)).toBeNull();
  wb.undo(); expect(wb.resolveLink(url)?.range).toEqual(localRange);
});

it.each([['xlsx', workbookToXlsx], ['ods', workbookToOds]])('keeps scoped targets through repeated %s saves', async (format, write) => {
  let wb = setup();
  wb.setLink(wb.sheets[0].id, 0, 5, "#'Two Data'!Target", 'Local range');
  wb.setLink(wb.sheets[1].id, 0, 5, '#Target', 'Same-sheet range');
  for (let i = 0; i < 2; i++) {
    wb = await workbookFromFile(await write(wb), `links.${format}`);
    for (const from of wb.sheets) {
      const link = wb.linkAt(from.id, 0, 5);
      expect(wb.resolveLink(link.url, from.id)).toEqual({ sheetId: wb.sheets[1].id, range: localRange });
    }
  }
});
