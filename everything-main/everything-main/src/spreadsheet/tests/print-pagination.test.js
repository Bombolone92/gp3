// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { buildPrintRoot, preparePrintRoot } from '../src/ui/print.js';
import { printBands, printTitleBands, setPrintTitleAxes, fitPrintPageScale, fitPrintTableScale, paginatePrintColumns } from '../src/ui/print-pagination.js';
import { setMergedPrintBorders, cellPrintBorders } from '../src/ui/print-borders.js';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
const offsets = sizes => sizes.reduce((all, size) => [...all, all.at(-1) + size], [0]);

// jsdom has no table layout. Feed measured geometry (including scale and outer
// borders) into the paginator. Real-browser runs cover actual paint/layout.
function measured({ widths = [110, 170, 130], heights = [45, 55, 60, 40], scale = 1, head = 0, border = 0, merges = [], spill = null } = {}) {
  const sheet = document.createElement('div'); sheet.className = 'print-sheet'; sheet.style.zoom = String(scale);
  const table = document.createElement('table'); table.className = 'print-table'; sheet.append(table); document.body.append(sheet);
  const xs = offsets(widths), ys = offsets(heights), inset = border / 2;
  const rect = (node, x, y, w, h) => vi.spyOn(node, 'getBoundingClientRect').mockReturnValue(new DOMRect((x + 37) * scale, (y + 19) * scale, w * scale, h * scale));
  rect(table, 0, 0, xs.at(-1) + border, ys.at(-1) + border);
  const cols = document.createElement('colgroup'); table.append(cols);
  widths.forEach((width, c) => { const col = document.createElement('col'); col.style.width = `${width}px`; cols.append(col); rect(col, xs[c] + inset, inset, width, ys.at(-1)); });
  const thead = document.createElement('thead'), tbody = document.createElement('tbody');
  if (head) table.append(thead); table.append(tbody);
  heights.forEach((height, r) => {
    const row = document.createElement('tr'); row.style.height = `${height}px`; (r < head ? thead : tbody).append(row);
    rect(row, inset, ys[r] + inset, xs.at(-1), height);
    widths.forEach((width, c) => {
      const merge = merges.find(m => r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2);
      if (merge && (r !== merge.r1 || c !== merge.c1)) return;
      const cell = document.createElement('td'); cell.dataset.cell = `${r},${c}`; cell.textContent = `${r},${c}`; row.append(cell);
      cell.rowSpan = merge ? merge.r2 - r + 1 : 1; cell.colSpan = merge ? merge.c2 - c + 1 : 1;
      rect(cell, xs[c] + inset, ys[r] + inset, xs[c + cell.colSpan] - xs[c], ys[r + cell.rowSpan] - ys[r]);
      if (spill && spill.r === r && spill.c === c) {
        cell.className = 'spill'; const label = document.createElement('div'); label.className = 'print-cell'; label.textContent = 'Overflowing label'; cell.append(label);
        rect(label, xs[c] + inset, ys[r] + inset, spill.width, height);
      }
    });
  });
  return { sheet, table, rect, addObject(x, y, w, h) { const obj = document.createElement('div'); obj.className = 'drawing'; obj.textContent = 'Chart'; sheet.append(obj); rect(obj, x, y, w, h); return obj; } };
}
const cells = page => [...page.querySelectorAll('[data-cell]')].map(n => n.dataset.cell);
const dimension = (node, key) => parseFloat(node.style[key]);

it.each([.5, 1, 1.75])('reserves actual border ink inside every page at scale %s', scale => {
  const { sheet, table } = measured({ scale });
  table.classList.add('has-print-borders');
  for (const td of table.querySelectorAll('td')) td.style.border = '3px double red';
  const pages = paginatePrintColumns(sheet, { width: 300 * scale, height: 120 * scale, force: true });
  expect(pages).toHaveLength(4);
  expect(pages.map(p => [dimension(p, 'width'), dimension(p, 'height')])).toEqual(
    [[284,104],[284,104],[134,104],[134,104]].map(([w,h]) => [w*scale,h*scale]));
  for (const page of pages) {
    const clip = page.querySelector('.print-page-clip');
    expect(dimension(clip, 'left')).toBe(2*scale);
    expect(dimension(clip, 'top')).toBe(2*scale);
  }
});

it('rebreaks an exact cell-box fit when the full border would exceed the page', () => {
  const { sheet, table } = measured();
  table.classList.add('has-print-borders');
  for (const td of table.querySelectorAll('td')) td.style.border = '3px double red';
  const pages = paginatePrintColumns(sheet, { width: 280, height: 100, force: true });
  expect(pages).toHaveLength(12);
  for (const page of pages) {
    expect(dimension(page, 'width')).toBeLessThanOrEqual(280);
    expect(dimension(page, 'height')).toBeLessThanOrEqual(100);
  }
  expect(new Set(pages.flatMap(cells)).size).toBe(12);
});

it('does not add page padding for borders safely inside the cell frame', () => {
  const { sheet, table } = measured();
  table.classList.add('has-print-borders');
  table.rows[1].cells[1].style.borderBottom = '2px solid red';
  const [page] = paginatePrintColumns(sheet, { width: 500, height: 300, force: true });
  expect([dimension(page, 'width'), dimension(page, 'height')]).toEqual([410,200]);
  expect(page.querySelector('.print-page-clip').style.top).toBe('0px');
});

it('breaks at whole lines, including fractional sizes and exact fits', () => {
  expect(printBands([.1, .2, .3], .3).bands.map(b => [b.start, b.end])).toEqual([[0,2],[2,3]]);
  const { bands } = printBands([80.25, 99.75, 180, 35, 20], 180);
  expect(bands.map(b => [b.start, b.end, b.offset, b.size])).toEqual([[0, 2, 0, 180], [2, 3, 180, 180], [3, 5, 360, 55]]);
});

it('clips an oversized line once and resumes after its full extent', () => {
  expect(printBands([900, 170, 50], 700).bands.map(b => [b.offset, b.extent, b.size])).toEqual([[0, 900, 700], [900, 220, 220]]);
});

it('reserves repeated headings and handles headings larger than the page without losing the body', () => {
  expect(printBands([20, 30, 40, 60, 50], 130, 2)).toEqual({ repeated: 50, bands: [
    { start: 2, end: 3, offset: 50, extent: 40, size: 40 },
    { start: 3, end: 4, offset: 90, extent: 60, size: 60 },
    { start: 4, end: 5, offset: 150, extent: 50, size: 50 },
  ] });
  // Design decision: titles taller than the page never occlude the body.
  // Excess title rows remain in the ordinary body instead of being dropped.
  expect(printBands([25, 50, 50, 50], 100, 3)).toEqual({ repeated: 75, bands: [
    { start: 2, end: 3, offset: 75, extent: 50, size: 25 },
    { start: 3, end: 4, offset: 125, extent: 50, size: 25 },
  ] });
  expect(printBands([20, 30], 100, 2).bands).toEqual([{ start: 2, end: 2, offset: 50, extent: 0, size: 0 }]);
  expect(printBands([20], 0)).toBeNull();
});

it.each([0.4, 1, 1.75])('paginates wide sheets at explicit scale %s without mutating source layout', scale => {
  const { sheet } = measured({ scale }); const before = sheet.outerHTML;
  const pages = paginatePrintColumns(sheet, { width: 300 * scale, height: 120 * scale });
  expect(pages).toHaveLength(4);
  expect(pages.map(p => [dimension(p, 'width'), dimension(p, 'height')])).toEqual([[280,100],[280,100],[130,100],[130,100]].map(([w,h]) => [w*scale,h*scale]));
  expect(pages.map(cells)).toEqual([['0,0','0,1','1,0','1,1'], ['2,0','2,1','3,0','3,1'], ['0,2','1,2'], ['2,2','3,2']]);
  expect(sheet.outerHTML).toBe(before);
  for (const page of pages) expect(page.querySelector('.print-sheet').style.zoom).toBe(String(scale));
});

it('supports across-then-down order and includes collapsed outer borders in the page budget', () => {
  const { sheet } = measured({ border: 2 });
  const pages = paginatePrintColumns(sheet, { width: 280, height: 120, pageOrder: 'overThenDown' });
  expect(pages).toHaveLength(6);
  expect(pages.slice(0,3).map(p => cells(p)[0])).toEqual(['0,0','0,1','0,2']);
  expect(pages.map(p => dimension(p, 'width'))).toEqual([111,170,131,111,170,131]);
  expect(pages[0].querySelector('.print-sheet').style.marginLeft).toBe('0px');
});

it('retains crossing merged spans, label overflow and drawings in every affected page', () => {
  const { sheet, addObject } = measured({ merges: [{ r1: 0, r2: 1, c1: 0, c2: 2 }], spill: { r: 2, c: 0, width: 400 } });
  addObject(200, 80, 150, 80);
  const pages = paginatePrintColumns(sheet, { width: 300, height: 120 });
  for (const page of [pages[0], pages[2]]) {
    const merge = page.querySelector('[data-cell="0,0"]'); expect(merge).not.toBeNull();
    // Spacers may compress DOM spans; total original geometry stays unchanged.
    expect(dimension(page.querySelector('table'), 'width')).toBe(410);
  }
  for (const page of [pages[1], pages[3]]) expect(page.querySelector('.spill .print-cell').textContent).toBe('Overflowing label');
  expect(pages.map(p => p.querySelectorAll('.drawing').length)).toEqual([1,1,1,1]);
});

it('repeats column letters, row numbers and frozen rows without repeating body cells', () => {
  const { sheet } = measured({ widths: [30,110,170,130], heights: [20,40,60,60,60], head: 2 });
  const pages = paginatePrintColumns(sheet, { width: 320, height: 180, headers: true });
  expect(pages).toHaveLength(4);
  for (const page of pages) {
    expect(page.querySelectorAll('.print-page-clip')).toHaveLength(4);
    expect(cells(page)).toContain('0,0'); expect(cells(page)).toContain('1,0');
  }
  expect(cells(pages[1])).toContain('4,1'); expect(cells(pages[1])).not.toContain('2,1');
  expect(cells(pages[3])).toContain('4,3'); expect(cells(pages[3])).not.toContain('4,1');
});

it('prints a sheet consisting only of repeated title rows', () => {
  const { sheet } = measured({ head: 4 });
  const pages = paginatePrintColumns(sheet, { width: 300, height: 250 });
  expect(pages).toHaveLength(2); expect(cells(pages[1])).toEqual(['0,2','1,2','2,2','3,2']);
});

it('keeps ordinary narrow-sheet printing unchanged', () => {
  const { sheet } = measured();
  expect(paginatePrintColumns(sheet, { width: 410, height: 80 })).toBeNull();
  expect(sheet.querySelector('td').getBoundingClientRect).not.toHaveBeenCalled();
});

it('copies cells in proportion to painted fragments instead of the full sheet per page', () => {
  const { sheet } = measured({ widths: Array(40).fill(50), heights: Array(80).fill(20) });
  const pages = paginatePrintColumns(sheet, { width: 200, height: 200 });
  expect(pages).toHaveLength(80);
  expect(pages.reduce((count, page) => count + page.querySelectorAll('[data-cell]').length, 0)).toBe(3200);
  expect(pages.reduce((count, page) => count + page.querySelectorAll('td').length, 0)).toBeLessThan(6000);
});

it('integrates pagination after layout, centers each page, and is idempotent', () => {
  const wb = new Workbook({ sheets: [{ name: 'Wide report', cells: { '0,0': { v: 'Heading' }, '3,2': { v: 'End' } } }] });
  const before = wb.toJSON();
  const root = buildPrintRoot(wb, wb.activeSheetId, 'Report', { fit: 'actual', title: false, marginBoxes: true,
    paper: 'letter', footer: '&LLeft &[Page]&CCenter &[Pages]&RRight', margins: 'custom', customMargins: { left: .5, right: .5, top: .5, bottom: .5 }, horizontalCentered: true, verticalCentered: true });
  document.body.append(root);
  const { table } = measured({ widths: [300,350,500], heights: [300,350,400,100] });
  root.querySelector('.print-sheet').replaceChildren(table);
  preparePrintRoot(root);
  expect(root.querySelectorAll('.print-section')).toHaveLength(4);
  expect(root.querySelectorAll('.page-break')).toHaveLength(3);
  expect(root.querySelector('style').textContent).not.toContain('margin-bottom: 0;');
  expect([...root.querySelectorAll('.print-position')].map(n => dimension(n, 'paddingLeft'))).toEqual([35,35,110,110]);
  expect([...root.querySelectorAll('.print-position')].map(n => dimension(n, 'paddingTop'))).toEqual([155,230,155,230]);
  const html = root.innerHTML;
  preparePrintRoot(root);
  expect(root.innerHTML).toBe(html); expect(wb.toJSON()).toEqual(before);
});

it.each([undefined, 0, 4, 4294967295])('selects page furniture continuously across print areas and sheets with start %s', start => {
  const settings = { differentFirst:true, differentOddEven:true, firstFooter:'FIRST', evenFooter:'EVEN', footer:'ODD',
    ...(start != null ? { firstPageNumber: start, useFirstPageNumber: true, header: '&P of &N', firstHeader: '&P of &N', evenHeader: '&P of &N' } : {}),
    margins:{left:.5,right:.5,top:.5,bottom:.5},fitToPage:false };
  const wb = new Workbook({sheets:[
    {name:'Areas',cells:{'0,0':{v:'Area one'},'8,0':{v:'Area two'}},printSettings:{...settings,
      areas:[{r1:0,c1:0,r2:6,c2:0},{r1:8,c1:0,r2:8,c2:0}]}},
    {name:'Next sheet',cells:{'0,0':{v:'Next'}},printSettings:{...settings,firstFooter:''}},
  ]});
  const root=buildPrintRoot(wb,wb.activeSheetId,'Report',{area:'workbook',marginBoxes:true,title:false});
  document.body.append(root);
  [...root.querySelectorAll('.print-sheet')].forEach((sheet,i)=>{
    const {table}=measured({widths:[200],heights:i===0?Array(7).fill(300):[100]});
    sheet.replaceChildren(table);
  });
  preparePrintRoot(root);
  const sections=[...root.querySelectorAll('.print-section')];
  expect(sections).toHaveLength(5);
  const css=root.querySelector('style').textContent;
  const footer=name=>[...css.matchAll(new RegExp(`@page ${name} \\{([^]*?)(?=@page|@media|$)`,'g'))].map(m=>m[1]).join('');
  ['FIRST','EVEN','ODD','EVEN','ODD'].forEach((expected,i)=>{
    const rule=footer(sections[i].style.page);
    if(expected)expect(rule).toContain(`content: "${expected}"`);
    else expect(rule).not.toContain('content:');
    if (start != null) expect(rule).toContain(`content: "${start + i}" " of " counter(pages)`);
  });
  expect(css).toContain(`page: ${sections.at(-1).style.page};`);
  const before=root.innerHTML;preparePrintRoot(root);expect(root.innerHTML).toBe(before);
});


it.each(['downThenOver', 'overThenDown'])('numbers ordinary page fragments in %s order without header variants', pageOrder => {
  const wb = new Workbook({ sheets: [{ name: 'Report', cells: { '0,0': { v: 1 } }, printSettings: {
    firstPageNumber: 17, useFirstPageNumber: true, footer: '&P of &N', pageOrder,
    margins: { left: .5, right: .5, top: .5, bottom: .5 }, fitToPage: false,
  } }] });
  const root = buildPrintRoot(wb, wb.activeSheetId, 'Report', { marginBoxes: true, title: false });
  document.body.append(root);
  const { table } = measured({ widths: [400, 400], heights: [600, 600] });
  root.querySelector('.print-sheet').replaceChildren(table);
  preparePrintRoot(root);
  const sections = [...root.querySelectorAll('.print-section')];
  expect(sections).toHaveLength(4);
  expect(sections.map(s => cells(s))).toEqual(pageOrder === 'overThenDown'
    ? [['0,0'], ['0,1'], ['1,0'], ['1,1']] : [['0,0'], ['1,0'], ['0,1'], ['1,1']]);
  const css = root.querySelector('style').textContent;
  sections.forEach((section, i) => expect(css).toContain(`@page ${section.style.page} { @bottom-center { content: "${17 + i}" " of " counter(pages)`));
});

it('counts preceding ordinary worksheets and chart sheets before choosing a page variant', () => {
  const p = { margins: { left: .5, right: .5, top: .5, bottom: .5 }, differentFirst: true,
    differentOddEven: true, firstFooter: 'FIRST', evenFooter: 'EVEN', footer: 'ODD' };
  const wb = new Workbook({ sheets: [
    { name: 'Plain', cells: { '0,0': { v: 1 } }, printSettings: { margins: p.margins } },
    { name: 'Chart', kind: 'chart', charts: [], printSettings: p },
    { name: 'Variants', cells: { '0,0': { v: 2 } }, printSettings: p },
  ] });
  const root = buildPrintRoot(wb, wb.activeSheetId, 'Report', { area: 'workbook', marginBoxes: true });
  document.body.append(root);
  for (const sheet of root.querySelectorAll('.print-sheet:not(.print-chart-sheet)')) {
    const { table } = measured({ widths: [200], heights: Array(4).fill(300) });
    sheet.replaceChildren(table);
  }
  preparePrintRoot(root);
  const sections = [...root.querySelectorAll('.print-section')];
  expect(sections).toHaveLength(5);
  expect(sections[2].querySelector('.print-chart-sheet')).not.toBeNull();
  const css = root.querySelector('style').textContent;
  ['ODD', 'EVEN', 'ODD'].forEach((text, i) => {
    const name = sections[i + 2].style.page;
    expect(css).toContain(`@page ${name} { @bottom-center { content: "${text}";`);
  });
  const before = root.innerHTML;
  preparePrintRoot(root);
  expect(root.innerHTML).toBe(before);
});

it('reserves later flow headers and footers when the first page is blank', () => {
  const nativeRect = HTMLElement.prototype.getBoundingClientRect;
  const wb = new Workbook({ sheets: [{ name: 'Report', cells: { '0,0': { v: 'Data' } }, printSettings: {
    differentFirst: true, differentOddEven: true, header: 'Odd header', footer: 'Odd footer',
    evenHeader: 'Even header', evenFooter: 'Tall even footer', firstHeader: '', firstFooter: '',
    margins: { left: .5, right: .5, top: .5, bottom: .5 },
  } }] });
  const root = buildPrintRoot(wb, wb.activeSheetId, 'Report', { marginBoxes: false });
  document.body.append(root);
  const { table } = measured({ widths: [200], heights: Array(6).fill(300) });
  root.querySelector('.print-sheet').replaceChildren(table);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    if (this.matches('.print-page-header')) return new DOMRect(0, 0, 200, 40);
    if (this.matches('.print-foot')) return new DOMRect(0, 0, 200, this.textContent === 'Tall even footer' ? 80 : 20);
    return nativeRect.call(this);
  });
  preparePrintRoot(root);
  const sections = [...root.querySelectorAll('.print-section')];
  expect(sections).toHaveLength(3);
  expect(sections.map(s => [...s.querySelectorAll('[data-cell]')].map(c => c.dataset.cell)))
    .toEqual([['0,0', '1,0'], ['2,0', '3,0'], ['4,0', '5,0']]);
  expect(sections.map(s => s.querySelector('.print-foot')?.textContent || ''))
    .toEqual(['', 'Tall even footer', 'Odd footer']);
  expect(sections.map(s => s.querySelector('.print-page-header')?.textContent || ''))
    .toEqual(['', 'Even header', 'Odd header']);
});

it.each([true, false])('extends oversized page paint while preserving footer alignment %s', alignWithMargins => {
  const wb = new Workbook({ sheets: [{ name: 'Tall report', cells: { '0,0': { v: 'Tall' }, '1,0': { v: 'Next' } } }] });
  const root = buildPrintRoot(wb, wb.activeSheetId, 'Report', { fit: 'actual', title: false, marginBoxes: true,
    paper: 'letter', footer: '&LLeft &[Page]&CCenter &[Pages]&RRight', alignWithMargins,
    margins: 'custom', customMargins: { left: .5, right: 1.25, top: .5, bottom: 2 } });
  document.body.append(root);
  const { table } = measured({ widths: [900, 20], heights: [900, 30] });
  root.querySelector('.print-sheet').replaceChildren(table);
  preparePrintRoot(root);
  expect(root.querySelectorAll('.print-section')).toHaveLength(4);
  expect(root.querySelectorAll('.print-page-overflow-bottom')).toHaveLength(2);
  expect(root.querySelectorAll('.print-page-overflow-right')).toHaveLength(2);
  for (const section of root.querySelectorAll('.print-section')) expect(section.style.width).toBe('648px');
  const css = root.querySelector('style').textContent;
  expect(css).toContain('margin-bottom: 0;'); expect(css).toContain('margin-right: 0;');
  for (const edge of ['top', 'bottom']) for (const side of ['center', 'right']) {
    expect(css).toMatch(new RegExp(`@${edge}-${side} \\{[^}]*margin-right: ${alignWithMargins ? 120 : 0}px;`));
  }
  for (const side of ['left', 'center', 'right']) expect(css).toContain(`@bottom-${side} { height: 192px; margin-top: -192px;`);
  expect(css).toContain('counter(page)'); expect(css).toContain('counter(pages)');
  const html = root.innerHTML;
  preparePrintRoot(root); expect(root.innerHTML).toBe(html);
});

it('repeats interior title intervals only after the first page reaches them', () => {
  const rows = (n, repeat, bodyStart = 0, capacity = 12) => printTitleBands(Array(n).fill(1), capacity, { repeat, bodyStart })
    .map(b => b.segments.flatMap(s => Array.from({ length: s.size }, (_, i) => s.offset + i + 1)));
  // Print-title controls: interior, preceding-area, crossing-break,
  // overlapping-area and titles-only cases, with geometry in whole-line units.
  expect(rows(18, [2, 4])).toEqual([Array.from({ length: 12 }, (_, i) => i + 1), [3,4,13,14,15,16,17,18]]);
  expect(rows(14, [0, 2], 2)).toEqual([[1,2,3,4,5,6,7,8,9,10,11,12],[1,2,13,14]]);
  expect(rows(18, [11, 14])).toEqual([Array.from({ length: 12 }, (_, i) => i + 1), [12,13,14,15,16,17,18]]);
  expect(rows(17, [0, 7], 3)).toEqual([Array.from({ length: 12 }, (_, i) => i + 1), [1,2,3,4,5,6,7,13,14,15,16,17]]);
  expect(rows(4, [0, 4], 2)).toEqual([[1,2,3,4]]);
  expect(rows(14, [4, 7], 0, 5)).toEqual([[1,2,3,4,5],[5,6,7,8,9],[5,6,7,10,11],[5,6,7,12,13],[5,6,7,14]]);
});

it('respects headings, fractional boundaries and overfull titles while guaranteeing progress', () => {
  expect(printTitleBands([.1,.2,.3], .3).map(b => b.segments)).toEqual([[{offset:0,size:.3}],[{offset: .1+.2,size:.3}]]);
  const bands = printTitleBands([20,40,40,40,40], 140, { heading: 1, repeat: [2,3] });
  expect(bands.map(b => b.segments)).toEqual([[{offset:0,size:20},{offset:20,size:120}],[{offset:0,size:20},{offset:60,size:40},{offset:140,size:40}]]);
  const overfull = printTitleBands(Array(18).fill(80), 960, { repeat: [0,14] });
  expect(overfull).toHaveLength(7);
  expect(overfull.slice(1).every(b => b.clipped)).toBe(true);
  expect(printTitleBands([1], 0)).toBeNull();
});

it('repeats only the reached portion of titles that extend across successive page breaks', () => {
  const bands = printTitleBands([30, 50, 40, 60, 20, 35], 90, { repeat: [0, 4] });
  expect(bands.map(b => b.segments)).toEqual([
    [{ offset: 0, size: 80 }],
    [{ offset: 0, size: 80 }, { offset: 80, size: 40 }],
    [{ offset: 0, size: 120 }, { offset: 120, size: 60 }],
    [{ offset: 0, size: 180 }, { offset: 180, size: 20 }],
    [{ offset: 0, size: 180 }, { offset: 200, size: 35 }],
  ]);
  expect(bands.map(b => b.paintSize)).toEqual([80, 120, 180, 200, 215]);
  expect(bands.map(b => b.size)).toEqual([80, 90, 90, 90, 90]);
});

it.each([0.5, 1, 1.5])('paints forced oversized lines into trailing margins at scale %s without adding pages', scale => {
  const { sheet } = measured({ widths: [250, 40], heights: [220, 30], scale });
  const pages = paginatePrintColumns(sheet, { width: 180 * scale, height: 150 * scale,
    overflowRight: 30 * scale, overflowBottom: 90 * scale });
  expect(pages).toHaveLength(4);
  expect(pages.map(cells)).toEqual([['0,0'], ['1,0'], ['0,1'], ['1,1']]);
  expect(dimension(pages[0], 'width')).toBe(180 * scale);
  expect(dimension(pages[0], 'height')).toBe(150 * scale);
  const clip = pages[0].querySelector('.print-page-clip');
  expect(dimension(clip, 'width')).toBe(210 * scale);
  expect(dimension(clip, 'height')).toBe(220 * scale);
});

it('does not extend paint margins for binary rounding at a whole-line boundary', () => {
  const { sheet } = measured({ widths: [.1, .2], heights: [20] });
  const pages = paginatePrintColumns(sheet, { width: .3, height: 30, overflowRight: 10 });
  expect(pages).toHaveLength(1);
  expect(pages[0].classList.contains('print-page-overflow')).toBe(false);
  expect(dimension(pages[0].querySelector('.print-page-clip'), 'width')).toBe(.3);
});

it('explicitly paginates a narrow sheet with an oversized row, preserving its full paint', () => {
  const { sheet } = measured({ widths: [70], heights: [170, 25] });
  const pages = paginatePrintColumns(sheet, { width: 100, height: 120, overflowBottom: 60 });
  expect(pages).toHaveLength(2);
  expect(pages.map(cells)).toEqual([['0,0'], ['1,0']]);
  expect(dimension(pages[0].querySelector('.print-page-clip'), 'height')).toBe(170);
});

it('paints growing oversized row and column titles only to the physical paper edge', () => {
  const { sheet, table } = measured({ widths: [40,40,40,40,40], heights: [30,30,30,30,30] });
  setPrintTitleAxes(table, { rows: { repeat: [0,4] }, cols: { repeat: [0,4] } });
  const pages = paginatePrintColumns(sheet, { width: 90, height: 70, overflowRight: 40, overflowBottom: 35 });
  expect(pages).toHaveLength(16);
  expect(cells(pages[1])).toEqual(['0,0','0,1','1,0','1,1','2,0','2,1']);
  expect(cells(pages[2])).toContain('3,0');
  expect(cells(pages[2])).not.toContain('4,0');
  for (const page of pages) for (const clip of page.querySelectorAll('.print-page-clip')) {
    expect(dimension(clip, 'left') + dimension(clip, 'width')).toBeLessThanOrEqual(130);
    expect(dimension(clip, 'top') + dimension(clip, 'height')).toBeLessThanOrEqual(105);
  }
});

it('includes repeated interior titles when fitting to a requested page count', () => {
  const sizes = Array(20).fill(10), titles = { repeat: [2,5] };
  const scale = fitPrintPageScale([{ sizes, titles, capacity: 100, pages: 2 }], 1);
  expect(scale).toBeLessThan(1);
  expect(printTitleBands(sizes, 100 / scale, titles)).toHaveLength(2);
  expect(printTitleBands(sizes, 100 / (scale + .01), titles).length).toBeGreaterThan(2);
});

it('fragments narrow sheets with interior row titles and indexes overlapping body/title regions correctly', () => {
  const { sheet, table, addObject } = measured({ widths: [80,80], heights: Array(8).fill(30) });
  setPrintTitleAxes(table, { rows: { repeat: [1,3] } });
  addObject(20, 35, 20, 15);
  const pages = paginatePrintColumns(sheet, { width: 200, height: 150 });
  expect(pages).toHaveLength(2);
  expect(cells(pages[0])).toEqual(Array.from({length:5},(_,r)=>[`${r},0`,`${r},1`]).flat());
  expect(cells(pages[1])).toEqual([1,2,5,6,7].flatMap(r=>[`${r},0`,`${r},1`]));
  expect(pages.map(p=>p.querySelectorAll('.drawing').length)).toEqual([1,1]);
});

it('repeats interior rows and columns together without duplicating their intersection', () => {
  const { sheet, table } = measured({ widths: Array(8).fill(30), heights: Array(8).fill(30) });
  setPrintTitleAxes(table, { rows: { repeat: [1,3] }, cols: { repeat: [1,3] } });
  const pages = paginatePrintColumns(sheet, { width: 150, height: 150 });
  expect(pages).toHaveLength(4);
  expect(cells(pages[3])).toHaveLength(25);
  expect(new Set(cells(pages[3])).size).toBe(25);
  expect(cells(pages[3])).toContain('1,1'); expect(cells(pages[3])).toContain('7,7');
  expect(cells(pages[3])).not.toContain('4,4');
});


it('includes border ink when choosing single- and multi-page fit scales', () => {
  const { sheet, table } = measured({ widths: [110,170,130], heights: [45,55,60,40] });
  table.classList.add('has-print-borders');
  for (const td of table.querySelectorAll('td')) td.style.border = '3px double red';
  // Cell boxes fit exactly, but complete rules need four additional CSS px.
  expect(fitPrintTableScale(table, { width:410, height:200, widthPages:1, heightPages:1, scale:1 })).toBe(.98);
  expect(fitPrintTableScale(table, { width:280, height:100, widthPages:2, heightPages:2, scale:1 })).toBe(.96);
});

it('retains independent merged perimeter segments in every crossing page fragment', () => {
  const { sheet, table } = measured({ widths:[80,120], heights:[30,50,40], merges:[{r1:0,c1:0,r2:1,c2:1}] });
  table.classList.add('has-print-borders');
  const merged = table.querySelector('td');
  setMergedPrintBorders(merged, [{side:'bb',start:0,end:.4,width:'2px',style:'solid',color:'red'},
    {side:'br',start:.375,end:1,width:'3px',style:'double',color:'blue'}]);
  const rect = {left:0,top:0,right:200,bottom:80};
  const expected = cellPrintBorders(merged,rect);
  const pages = paginatePrintColumns(sheet,{width:150,height:100,force:true});
  const copies = pages.flatMap(page=>[...page.querySelectorAll('td')].filter(td=>td.textContent==='0,0'));
  expect(copies).toHaveLength(2);
  for (const clone of copies) expect(cellPrintBorders(clone,rect)).toEqual(expected);
});
