// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { rowsFromHtml } from '../src/core/importrange.js';
import { parseInput } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';

const read = (html) => rowsFromHtml(html, 'table', 1, parseInput);

it('retains leading, middle, and trailing empty rows at the full table width', () => {
  expect(read('<table><tr></tr><tr><td>A</td></tr><tr></tr><tr><td>B</td><td>2</td></tr><tr></tr></table>'))
    .toEqual([[null, null], ['A', null], [null, null], ['B', 2], [null, null]]);
});

it('retains empty rows across sections without carrying spans into the next body', () => {
  const html = '<table><thead><tr></tr><tr><th>Heading</th></tr></thead>'
    + '<tbody><tr><td rowspan="0">A</td><td>1</td></tr><tr></tr></tbody>'
    + '<tbody><tr></tr><tr><td>B</td><td>2</td></tr><tr></tr></tbody></table>';
  expect(read(html)).toEqual([[null, null], ['Heading', null], ['A', 1], [null, null], [null, null], ['B', 2], [null, null]]);
});

it('reports no data for a table with no cells and retains explicit blank cells', () => {
  expect(read('<table><tr></tr><tr></tr></table>')).toEqual({ error: '#N/A' });
  expect(read('<table><tr></tr><tr><td></td></tr><tr></tr></table>')).toEqual([[null], [null], [null]]);
});

it.each(['first', 'last'])('counts empty rows toward the cell limit with a wide %s row', (position) => {
  const wide = '<tr><td colspan="1000">1</td></tr>';
  const markup = (height) => `<table>${position === 'first' ? wide : ''}${'<tr></tr>'.repeat(height - 1)}${position === 'last' ? wide : ''}</table>`;
  const accepted = read(markup(200));
  expect(accepted).toHaveLength(200);
  expect(accepted.every((row) => row.length === 1000)).toBe(true);
  expect(accepted[position === 'first' ? 0 : 199][0]).toBe(1);
  const parse = vi.fn(parseInput);
  expect(rowsFromHtml(markup(201), 'table', 1, parse)).toEqual({ error: '#NUM!' });
  expect(parse).not.toHaveBeenCalled();
});

it('keeps imported row addresses in spills and INDEX, and checks blank-row destinations', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const formula = 'IMPORTHTML("https://example.com/table", "table", 1)';
  wb.setAsyncProvider('IMPORTHTML', () => read('<table><tr></tr><tr><td>10</td></tr><tr></tr></table>'));
  wb.setInput(id, 0, 0, `=${formula}`);
  wb.setInput(id, 0, 3, `=INDEX(${formula},2,1)`);
  wb.getValue(id, 0, 0);
  await new Promise(setImmediate);
  expect(wb.rangeValues(id, { r1: 0, c1: 0, r2: 2, c2: 0 })).toEqual([[''], [10], ['']]);
  expect(wb.getValue(id, 0, 3)).toBe(10);
  expect(wb.spillRangeAt(id, 0, 0)).toEqual({ r1: 0, c1: 0, r2: 2, c2: 0 });
  wb.setInput(id, 0, 0, '');
  wb.setInput(id, 2, 0, 'Keep');
  wb.setInput(id, 0, 0, `=${formula}`);
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#SPILL!' });
  expect(wb.getValue(id, 2, 0)).toBe('Keep');
  wb.setInput(id, 2, 0, '');
  expect(wb.getValue(id, 1, 0)).toBe(10);
});
