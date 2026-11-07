import { describe, it, expect } from 'vitest';
import { Workbook, safeSheetName } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';

const tableNS = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const flatOds = (tables) => new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
  <office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
    xmlns:table="${tableNS}" office:mimetype="application/vnd.oasis.opendocument.spreadsheet" office:version="1.2">
    <office:body><office:spreadsheet>${tables}</office:spreadsheet></office:body>
  </office:document>`);
const table = (name, cells) => `<table:table table:name="${name}"><table:table-row>${cells}</table:table-row></table:table>`;
const num = (v, formula = null) => `<table:table-cell office:value-type="float" office:value="${v}"${formula ? ` table:formula="${formula.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"` : ''}><text:p>${v}</text:p></table:table-cell>`;

describe('sheet names every file format accepts', () => {
  it('refuses names a workbook file cannot hold when a sheet is renamed or added', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    expect(wb.renameSheet(id, 'History')).toBe(false);
    expect(wb.renameSheet(id, 'history')).toBe(false);
    expect(wb.renameSheet(id, "'Notes")).toBe(false);
    expect(wb.renameSheet(id, "Notes'")).toBe(false);
    expect(wb.validateSheetName('History')).toMatch(/History/);
    expect(wb.validateSheetName("'Quoted'")).toMatch(/apostrophe/);
    expect(wb.renameSheet(id, "Rock 'n' roll")).toBe(true);
    expect(wb.addSheet('History').name).toBe('Sheet2');
  });

  it('turns a foreign name into one the writer accepts, unique among its neighbours', () => {
    expect(safeSheetName('Q1/Q2')).toBe('Q1 Q2');
    expect(safeSheetName('History')).toBe('History sheet');
    expect(safeSheetName("'Notes'")).toBe('Notes');
    expect(safeSheetName('')).toBe('Sheet1');
    expect(safeSheetName('x'.repeat(40))).toHaveLength(31);
    expect(safeSheetName('x'.repeat(31), ['x'.repeat(31)])).toBe(`${'x'.repeat(29)} 2`);
    expect(safeSheetName('Data', ['data', 'Data 2'])).toBe('Data 3');
  });

  it('renames imported sheets the writer would refuse and keeps their references working', async () => {
    const wb = await workbookFromFile(flatOds(
      table('Q1/Q2', num(5))
      + table('History', num(10, "of:=['Q1/Q2'.A1]*2"))
      + table('x'.repeat(40), num(1)),
    ), 'foreign.fods');
    expect(wb.sheets.map((s) => s.name)).toEqual(['Q1 Q2', 'History sheet', 'x'.repeat(31)]);
    const history = wb.sheets[1];
    expect(wb.getCell(history.id, 0, 0).f).toBe("'Q1 Q2'!A1*2");
    expect(wb.getValue(history.id, 0, 0)).toBe(10);
    expect(wb.canUndo()).toBe(false);
    expect(wb.dirty).toBe(false);
    // The point of it all: the file can be saved again.
    await expect(workbookToXlsx(wb)).resolves.toBeTruthy();
    await expect(workbookToOds(wb)).resolves.toBeTruthy();
  });

  it('names a CSV sheet after the file with the same rules', async () => {
    const wb = await workbookFromFile(new TextEncoder().encode('a,b\n1,2\n'), 'History.csv');
    expect(wb.sheets[0].name).toBe('History sheet');
    await expect(workbookToXlsx(wb)).resolves.toBeTruthy();
  });
});
