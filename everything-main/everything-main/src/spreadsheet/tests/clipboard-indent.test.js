// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { cellsToHtml, cellsFromHtmlRows, parseHtmlClipboard } from '../src/core/clipboard.js';

const pasted = html => cellsFromHtmlRows(parseHtmlClipboard(html).rows).map(x => x.cell);

it('preserves aligned indentation in external HTML while retaining ordinary cell padding', () => {
  const values = ['Address', 25, 'Centered', 'שלום', true];
  const cells = values.map((v, i) => ({ v, s: { indent: 2, ...(i === 2 ? { align: 'center' } : {}) } }));
  const html = cellsToHtml([values.map(String)], [cells], null, [values]).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  const doc = new DOMParser().parseFromString(html, 'text/html'), tds = doc.querySelectorAll('td');
  expect(tds[0].style.paddingLeft).toBe('26px');
  expect(tds[1].style.paddingRight).toBe('26px');
  expect(tds[2].style.paddingLeft).toBe('');
  expect(tds[3].style.paddingRight).toBe('26px');
  expect(tds[4].style.paddingLeft).toBe('');
  const back = pasted(html);
  expect(back[0].s.indent).toBe(2);
  expect(back[1].s).toMatchObject({ align: 'right', indent: 2 });
  expect(back[2].s.indent).toBeUndefined();
  expect(back[3].s).toMatchObject({ align: 'right', indent: 2 });
  expect(back[4].s.indent).toBeUndefined();
});

it('uses Excel indent counts before CSS padding, and bounds plain HTML indentation', () => {
  const html = '<style>.xl1 {padding-left:45px;mso-char-indent-count:5}</style><table><tr>'
    + '<td class="xl1">Excel</td><td style="padding-left:18pt">HTML</td>'
    + '<td style="padding-left:4px">Ordinary</td><td style="mso-char-indent-count:251;padding-left:36px">Invalid</td>'
    + '<td style="mso-char-indent-count:0;padding-left:36px">Reset</td></tr></table>';
  expect(pasted(html).map(cell => cell.s?.indent)).toEqual([5, 2, undefined, undefined, 0]);
});
