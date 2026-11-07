import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { chartData, defaultChart } from '../src/core/charts.js';
import { chartXlsx } from './helpers/xlsx-chart-fixture.js';
import { exportStyles } from '../src/core/xlsx-export-styles.js';

const parser = new (new JSDOM('').window.DOMParser)();

it('orders every combination of normal and differential font properties for Excel', () => {
  const source = '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="0"/><fills count="0"/><borders count="0"/><cellXfs count="0"/><dxfs count="0"/></styleSheet>';
  const writer = exportStyles(source);
  for (let bits = 0; bits < 16; bits++) {
    const style = { font: 'arial', size: 20, color: '#357911' };
    ['bold', 'italic', 'strike', 'underline'].forEach((key, i) => { style[key] = !!(bits & (1 << i)); });
    writer.cell(style); writer.differential(style);
  }
  writer.cell({}); writer.differential({ color: '#112233' }); writer.differential({ font: 'calibri' });
  const document = parser.parseFromString(writer.xml(), 'application/xml');
  expect(document.querySelectorAll('fonts font')).toHaveLength(17);
  expect(document.querySelectorAll('dxfs font')).toHaveLength(18);
  const order = ['b', 'i', 'strike', 'condense', 'extend', 'outline', 'shadow', 'u', 'vertAlign', 'sz', 'color', 'name', 'family', 'charset', 'scheme'];
  for (const font of document.querySelectorAll('font')) {
    const actual = [...font.children].map(child => order.indexOf(child.localName));
    expect(actual.every(index => index >= 0)).toBe(true);
    expect(actual).toEqual([...actual].sort((a, b) => a - b));
  }
  const off = document.querySelector('dxf font');
  for (const tag of ['b', 'i', 'strike']) expect(off.querySelector(tag).getAttribute('val')).toBe('0');
  expect(off.querySelector('u').getAttribute('val')).toBe('none');
  expect(off.querySelector('sz').getAttribute('val')).toBe('15');
});
it.each([undefined, false, true].flatMap(bv => [undefined, false, true].map(bh => ({ bv, bh }))))('orders border children and retains inner-border overrides: %j', ({ bv, bh }) => {
  const source = '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="0"/><fills count="0"/><borders count="0"/><cellXfs count="0"/><dxfs count="0"/></styleSheet>';
  const writer = exportStyles(source), style = { bl: true, br: false, bt: false, bb: true, bbBorder: { bs: 'double', bc: '#684219' },
    bvBorder: { bs: 'dashed', bc: '#123456' }, bhBorder: { bs: 'medium', bc: '#abcdef' } };
  if (bv !== undefined) style.bv = bv;
  if (bh !== undefined) style.bh = bh;
  writer.cell(style); writer.differential(style);
  const document = parser.parseFromString(writer.xml(), 'application/xml');
  // ISO 29500 CT_Border / Open XML SDK's Border particle, including unused
  // optional children, rather than the writer's own iteration order.
  const sequence = ['start', 'end', 'left', 'right', 'top', 'bottom', 'diagonal', 'vertical', 'horizontal'];
  for (const border of document.querySelectorAll('border')) {
    const ranks = [...border.children].map(child => sequence.indexOf(child.localName));
    expect(ranks.every(rank => rank >= 0)).toBe(true);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(border.querySelector('bottom').getAttribute('style')).toBe('double');
  }
  const differential = document.querySelector('dxf border');
  for (const [side, value, line, rgb] of [['vertical', bv, 'dashed', 'FF123456'], ['horizontal', bh, 'medium', 'FFABCDEF']]) {
    const edge = differential.querySelector(side);
    if (value === undefined) expect(edge).toBeNull();
    else if (!value) { expect(edge).not.toBeNull(); expect(edge.attributes.length).toBe(0); expect(edge.children.length).toBe(0); }
    else { expect(edge.getAttribute('style')).toBe(line); expect(edge.querySelector('color').getAttribute('rgb')).toBe(rgb); }
  }
});

async function exported(wb) {
  const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  const zip = X.CFB.read(bytes, { type: 'array' });
  const text = path => new TextDecoder().decode(X.CFB.find(zip, path).content);
  const xml = path => {
    const doc = parser.parseFromString(text(path), 'application/xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    return doc;
  };
  // Remove metadata directly from the package. Rewriting through SheetJS would
  // discard the very native styles and drawings these tests need to examine.
  const external = () => {
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(text('/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
    part.size = part.content.length;
    return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx');
  };
  const styles = xml('/xl/styles.xml'), sheet = xml('/xl/worksheets/sheet1.xml');
  const style = address => {
    const cell = sheet.querySelector(`c[r="${address}"]`);
    expect(cell, address).not.toBeNull();
    const xf = styles.querySelector('cellXfs').children[Number(cell.getAttribute('s') || 0)];
    return { xf, font: styles.querySelector('fonts').children[Number(xf.getAttribute('fontId'))],
      fill: styles.querySelector('fills').children[Number(xf.getAttribute('fillId'))],
      border: styles.querySelector('borders').children[Number(xf.getAttribute('borderId'))] };
  };
  return { xml, style, external, bytes, sheet, styles };
}

it('writes real font, fill, border and alignment records for values and blank formatted cells', async () => {
  const s = { font: 'arial-black', size: 32, color: '#ffffff', bg: '#176371', bold: true, italic: true, underline: true,
    align: 'center', valign: 'top', wrap: true, indent: 2, bt: true, br: true, bs: 'thin', bc: '#90cf47', brBorder: { bs: 'double', bc: '#404040' } };
  const wb = new Workbook({ sheets: [{ name: 'Report', cells: { '0,0': { v: 'A & B', s }, '0,1': { s }, '1,0': { v: 0.25, s: { ...s, fmt: 'percent', dec: 1 } } } }] });
  const file = await exported(wb), style = file.style('A1');
  expect(style.font.querySelector('name').getAttribute('val')).toBe('Arial Black');
  expect(style.font.querySelector('sz').getAttribute('val')).toBe('24');
  for (const tag of ['b', 'i', 'u']) expect(style.font.querySelector(tag)).not.toBeNull();
  expect(style.fill.querySelector('fgColor').getAttribute('rgb')).toBe('FF176371');
  expect(style.border.querySelector('right').getAttribute('style')).toBe('double');
  expect(style.border.querySelector('right color').getAttribute('rgb')).toBe('FF404040');
  expect(style.border.querySelector('top').getAttribute('style')).toBe('thin');
  expect(style.xf.querySelector('alignment').getAttribute('wrapText')).toBe('1');
  expect(file.style('B1').xf).toBe(style.xf);
  expect(file.style('A2').xf.getAttribute('numFmtId')).not.toBe(style.xf.getAttribute('numFmtId'));
  const external = await file.external();
  for (const c of [0, 1]) expect(external.getCell(external.activeSheetId, 0, c).s).toMatchObject(s);
  expect(external.getDisplay(external.activeSheetId, 1, 0)).toBe('25.0%');
});

it('writes Excel units and sheet views and reopens with the same pixel geometry', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Layout', defaultColWidth: 72, defaultRowHeight: 43,
    colWidths: { 0: 21, 1: 174, 2: 131 }, rowHeights: { 0: 50, 5: 64 }, frozenRows: 3, frozenCols: 2,
    gridlines: false, zeros: false, color: '#176371', cells: { '0,0': { v: 'Title' } } }] });
  const file = await exported(wb);
  expect(file.sheet.querySelector('row[r="1"]').getAttribute('ht')).toBe('37.5');
  expect(file.sheet.querySelector('col[min="2"]').getAttribute('width')).toBe('21.75');
  expect(file.sheet.querySelector('sheetFormatPr').getAttribute('defaultRowHeight')).toBe('32.25');
  expect(file.sheet.querySelector('sheetView').getAttribute('showGridLines')).toBe('0');
  expect(file.sheet.querySelector('sheetView').getAttribute('showZeros')).toBe('0');
  expect(file.sheet.querySelector('pane').getAttribute('topLeftCell')).toBe('C4');
  for (const back of [await workbookFromFile(file.bytes, 'own.xlsx'), await file.external()]) {
    expect([...back.activeSheet.colWidths]).toEqual([...wb.activeSheet.colWidths]);
    expect([...back.activeSheet.rowHeights]).toEqual([...wb.activeSheet.rowHeights]);
    expect(back.activeSheet.defaultRowHeight).toBe(43);
    expect(back.activeSheet.defaultColWidth).toBe(72);
    expect(back.activeSheet.gridlines).toBe(false);
  }
});

it('keeps inherited native styles out of the original cell overrides on reopening', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Data', colStyles: { 1: { bg: '#ffeeee', color: '#123456', bold: true } },
    rowStyles: { 6: { italic: true } }, cells: { '0,1': { v: 10 }, '1,1': { v: 20, s: { bg: null, bold: false } } } }] });
  const file = await exported(wb);
  expect(file.style('B1').fill.querySelector('fgColor').getAttribute('rgb')).toBe('FFFFEEEE');
  expect(file.style('B2').fill.querySelector('patternFill').getAttribute('patternType')).toBe('none');
  expect(file.sheet.querySelector('col[min="2"]').hasAttribute('style')).toBe(true);
  expect(file.sheet.querySelector('row[r="7"]').getAttribute('customFormat')).toBe('1');
  const back = await workbookFromFile(file.bytes, 'own.xlsx');
  expect(back.getCell(back.activeSheetId, 0, 1).s).toBeUndefined();
  expect(back.getCell(back.activeSheetId, 1, 1).s).toEqual({ bg: null, bold: false });
  back.applyStyle(back.activeSheetId, { r1: 0, r2: back.activeSheet.rows - 1, c1: 1, c2: 1 }, { color: '#abcdef' });
  expect(back.styleAt(back.activeSheetId, 0, 1).color).toBe('#abcdef');
});

it.each([26, 43.5, 71])('retains fixed %spx default heights on materialized rows without expanding sparse sheets', async defaultRowHeight => {
  const wb = new Workbook({ sheets: [{ name: 'Heights', rows: 1048576, defaultRowHeight,
    rowHeights: { 4: 87 }, hiddenRows: [6], rowStyles: { 8: { italic: true } },
    cells: { '0,0': { v: 'Ordinary' }, '2,1': { s: { bg: '#abcdef' } },
      '10,2': { v: 'Large\nwrapped text', s: { size: 64, wrap: true } }, '900000,0': { v: 'Far away' } },
  }] });
  const file = await exported(wb);
  const rows = [...file.sheet.querySelectorAll('sheetData > row')];
  expect(rows.length).toBe(7);
  for (const row of rows) {
    expect(Number(row.getAttribute('ht'))).toBe((row.getAttribute('r') === '5' ? 87 : defaultRowHeight) * 3 / 4);
    expect(row.getAttribute('customHeight')).toBe('1');
  }
  expect(file.sheet.querySelector('row[r="7"]').getAttribute('hidden')).toBe('1');
  expect(file.sheet.querySelector('row[r="9"]').getAttribute('customFormat')).toBe('1');
  const back = await file.external();
  expect(back.activeSheet.defaultRowHeight).toBe(defaultRowHeight);
  expect([...back.activeSheet.rowHeights]).toEqual([[4, 87]]);
  expect(back.rowHeight(back.activeSheetId, 900000)).toBe(defaultRowHeight);
});

it('exports native tables with custom stripes and escaped headers', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Data', cells: { '0,0': { v: 'Item & type' }, '0,1': { v: 'Price' }, '1,0': { v: 'A' }, '1,1': { v: 5 } },
    tables: [{ name: 'Sales', range: { r1: 0, c1: 0, r2: 4, c2: 1 }, style: 'custom', banded: true,
      customStyle: { headerRow: { bg: '#000000', color: '#ffffff', bold: true }, firstRowStripe: { bg: '#d9d9d9' } } }] }] });
  const file = await exported(wb), table = file.xml('/xl/tables/table1.xml');
  expect(table.querySelector('tableColumn').getAttribute('name')).toBe('Item & type');
  expect(table.querySelector('table').getAttribute('ref')).toBe('A1:B5');
  expect(file.styles.querySelector('tableStyleElement[type="firstRowStripe"]')).not.toBeNull();
  const back = await file.external(), t = back.activeSheet.tables[0];
  expect(t.name).toBe('Sales');
  expect(t.customStyle.firstRowStripe.bg).toBe('#d9d9d9');
});

it('exports imported charts as native DrawingML with live sources and updated values', async () => {
  const wb = await workbookFromFile(chartXlsx({ embedded: true }), 'chart.xlsx');
  wb.setInput(wb.activeSheetId, 0, 1, '5.8');
  const file = await exported(wb), chart = file.xml('/xl/charts/chart1_1.xml');
  expect(chart.getElementsByTagNameNS('*', 'lineChart').length).toBe(1);
  expect([...chart.getElementsByTagNameNS('*', 'f')].map(n => n.textContent)).toContain('Data!$B$1:$B$80');
  expect([...chart.getElementsByTagNameNS('*', 'v')].map(n => n.textContent)).toContain('5.8');
  const back = await file.external(), ch = back.activeSheet.charts[0];
  expect(ch.type).toBe('line');
  expect(ch.title).toBe('Daily average & sample mean');
  expect(ch.appearance.lines[0].markerFill).toBe('#ffffff');
  expect(chartData(back, back.activeSheetId, ch).series[0].values).toEqual([5.8, 4.2, 2]);
});

it('links newly created charts to their worksheet cells', async () => {
  const wb = new Workbook({ sheets: [{ name: "A & B's", cells: { '0,0': { v: 'Item' }, '0,1': { v: 'Value' }, '1,0': { v: 'First' }, '1,1': { v: 5 }, '2,0': { v: 'Next' }, '2,1': { v: 9 } },
    charts: [defaultChart({ r1: 0, c1: 0, r2: 2, c2: 1 }, { r: 1, c: 4 })] }] });
  const file = await exported(wb), back = await file.external();
  const ch = back.activeSheet.charts[0];
  expect(ch.sourceRefs[0].values).toBe("'A & B''s'!B2:B3");
  back.setInput(back.activeSheetId, 1, 1, '42');
  expect(chartData(back, back.activeSheetId, ch).series[0].values).toEqual([42, 9]);
});

it('embeds pictures with their placement and keeps existing hyperlink and comment relationships', async () => {
  const src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
  const wb = new Workbook({ sheets: [{ name: 'Data', cells: { '0,0': { f: 'HYPERLINK("https://example.com","Link")' } }, notes: { '0,0': 'A note' },
    charts: [{ type: 'image', src, title: 'A & B', anchor: { r: 3, c: 2 }, dx: 7, dy: 8, w: 120, h: 60, flipH: true, rotation: 30 }] }] });
  const file = await exported(wb), drawing = file.xml('/xl/drawings/drawing1.xml');
  expect(drawing.getElementsByTagNameNS('*', 'col')[0].textContent).toBe('2');
  expect(drawing.getElementsByTagNameNS('*', 'ext')[0].getAttribute('cx')).toBe(String(120 * 9525));
  const back = await file.external();
  expect(back.activeSheet.charts[0]).toMatchObject({ src, anchor: { r: 3, c: 2 }, dx: 7, dy: 8, w: 120, h: 60, rotation: 30, flipH: true });
  expect(back.activeSheet.notes.get('0,0')).toBe('A note');
  expect(back.linkAt(back.activeSheetId, 0, 0).url).toBe('https://example.com');
});

it('keeps number-format literals intact when extending the native style table', async () => {
  const code = '0.0" $& $` $\' <tag>"';
  const wb = new Workbook({ sheets: [{ name: 'Data', cells: { '0,0': { v: 12, s: { fmt: 'custom', code, bg: '#ffeeee' } } } }] });
  const file = await exported(wb);
  const xf = file.style('A1').xf;
  expect(file.styles.querySelector(`numFmt[numFmtId="${xf.getAttribute('numFmtId')}"]`).getAttribute('formatCode')).toBe(code);
});
