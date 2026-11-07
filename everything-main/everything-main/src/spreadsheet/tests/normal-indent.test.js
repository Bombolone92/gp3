import { expect, it, vi } from 'vitest';
import { normalIndentUnit, normalFontCss } from '../src/core/normal-font.js';
import { indentWidth } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { sheetToHtml, workbookToXlsx, workbookFromFile } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

// Measured from Excel for Mac PDFs at 100%: subtract actual native column widths from
// consecutive X origins. Cell fonts/sizes change independently of Normal.
it.each([
  ['Courier New', 12, 28], ['Arial', 6, 8], ['Open Sans', 11, 12],
  ['Arial', 1, 4 / 3], ['Arial', 2, 4], ['Arial', 8, 8],
  ['Arial', 8.4, 8], ['Arial', 8.5, 12], ['Arial', 8.6, 12],
  ['Arial', 9, 12], ['Arial', 10, 12], ['Arial', 12, 12],
  ['Arial', 16.4, 16], ['Arial', 16.5, 20], ['Arial', 18, 20],
])('matches native Normal-font indentation: %s %spt', (name, sz, unit) => {
  for (const bold of [false, true]) for (const italic of [false, true]) {
    const measure = vi.fn(() => 999);
    expect(normalIndentUnit({ name, sz, bold, italic }, measure)).toBe(unit);
    expect(measure).not.toHaveBeenCalled();
    for (const indent of [0, 1, 3, 17, 250]) {
      expect(indentWidth('X', { font: 'georgia', size: 90, indent }, unit)).toBe(indent * unit);
      expect(indentWidth(12, { font: 'arial', size: 8, indent }, unit)).toBe(indent * unit);
      expect(indentWidth('X', { align: 'center', indent }, unit)).toBe(0);
      expect(indentWidth(true, { indent }, unit)).toBe(0);
    }
  }
});

it('uses the full Normal face when measuring an arbitrary font, with stable units before zoom', () => {
  const font = { name: 'A "quoted" family', sz: 18, bold: true, italic: true };
  const measure = vi.fn(() => 8);
  expect(normalFontCss(font)).toContain('italic 600 24px "A \\"quoted\\" family"');
  expect(normalIndentUnit(font, measure)).toBe(24);
  expect(measure).toHaveBeenCalledWith(' ', normalFontCss(font));
  expect(normalIndentUnit(font, () => 8.8)).toBe(28);
  expect(normalIndentUnit(font, () => 0)).toBe(4 / 3);
  normalIndentUnit({ ...font, sz: 18.5 }, measure);
  expect(measure).toHaveBeenLastCalledWith(' ', normalFontCss({ ...font, sz: 19 }));
});

it('handles size changes, invalid measurements and missing Normal metadata without changing logical styles', () => {
  expect(normalIndentUnit(null)).toBe(12);
  expect(normalIndentUnit({ name: 'Arial', sz: NaN })).toBe(12);
  expect(normalIndentUnit({ name: 'ARIAL', sz: 18 })).toBe(20);
  expect(normalIndentUnit({ name: 'Arial', sz: 1 })).toBe(4 / 3);
  for (const bad of [NaN, Infinity, -1]) {
    expect(normalIndentUnit({ name: 'Unavailable', sz: 18 }, () => bad)).toBe(normalIndentUnit({ name: 'Arial', sz: 18 }));
  }
});

it.each(['Arial', 'Courier New', 'Open Sans'])('retains Normal-based indents through edited native XLSX and headless HTML: %s', async name => {
  const wb = new Workbook({ normalFont: { name, sz: 18 }, sheets: [{ cells: {
    '0,0': { v: 'Left', s: { font: 'arial', size: 11, indent: 2 } },
    '0,1': { v: 17, s: { font: 'georgia', indent: 3 } },
  } }] });
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Edited');
  const unit = normalIndentUnit(wb.normalFont);
  const html = sheetToHtml(wb, id);
  expect(html).toContain(`padding-left:${2 * unit + 2}px`);
  expect(html).toContain(`padding-right:${3 * unit + 2}px`);
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  const reopened = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
  expect(reopened.normalFont).toMatchObject({ name, sz: 18 });
  expect(reopened.getValue(reopened.activeSheetId, 0, 0)).toBe('Edited');
  expect([0, 1].map(c => reopened.styleAt(reopened.activeSheetId, 0, c).indent)).toEqual([2, 3]);
  expect(normalIndentUnit(reopened.normalFont)).toBe(unit);
});
