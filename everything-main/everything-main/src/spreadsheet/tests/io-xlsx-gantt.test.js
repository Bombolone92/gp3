import { afterEach, expect, it, vi } from 'vitest';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { ganttXlsx } from './helpers/xlsx-gantt-fixture.js';
import { readXlsxConditionalFormats } from '../src/core/xlsx-condformat.js';

afterEach(() => vi.useRealTimers());

it('imports a live Gantt schedule with relative names, rule priority, today borders and fixed progress bars', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 16, 12));
  let wb = await workbookFromFile(ganttXlsx(), 'schedule.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const s = wb.activeSheet, id = s.id;
    const look = (r, c) => wb.conditionalStyle(id, r, c, wb.getValue(id, r, c));
    expect(s.gridlines).toBe(false);
    expect(wb.colWidth(id, 8)).toBe(22);
    expect(wb.rowHeight(id, 0)).toBe(120);
    expect(wb.getCell(id, 0, 1).s).toMatchObject({ font: 'arial-black', size: 160 / 3, color: '#1363df', valign: 'bottom' });
    expect(wb.getCell(id, 4, 8).s).toMatchObject({ bg: { theme: 0, base: '#ffffff', tint: -0.05, rgb: '#f2f2f2' } });
    expect(s.rules).toHaveLength(4);
    expect(look(8, 9)).toBeNull(); // before the task starts
    expect(look(8, 10)).toMatchObject({ bg: '#e0d4fd', bl: true, br: true, bc: '#ff00ff' });
    expect(look(8, 11)).toMatchObject({ bg: '#e0d4fd' });
    expect(look(8, 12)).toMatchObject({ bg: '#a37efa' });
    expect(look(8, 13)).toMatchObject({ bg: '#a37efa' });
    expect(look(8, 14)).toBeNull(); // after the task ends
    expect(look(9, 12)).toBeNull(); // a different row reads that row's task dates
    expect(look(9, 13)).toMatchObject({ bg: '#e0d4fd' });
    expect(look(9, 14)).toMatchObject({ bg: '#a37efa' });
    expect(look(8, 3)).toMatchObject({ bar: 0.5, barColor: '#ffffff' });
    expect(look(9, 3)).toMatchObject({ bar: 0.58 }); // native default lengths span 10–90%, not 0–100%
    if (!pass) wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  }
  const id = wb.activeSheetId;
  wb.setInput(id, 8, 3, '100%');
  expect(wb.conditionalStyle(id, 8, 12, null).bg).toBe('#e0d4fd');
  wb.setInput(id, 8, 4, '46283');
  expect(wb.conditionalStyle(id, 8, 11, null)).toBeNull();
  expect(wb.conditionalStyle(id, 8, 10, null)).toMatchObject({ bl: true, br: true });
});

it('rebases separate target areas and respects explicit stop rules', async () => {
  const styles = { dxfs: [{ bg: '#ff0000' }, { color: '#0000ff' }, { bold: true }] };
  const xml = '<conditionalFormatting sqref="C3:C4 E5:E6">'
    + '<cfRule type="expression" dxfId="2" priority="3"><formula>TRUE()</formula></cfRule>'
    + '<cfRule type="cellIs" operator="greaterThan" dxfId="1" priority="2" stopIfTrue="1"><formula>$B3</formula></cfRule>'
    + '<cfRule type="expression" dxfId="0" priority="1"><formula>A3&gt;0</formula></cfRule></conditionalFormatting>';
  const rules = readXlsxConditionalFormats(xml, styles);
  expect(rules.map(r => r.value)).toEqual(['A3>0', 'C5>0', 'C3>($B3)', 'E5>($B5)', 'TRUE()', 'TRUE()']);
  const { Workbook } = await import('../src/core/workbook.js');
  const wb = new Workbook({ sheets: [{ name: 'Data', rules, cells: { '2,0': { v: 1 }, '2,1': { v: 2 }, '2,2': { v: 3 } } }] });
  expect(wb.conditionalStyle(wb.activeSheetId, 2, 2, 3)).toEqual({ bg: '#ff0000', color: '#0000ff' });
});

it('keeps stop rules without a differential style and rejects missing numeric bar bounds', () => {
  const rules = readXlsxConditionalFormats('<conditionalFormatting sqref="A1:A4">'
    + '<cfRule type="expression" priority="1" stopIfTrue="1"><formula>A1=&quot;skip&quot;</formula></cfRule>'
    + '<cfRule type="dataBar" priority="2"><dataBar><cfvo type="num"/><cfvo type="num" val="1"/><color rgb="FF0000FF"/></dataBar></cfRule>'
    + '</conditionalFormatting>');
  expect(rules).toHaveLength(1);
  expect(rules[0]).toMatchObject({ type: 'formula', value: 'A1="skip"', stopIfTrue: true, style: {} });
});
