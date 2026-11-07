// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { normalizeNativeFill, nativeFillOverridesNormal } from '../src/core/native-fill.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
it('reads native automatic No fill as a complete clear despite global td shading', () => {
  const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><style>
    td { background: #bbddee; } .none { mso-background-source: auto; mso-pattern: auto; }
    .white { background: white; mso-pattern: black none; }
    </style><table><tr><td class="none" x:str>Clear</td><td class="white" x:str>White</td><td x:str>Default</td></tr></table></html>`;
  const parsed = parseHtmlClipboard(html), cells = cellsFromHtmlRows(parsed.rows).map(({ cell }) => cell);
  expect(cells.map(cell => cell.s.bg)).toEqual([null, '#ffffff', '#bbddee']);
  const target = new Workbook({ normalStyle: { bg: '#bbddee' } });
  target.pasteCells(target.activeSheetId, [cells], 0, 0);
  expect(target.styleAt(target.activeSheetId, 0, 0).bg).toBeNull();
  expect(target.styleAt(target.activeSheetId, 0, 1).bg).toBe('#ffffff');
});

it('writes public No fill hints while keeping private clear bindings intact', () => {
  const nativeFill = normalizeNativeFill({ key: 'none', xml: `<fill xmlns="${MAIN}"><patternFill patternType="none"/></fill>` });
  const html = cellsToHtml([['Clear', 'White']], [[{ v: 'Clear', s: { bg: null, nativeFill } }, { v: 'White', s: { bg: '#ffffff' } }]]);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  expect(doc.querySelector('td').getAttribute('style')).toContain('mso-pattern:auto');
  expect(parseHtmlClipboard(html).cells[0][0].s.nativeFill.key).toBe('none');
  for (const element of doc.querySelectorAll('*')) for (const attr of [...element.attributes]) {
    if (attr.name.startsWith('data-spreadsheet')) element.removeAttribute(attr.name);
  }
  const publicRows = parseHtmlClipboard(doc.documentElement.outerHTML).rows;
  expect(publicRows[0][0].style.bg).toBeNull();
  expect(publicRows[0][1].style.bg).toBe('#ffffff');
});

it('compares table fill bindings with Normal, including No fill and edited paint', () => {
  const normal = normalizeNativeFill({ key: 'normal', xml: `<fill xmlns="${MAIN}"><patternFill patternType="solid"><fgColor rgb="FFBBDDEE"/></patternFill></fill>` });
  const none = normalizeNativeFill({ key: 'none', xml: `<fill xmlns="${MAIN}"><patternFill patternType="none"/></fill>` });
  expect(nativeFillOverridesNormal({ bg: normal.paint, nativeFill: normal }, normal)).toBe(false);
  expect(nativeFillOverridesNormal({ bg: null, nativeFill: none }, normal)).toBe(true);
  expect(nativeFillOverridesNormal({ bg: null, nativeFill: null }, normal)).toBe(true);
  expect(nativeFillOverridesNormal({ bg: '#ffffff', nativeFill: normal }, normal)).toBe(true);
  expect(nativeFillOverridesNormal({ bg: null, nativeFill: none }, none)).toBe(false);
  const duplicate = normalizeNativeFill({ ...none, key: 'duplicate' });
  expect(nativeFillOverridesNormal({ bg: null, nativeFill: duplicate }, none)).toBe(true);
});
it('interns clipboard definitions and preserves a shared resource through internal paste', () => {
  const nativeFill = normalizeNativeFill({ key: 'same', xml: `<fill xmlns="${MAIN}"><patternFill patternType="solid"><fgColor theme="4"/></patternFill></fill>` });
  const wb = new Workbook({ sheets: [{ cells: { '0,0': { v: 'One', s: { bg: nativeFill.paint, nativeFill } }, '0,1': { v: 'Two', s: { bg: nativeFill.paint, nativeFill } } } }] });
  const cells = wb.copyCells(wb.activeSheetId, [0], [0, 1]);
  const html = cellsToHtml([['One', 'Two']], cells);
  expect((html.match(/&lt;fill xmlns=/g) || []).length).toBe(1);
  const parsed = parseHtmlClipboard(html);
  expect(parsed.cells[0][0].s.nativeFill).toBe(parsed.cells[0][1].s.nativeFill);
  const target = new Workbook(); target.pasteCells(target.activeSheetId, parsed.cells, 3, 4);
  expect(target.getCell(target.activeSheetId, 3, 4).s.nativeFill.key).toBe('same');
  expect(html).toContain('background-color:#4f81bd');
});

it.each(['dangling', 'conflicting', 'malformed'])('falls back to visible public HTML when a resource definition is %s', problem => {
  const nativeFill = normalizeNativeFill({ key: 'same', xml: `<fill xmlns="${MAIN}"><patternFill patternType="solid"><fgColor rgb="FF123456"/></patternFill></fill>` });
  const html = cellsToHtml([['Visible']], [[{ v: 'Visible', s: { bg: nativeFill.paint, nativeFill } }]]);
  const doc = new DOMParser().parseFromString(html, 'text/html'), table = doc.querySelector('table');
  const records = JSON.parse(table.getAttribute('data-spreadsheet-fills'));
  if (problem === 'dangling') delete records.same;
  if (problem === 'conflicting') records.same.key = 'different';
  if (problem === 'malformed') records.same.xml = '<fill xmlns="urn:wrong"/>';
  table.setAttribute('data-spreadsheet-fills', JSON.stringify(records));
  const parsed = parseHtmlClipboard(doc.body.innerHTML);
  expect(parsed.cells).toBeUndefined();
  expect(parsed.rows[0][0].text).toBe('Visible');
  expect(parsed.rows[0][0].style.bg).toBe('#123456');
  expect(parsed.rows[0][0].style.nativeFill).toBeUndefined();
});
