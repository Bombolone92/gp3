// @vitest-environment jsdom
import { stampClipboardHtml } from './helpers/clipboard.js';
import { expect, it, vi } from 'vitest';
import { parseHtmlClipboard } from '../src/core/clipboard.js';

it.each([0, 1])('refuses a span-expanded rectangle above the copy limit (rowspan=%s)', (rowspan) => {
  const html = `<table><tr><td colspan="1000" rowspan="${rowspan}">Value</td></tr>${'<tr></tr>'.repeat(200)}</table>`;
  const clone = vi.spyOn(Element.prototype, 'cloneNode');
  try {
    const parsed = parseHtmlClipboard(html);
    expect(parsed.error).toMatch(/too large.*200,000/i);
    expect(clone).not.toHaveBeenCalled();
    expect(parsed.rows).toBeUndefined();
  } finally { clone.mockRestore(); }
});

it('checks accumulated span widths before expanding the rest of a row', () => {
  const html = `<table><tr>${'<td colspan="1000" rowspan="0">Value</td>'.repeat(20)}</tr>${'<tr></tr>'.repeat(10)}</table>`;
  const clone = vi.spyOn(Element.prototype, 'cloneNode');
  try {
    const parsed = parseHtmlClipboard(html);
    expect(parsed.error).toMatch(/too large/i);
    expect(clone.mock.calls.length).toBeLessThan(20);
  } finally { clone.mockRestore(); }
});

it('accepts the boundary-sized table and retains span positions and styling', () => {
  const html = `<table><tr><td colspan="1000" rowspan="0" style="font-weight:bold">Value</td></tr>${'<tr></tr>'.repeat(199)}</table>`;
  const parsed = parseHtmlClipboard(html);
  expect(parsed.error).toBeUndefined();
  expect(parsed.rows).toHaveLength(200);
  expect(parsed.rows.every((row) => row.length === 1000)).toBe(true);
  expect(parsed.rows[0][0]).toEqual({ text: 'Value', style: { bold: true } });
  expect(parsed.rows[199][999]).toEqual({ text: '', style: undefined });
});

it.each([200, 201])('applies the same cell limit to embedded metadata with %s rows', (height) => {
  const cells = Array.from({ length: height }, () => Array(1000).fill(null));
  const parsed = parseHtmlClipboard(stampClipboardHtml(`<table data-spreadsheet-cells='${JSON.stringify(cells)}'><tr><td>Fallback</td></tr></table>`));
  if (height === 200) {
    expect(parsed.error).toBeUndefined();
    expect(parsed.cells).toHaveLength(200);
  } else expect(parsed.error).toMatch(/too large/i);
});
