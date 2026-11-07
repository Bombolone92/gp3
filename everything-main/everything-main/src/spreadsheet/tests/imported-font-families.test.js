// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { fontKeyFor, fontName, fontStack } from '../src/core/format.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { xmlText } from '../src/core/xlsx-export-styles.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';
import { createToolbar } from '../src/ui/toolbar.js';
import { openFormatCellsDialog } from '../src/ui/formatcells.js';
import { closeMenu } from '../src/ui/menu.js';
import { closeAllModals } from '../src/ui/modal.js';
import { Workbook } from '../src/core/workbook.js';

afterEach(() => { closeMenu(); closeAllModals(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it('preserves unquoted CSS family names independently of preset keys and fallback aliases', () => {
  for (const family of ['Geneva', 'geneva', 'century', 'Times', 'Courier', 'Menlo', 'Carlito', 'Avenir']) {
    for (const css of [family, `${family}, sans-serif`, `"${family}"`]) {
      expect(fontName(fontKeyFor(css))).toBe(family);
      const cell = parseHtmlClipboard(`<table><tr><td style='font-family:${css}'>Text</td></tr></table>`).rows[0][0];
      expect(fontName(cell.style.font)).toBe(family);
    }
  }
  expect(fontKeyFor('sans-serif')).toBe('arial');
  expect(fontKeyFor('ui-monospace')).toBe('mono');
  expect(fontKeyFor('"sans-serif"')).toBe('font:sans-serif');
  expect(fontKeyFor('Helvetica')).toBe('helvetica');
});

it('preserves unlisted, Unicode and punctuation-bearing native families through CSS without confusing preset keys', () => {
  for (const name of ['Gadugi', 'Calibri Light', 'Book Antiqua', 'Century', 'century', '新しい書体', 'O\'Brien, "Special" \\ Font']) {
    const key = fontKeyFor(name, { literal: true });
    expect(fontName(key)).toBe(name);
    expect(fontKeyFor(fontStack(key))).toBe(key);
  }
  expect(fontKeyFor('Gadugi, sans-serif')).toBe('font:Gadugi');
  expect(fontKeyFor('"Gadu\\67 i", sans-serif')).toBe('font:Gadugi');
  expect(fontKeyFor('Century')).toBe('font:Century');
  expect(fontKeyFor('"Menlo"')).toBe('font:Menlo');
  expect(fontName('times')).toBe('Times New Roman');
  expect(fontStack('default')).toBeNull();
  for (const input of ['', '\u0000Gadugi', 'x'.repeat(256), 'inherit', 'unset', 'bad; color:red']) expect(fontKeyFor(input)).toBeNull();
  const malicious = fontStack(fontKeyFor('Font";color:red;/*', { literal: true }));
  const div = document.createElement('div');
  div.style.cssText = `font-family:${malicious};font-size:14px`;
  expect(div.style.color).toBe('');
  expect(div.style.fontSize).toBe('14px');
});

it('retains imported families in cells, chart text, native XLSX and external HTML without private metadata', async () => {
  const families = ['Gadugi', 'Calibri Light', 'Book Antiqua', 'Century', 'O\'Brien, "Special"', 'Sylfaen', 'Gill Sans MT'];
  const bytes = otherProgramsXlsx({
    sheetXml: { Data: { rows: '<row r="1">' + families.map((name, c) => `<c r="${X.utils.encode_col(c)}1" s="${c}" t="inlineStr"><is><t>Sample ${c}</t></is></c>`).join('')
      + '</row><row r="2"><c r="A2"><v>1</v></c><c r="B2"><v>2</v></c></row>' } },
    styles: {
      fonts: families.slice(1).map(name => `<font><name val="${xmlText(name)}"/><sz val="11"/></font>`),
      cellXfs: families.slice(1).map((_, i) => `<xf fontId="${i + 1}" numFmtId="0" fillId="0" borderId="0" xfId="0"/>`),
    },
    patch: { '/xl/styles.xml': xml => xml.replace('<scheme val="minor"/>', '').replace('<name val="Calibri"/>', '<name val="Gadugi"/>') },
  });
  let wb = await workbookFromFile(bytes, 'fonts.xlsx');
  wb.addChart(wb.activeSheetId, { type: 'column', title: 'Income', range: { r1: 0, r2: 1, c1: 0, c2: 1 }, anchor: { r: 4, c: 0 }, w: 500, h: 300,
    appearance: { titleStyle: { font: 'font:Gadugi', size: 20 }, yStyle: { font: 'font:Book Antiqua' } } });
  for (let pass = 0; pass < 2; pass++) {
    const id = wb.activeSheetId;
    families.forEach((name, c) => {
      const style = wb.styleAt(id, 0, c);
      expect(fontName(style.font)).toBe(name);
      const html = cellsToHtml([[`Sample ${c}`]], [[wb.getCell(id, 0, c)]], [[style]]).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
      const pasted = cellsFromHtmlRows(parseHtmlClipboard(html).rows);
      expect(fontName(pasted[0].cell.s.font)).toBe(name);
    });
    expect(fontName(wb.activeSheet.charts[0].appearance.titleStyle.font)).toBe('Gadugi');
    expect(fontName(wb.activeSheet.charts[0].appearance.yStyle.font)).toBe('Book Antiqua');
    if (pass) break;
    const saved = await workbookToXlsx(wb);
    const array = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsArrayBuffer(saved); });
    const zip = X.CFB.read(new Uint8Array(array), { type: 'array' });
    const styles = new TextDecoder().decode(X.CFB.find(zip, '/xl/styles.xml').content);
    families.forEach(name => expect(styles).toContain(`<name val="${xmlText(name)}"/>`));
    const chartPath = zip.FullPaths.find(path => /\/xl\/charts\/[^/]+\.xml$/.test(path));
    expect(chartPath).toBeTruthy();
    const chart = new TextDecoder().decode(X.CFB.find(zip, chartPath).content);
    expect(chart).toContain('typeface="Gadugi"');
    expect(chart).toContain('typeface="Book Antiqua"');
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
    part.size = part.content.length;
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx');
  }
});

it('shows the imported family as the selected font in the toolbar and format dialog', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const wb = new Workbook(), runs = [], range = { r1: 0, r2: 0, c1: 0, c2: 0 };
  const style = { font: 'font:Gadugi' };
  const ctx = { wb, run: (...args) => runs.push(args), activeCell: () => null, style: () => style, active: () => ({ r: 0, c: 0 }),
    range: () => range, sheetId: () => wb.activeSheetId, grid: { editing: false }, subscribe: () => () => {} };
  const toolbar = createToolbar(ctx);
  document.body.append(toolbar.el);
  expect(toolbar.el.querySelector('.tb-font-label').textContent).toBe('Gadugi');
  toolbar.el.querySelector('.tb-font').click();
  const selected = document.querySelector('[role="menuitemradio"][aria-checked="true"]');
  expect(selected.querySelector('.menu-label').textContent).toBe('Gadugi');
  selected.click();
  expect(runs).toEqual([['font', 'font:Gadugi']]);
  const modal = openFormatCellsDialog(ctx, { panel: 'font' });
  const field = modal.panel.querySelector('[aria-label="Font"]');
  expect(field.value).toBe('font:Gadugi');
  expect(field.selectedOptions[0].textContent).toBe('Gadugi');
});

it('keeps unlisted fonts in native differential table styles', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Data', cells: { '0,0': { v: 'Item' }, '1,0': { v: 'A' } },
    tables: [{ name: 'Items', range: { r1: 0, r2: 1, c1: 0, c2: 0 }, style: 'custom',
      customStyle: { headerRow: { font: 'font:Book Antiqua', bold: true } } }] }] });
  const blob = await workbookToXlsx(wb);
  const array = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsArrayBuffer(blob); });
  const zip = X.CFB.read(new Uint8Array(array), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx');
  expect(back.activeSheet.tables[0].customStyle.headerRow.font).toBe('font:Book Antiqua');
});
