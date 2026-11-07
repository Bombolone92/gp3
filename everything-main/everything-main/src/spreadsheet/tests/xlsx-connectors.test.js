import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { shapeXlsx } from './helpers/xlsx-shape-fixture.js';

const change = (zip, path, rewrite) => { const p = X.CFB.find(zip, path); p.content = new TextEncoder().encode(rewrite(new TextDecoder().decode(p.content))); p.size = p.content.length; };
function fixture(w, h, stroke = 1, linked = false) {
  const zip = X.CFB.read(new Uint8Array(shapeXlsx({ preset: 'line', text: '', width: w, height: h, stroke: true })), { type: 'array' });
  change(zip, '/xl/drawings/shapes.xml', xml => {
    let connector = xml.replaceAll('xdr:nvSpPr', 'xdr:nvCxnSpPr').replaceAll('xdr:cNvSpPr', 'xdr:cNvCxnSpPr').replaceAll('xdr:sp>', 'xdr:cxnSp>')
      .replace(/<xdr:txBody>[\s\S]*?<\/xdr:txBody>/, '').replace('name="Invoice logo"', 'name="Connector"').replace('<a:ln w="9525">', `<a:ln w="${stroke * 9525}">`);
    if (linked) {
      connector = connector.replace('<xdr:cNvCxnSpPr/>', '<xdr:cNvCxnSpPr><a:stCxn id="8" idx="1"/><a:endCxn id="8" idx="3"/></xdr:cNvCxnSpPr>');
      const target = /<xdr:oneCellAnchor>[\s\S]*?<\/xdr:oneCellAnchor>/.exec(new TextDecoder().decode(X.CFB.find(X.CFB.read(new Uint8Array(shapeXlsx({ text: 'Target' })), { type: 'array' }), '/xl/drawings/shapes.xml').content))[0]
        .replace('id="2"', 'id="8"').replace('<xdr:col>2</xdr:col>', '<xdr:col>5</xdr:col>');
      connector = connector.replace('</xdr:wsDr>', target + '</xdr:wsDr>');
    }
    return connector;
  });
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
async function exported(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  change(zip, '/xl/workbook.xml', xml => xml.replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  return { zip, wb: await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx') };
}
const nodes = n => [n, ...n.children.flatMap(nodes)];
it.each([[0, 80, 1], [130, 0, .4], [130, 80, 2]])('imports and round trips a %s × %s connector with its native stroke (%s)', async (w, h, stroke) => {
  let wb = await workbookFromFile(fixture(w, h, stroke), 'line.xlsx');
  for (let pass = 0; pass < 3; pass++) {
    expect(wb.activeSheet.charts).toHaveLength(1);
    const ch = wb.activeSheet.charts[0];
    expect(ch.drawingShape).toBe(true); expect(ch.nativeDrawing).toBeTruthy();
    // Native group crop boundaries use integer EMUs; allow integer-EMU crop rounding.
    expect(ch.w).toBeCloseTo(w + stroke, 3); expect(ch.h).toBeCloseTo(h + stroke, 3);
    expect(ch.dx).toBeCloseTo(1 - stroke / 2, 3); expect(ch.dy).toBeCloseTo(2 - stroke / 2, 3);
    const shape = nodes(ch.nativeDrawing.node).find(n => n.name === 'cxnSp'); expect(shape).toBeTruthy();
    const extent = nodes(shape).find(n => n.name === 'ext'); expect(Number(extent.attrs.cx)).toBe(w * 9525); expect(Number(extent.attrs.cy)).toBe(h * 9525);
    const svg = new JSDOM(Buffer.from(ch.src.split(',')[1], 'base64').toString(), { contentType: 'image/svg+xml' });
    expect(svg.window.document.querySelector('path[stroke="#000000"]')).toBeTruthy();
    wb = (await exported(wb)).wb;
  }
});
it('duplicates a subpixel vertical stroke without widening its native geometry', async () => {
  const wb = await workbookFromFile(fixture(0, 53, .4), 'thin.xlsx'), id = wb.activeSheetId;
  const copy = wb.duplicateChart(id, wb.activeSheet.charts[0].id);
  expect(wb.chartById(id, copy).w).toBeCloseTo(.4, 8);
  const out = (await exported(wb)).wb;
  expect(out.activeSheet.charts).toHaveLength(2);
  for (const ch of out.activeSheet.charts) expect(ch.w).toBeCloseTo(.4, 8);
  wb.undo(); expect(wb.activeSheet.charts).toHaveLength(1);
});
it('remaps connector endpoint identities to the emitted target shapes', async () => {
  let wb = await workbookFromFile(fixture(120, 60, 1, true), 'linked.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const all = wb.activeSheet.charts.flatMap(ch => nodes(ch.nativeDrawing.node));
    const connector = all.find(n => n.name === 'cxnSp');
    expect(connector.connections.start.index).toBe(1); expect(connector.connections.end.index).toBe(3);
    expect(all.find(n => n.key === connector.connections.start.target)?.name).toBe('sp');
    const out = await exported(wb);
    const xml = new JSDOM(new TextDecoder().decode(X.CFB.find(out.zip, '/xl/drawings/drawing1.xml').content), { contentType: 'text/xml' }).window.document;
    for (const link of [...xml.getElementsByTagNameNS('*', 'stCxn'), ...xml.getElementsByTagNameNS('*', 'endCxn')]) {
      const target = [...xml.getElementsByTagNameNS('*', 'cNvPr')].find(n => n.getAttribute('id') === link.getAttribute('id'));
      expect(target?.parentElement.parentElement.textContent).toContain('Target');
    }
    wb = out.wb;
  }
});
it('keeps endpoint references local when a connected group is duplicated', async () => {
  const zip = X.CFB.read(new Uint8Array(fixture(120, 60, 1, true)), { type: 'array' });
  change(zip, '/xl/drawings/shapes.xml', xml => {
    const shapes = [...xml.matchAll(/<xdr:(sp|cxnSp)>[\s\S]*?<\/xdr:\1>/g)].map(m => m[0]).join('');
    const group = `<xdr:grpSp><xdr:nvGrpSpPr><xdr:cNvPr id="15" name="Connected group"/><xdr:cNvGrpSpPr/></xdr:nvGrpSpPr><xdr:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2857500" cy="1905000"/><a:chOff x="0" y="0"/><a:chExt cx="2857500" cy="1905000"/></a:xfrm></xdr:grpSpPr>${shapes}</xdr:grpSp>`;
    const anchor = `<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="2857500" cy="1905000"/>${group}<xdr:clientData/></xdr:oneCellAnchor>`;
    return xml.replace(/<xdr:oneCellAnchor>[\s\S]*<\/xdr:oneCellAnchor>/, anchor);
  });
  const wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'group.xlsx');
  expect(wb.activeSheet.charts).toHaveLength(1);
  wb.duplicateChart(wb.activeSheetId, wb.activeSheet.charts[0].id);
  const out = await exported(wb);
  const xml = new JSDOM(new TextDecoder().decode(X.CFB.find(out.zip, '/xl/drawings/drawing1.xml').content), { contentType: 'text/xml' }).window.document;
  const targets = [];
  for (const anchor of xml.documentElement.children) {
    const link = anchor.getElementsByTagNameNS('*', 'stCxn')[0]; expect(link).toBeTruthy();
    const target = [...anchor.getElementsByTagNameNS('*', 'cNvPr')].find(n => n.getAttribute('id') === link.getAttribute('id'));
    expect(target?.parentElement.parentElement.textContent).toContain('Target'); targets.push(link.getAttribute('id'));
  }
  expect(new Set(targets).size).toBe(2);
});
