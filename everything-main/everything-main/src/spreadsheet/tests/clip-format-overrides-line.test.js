// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { cellsToHtml, parseHtmlClipboard } from '../src/core/clipboard.js';

it('keeps No fill and Automatic text color when copying into another tab with formatted columns', () => {
  const wb = new Workbook(); const id = wb.activeSheetId;
  const range = { r1: 4, c1: 1, r2: 4, c2: 1 };
  wb.applyStyle(id, { r1: 0, c1: 1, r2: 99, c2: 1 }, { color: '#ff0000', bg: '#ffff00', bold: true });
  wb.setInput(id, 4, 1, 'Text');
  wb.applyStyle(id, range, { color: null, bg: null, bold: null });
  const html = cellsToHtml([['Text']], wb.copyRange(id, range));
  const td = new DOMParser().parseFromString(html, 'text/html').querySelector('td');
  expect(td.style.color).toBe('');
  expect(td.style.backgroundColor).toBe('');
  expect(td.style.fontWeight).toBe('normal');

  const other = new Workbook(); const oid = other.activeSheetId;
  other.applyStyle(oid, { r1: 0, c1: 1, r2: 99, c2: 1 }, { color: '#00ff00', bg: '#ff00ff', bold: true });
  other.pasteCells(oid, parseHtmlClipboard(html).cells, 4, 1);
  expect(other.getValue(oid, 4, 1)).toBe('Text');
  for (const key of ['color', 'bg', 'bold']) expect(other.styleAt(oid, 4, 1)?.[key], key).toBeFalsy();
  expect(other.styleAt(oid, 5, 1)).toMatchObject({ color: '#00ff00', bg: '#ff00ff', bold: true });
});
