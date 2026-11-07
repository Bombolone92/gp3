// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { cellsToHtml, parseHtmlClipboard } from '../src/core/clipboard.js';

// Excel for Mac loses fills from otherwise identical HTML without these
// boundaries. They delimit the complete table, as the HTML clipboard format
// specifies; the browser owns any native byte-offset header.
const fragment = html => {
  expect(html.match(/<!--StartFragment-->/g)).toHaveLength(1);
  expect(html.match(/<!--EndFragment-->/g)).toHaveLength(1);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  expect(doc.documentElement.getAttribute('xmlns:x')).toBe('urn:schemas-microsoft-com:office:excel');
  const start = html.indexOf('<!--StartFragment-->') + '<!--StartFragment-->'.length;
  const body = html.slice(start, html.indexOf('<!--EndFragment-->'));
  expect(body.startsWith('<table')).toBe(true);
  expect(body.endsWith('</table>')).toBe(true);
  return body;
};

it('bounds all rows, merged spans, typed values and private metadata in one clipboard fragment', () => {
  const cells = [[{ v: 'Résumé 🟢', s: { bg: '#aabbcc' } }, null],
    [{ v: 1.25, s: { bg: '#ffffff', fmt: 'number', dec: 2 } }, { f: 'A2*2' }]];
  const values = [['Résumé 🟢', null], [1.25, 2.5]];
  const html = cellsToHtml([['Résumé 🟢', ''], ['1.25', '2.5']], cells, null, values, { r: 0, c: 0 },
    { merges: [{ r1: 0, c1: 0, r2: 0, c2: 1 }], rows: [0, 1], cols: [0, 1] });
  const body = fragment(html), doc = new DOMParser().parseFromString(body, 'text/html');
  expect(doc.querySelectorAll('table')).toHaveLength(1);
  expect(doc.querySelectorAll('tr')).toHaveLength(2);
  expect(doc.querySelector('td').colSpan).toBe(2);
  expect(doc.querySelector('td').style.backgroundColor).toBe('rgb(170, 187, 204)');
  expect(parseHtmlClipboard(html).cells).toEqual(cells);
  expect(parseHtmlClipboard(body).values).toEqual(values);
  expect(parseHtmlClipboard(body).origin).toEqual({ r: 0, c: 0 });
});

it('keeps apparent fills and unfilled cells within the same externally readable fragment', () => {
  const cells = [[{ v: 'Inherited' }, { v: 'Rule' }, { v: 'Clear', s: { bg: null } }]];
  const html = cellsToHtml([['Inherited', 'Rule', 'Clear']], cells, [[null, { bg: '#ffeecc' }, null]], null, null,
    { styles: [[{ bg: '#123456' }, { bg: '#654321' }, { bg: null }]] });
  const body = fragment(html), doc = new DOMParser().parseFromString(body, 'text/html');
  for (const attr of [...doc.querySelector('table').attributes]) doc.querySelector('table').removeAttribute(attr.name);
  const back = parseHtmlClipboard(doc.body.innerHTML);
  expect(back.rows[0].map(cell => cell.style?.bg ?? null)).toEqual(['#123456', '#ffeecc', null]);
  expect(parseHtmlClipboard(html).cells).toEqual(cells);
});

it('escapes marker-like cell text so it cannot truncate the clipboard fragment', () => {
  const value = '<!--EndFragment-->雪<!--StartFragment-->';
  const html = cellsToHtml([[value]], [[{ v: value }]]);
  const doc = new DOMParser().parseFromString(fragment(html), 'text/html');
  expect(doc.querySelector('td').textContent).toBe(value);
  expect(parseHtmlClipboard(html).cells[0][0].v).toBe(value);
});

it('exports the default no-wrap behavior alongside explicit wrapping without changing private styles', () => {
  const cells = [[{ v: 'Default' }, { v: 'Styled', s: { bg: '#fedcba' } },
    { v: 'Explicit', s: { wrap: false } }, { v: 'Two\nlines', s: { wrap: true } }, null]];
  const html = cellsToHtml([['Default', 'Styled', 'Explicit', 'Two\nlines', '']], cells);
  const doc = new DOMParser().parseFromString(fragment(html), 'text/html');
  expect([...doc.querySelectorAll('td')].map(td => td.style.whiteSpace)).toEqual(['nowrap', 'nowrap', 'nowrap', 'pre-wrap', 'nowrap']);
  expect(parseHtmlClipboard(html).cells).toEqual(cells);
  for (const attr of [...doc.querySelector('table').attributes]) doc.querySelector('table').removeAttribute(attr.name);
  expect(parseHtmlClipboard(doc.body.innerHTML).rows[0].map(cell => cell.style?.wrap)).toEqual([false, false, false, true, false]);
});

it('leaves plain HTML export boundaries and unspecified wrapping to the surrounding page', () => {
  const html = cellsToHtml([['Default', 'Wrapped', 'Explicit']],
    [[{ v: 'Default' }, { v: 'Wrapped', s: { wrap: true } }, { v: 'Explicit', s: { wrap: false } }]],
    null, null, null, { clipboard: false });
  expect(html.startsWith('<table')).toBe(true);
  expect(html).not.toContain('<!--StartFragment-->');
  expect(html).not.toContain('<!--EndFragment-->');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  expect([...doc.querySelectorAll('td')].map(td => td.style.whiteSpace)).toEqual(['', 'pre-wrap', 'nowrap']);
});
