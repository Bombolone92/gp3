import { DEFAULT_FONT_COLOR } from '../src/core/font-color.js';
import { expect, it } from 'vitest';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { degreeRoadmapXlsx } from './helpers/xlsx-degree-roadmap-fixture.js';

it.each([null, ''])('keeps unstyled course tables and the precise Calibri layout through save/reopen (style %j)', async styleName => {
  let wb = await workbookFromFile(degreeRoadmapXlsx({ styleName }), 'roadmap.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const s = wb.activeSheet, id = s.id;
    expect(s.tables[0].style).toBe('none');
    expect(wb.conditionalStyle(id, 22, 1, 'Subject')).toBeNull();
    expect(wb.conditionalStyle(id, 23, 1, 'ECE')).toBeNull();
    expect(wb.getCell(id, 22, 1).s).toMatchObject({ font: 'calibri', size: 44 / 3, color: DEFAULT_FONT_COLOR, bold: true, bg: '#ededed', wrap: true, valign: 'bottom' });
    expect(wb.getCell(id, 23, 1).s).toMatchObject({ font: 'calibri', size: 44 / 3, bg: '#e2f0d9' });
    expect(wb.getCell(id, 0, 0).s.size).toBeCloseTo(80 / 3);
    expect(wb.rowHeight(id, 22)).toBe(41);
    expect(wb.colWidth(id, 1)).toBe(134);
    expect(s.defaultRowHeight).toBe(20);
    expect(s.defaultColWidth).toBe(62);
    expect(s.filter.showButtons).toBe(false);
    expect(s.merges).toContainEqual({ r1: 7, c1: 0, r2: 11, c2: 1 });
    expect(wb.getValue(wb.sheets[1].id, 0, 0)).toBe(7);
    if (!pass) wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  }
  wb.setInput(wb.activeSheetId, 23, 4, '5');
  expect(wb.getValue(wb.sheets[1].id, 0, 0)).toBe(9);
  wb.undo();
  expect(wb.getValue(wb.sheets[1].id, 0, 0)).toBe(7);
});

it('still imports named table styles and lets a user change an unstyled table', async () => {
  const styled = await workbookFromFile(degreeRoadmapXlsx({ styleName: 'TableStyleMedium7' }), 'styled.xlsx');
  expect(styled.activeSheet.tables[0].style).toBe('green');
  const wb = await workbookFromFile(degreeRoadmapXlsx(), 'plain.xlsx');
  const s = wb.activeSheet, table = s.tables[0];
  wb.updateTable(s.id, table.id, { style: 'blue' });
  expect(wb.conditionalStyle(s.id, 22, 1, 'Subject').color).toBe('#ffffff');
  wb.undo();
  expect(wb.conditionalStyle(s.id, 22, 1, 'Subject')).toBeNull();
});
