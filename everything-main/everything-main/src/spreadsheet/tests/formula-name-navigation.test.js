import { expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';

function setup() {
  return new Workbook({ sheets: [{ name: 'One' }, { name: 'Two' }], names: [
    { name: 'Base', ref: 'One!$B$2:$B$4' },
    { name: 'Alias', ref: 'Base' },
    { name: 'Moved', ref: 'OFFSET(Base,1,1,2,1)' },
    { name: 'Chosen', ref: 'IF(TRUE,One!C5,One!D6)' },
    { name: 'Relative', ref: 'OFFSET(One!A1,ROW()-1,COLUMN()-1)', sheet: 'Two' },
    { name: 'Local', ref: 'B5', sheet: 'Two' },
    { name: 'Cross', ref: 'Two!Local' },
    { name: 'TextPlace', ref: 'INDIRECT("C7")', sheet: 'Two' },
    { name: 'TextAlias', ref: 'Two!TextPlace' },
  ] });
}
it.each([
  ['#Alias', 'One', { r1: 1, c1: 1, r2: 3, c2: 1 }],
  ['#Moved', 'One', { r1: 2, c1: 2, r2: 3, c2: 2 }],
  ['#Chosen', 'One', { r1: 4, c1: 2, r2: 4, c2: 2 }],
  ['#Two!Local', 'Two', { r1: 4, c1: 1, r2: 4, c2: 1 }],
  ['#Cross', 'Two', { r1: 4, c1: 1, r2: 4, c2: 1 }],
  ['#TextAlias', 'Two', { r1: 6, c1: 2, r2: 6, c2: 2 }],
])('resolves the reference returned by %s', (url, sheet, range) => {
  const wb = setup();
  expect(wb.resolveLink(url)).toEqual({ sheetId: wb.sheetByName(sheet).id, range });
});

it('uses the link cell for formulas depending on ROW and COLUMN', () => {
  const wb = setup();
  expect(wb.resolveLink('#Two!Relative', wb.sheets[0].id, { r: 6, c: 3 }))
    .toEqual({ sheetId: wb.sheets[0].id, range: { r1: 6, c1: 3, r2: 6, c2: 3 } });
});

it('locates reference results without evaluating the destination cells', () => {
  const wb = setup();
  const read = vi.spyOn(wb, '_compute');
  expect(wb.resolveLink('#Moved')).not.toBeNull();
  expect(wb.resolveLink('#Chosen')).not.toBeNull();
  expect(wb.resolveLink('#Cross')).not.toBeNull();
  expect(wb.resolveLink('#TextAlias')).not.toBeNull();
  expect(read).not.toHaveBeenCalled();
});

it('uses calculated inputs when needed and follows edits and undo', () => {
  const wb = setup(), id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, '2'); wb.defineName('Dynamic', 'OFFSET(One!B1,One!A1,0)');
  expect(wb.resolveLink('#Dynamic')?.range.r1).toBe(2);
  wb.setInput(id, 0, 0, '5'); expect(wb.resolveLink('#Dynamic')?.range.r1).toBe(5);
  wb.undo(); expect(wb.resolveLink('#Dynamic')?.range.r1).toBe(2);
});

it.each(['42', 'SUM(1,2)', 'LAMBDA(x,x*2)', 'SEQUENCE(3)', '#REF!', 'Loop'])('rejects non-location definition %s', (ref) => {
  const wb = setup();
  wb.replaceWith({ ...wb.toJSON(), names: [...wb.names, { name: 'Loop', ref }] });
  expect(wb.resolveLink('#Loop')).toBeNull();
});

it.each([['xlsx', workbookToXlsx], ['ods', workbookToOds]])('retains formula-name navigation after %s reopening', async (format, write) => {
  let wb = setup(); wb.setLink(wb.sheets[0].id, 0, 5, '#Moved', 'Go');
  wb = await workbookFromFile(await write(wb), `names.${format}`);
  expect(wb.resolveLink(wb.linkAt(wb.sheets[0].id, 0, 5).url))
    .toEqual({ sheetId: wb.sheets[0].id, range: { r1: 2, c1: 2, r2: 3, c2: 2 } });
});
