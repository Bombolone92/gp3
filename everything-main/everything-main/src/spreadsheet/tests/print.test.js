// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildPrintTable, buildPrintSheet, buildPrintRoot, printTextParts, splitPrintSections, expandPrintText, marginBoxContent, pageMarginCss } from '../src/ui/print.js';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';
import { parseCellRef, parseRange } from '../src/core/cell.js';
import { getLocale, setLocale } from '../src/core/format.js';

describe('print table', () => {
  it('renders the used range with displayed values and styles, skipping hidden lines', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const set = (a1, v) => { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, v); };
    set('A1', 'Item'); set('B1', 'Amount'); set('C1', 'Note');
    set('A2', 'Rent'); set('B2', '1500'); set('B3', '=B2*2'); set('B4', '=1/0');
    wb.applyStyle(id, parseRange('A1:C1'), { bold: true, bg: '#eeeeee' });
    wb.applyStyle(id, parseRange('B2:B3'), { fmt: 'currency', dec: 0 });
    wb.applyBorders(id, parseRange('A1:C4'), 'outer');
    wb.setHidden(id, 'col', [2], true);
    wb.setHidden(id, 'row', [2], true);
    const table = buildPrintTable(wb, id);
    const rows = [...table.querySelectorAll('tr')];
    expect(rows).toHaveLength(3); // rows 1, 2, 4
    expect(rows[0].children).toHaveLength(2); // column C hidden
    expect(rows[0].children[0].textContent).toBe('Item');
    expect(rows[0].children[0].style.fontWeight).toBe('600');
    expect(rows[0].children[0].style.backgroundColor).toBe('rgb(238, 238, 238)');
    expect(rows[0].children[0].style.borderTop).toContain('1px solid');
    expect(rows[1].children[1].textContent).toBe('$1,500');
    expect(rows[1].children[1].style.textAlign).toBe('right');
    expect(rows[2].children[1].textContent).toBe('#DIV/0!');
    expect(rows[2].children[1].classList.contains('err')).toBe(true);
    expect(table.querySelectorAll('col')).toHaveLength(2);
  });

  it('supports headers, a print range, repeating rows, and gridline and width options', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) wb.setInput(id, r, c, `${r}-${c}`);
    wb.setFrozen(id, 1, 0);
    const table = buildPrintTable(wb, id, { headers: true, repeatRows: 1, gridlines: false, fit: 'actual', range: parseRange('A1:B3') });
    expect(table.classList.contains('no-grid')).toBe(true);
    expect(table.classList.contains('actual')).toBe(true);
    expect(table.style.width).toBe(`${100 + 100 + 34}px`);
    const thead = table.querySelector('thead');
    expect(thead.querySelectorAll('tr')).toHaveLength(2); // letters row + the repeated first row
    expect([...thead.querySelectorAll('tr')[0].children].map((th) => th.textContent)).toEqual(['', 'A', 'B']);
    expect(thead.querySelectorAll('tr')[1].children[0].textContent).toBe('1');
    expect(thead.querySelectorAll('tr')[1].children[1].textContent).toBe('0-0');
    const body = table.querySelector('tbody');
    expect(body.querySelectorAll('tr')).toHaveLength(2); // rows 2 and 3 of the range
    expect(body.querySelectorAll('tr')[1].children[2].textContent).toBe('2-1');
    expect(table.querySelectorAll('col')).toHaveLength(3);
  });

  it('zooms the table for a custom scale', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, 'x');
    const table = buildPrintTable(wb, id, { fit: 'scale', scale: 80 });
    expect(table.classList.contains('actual')).toBe(true);
    expect(table.style.zoom).toBe('0.8');
    expect(buildPrintTable(wb, id, { fit: 'scale', scale: 5000 }).style.zoom).toBe('4');
  });

  it('prints conditional formatting and table styling', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, 'Item'); wb.setInput(id, 0, 1, 'Qty');
    wb.setInput(id, 1, 0, 'a'); wb.setInput(id, 1, 1, '10');
    wb.setInput(id, 2, 0, 'b'); wb.setInput(id, 2, 1, '2');
    wb.addRule(id, { range: parseRange('B2:B3'), type: 'gt', value: 5, style: { bg: '#ff0000', color: '#ffffff' } });
    wb.addTable(id, parseRange('A1:B3'), { name: 'T', style: 'blue' });
    const table = buildPrintTable(wb, id);
    const rows = [...table.querySelectorAll('tr')];
    expect(rows[0].children[0].style.fontWeight).toBe('600'); // table header
    expect(rows[0].children[0].style.backgroundColor).toBe('rgb(68, 114, 196)');
    expect(rows[1].children[1].style.backgroundColor).toBe('rgb(255, 0, 0)'); // the rule wins over banding
    expect(rows[1].children[1].style.color).toBe('rgb(255, 255, 255)');
    expect(rows[2].children[1].style.backgroundColor).toBe(''); // an unbanded row with no rule match
  });

  it('is empty for an empty sheet', () => {
    const wb = new Workbook();
    expect(buildPrintTable(wb, wb.sheets[0].id).querySelectorAll('tr')).toHaveLength(0);
  });

  it('starts at the first used cell rather than at A1', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const { r, c } = parseCellRef('E10');
    wb.setInput(id, r, c, 'lone');
    wb.setInput(id, r + 1, c + 1, '7');
    const table = buildPrintTable(wb, id, { headers: true });
    const rows = [...table.querySelectorAll('tr')];
    expect(rows).toHaveLength(3); // the letters row, then rows 10 and 11
    expect([...rows[0].children].map((th) => th.textContent)).toEqual(['', 'E', 'F']);
    expect([...rows[1].children].map((n) => n.textContent)).toEqual(['10', 'lone', '']);
    expect([...rows[2].children].map((n) => n.textContent)).toEqual(['11', '', '7']);
    // A selection still prints exactly the cells asked for.
    expect(buildPrintTable(wb, id, { range: parseRange('A1:B2') }).querySelectorAll('tr')).toHaveLength(2);
  });
});

describe('charts and images in print', () => {
  it('places each object over its anchor cell, as a percentage of the table width when the table stretches', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const set = (a1, v) => { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, v); };
    set('A1', 'x'); set('B1', 'y'); set('A2', '1'); set('B2', '2'); set('A3', '3'); set('B3', '5'); set('F20', 'end');
    wb.addChart(id, { type: 'column', range: parseRange('A1:B3'), anchor: { r: 1, c: 2 }, dx: 10, dy: 5, w: 240, h: 150 });
    wb.addChart(id, { type: 'image', src: 'data:image/png;base64,iVBORw0KGgo=', anchor: { r: 0, c: 0 }, dx: 0, dy: 0, w: 50, h: 50 });
    const sheet = buildPrintSheet(wb, id, {});
    expect(sheet.classList.contains('print-sheet')).toBe(true);
    expect(sheet.querySelector('table')).not.toBeNull();
    const objects = sheet.querySelectorAll('.print-object');
    expect(objects.length).toBe(2);
    const chartNode = [...objects].find((n) => n.querySelector('svg'));
    expect(chartNode.style.top).toBe(`${wb.rowHeight(id, 0) + 5}px`);
    expect(chartNode.style.left).toMatch(/%$/);
    expect(chartNode.style.height).toBe('150px');
    expect([...objects].find((n) => n.querySelector('img'))).toBeTruthy();
    // Actual size keeps pixels, and an object outside the printed range is left out.
    const actual = buildPrintSheet(wb, id, { fit: 'actual', range: parseRange('A1:B3') });
    expect(actual.querySelectorAll('.print-object').length).toBe(1);
    expect(actual.querySelector('.print-object').style.left).toBe('0px');
  });

  it('keeps an object as tall as the rows it covers when the table is stretched to the page', () => {
    // Fit to page width stretches a table narrower than the page, but its rows keep their pixel
    // heights. An object shaped by its own ratio grew with the columns and buried the rows under it.
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    for (let r = 0; r < 20; r++) { wb.setInput(id, r, 0, `r${r}`); wb.setInput(id, r, 1, String(r)); }
    wb.addChart(id, { type: 'column', range: parseRange('A1:B20'), anchor: { r: 0, c: 2 }, dx: 0, dy: 0, w: 160, h: 120 });
    const node = buildPrintSheet(wb, id, { fit: 'width' }).querySelector('.print-object');
    expect(node.style.left).toMatch(/%$/); // the table stretches, so the position follows it
    expect(node.style.height).toBe('120px');
    expect(node.style.aspectRatio).toBe('');
  });

  it('prints a chart placed beside or below the data by widening the printed cells over it', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const set = (a1, v) => { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, v); };
    set('A1', 'x'); set('B1', 'y'); set('A2', '1'); set('B2', '2');
    wb.addChart(id, { type: 'column', range: parseRange('A1:B2'), anchor: { r: 0, c: 2 }, dx: 8, dy: 6, w: 480, h: 300 }); // where a new chart is placed
    wb.addChart(id, { type: 'column', range: parseRange('A1:B2'), anchor: { r: 5, c: 0 }, dx: 0, dy: 0, w: 200, h: 100 });
    const sheet = buildPrintSheet(wb, id, { fit: 'actual' });
    const objects = [...sheet.querySelectorAll('.print-object')];
    expect(objects).toHaveLength(2);
    const table = sheet.querySelector('table');
    // 488px from column C at 100px a column reaches column G; 306px down from row 1 reaches the row holding it.
    expect(table.querySelectorAll('col')).toHaveLength(7);
    expect(table.querySelectorAll('tr')).toHaveLength(Math.ceil(306 / DEFAULT_ROW_HEIGHT));
    expect(objects[0].style.left).toBe('208px');
    expect(objects[1].style.top).toBe(`${5 * wb.rowHeight(id, 0)}px`);
    // A sheet holding nothing but a chart prints the chart.
    const only = new Workbook();
    only.addChart(only.sheets[0].id, { type: 'image', src: 'data:image/png;base64,iVBORw0KGgo=', anchor: { r: 2, c: 1 }, w: 50, h: 50 });
    const alone = buildPrintSheet(only, only.sheets[0].id, {});
    expect(alone.querySelectorAll('.print-object')).toHaveLength(1);
    // The rows the 50px image covers, from its own row 3 down.
    expect(alone.querySelector('table').querySelectorAll('tr')).toHaveLength(Math.ceil((2 * DEFAULT_ROW_HEIGHT + 50) / DEFAULT_ROW_HEIGHT) - 2);
  });

  it('moves objects down past the column-letters row when row and column headers print', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    for (let r = 0; r < 4; r++) { wb.setInput(id, r, 0, `${r}`); wb.setInput(id, r, 1, `${r * 2}`); }
    wb.addChart(id, { type: 'column', range: parseRange('A1:B4'), anchor: { r: 1, c: 0 }, dx: 0, dy: 5, w: 100, h: 60 });
    const plain = buildPrintSheet(wb, id, { fit: 'actual' });
    expect(plain.querySelector('.print-object').style.top).toBe(`${wb.rowHeight(id, 0) + 5}px`);
    const withHeaders = buildPrintSheet(wb, id, { fit: 'actual', headers: true });
    const letters = withHeaders.querySelector('tr.print-hdr-row');
    expect(letters.style.height).toMatch(/^\d+px$/);
    expect(withHeaders.querySelector('.print-object').style.top).toBe(`${parseInt(letters.style.height, 10) + wb.rowHeight(id, 0) + 5}px`);
    expect(withHeaders.querySelector('.print-object').style.left).toBe('34px'); // past the row-numbers column, as before
  });
});

describe('print headers and footers', () => {
  const info = { file: 'Budget', tab: 'Q1', now: new Date(2026, 7, 28, 14, 5), page: 2, pages: 5 };

  it('reads &[Token] and short-form tokens into parts', () => {
    expect(printTextParts('Page &[Page] of &[Pages] — &F/&A')).toEqual([
      { text: 'Page ' }, { token: 'Page' }, { text: ' of ' }, { token: 'Pages' }, { text: ' — ' }, { token: 'File' }, { text: '/' }, { token: 'Tab' },
    ]);
    expect(printTextParts('&[page] &[TAB]')).toEqual([{ token: 'Page' }, { text: ' ' }, { token: 'Tab' }]);
    expect(printTextParts('A&B')).toEqual([{ text: 'A&B' }]); // &B is not a token
    expect(printTextParts('&Pages')).toEqual([{ text: '&Pages' }]); // a short form needs a non-letter after it
    expect(printTextParts('')).toEqual([]);
  });

  it('splits &L &C &R sections, centering text without a code', () => {
    expect(splitPrintSections('&LLeft&CMiddle&RRight')).toEqual({ left: 'Left', center: 'Middle', right: 'Right' });
    expect(splitPrintSections('Just this')).toEqual({ left: '', center: 'Just this', right: '' });
    expect(splitPrintSections('&RPage &P')).toEqual({ left: '', center: '', right: 'Page &P' });
  });

  it('expands tokens from the print info and drops page numbers it cannot know', () => {
    expect(expandPrintText('&[File] — &[Tab], p. &[Page]/&[Pages]', info)).toBe('Budget — Q1, p. 2/5');
    expect(expandPrintText('&[Date] &[Time]', info)).toBe(`${info.now.toLocaleDateString(getLocale())} ${info.now.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' })}`);
    expect(expandPrintText('Page &[Page] of &[Pages]', { file: 'x' })).toBe('');
    expect(expandPrintText('plain', info)).toBe('plain');
  });

  it('turns page tokens into CSS counters for margin boxes and escapes quotes', () => {
    expect(marginBoxContent('Page &[Page] of &[Pages]', { ...info, page: undefined })).toBe('"Page " counter(page) " of " counter(pages)');
    expect(marginBoxContent('Page &[Page] of &[Pages]', info)).toBe('"Page " "2" " of " counter(pages)');
    expect(marginBoxContent('Say "hi" &[Tab]', info)).toBe('"Say \\"hi\\" " "Q1"');
    expect(marginBoxContent('', info)).toBeNull();
    const css = pageMarginCss('sheet-1', '&LBudget&RPrinted &[Date]', 'Page &[Page] of &[Pages]', { ...info, page: undefined });
    expect(css.startsWith('@page sheet-1 {')).toBe(true);
    expect(css).toContain('@top-left { content: "Budget";');
    expect(css).toContain(`@top-right { content: "Printed " "${info.now.toLocaleDateString(getLocale())}";`);
    expect(css).toContain('@bottom-center { content: "Page " counter(page) " of " counter(pages);');
    expect(css).not.toContain('@top-center');
  });

  it('puts the header and footer in named page margins when supported, once per sheet otherwise', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, 'x');
    const other = wb.addSheet('Costs');
    wb.setInput(other.id, 0, 0, 'y');
    const withBoxes = buildPrintRoot(wb, id, 'Budget', { area: 'workbook', header: '&[File] — &[Tab]', marginBoxes: true });
    const style = withBoxes.querySelector('style').textContent;
    expect(style).toContain('@page sheet-1 { @top-center { content: "Budget" " — " "Sheet1";');
    expect(style).toContain('@page sheet-2 { @top-center { content: "Budget" " — " "Costs";');
    expect(style).toContain('@bottom-center { content: "Page " counter(page) " of " counter(pages);'); // default footer
    const sections = withBoxes.querySelectorAll('.print-section');
    expect(sections).toHaveLength(2);
    expect(sections[0].style.page).toBe('sheet-1');
    expect(sections[1].style.page).toBe('sheet-2');
    expect(sections[0].querySelector('.print-title').textContent).toBe('Budget');
    expect(sections[1].querySelector('.print-sub').textContent).toBe('Costs');
    expect(withBoxes.querySelector('.print-foot')).toBeNull();

    const inFlow = buildPrintRoot(wb, id, 'Budget', { header: 'Report for &[Tab]', footer: 'Printed &[Date] page &[Page]', marginBoxes: false });
    expect(inFlow.querySelector('style').textContent).not.toContain('@top-');
    expect(inFlow.querySelector('.print-title').textContent).toBe('Report for Sheet1');
    expect(inFlow.querySelector('.print-foot').textContent).toBe(`Printed ${new Date().toLocaleDateString(getLocale())}`);
    const plain = buildPrintRoot(wb, id, 'Budget', { marginBoxes: false });
    expect(plain.querySelector('.print-title').textContent).toBe('Budget');
    expect(plain.querySelector('.print-foot').textContent).toBe(new Date().toLocaleDateString(getLocale()));
  });

  it('writes &[Date] and &[Time] in the app\'s regional format, not the browser\'s', () => {
    const now = new Date(2026, 7, 28, 14, 5);
    setLocale('de-DE');
    try {
      expect(expandPrintText('&[Date]', { now })).toBe('28.8.2026');
      expect(expandPrintText('&[Time]', { now })).toBe(now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }));
      expect(marginBoxContent('&[Date]', { now })).toBe('"28.8.2026"');
    } finally { setLocale('en-US'); }
    expect(expandPrintText('&[Date]', { now })).toBe('8/28/2026');
  });

  it('lays an in-flow header and footer out in their &L, &C and &R parts instead of printing the codes', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, 'x');
    const root = buildPrintRoot(wb, id, 'Budget', { marginBoxes: false, header: '&L&[File]&C&[Tab]&RConfidential', footer: '&LPrinted&RBy me' });
    expect([...root.querySelectorAll('.print-title')].map((n) => [n.textContent, n.style.textAlign])).toEqual([['Budget', 'left'], ['Sheet1', 'center'], ['Confidential', 'right']]);
    const foot = root.querySelector('.print-foot');
    expect(foot.style.display).toBe('flex');
    expect([...foot.children].map((n) => n.textContent)).toEqual(['Printed', '', 'By me']);
    expect(root.textContent).not.toMatch(/&[LCR]/);
    // A header of only a right part leaves the title's place empty rather than falling back to the file name.
    const rightOnly = buildPrintRoot(wb, id, 'Budget', { marginBoxes: false, header: '&RDraft' });
    expect([...rightOnly.querySelectorAll('.print-title')].map((n) => n.textContent)).toEqual(['', '', 'Draft']);
  });
});
