import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';

function setup(ref = 'One:Missing!$B$2:$C$3') {
  return new Workbook({ sheets: [{ name: 'One' }, { name: 'Two Data' }], names: [{ name: 'Across', ref }] });
}
it.each(['One:Missing!B2:C3', "'Two Data:Missing Data'!B2", "'Two Data':'Missing Data'!B2", 'Missing:One!B2'])(
  'rejects a link with an unavailable endpoint: %s', (address) => {
    expect(setup().resolveLink(`#${address}`)).toBeNull();
  },
);
it.each(['One:Missing!B2:C3', "'Two Data:Missing Data'!B2", 'Missing:One!B2'])(
  'rejects a named location with an unavailable endpoint: %s', (ref) => {
    const wb = setup(ref);
    expect(wb.namedLocation('Across')).toBeNull();
    expect(wb.resolveLink('#Across')).toBeNull();
  },
);
it('follows endpoint creation and undo', () => {
  const wb = setup();
  expect(wb.resolveLink('#Across')).toBeNull();
  wb.addSheet('Missing');
  expect(wb.resolveLink('#Across')).toEqual({ sheetId: wb.sheets[0].id, range: { r1: 1, c1: 1, r2: 2, c2: 2 } });
  wb.undo(); expect(wb.resolveLink('#Across')).toBeNull();
});
it.each(["One:'Two Data'!B2:C3", "'Two Data':One!B2:C3"])(
  'preserves navigation to the first endpoint of an existing span: %s', (ref) => {
    const wb = setup(ref), name = ref.startsWith('One') ? 'One' : 'Two Data';
    const expected = { sheetId: wb.sheetByName(name).id, range: { r1: 1, c1: 1, r2: 2, c2: 2 } };
    expect(wb.resolveLink('#Across')).toEqual(expected);
    expect(wb.resolveLink(`#${ref}`)).toEqual(expected);
  },
);
it.each([['xlsx', workbookToXlsx], ['ods', workbookToOds]])('keeps missing endpoints invalid after %s reopening', async (ext, write) => {
  let wb = setup(); wb.setLink(wb.sheets[0].id, 0, 0, '#Across', 'Across');
  wb = await workbookFromFile(await write(wb), `span.${ext}`);
  expect(wb.resolveLink(wb.linkAt(wb.sheets[0].id, 0, 0).url)).toBeNull();
});
