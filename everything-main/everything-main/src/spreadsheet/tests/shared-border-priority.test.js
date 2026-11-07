// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { createGrid } from '../src/ui/grid.js';
import { buildPrintTable } from '../src/ui/print.js';
import { cellPrintBorders } from '../src/ui/print-borders.js';
import { createBorderResolver } from '../src/core/shared-borders.js';

let grid;
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 500 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: t => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = () => {};
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
});
afterEach(() => { grid?.destroy(); grid = null; vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
const box = (r, c) => ({ r1: r, c1: c, r2: r, c2: c });
const style = (side, bs, bc) => ({ [side]: !!bs, [`${side}Border`]: bs ? { bs, bc } : null });
const red = '#ff0000', blue = '#0000ff';
async function mount(wb) {
  grid = createGrid({ wb, sheetId: wb.activeSheetId, announce() {} }); document.body.append(grid.el);
  await new Promise(resolve => setTimeout(resolve, 5));
  return (r, c) => grid.el.querySelector(`#gc-${r}-${c}`);
}
// The cases cover all 36 pairs on each axis.
const priority = ['dotted', 'dashed', 'thin', 'medium', 'thick', 'double'];
it.each(priority.flatMap(a => priority.map(b => [a, b])))('resolves %s / %s identically on screen and print, on both axes', async (a, b) => {
  const wb = new Workbook(), id = wb.activeSheetId;
  const entries = [
    { r: 0, c: 0, cell: { v: 'left', s: style('br', a, red) } },
    { r: 0, c: 1, cell: { v: 'right', s: style('bl', b, blue) } },
    { r: 2, c: 0, cell: { v: 'above', s: style('bb', a, red) } },
    { r: 3, c: 0, cell: { v: 'below', s: style('bt', b, blue) } },
  ];
  wb.setCells(id, entries); const node = await mount(wb), before = wb.toJSON();
  const later = priority.indexOf(b) >= priority.indexOf(a);
  for (const [r, c, side, winner] of [[0, 0, 'br', !later], [0, 1, 'bl', later], [2, 0, 'bb', !later], [3, 0, 'bt', later]]) {
    expect(node(r, c).classList.contains(side), `${r},${c} ${side}`).toBe(winner);
  }
  const printed = buildPrintTable(wb, id, { fit: 'actual', range: { r1: 0, c1: 0, r2: 3, c2: 1 } });
  for (const [r, c, side, winner] of [[0, 0, 'Right', !later], [0, 1, 'Left', later], [2, 0, 'Bottom', !later], [3, 0, 'Top', later]]) {
    expect(!!printed.rows[r].cells[c].style[`border${side}Width`]).toBe(winner);
  }
  expect(wb.toJSON()).toEqual(before);
});

it.each([
  ['thick', 'thin', false, true, 'right'], ['thin', 'thick', true, false, 'left'],
  ['thick', null, false, true, null], [null, 'thick', true, false, null],
  ['thin', 'thick', true, true, 'right'], ['thick', 'thin', true, true, 'left'],
  [null, 'thin', true, true, 'right'], ['thin', null, true, true, 'left'],
  ['thin', 'thin', true, true, 'right'],
])('resolves ordinary/conditional borders and clears (%j)', async (a, b, leftRule, rightRule, winner) => {
  const wb = new Workbook(), id = wb.activeSheetId;
  for (const [c, side, bs, bc, rule] of [[0, 'br', a, red, leftRule], [1, 'bl', b, blue, rightRule]]) {
    const s = style(side, bs, bc);
    wb.setCells(id, [{ r: 1, c, cell: { v: c + 1, s: rule ? undefined : s } }]);
    if (rule) wb.addRule(id, { type: 'formula', value: 'TRUE', range: box(1, c), style: s });
  }
  const node = await mount(wb);
  expect(node(1, 0).classList.contains('br')).toBe(winner === 'left');
  expect(node(1, 1).classList.contains('bl')).toBe(winner === 'right');
  const printed = buildPrintTable(wb, id, { fit: 'actual', range: { r1: 1, c1: 0, r2: 1, c2: 1 } });
  expect(!!printed.rows[0].cells[0].style.borderRightWidth).toBe(winner === 'left');
  expect(!!printed.rows[0].cells[1].style.borderLeftWidth).toBe(winner === 'right');
});

it('recalculates conditional edge ownership after an edit and undo', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setCells(id, [{ r: 0, c: 0, cell: { v: 1, s: style('br', 'thick', red) } }, { r: 0, c: 1, cell: { v: 0 } }]);
  wb.addRule(id, { type: 'formula', value: 'B1>0', range: box(0, 1), style: style('bl', 'thin', blue) });
  const node = await mount(wb); expect(node(0, 0).classList.contains('br')).toBe(true);
  wb.setInput(id, 0, 1, '1'); await new Promise(resolve => setTimeout(resolve, 5));
  expect(node(0, 0).classList.contains('br')).toBe(false); expect(node(0, 1).classList.contains('bl')).toBe(true);
  wb.undo(); await new Promise(resolve => setTimeout(resolve, 5)); expect(node(0, 0).classList.contains('br')).toBe(true);
});

it('keeps border lookup lazy and reuses queried neighbors without reading a merged interior', () => {
  const read = vi.fn(() => ({ style: style('bl', 'thick', blue) }));
  const resolve = createBorderResolver({ read, neighbor: (r, c) => [r, c + 1],
    mergeAt: (r, c) => c === 2 ? { r1: 0, r2: 100000, c1: 1, c2: 10000 } : null });
  resolve(0, 0, {}, null); expect(read).not.toHaveBeenCalled();
  for (let i = 0; i < 3; i++) expect(resolve(0, 0, style('br', 'thin', red), null).br).toBeUndefined();
  expect(read).toHaveBeenCalledTimes(1);
  expect(resolve(0, 1, style('br', 'thin', red), null).br).toBe(true);
  expect(read).toHaveBeenCalledTimes(1);
});

it('ignores a border beyond the printed selection instead of dropping its outside edge', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setCells(id, [{ r: 0, c: 0, cell: { v: 1, s: style('br', 'thin', red) } }, { r: 0, c: 1, cell: { v: 2, s: style('bl', 'thick', blue) } }]);
  const printed = buildPrintTable(wb, id, { fit: 'actual', range: box(0, 0) });
  expect(printed.rows[0].cells[0].style.borderRightColor).toBe('rgb(255, 0, 0)');
});

it.each(['row', 'col'])('skips hidden %s borders and compares the nearest visible edges in grid and print', async axis => {
  const wb = new Workbook(), id = wb.activeSheetId, vertical = axis === 'row';
  for (const [position, side, bs, bc] of [[0, vertical ? 'bb' : 'br', 'thin', red],
    [1, vertical ? 'bb' : 'br', 'double', '#cc00cc'], [2, vertical ? 'bt' : 'bl', 'thick', blue]]) {
    wb.setCells(id, [{ r: vertical ? position : 0, c: vertical ? 0 : position, cell: { v: position, s: style(side, bs, bc) } }]);
  }
  wb.setHidden(id, axis, [1], true);
  const node = await mount(wb);
  expect(node(0, 0).classList.contains(vertical ? 'bb' : 'br')).toBe(false);
  expect(node(vertical ? 2 : 0, vertical ? 0 : 2).classList.contains(vertical ? 'bt' : 'bl')).toBe(true);
  const table = buildPrintTable(wb, id, { fit: 'actual' });
  expect(table.rows[0].cells[0].style[vertical ? 'borderBottomWidth' : 'borderRightWidth']).toBe('');
  expect(table.rows[vertical ? 1 : 0].cells[vertical ? 0 : 1].style[vertical ? 'borderTopColor' : 'borderLeftColor']).toBe('rgb(0, 0, 255)');
});

it('compares merged perimeter segments independently without borrowing hidden interior edges', async () => {
  const wb = new Workbook({ sheets: [{ merges: [{ r1: 1, c1: 1, r2: 2, c2: 2 }], cells: {
    '1,1': { v: 'Merged', s: style('br', 'double', '#cc00cc') },
    '1,2': { s: style('br', 'thin', red) }, '2,1': { s: style('bb', 'thin', red) },
    '2,2': { s: { ...style('br', 'thin', red), ...style('bb', 'thin', red) } },
    '1,3': { v: 'Strong', s: style('bl', 'thick', blue) }, '2,3': { v: 'Equal', s: style('bl', 'thin', blue) },
    '3,1': { v: 'Strong', s: style('bt', 'thick', blue) }, '3,2': { v: 'Weak', s: style('bt', 'dotted', blue) },
  } }] }), id = wb.activeSheetId;
  const node = await mount(wb);
  expect(node(1, 1).classList.contains('br')).toBe(false);
  expect(node(1, 3).classList.contains('bl')).toBe(true); expect(node(2, 3).classList.contains('bl')).toBe(true);
  expect(node(3, 1).classList.contains('bt')).toBe(true); expect(node(3, 2).classList.contains('bt')).toBe(false);
  const segments = [...grid.el.querySelectorAll('.merged-border-paint span')];
  expect(segments).toHaveLength(1); expect(segments[0].style.borderBottomColor).toBe('rgb(255, 0, 0)');
  const table = buildPrintTable(wb, id, { fit: 'actual', range: { r1: 1, c1: 1, r2: 3, c2: 3 } });
  document.body.append(table);
  const edges = cellPrintBorders(table.rows[0].cells[0], { top: 0, left: 0, right: 200, bottom: 52 });
  expect(edges).toHaveLength(1);
  expect(edges[0]).toMatchObject({ axis: 'h', at: 52, start: 100, end: 200, style: 'solid', color: red });
});

it.each(['thin', 'double', undefined, false, 'dotted', 'cf', 'cfnone'])('distinguishes table borders from direct and conditional formatting (%s)', async pen => {
  const wb = new Workbook({ sheets: [{ cells: { '1,0': { v: 'Outside' }, '1,1': { v: 'Header' } },
    tables: [{ id: 'edges', name: 'Edges', range: { r1: 1, r2: 2, c1: 1, c2: 1 }, style: 'custom',
      customStyle: { wholeTable: style('bl', 'thick', blue) } }] }] }), id = wb.activeSheetId;
  const conditional = pen === 'cf' || pen === 'cfnone', ink = !!pen && pen !== 'cfnone';
  const s = style('br', conditional ? pen === 'cf' ? 'thin' : null : pen, red);
  // Test both a stored table header and a blank table cell synthesized for print.
  for (const r of [1, 2]) {
    if (conditional) wb.addRule(id, { type: 'formula', value: 'TRUE', range: box(r, 0), style: s });
    else if (pen !== undefined) wb.applyStyle(id, box(r, 0), s);
  }
  const node = await mount(wb), printed = buildPrintTable(wb, id, { range: { r1: 1, r2: 2, c1: 0, c2: 1 } });
  for (const r of [1, 2]) {
    expect(node(r, 0).classList.contains('br')).toBe(ink);
    expect(node(r, 1).classList.contains('bl')).toBe(!ink && !conditional);
    expect(!!printed.rows[r - 1].cells[0].style.borderRightWidth).toBe(ink);
    expect(!!printed.rows[r - 1].cells[1].style.borderLeftWidth).toBe(!ink && !conditional);
  }
});

function competingWorkbook() {
  return new Workbook({ sheets: [{ cells: {
    '0,0': { v: 'Left', s: style('br', 'thin', red) },
    '0,1': { v: 'Right', s: style('bl', 'thick', blue) },
  } }] });
}
function expectStoredSides(wb) {
  for (const [c, side, bs, bc] of [[0, 'br', 'thin', red], [1, 'bl', 'thick', blue]]) {
    const st = wb.styleAt(wb.activeSheetId, 0, c);
    expect(st[side]).toBe(true);
    expect(st[`${side}Border`] || st).toMatchObject({ bs, bc });
  }
}
it.each([false, true])('preserves both stored sides and conditional precedence through XLSX (native-only=%s)', async nativeOnly => {
  vi.stubGlobal('Blob', NodeBlob);
  const wb = competingWorkbook();
  wb.addRule(wb.activeSheetId, { type: 'formula', value: 'TRUE', range: box(0, 0), style: style('br', 'dotted', red) });
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  if (nativeOnly) {
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
    part.size = part.content.length;
  }
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'edges.xlsx');
  expectStoredSides(back);
  const node = await mount(back);
  expect(node(0, 0).classList.contains('br')).toBe(true);
  expect(node(0, 1).classList.contains('bl')).toBe(false);
  const cf = back.conditionalStyle(back.activeSheetId, 0, 0, 'Left');
  expect(cf.br).toBe(true);
  expect(cf.brBorder || cf).toMatchObject({ bs: 'dotted', bc: red });
});
it.each([false, true])('preserves the editable losing border through HTML paste (foreign=%s)', async foreign => {
  const wb = competingWorkbook(), cells = wb.copyRange(wb.activeSheetId, { r1: 0, r2: 0, c1: 0, c2: 1 });
  let html = cellsToHtml([['Left', 'Right']], cells);
  if (foreign) html = html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  const parsed = parseHtmlClipboard(html), back = new Workbook();
  if (foreign) back.setCells(back.activeSheetId, cellsFromHtmlRows(parsed.rows).map(({ i, j, cell }) => ({ r: i, c: j, cell })));
  else back.pasteCells(back.activeSheetId, parsed.cells, 0, 0);
  expectStoredSides(back);
  const node = await mount(back);
  expect(node(0, 0).classList.contains('br')).toBe(false);
  expect(node(0, 1).classList.contains('bl')).toBe(true);
  back.applyStyle(back.activeSheetId, box(0, 1), { bl: false });
  await new Promise(resolve => setTimeout(resolve, 5));
  expect(node(0, 0).classList.contains('br')).toBe(true);
});
