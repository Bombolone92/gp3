// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { FONTS, fontName, fontKeyFor, fontStack } from '../src/core/format.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

const families = ['Open Sans', 'Open Sans Regular', 'Calibri Light', 'Book Antiqua', 'Geneva', 'Century',
  '新しい書体', 'O\'Brien, "Special" \\ Font', 'Font";color:red;/*', 'Gill Sans MT'];
const keys = [...FONTS.map(([key]) => key), ...families.map(name => fontKeyFor(name, { literal: true }))];
const cells = keys.map((font, i) => ({ v: `Sample ${i}`, f: null, s: { font, size: 14, bold: i % 2 === 0, italic: i % 3 === 0 } }));
const texts = [cells.map(c => c.v)];
const doc = html => new DOMParser().parseFromString(html, 'text/html');
const external = html => html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');

it('writes one safely quoted requested family for every named preset and imported font', () => {
  const html = cellsToHtml(texts, [cells]);
  const tds = [...doc(html).querySelectorAll('td')];
  cells.forEach((cell, i) => {
    const name = fontName(cell.s.font), style = tds[i].style;
    const css = fontStack(cell.s.font, { fallbacks: false });
    if (name) expect(tds[i].getAttribute('style')).toContain(`font-family:${css};`);
    else expect(style.fontFamily).toBe('');
    expect(style.color).toBe('');
    expect(style.fontSize).toBe('10.5pt');
    if (name) expect(fontName(fontKeyFor(css))).toBe(name);
  });
  expect(doc(html).querySelectorAll('script')).toHaveLength(0);
  expect(parseHtmlClipboard(html).cells).toEqual([cells]);
});

it('keeps browser fallbacks in web exports without changing the requested family', () => {
  const html = cellsToHtml(texts, [cells], null, null, null, { clipboard: false });
  const tds = [...doc(html).querySelectorAll('td')];
  cells.forEach((cell, i) => {
    const css = fontStack(cell.s.font);
    if (css) expect(tds[i].getAttribute('style')).toContain(`font-family:${css}`);
    else expect(tds[i].style.fontFamily).toBe('');
  });
  expect(tds.find(td => td.style.fontFamily.includes('Open Sans')).style.fontFamily).toContain('Arial');
});

it('preserves resolved line formatting through external paste, edit, undo and native XLSX', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  const rows = cellsFromHtmlRows(parseHtmlClipboard(external(cellsToHtml(texts,
    [cells.map(c => ({ v: c.v, f: null }))], null, [cells.map(c => c.v)], null, { styles: [cells.map(c => c.s)] }))).rows);
  wb.setCells(id, rows.map(({ i, j, cell }) => ({ r: i, c: j, cell })));
  wb.setInput(id, 0, 1, 'Changed'); wb.undo();
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.readAsArrayBuffer(blob); });
  const zip = X.CFB.read(bytes, { type: 'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  const restored = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx');
  cells.forEach((cell, c) => {
    expect(restored.getValue(restored.activeSheetId, 0, c)).toBe(cell.v);
    if (cell.s.font === 'default') return;
    const style = restored.styleAt(restored.activeSheetId, 0, c);
    expect(fontName(style.font)).toBe(fontName(cell.s.font));
    expect(style.size).toBe(14);
    expect(!!style.bold).toBe(cell.s.bold);
    expect(!!style.italic).toBe(cell.s.italic);
  });
});

it('omits missing or invalid font values without creating fallback family data', () => {
  for (const font of [null, '', 'default', 'font:', 'font:Bad\nFont', 'font:' + 'x'.repeat(256)]) {
    expect(fontStack(font, { fallbacks: false })).toBeNull();
    const html = cellsToHtml([['Text']], [[{ v: 'Text', s: { font } }]]);
    expect(doc(html).querySelector('td').style.fontFamily).toBe('');
  }
});
