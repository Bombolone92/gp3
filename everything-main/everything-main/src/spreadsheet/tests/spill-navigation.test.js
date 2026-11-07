import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';

function setup() {
  const wb = new Workbook({ sheets: [{ name: 'One' }, { name: 'Two Data' }], names: [
    { name: 'Results', ref: "'Two Data'!$B$2#" },
    { name: 'LocalResults', ref: "'Two Data'!$B$2#", sheet: 'Two Data' },
  ] });
  wb.setInput(wb.sheets[1].id, 1, 1, '=SEQUENCE(3,2)');
  return wb;
}
const range = { r1: 1, c1: 1, r2: 3, c2: 2 };
it.each(['#Results', "#'Two Data'!LocalResults", "#'Two Data'!B2#", "#'Two Data'!$B$2#", '#B2#'])(
  'resolves the current spill area for %s', (url) => {
    const wb = setup(), id = wb.sheets[1].id;
    expect(wb.resolveLink(url, id)).toEqual({ sheetId: id, range });
  },
);
it('resolves a named location to the entire spill', () => {
  const wb = setup();
  expect(wb.namedLocation('Results')).toMatchObject(range);
});
it('uses the source sheet for an unqualified spill address', () => {
  const wb = setup(), [one, two] = wb.sheets;
  wb.setInput(one.id, 1, 1, '=SEQUENCE(2,3)');
  expect(wb.resolveLink('#B2#', two.id)).toEqual({ sheetId: two.id, range });
  wb.setActiveSheet(two.id);
  expect(wb.resolveLink('#B2#', one.id)).toEqual({ sheetId: one.id, range: { r1: 1, c1: 1, r2: 2, c2: 3 } });
});
it.each(['#Results', "#'Two Data'!B2#"])(
  'follows resizing, blocking, removal and undo for %s', (url) => {
    const wb = setup(), id = wb.sheets[1].id;
    wb.setInput(id, 1, 1, '=SEQUENCE(5,3)');
    expect(wb.resolveLink(url)?.range).toEqual({ r1: 1, c1: 1, r2: 5, c2: 3 });
    wb.undo(); expect(wb.resolveLink(url)?.range).toEqual(range);
    wb.setInput(id, 2, 2, 'Block'); expect(wb.resolveLink(url)).toBeNull();
    wb.undo(); expect(wb.resolveLink(url)?.range).toEqual(range);
    wb.setInput(id, 1, 1, '7'); expect(wb.resolveLink(url)).toBeNull();
    wb.undo(); expect(wb.resolveLink(url)?.range).toEqual(range);
  },
);
it.each(["#'Two Data'!D9#", "#'Two Data'!B3#", "#'Two Data'!B2:C3#", "#One:'Two Data'!B2#"])(
  'rejects unavailable or invalid spill locations %s', (url) => {
    expect(setup().resolveLink(url)).toBeNull();
  },
);
it.each([['xlsx', workbookToXlsx], ['ods', workbookToOds]])('preserves spill navigation through %s reopening', async (ext, write) => {
  let wb = setup(); wb.setLink(wb.sheets[0].id, 0, 0, '#Results', 'Go');
  wb = await workbookFromFile(await write(wb), `spill.${ext}`);
  expect(wb.resolveLink(wb.linkAt(wb.sheets[0].id, 0, 0).url)).toEqual({ sheetId: wb.sheets[1].id, range });
});
