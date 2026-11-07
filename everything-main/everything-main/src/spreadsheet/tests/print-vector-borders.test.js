// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { collapsePrintBorders, paintPrintBorders } from '../src/ui/print-borders.js';
import { Workbook } from '../src/core/workbook.js';
import { buildPrintTable } from '../src/ui/print.js';
import { parseRange } from '../src/core/cell.js';
import { parseRules, stylesheet } from './helpers/css.js';

afterEach(() => { document.head.replaceChildren(); document.body.replaceChildren(); vi.restoreAllMocks(); });
const edge = (patch = {}) => ({ axis: 'h', at: 30, start: 0, end: 100, width: 1, style: 'solid', color: 'red', explicit: true, order: 0, ...patch });

it.each([
  [{ width: 2 }, { width: 1 }, 'red'],
  [{ width: 1 }, { width: 3 }, 'blue'],
  [{ width: 3, style: 'double' }, { width: 3 }, 'red'],
  [{ style: 'dashed' }, { style: 'solid' }, 'blue'],
  [{ style: 'dotted' }, { style: 'dashed' }, 'blue'],
  [{}, {}, 'blue'],
  [{ explicit: false, width: 3 }, { width: 1 }, 'blue'],
])('resolves shared rules by explicitness, weight, style and lower/right ownership (%j, %j)', (a, b, color) => {
  for (const axis of ['h', 'v']) {
    const edges = [edge({ ...a, axis }), edge({ color: 'blue', order: 1, ...b, axis })];
    expect(collapsePrintBorders(edges)).toHaveLength(1);
    expect(collapsePrintBorders(edges.reverse())[0].color).toBe(color);
  }
});

it('splits a merged side against independently styled neighboring cells without bridging gaps', () => {
  const result = collapsePrintBorders([edge({ end: 270 }), edge({ start: 75, end: 160, width: 2, color: 'blue' }),
    edge({ start: 300, end: 320 }), edge({ start: 320, end: 320 }), edge({ width: 0 })]);
  expect(result.map(e => [e.start, e.end, e.color]).sort((a,b) => a[0]-b[0])).toEqual([
    [0,75,'red'], [75,160,'blue'], [160,270,'red'], [300,320,'red'],
  ]);
});

function measured(scale = 1) {
  const style = document.createElement('style');
  style.textContent = parseRules(stylesheet('editor.css')).filter(r => r.selectors.some(s => s.startsWith('.print-')))
    .map(r => `${r.selectors.join(',')} {${r.body}}`).join('\n');
  document.head.append(style);
  const wb = new Workbook({ sheets: [{ cells: Object.fromEntries(['thin','medium','thick','dashed','dotted','double'].map((bs,r) =>
    [`${r},0`, { v: bs, s: { bb: true, bbBorder: { bs, bc: '#2468ac' } } }])) }] });
  const table = buildPrintTable(wb, wb.activeSheetId, { range: parseRange('A1:A6'), gridlines: false });
  const sheet = document.createElement('div'); sheet.className = 'print-sheet'; sheet.style.zoom = String(scale); sheet.append(table);
  document.body.append(sheet);
  const rect = (node, x, y, w, h) => vi.spyOn(node, 'getBoundingClientRect').mockReturnValue(new DOMRect(37+x*scale, 19+y*scale, w*scale, h*scale));
  rect(sheet, 0, 0, 140, 180); rect(table, 0, 0, 140, 180);
  [...table.rows].forEach((row,r) => rect(row.cells[0], 0, r*30, 140, 30));
  return { wb, table, sheet, rect };
}

it.each([1, .75, .5, .1, 2.25])('preserves physical weights, colors and double gaps at scale %s', scale => {
  const { wb, table, sheet } = measured(scale), before = JSON.stringify(wb.toJSON());
  paintPrintBorders(sheet);
  const svg = sheet.querySelector('.print-cell-borders');
  expect(svg.getAttribute('viewBox')).toBe('-2 -2 144 184');
  expect(svg.style.overflow).toBe('hidden');
  const paths = [...svg.children].filter(n => n.tagName === 'path');
  expect(paths).toHaveLength(6);
  expect(paths.map(n => +n.getAttribute('stroke-width')).sort((a,b) => a-b)).toEqual([4/3,4/3,4/3,8/3,4,4]);
  expect(paths.every(n => n.getAttribute('stroke') === 'rgb(36, 104, 172)')).toBe(true);
  const double = paths.find(n => n.hasAttribute('mask'));
  expect(double.getAttribute('d')).toBe('M0 180H140');
  expect(svg.querySelector('mask path').getAttribute('stroke-width')).toBe(String(4/3));
  expect(paths.filter(n => n.hasAttribute('stroke-dasharray')).map(n => n.getAttribute('stroke-dasharray')))
    .toEqual([`${4/3} ${4/3}`, `4 ${4/3}`]);
  expect(getComputedStyle(table.rows[0].cells[0]).borderBottomColor).toBe('rgba(0, 0, 0, 0)');
  expect(svg.getAttribute('aria-hidden')).toBe('true');
  expect(svg.style.pointerEvents).toBe('none');
  paintPrintBorders(sheet);
  expect(sheet.querySelectorAll('.print-cell-borders')).toHaveLength(1);
  expect(JSON.stringify(wb.toJSON())).toBe(before);
});

it('clips page content independently while retaining complete strokes at fragment boundaries', () => {
  const { table, sheet, rect } = measured(.5);
  const clip = document.createElement('div'); clip.className = 'print-page-clip'; sheet.replaceWith(clip); clip.append(sheet);
  // Last three rows and a horizontally crossing cell. No artificial border
  // is invented at the left/right cut, and the bottom double stays complete.
  rect(clip, 20, 90, 100, 90);
  const object = document.createElement('div'); object.className = 'print-object'; sheet.append(object);
  rect(object, 10, 100, 60, 100);
  paintPrintBorders(sheet);
  const svg = sheet.querySelector('svg');
  expect(svg.getAttribute('viewBox')).toBe('18 88 104 94');
  expect(svg.getAttribute('height')).toBe('94');
  const d = [...svg.querySelectorAll('path')].map(p => p.getAttribute('d')).join('');
  expect(d).not.toMatch(/M20 (30|60)H/);
  expect(d).toContain('M20 180H120');
  expect(d).not.toContain('V');
  expect(clip.style.overflow).toBe('clip');
  expect(clip.style.contain).toBe('strict');
  expect(clip.style.overflowClipMargin).toBe('1px');
  expect(table.style.clipPath).toBe('inset(90px 20px 0px 20px)');
  expect(object.style.clipPath).toBe('inset(-10px -50px 20px 10px)');
  expect(svg.nextElementSibling).toBe(object);
});

it('does not paint unmeasured, borderless, or fully clipped tables', () => {
  const { table, sheet, rect } = measured();
  table.classList.remove('has-print-borders'); paintPrintBorders(sheet);
  expect(sheet.querySelector('svg')).toBeNull();
  table.classList.add('has-print-borders');
  table.getBoundingClientRect.mockReturnValue(new DOMRect()); paintPrintBorders(sheet);
  expect(sheet.querySelector('svg')).toBeNull();
  table.getBoundingClientRect.mockRestore(); rect(table, 0, 0, 140, 180);
  const clip = document.createElement('div'); clip.className = 'print-page-clip'; sheet.replaceWith(clip); clip.append(sheet);
  rect(clip, 0, 200, 140, 40); paintPrintBorders(sheet);
  expect(sheet.querySelector('svg')).toBeNull();
});

it('contains fractional border overflow within its allocated page while allowing oversized line margins', () => {
  const { sheet } = measured(.5);
  const page = document.createElement('div'); page.className = 'print-page';
  sheet.replaceWith(page); page.append(sheet);
  expect(getComputedStyle(page).overflow).toBe('clip');
  expect(getComputedStyle(page).overflowClipMargin).toBe('');
  page.classList.add('print-page-overflow');
  expect(getComputedStyle(page).overflow).toBe('clip');
  expect(getComputedStyle(page).overflowClipMargin).toBe('var(--print-overflow-margin, 0px)');
});
