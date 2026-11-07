import { DEFAULT_FONT_COLOR } from '../src/core/font-color.js';
import { expect, it } from 'vitest';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { reportXlsx } from './helpers/xlsx-report-fixture.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';

it('preserves a designed Excel report, including fonts, alignment, dimensions, borders and custom table colors', async () => {
  let wb = await workbookFromFile(reportXlsx(), 'report.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const s = wb.sheets[0], id = s.id;
    expect(s.gridlines).toBe(false);
    expect(s.filter.showButtons).toBe(false);
    expect(wb.colWidth(id, 2)).toBe(126);
    expect(wb.rowHeight(id, 2)).toBe(24);
    expect(wb.rowHeight(id, 11)).toBeCloseTo(58.15 * 4 / 3);
    expect(wb.rowHeight(id, 12)).toBe(40);
    expect(wb.getCell(id, 2, 2).s).toMatchObject({ font: 'rockwell', size: 64, wrap: true, indent: 1, align: 'left', valign: 'middle', color: '#135679' });
    expect(wb.getCell(id, 11, 9).s).toMatchObject({ font: 'rockwell', bold: true, size: 16, wrap: true, align: 'center', valign: 'middle' });
    expect(wb.getCell(id, 2, 7).s.align).toBe('right');
    expect(wb.getCell(id, 10, 3).s).toMatchObject({ bl: true, bt: true, bc: '#135679' });
    expect(wb.getCell(id, 10, 7).s).toMatchObject({ br: true, bt: true, bc: '#135679' });
    expect(wb.conditionalStyle(id, 11, 2, 'Date')).toMatchObject({ bg: '#135679', color: '#ffeed7' });
    expect(wb.conditionalStyle(id, 12, 2, 1)).toMatchObject({ bg: '#ffeed7', bb: true, bc: '#135679' });
    expect(wb.conditionalStyle(id, 13, 2, 2)).toMatchObject({ bg: '#fee8c1' });
    expect(wb.getCell(id, 12, 3).s.bg).toBe('#ffddaf');
    expect(s.merges).toContainEqual({ r1: 2, c1: 2, r2: 8, c2: 6 });
    if (!pass) wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  }
  const s = wb.sheets[0], table = s.tables[0];
  wb.addTableRow(s.id, table.id);
  expect(wb.conditionalStyle(s.id, 14, 2, null).bg).toBe('#ffeed7');
  s.hiddenRows.add(12);
  expect(wb.conditionalStyle(s.id, 13, 2, 2).bg).toBe('#ffeed7');
  wb.updateTable(s.id, table.id, { style: 'green' });
  expect(s.tables[0].customStyle).toBeUndefined();
});

it('imports alignment even when the workbook only has the default font', async () => {
  const wb = await workbookFromFile(otherProgramsXlsx({
    styles: { cellXfs: ['<xf fontId="0" fillId="0" borderId="0"><alignment horizontal="right" vertical="bottom" wrapText="1"/></xf>'] },
    sheetXml: { Data: { rows: '<row r="1"><c r="A1" s="1"><v>1</v></c></row>' } },
  }), 'alignment.xlsx');
  expect(wb.getCell(wb.activeSheetId, 0, 0).s).toEqual({ font: 'calibri', scheme: 'minor', size: 16, color: DEFAULT_FONT_COLOR, align: 'right', valign: 'bottom', wrap: true });
});
