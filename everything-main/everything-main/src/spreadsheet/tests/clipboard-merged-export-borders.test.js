// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { cellsToHtml, copyMergeLayout, parseHtmlClipboard } from '../src/core/clipboard.js';

const edge = (key, bs, bc) => ({ [key]: true, [`${key}Border`]: { bs, bc } });
const foreign = html => parseHtmlClipboard(html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, ''));
const first = html => new DOMParser().parseFromString(html, 'text/html').querySelector('td');
function block(height, width) {
  const cells = Array.from({ length: height }, () => Array.from({ length: width }, () => null));
  cells[0][0] = { v: 9, f: '3*3', s: { ...edge('bt', 'thin', '#123456'), ...edge('bl', 'dashed', '#654321'), bg: '#eeeecc' } };
  cells[height - 1][width - 1] = { v: null, s: { ...edge('bb', 'double', '#338855'), ...edge('br', 'medium', '#884477'), bg: '#ff0000', bold: true } };
  const texts = cells.map(row => row.map(cell => cell?.v == null ? '' : String(cell.v)));
  const rows = Array.from({ length: height }, (_, i) => i + 4), cols = Array.from({ length: width }, (_, i) => i + 2);
  const mergeLayout = copyMergeLayout([{ r1: rows[0], c1: cols[0], r2: rows.at(-1), c2: cols.at(-1) }], rows, cols);
  return { cells, texts, mergeLayout, html: options => cellsToHtml(texts, cells, null, null, null, { mergeLayout, ...options }) };
}

it.each([[3, 4], [1, 5], [4, 1]])('exports all four merged sides from the copied corners (%i by %i)', (height, width) => {
  const b = block(height, width), before = JSON.stringify(b.cells), html = b.html();
  const css = first(html).style;
  expect(css.borderTop).toBe('0.5pt solid rgb(18, 52, 86)');
  expect(css.borderLeft).toBe('0.5pt dashed rgb(101, 67, 33)');
  expect(css.borderBottom).toBe('1.5pt double rgb(51, 136, 85)');
  expect(css.borderRight).toBe('1pt solid rgb(136, 68, 119)');
  expect(css.backgroundColor).toBe('rgb(238, 238, 204)');
  expect(css.fontWeight).toBe(''); // covered-cell fonts/fills do not become the anchor's
  expect(parseHtmlClipboard(html).cells).toEqual(b.cells);
  expect(JSON.stringify(b.cells)).toBe(before);
  const parsed = foreign(html);
  expect(parsed.merges).toEqual(b.mergeLayout.ranges);
  for (let c = 0; c < width; c++) expect(parsed.rows[height - 1][c].style.bbBorder).toEqual({ bs: 'double', bc: '#338855' });
  for (let r = 0; r < height; r++) expect(parsed.rows[r][width - 1].style.brBorder).toEqual({ bs: 'medium', bc: '#884477' });
});

it.each([null, { s: { bb: false, br: false, bs: 'thick', bc: '#aa0000' } }])('does not stretch internal anchor sides over an absent opposite perimeter (%j)', corner => {
  const b = block(2, 3);
  Object.assign(b.cells[0][0].s, edge('bb', 'thick', '#123456'), edge('br', 'double', '#123456'));
  b.cells[1][2] = corner;
  const html = b.html(), td = first(html);
  expect(td.getAttribute('style')).toContain('border-bottom:none');
  expect(td.getAttribute('style')).toContain('border-right:none');
  expect(foreign(html).rows[1][2].style).toMatchObject({ bb: false, br: false });
  expect(parseHtmlClipboard(html).cells[0][0].s.bb).toBe(true);
});

it('uses effective corner styles and conditional border overrides without borrowing the anchor descriptor', () => {
  const b = block(2, 2);
  b.cells[0][0].s.bs = 'thick'; b.cells[0][0].s.bc = '#ff0000';
  const styles = [[], [null, { bb: true, br: true, bs: 'dotted', bc: '#334455' }]];
  const looks = [[], [null, { br: true, brBorder: { bs: 'double', bc: '#663399' }, bg: '#112233', bold: true }]];
  const before = JSON.stringify({ styles, looks, cells: b.cells });
  const html = cellsToHtml(b.texts, b.cells, looks, null, null, { mergeLayout: b.mergeLayout, styles });
  expect(foreign(html).rows[1][1].style).toMatchObject({ bbBorder: { bs: 'dotted', bc: '#334455' }, brBorder: { bs: 'double', bc: '#663399' } });
  expect(first(html).style.backgroundColor).toBe('rgb(238, 238, 204)');
  expect(JSON.stringify({ styles, looks, cells: b.cells })).toBe(before);
  styles[1][1] = { bb: true, br: true };
  const implicit = foreign(b.html({ styles })).rows[1][1].style;
  expect(implicit.bbBorder).toEqual({ bs: 'thin', bc: '#000000' });
  expect(implicit.brBorder).toEqual({ bs: 'thin', bc: '#000000' });
});

it('honors cleared conditional sides and retains private stored borders', () => {
  const b = block(2, 2), looks = [[], [null, { bb: false, br: false }]];
  const html = cellsToHtml(b.texts, b.cells, looks, null, null, { mergeLayout: b.mergeLayout });
  expect(foreign(html).rows[1][1].style).toMatchObject({ bb: false, br: false });
  expect(parseHtmlClipboard(html).cells).toEqual(b.cells);
});

it('uses compacted merge corners when hidden lines or partial selections omit original boundaries', () => {
  const b = block(2, 2);
  const merges = [{ r1: 4, c1: 2, r2: 10, c2: 8 }], rows = [5, 8], cols = [3, 7];
  const fromLines = cellsToHtml(b.texts, b.cells, null, null, null, { merges, rows, cols });
  const fromLayout = b.html({ mergeLayout: copyMergeLayout(merges, rows, cols) });
  expect(fromLines).toBe(fromLayout);
  expect(first(fromLines).getAttribute('rowspan')).toBe('2');
  expect(foreign(fromLines).rows[1][1].style.brBorder).toEqual({ bs: 'medium', bc: '#884477' });
});

it('uses screen border widths for a plain HTML table while retaining merged perimeter colors', () => {
  const b = block(3, 2), css = first(b.html({ clipboard: false })).style;
  expect(css.borderBottom).toBe('3px double rgb(51, 136, 85)');
  expect(css.borderRight).toBe('2px solid rgb(136, 68, 119)');
});
