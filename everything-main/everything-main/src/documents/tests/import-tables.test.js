// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { normalizeTables } from '../src/lib/import-tables.js';
import { htmlBody } from '../src/lib/importers.js';

const normalized = (html) => { const doc = new DOMParser().parseFromString(html, 'text/html'); normalizeTables(doc.body); return doc.body.innerHTML; };
const grid = (html) => { const doc = new DOMParser().parseFromString(html, 'text/html'); return [...doc.querySelectorAll('tr')].map((row) => [...row.children].map((cell) => `${cell.textContent}${cell.getAttribute('colspan') ? `x${cell.getAttribute('colspan')}` : ''}`)); };

describe('tables the converter refuses', () => {
  it('pads the rows under a row-spanning cell with empty cells so the grid stays rectangular', () => {
    const out = normalized('<table><tr><td rowspan="2">r</td><td>1</td></tr><tr><td>2</td></tr></table>');
    expect(out).not.toContain('rowspan');
    expect(grid(out)).toEqual([['r', '1'], ['', '2']]);
  });

  it('places the padding at the spanned column, minding column spans and spans that start mid-row', () => {
    const out = normalized('<table><tr><th>A</th><th colspan="2" rowspan="2">B</th><th>C</th></tr><tr><td>a</td><td rowspan="3">c</td></tr><tr><td>x</td><td>y</td><td>z</td></tr><tr><td>p</td><td>q</td><td>r</td></tr></table>');
    expect(grid(out)).toEqual([['A', 'Bx2', 'C'], ['a', 'x2', 'c'], ['x', 'y', 'z', ''], ['p', 'q', 'r', '']]);
    // A header row's padding is a header cell too.
    expect([...new DOMParser().parseFromString(out, 'text/html').querySelectorAll('tr')][1].children[1].tagName).toBe('TD');
  });

  it('pads a row shorter than the grid under a spanning cell, and does not carry the span into a later row', () => {
    const out = normalized('<table><tr><td>A</td><td>B</td><td rowspan="2">C</td></tr><tr><td>D</td></tr><tr><td>E</td><td>F</td><td>G</td></tr></table>');
    expect(grid(out)).toEqual([['A', 'B', 'C'], ['D', ''], ['E', 'F', 'G']]);
  });

  it('spans to the end of the table for rowspan="0" and ignores a nonsense value', () => {
    expect(grid(normalized('<table><tr><td rowspan="0">r</td><td>1</td></tr><tr><td>2</td></tr><tr><td>3</td></tr></table>'))).toEqual([['r', '1'], ['', '2'], ['', '3']]);
    expect(grid(normalized('<table><tr><td rowspan="abc">r</td><td>1</td></tr><tr><td>2</td><td>3</td></tr></table>'))).toEqual([['r', '1'], ['2', '3']]);
  });

  it('unwraps a single-cell layout box around a table into its content, and leaves a lone single-cell table as it is', () => {
    expect(normalized('<table><tr><td><p>One</p><table><tr><td>a</td><td>b</td></tr></table></td></tr></table>')).toBe('<p>One</p><table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>');
    expect(normalized('<table><tr><td>Text <table><tr><td>a</td><td>b</td></tr></table></td></tr></table>')).toBe('Text <table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>');
    // A box around a box around a real table: only the real table is left.
    expect(grid(normalized('<table><tr><td><table><tr><td><table><tr><td>a</td><td>b</td></tr></table></td></tr></table></td></tr></table>'))).toEqual([['a', 'b']]);
    // A note box with nothing but text stays a table.
    const note = '<table><tr><td><p>Note</p></td></tr></table>';
    expect(normalized(note)).toBe(new DOMParser().parseFromString(note, 'text/html').body.innerHTML);
  });

  it('turns a table inside a cell into paragraphs of cells separated by a bar', () => {
    const out = normalized('<table><tr><td>a<table><tr><td>i1</td><td>i2</td></tr><tr><td>j1</td><td>j2</td></tr></table>b</td><td>c</td></tr></table>');
    expect(out).toBe('<table><tbody><tr><td>a<p>i1 | i2</p><p>j1 | j2</p>b</td><td>c</td></tr></tbody></table>');
  });

  it('leaves an ordinary table, including column spans, untouched', () => {
    const html = '<table><tr><th colspan="2">Head</th></tr><tr><td>a</td><td>b</td></tr></table>';
    expect(normalized(html)).toBe(new DOMParser().parseFromString(html, 'text/html').body.innerHTML);
  });

  it('runs as part of preparing an HTML page for import', () => {
    expect(htmlBody('<html><body><table><tr><td rowspan="2">r</td><td>1</td></tr><tr><td>2</td></tr></table></body></html>')).not.toContain('rowspan');
  });
});
