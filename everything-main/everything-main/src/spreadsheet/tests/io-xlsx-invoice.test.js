import { DEFAULT_FONT_COLOR } from '../src/core/font-color.js';
import { expect, it } from 'vitest';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { invoiceXlsx } from './helpers/xlsx-invoice-fixture.js';

it('keeps invoice decoration sizes, theme colors and Cambria through save/reopen', async () => {
  let wb = await workbookFromFile(invoiceXlsx(), 'invoice.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const sheet = wb.activeSheet;
    expect(sheet.charts).toHaveLength(5);
    expect(sheet.charts.map(shape => shape.style.bg)).toEqual(['#edfbdc', '#caf297', '#edfbdc', '#edfbdc', '#caf297']);
    expect(sheet.charts[0].w).toBeCloseTo((360046 - 3026) / 9525);
    expect(sheet.charts[1].h).toBeCloseTo(40 + (1 - 8573) / 9525);
    expect(sheet.charts[2]).toMatchObject({ type: 'text', text: '', anchor: { r: 3, c: 1 }, style: { border: false } });
    expect(sheet.charts[2].w).toBeCloseTo((360046 - 165589) / 9525);
    expect(sheet.charts[2].h).toBeCloseTo((199690 - 309) / 9525);
    expect(sheet.charts[3].h).toBeCloseTo(40 + (191189 - 372808) / 9525);
    expect(sheet.charts[4].h).toBeCloseTo(371317 / 9525);
    expect(wb.getCell(sheet.id, 0, 1).s).toMatchObject({ bg: { theme: 6, base: '#a7ea52', rgb: '#81d31a', tint: -0.249977111117893 }, font: 'cambria', size: 16 });
    expect(wb.getCell(sheet.id, 4, 1).s).toMatchObject({ font: 'cambria', size: 16, color: DEFAULT_FONT_COLOR });
    if (!pass) wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  }
  const sheet = wb.activeSheet, shape = sheet.charts[2];
  wb.updateChart(sheet.id, shape.id, { dx: 25 }, 'Move decoration');
  const moved = wb.chartById(sheet.id, shape.id);
  expect(moved.dx).toBe(25);
  // Converting fractional extents back into cell markers can round binary floats.
  expect(moved.w).toBeCloseTo(shape.w, 10);
  expect(moved.h).toBeCloseTo(shape.h, 10);
  wb.undo();
  expect(wb.chartById(sheet.id, shape.id)).toEqual(shape);
});

it('does not discard visible text to import a rectangle as blank decoration', async () => {
  let wb = await workbookFromFile(invoiceXlsx({ rectangleText: 'Caption' }), 'invoice.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    expect(wb.activeSheet.charts).toHaveLength(5);
    const caption = wb.activeSheet.charts[2];
    expect(caption).toMatchObject({ type: 'image', drawingShape: true });
    expect(Buffer.from(caption.src.split(',')[1], 'base64').toString()).toContain('>Caption</span>');
    expect(wb.activeSheet.charts.filter(c => c.type === 'text' && c.text === '')).toHaveLength(4);
    if (!pass) wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  }
});
