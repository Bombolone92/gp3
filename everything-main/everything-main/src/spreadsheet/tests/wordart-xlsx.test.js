import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookToXlsx, workbookFromFile } from '../src/core/io.js';

it('exports WordArt as a DrawingML text box with outline and shadow, and reads it back', async () => {
  const wb = new Workbook(); const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Sales');
  wb.addChart(id, { type: 'text', text: 'Hello', anchor: { r: 1, c: 1 }, w: 300, h: 80,
    style: { size: 40, bold: true, color: '#4f81bd', border: false, align: 'center', effects: { outline: '#203040', outlineWidth: 1.5, shadow: '#000000', glow: '#ffcc00' } } });
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const drawing = zip.FullPaths.find(p => /drawings\/drawing\d+\.xml$/.test(p));
  const xml = new TextDecoder().decode(X.CFB.find(zip, drawing).content);
  expect(xml).toMatch(/<a:rPr [^>]*sz="3000"[^>]*><a:ln w="14288"><a:solidFill><a:srgbClr val="203040"(?:\/>|><\/a:srgbClr>)<\/a:solidFill><\/a:ln><a:solidFill><a:srgbClr val="4F81BD"(?:\/>|><\/a:srgbClr>)<\/a:solidFill><a:effectLst><a:glow rad="63500">/);
  expect(xml).toContain('<a:outerShdw');
  expect(xml).toContain('<a:t>Hello</a:t>');
  const back = await workbookFromFile(await workbookToXlsx(wb), 'art.xlsx');
  const box = back.sheet(back.activeSheetId).charts.find(c => c.type === 'text');
  expect(box.text).toBe('Hello');
  expect(box.style.effects).toEqual({ outline: '#203040', outlineWidth: 1.5, shadow: '#000000', glow: '#ffcc00' });
});
