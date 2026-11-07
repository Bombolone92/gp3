import { expect, it } from 'vitest';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { readXlsxConditionalFormats } from '../src/core/xlsx-condformat.js';
import { Workbook } from '../src/core/workbook.js';
import { projectTrackerXlsx } from './helpers/xlsx-project-tracker-fixture.js';

it('keeps tracker status colors, checkbox states and border weights through editing and save/reopen', async () => {
  let wb = await workbookFromFile(projectTrackerXlsx(), 'tracker.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const s = wb.sheets[0], id = s.id;
    expect(s.gridlines).toBe(false);
    expect(s.validations.filter(v => v.type === 'checkbox')).toHaveLength(22);
    expect(wb.sheets[1].validations.filter(v => v.type === 'checkbox')).toHaveLength(22);
    expect(wb.getValue(id, 5, 1)).toBe(false);
    expect(wb.getValue(id, 6, 1)).toBe(true);
    expect(wb.validationAt(id, 6, 1)).toMatchObject({ checkboxStyle: 'excel', checkboxOffset: 16 });
    expect(wb.validationAt(id, 5, 2).type).toBe('list');
    expect(wb.colWidth(id, 5)).toBe(247);
    expect(wb.rowHeight(id, 5)).toBeCloseTo(100 / 3);
    expect(wb.getDisplay(id, 6, 9)).toBe('80%');
    expect(wb.getCell(id, 3, 1).s).toMatchObject({ bs: 'medium', blBorder: { bs: 'thin' }, brBorder: { bs: 'thin' }, btBorder: { bs: 'thin' } });
    const look = (r, c) => wb.conditionalStyle(id, r, c, wb.getValue(id, r, c));
    expect(look(5, 2)?.bg).toBe('#00b050');
    expect(look(6, 2)?.bg).toBe('#ffff00');
    expect(look(7, 2)?.bg).toBe('#ff0000');
    expect(look(6, 14)?.bg).toBe('#00b050');
    expect(look(4, 16)?.bg).toBe('#ff0000');
    expect(look(5, 3)?.bg).toBe('#ff0000');
    if (!pass) wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  }
  const id = wb.activeSheetId;
  wb.setInput(id, 6, 1, 'FALSE');
  expect(wb.getValue(id, 6, 1)).toBe(false);
  wb.undo();
  expect(wb.getValue(id, 6, 1)).toBe(true);
  wb.setInput(id, 5, 2, 'Overdue');
  expect(wb.conditionalStyle(id, 5, 2, wb.getValue(id, 5, 2)).bg).toBe('#ff0000');
  expect(wb.conditionalStyle(id, 6, 14, wb.getValue(id, 6, 14)).bg).toBe('#00b050');
  wb.applyBorders(id, { r1: 3, c1: 1, r2: 3, c2: 1 }, 'restyle', { style: 'dashed', color: '#123456' });
  expect(wb.getCell(id, 3, 1).s.blBorder).toEqual({ bs: 'dashed', bc: '#123456' });
  wb.undo();
  expect(wb.getCell(id, 3, 1).s.blBorder.bs).toBe('thin');
});

it.each([
  { controlProps: 'fmlaLink="$Z$1"' }, { controlProps: 'macro="DoSomething"' },
  { controlProps: 'checked="Mixed"' }, { caption: 'Caption' }, { occupied: true }, { external: true },
])('does not replace unsupported or occupied form controls with checkbox cells: %j', async options => {
  const wb = await workbookFromFile(projectTrackerXlsx(options), 'tracker.xlsx'), s = wb.activeSheet;
  expect(wb.validationAt(s.id, 5, 1)).toBeNull();
  expect(wb.getValue(s.id, 5, 1)).toBe(options.occupied ? 'Keep me' : null);
  expect(wb.getValue(s.id, 6, 1)).toBe(true);
});

it.each([
  ['containsText', 'a*1', 'prefix A21 suffix', true],
  ['notContainsText', 'A1', 'A1', false],
  ['beginsWith', 'A1', 'a1 suffix', true],
  ['endsWith', 'A1', 'prefix a1', true],
  ['containsText', 'say &quot;yes&quot;', 'say "yes"', true],
])('evaluates %s locally in disjoint ranges, preserving text and wildcards', (type, text, value, matches) => {
  const rules = readXlsxConditionalFormats(`<conditionalFormatting sqref="O5 C5"><cfRule type="${type}" text="${text}" dxfId="0" priority="1"><formula>C5=0</formula></cfRule></conditionalFormatting>`, { dxfs: [{ bg: '#ff0000' }] });
  const wb = new Workbook({ sheets: [{ rules, cells: { '4,2': { v: value }, '4,14': { v: value } } }] });
  for (const c of [2, 14]) expect(!!wb.conditionalStyle(wb.activeSheetId, 4, c, value)).toBe(matches);
});
