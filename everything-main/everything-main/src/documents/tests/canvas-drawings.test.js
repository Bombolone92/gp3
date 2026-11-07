import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage, W } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutDocument, hitTest, selectionRects } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { EMU_PER_PX, OBJECT } from '../src/engine/images.js';
import { WP, A, R } from '../src/engine/docx-images.js';
import { C } from '../src/engine/docx-charts.js';
import { chartScale, paintChart } from '../src/engine/canvas-charts.js';
import { resolveCapitalization } from '../src/engine/capitalization.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/charts-and-anchors.docx');
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const save = async (p, d) => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
const pictures = d => d.paragraphs.flatMap(p => p.runs.filter(r => r.image).map(r => r.image));
const measure = (t, s) => ({ width: t.length * s.fontSize * .6, ascent: s.fontSize, descent: s.fontSize / 3 });
const layout = d => layoutDocument(d.paragraphs, measure, pageGeometry(d.pageSettings), d.numbering, d.tables);
const node = (root, ns, name) => root.getElementsByTagNameNS(ns, name)[0];
function changed(fn, path = 'word/document.xml') {
  const parts = unzipSync(source), doc = new DOMParser().parseFromString(strFromU8(parts[path]), 'application/xml');
  fn(doc, parts); parts[path] = strToU8(new XMLSerializer().serializeToString(doc)); return zipSync(parts);
}
function unchanged(parts, originals, except = []) {
  expect(Object.keys(parts).sort()).toEqual(Object.keys(originals).sort());
  for (const [name, bytes] of Object.entries(originals)) if (!except.includes(name)) expect(Buffer.from(parts[name]).equals(Buffer.from(bytes)), name).toBe(true);
}

it('opens independently generated cached charts and full-column anchors, with byte-preserving no-edit export', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), [chart, anchor] = pictures(doc);
  expect(chart).toMatchObject({ kind: 'chart', name: 'Quarterly results', width: 4114800, height: 2011680 });
  expect(anchor).toMatchObject({ anchor: { horizontal: 'columnCenter', vertical: 'paragraphTop', wrap: 'square' }, width: 4572000, height: 1143000 });
  const data = pkg.assets[chart.assetId].chart;
  expect(data.series.map(s => s.values)).toEqual([[6, 4, 8, 2], [3, -2, 5, 7], [2, 3, 4, 6]]);
  expect(data.series[0].categories).toEqual(['Q1', 'Q2', 'Q3', 'Q4']); expect(data.series.map(s => s.name)).toEqual(['North', 'South', 'West']);
  expect(data.series.map(s => s.fill)).toEqual(['#004586', '#ff420e', '#ffd320']);
  expect(doc.paragraphs[0].runs[0].capitalization).toBe('normal'); expect(doc.tables).toHaveLength(1);
  unchanged(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('round-trips text, chart size/alt edits and floating-picture alt while retaining chart data and anchor metadata', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), [chart, anchor] = pictures(doc);
  doc.select(0); doc.replace('Edited ');
  let at = doc.text.indexOf(OBJECT); doc.select(at, at + 1); doc.setImageProperties({ width: 3657600, alt: 'Chart retained after editing' });
  expect(() => doc.setImageProperties({ crop: { left: 1000 } })).toThrow(/Chart cropping/);
  expect(() => doc.setImageProperties({ flipH: true })).toThrow(/Chart cropping/);
  expect(() => doc.setImageProperties({ rotation: 5400000 })).toThrow(/Chart cropping/);
  at = doc.text.lastIndexOf(OBJECT); doc.select(at, at + 1); doc.setImageProperties({ alt: 'Picture retained after editing' });
  const bytes = await save(pkg, doc), reopened = model(await DocxPackage.open(bytes));
  expect(reopened.text).toBe(doc.text); expect(pictures(reopened)[0]).toMatchObject({ width: 3657600, height: chart.height, alt: 'Chart retained after editing' });
  expect(pictures(reopened)[1]).toMatchObject({ width: anchor.width, anchor: anchor.anchor, alt: 'Picture retained after editing' });
  expectBodyEditParts(unzipSync(bytes), pkg.parts);
  while (doc.history.length) doc.undo(); unchanged(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('keeps charts atomic through text splits, deletion, undo and redo', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), at = doc.text.indexOf(OBJECT);
  doc.select(at); doc.replace('Before '); doc.insertParagraph(); const pos = doc.text.indexOf(OBJECT);
  doc.select(pos + 1); doc.replace(' after'); doc.select(pos, pos + 1); doc.replace(''); expect(pictures(doc)).toHaveLength(1);
  doc.undo(); expect(pictures(doc)).toHaveLength(2); doc.redo(); expect(pictures(doc)).toHaveLength(1); doc.undo();
  const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(reopened.text).toBe(doc.text); expect(pictures(reopened)[0].kind).toBe('chart');
  expectBodyEditParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('positions full-column floats at the paragraph top independently of text line spacing and keeps them on one page', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), at = doc.text.lastIndexOf(OBJECT);
  doc.select(at, at + 1); doc.setParagraphFormat({ lineSpacing: 3, alignment: 'right', indentLeft: 600 });
  const result = layout(doc), line = result.lines.find(l => l.fragments.some(f => f.image?.anchor)), f = line.fragments[0];
  expect(f.x).toBeCloseTo(result.page.left); expect(line.height).toBeCloseTo(f.image.height / EMU_PER_PX);
  expect(line.baseline - f.ascent).toBeCloseTo(line.y); expect(line.y + line.height).toBeLessThanOrEqual(result.page.height - result.page.bottom);
  expect(hitTest(result, line.page, f.x + 1, line.y + line.height / 2)).toBe(at);
  expect(selectionRects(result, at, at + 1).some(r => r.width >= f.width)).toBe(true);
  expect(layout(model(await DocxPackage.open(await save(pkg, doc)))).pageCount).toBe(result.pageCount);
  doc.setImageProperties({ width: 2286000, height: 571500 }); expect(() => layout(doc)).toThrow(/full text column/); doc.undo();
  doc.select(at); doc.replace('Unsafe side text'); expect(() => layout(doc)).toThrow(/standalone/); doc.undo();
  doc.select(at + 1); doc.delete(-1); expect(pictures(doc)).toHaveLength(1); doc.undo(); expect(layout(doc).pageCount).toBe(result.pageCount);
});

it('accepts paired-off capitalization as a retained compatibility form, including inherited styles and marks', async () => {
  for (const inherited of ['caps', 'smallCaps']) {
    const bytes = changed(xml => {
      const p = node(xml, W, 'p'), props = xml.createElementNS(W, 'w:pPr'), style = xml.createElementNS(W, 'w:pStyle'); style.setAttributeNS(W, 'w:val', 'Title'); props.append(style);
      const mark = node(p, W, 'rPr').cloneNode(true); props.append(mark); p.prepend(props);
    });
    const parts = unzipSync(bytes), styles = new DOMParser().parseFromString(strFromU8(parts['word/styles.xml']), 'application/xml');
    const title = [...styles.getElementsByTagNameNS(W, 'style')].find(n => n.getAttributeNS(W, 'styleId') === 'Title');
    const props = node(title, W, 'rPr'), flag = styles.createElementNS(W, `w:${inherited}`); props.append(flag);
    parts['word/styles.xml'] = strToU8(new XMLSerializer().serializeToString(styles));
    const pkg = await DocxPackage.open(zipSync(parts)), doc = model(pkg); expect(doc.styles.definitions.Title.run.capitalization).toBe(inherited);
    expect(doc.paragraphs[0].runs[0].capitalization).toBe('normal'); expect(doc.paragraphs[0].markFormat.capitalization).toBe('normal');
    doc.select(3); doc.replace('x'); expect(model(await DocxPackage.open(await save(pkg, doc))).paragraphs[0].runs.every(r => r.capitalization === 'normal')).toBe(true);
    expect(resolveCapitalization(inherited, 'bothCapsOff')).toBe('normal');
  }
});

it.each([
  ['external chart', (xml) => { const c = [...xml.getElementsByTagNameNS('*', 'Relationship')].find(n => n.getAttribute('Type') === `${R}/chart`); c.setAttribute('TargetMode', 'External'); }, 'word/_rels/document.xml.rels'],
  ['missing cache', xml => node(xml, C, 'numCache').remove(), 'word/charts/chart1.xml'],
  ['duplicate cache indices', xml => { const pts = node(xml, C, 'numCache').getElementsByTagNameNS(C, 'pt'); pts[1].setAttribute('idx', pts[0].getAttribute('idx')); }, 'word/charts/chart1.xml'],
  ['nonfinite values', xml => node(node(xml, C, 'numCache'), C, 'v').textContent = 'NaN', 'word/charts/chart1.xml'],
  ['inconsistent axes', xml => node(xml, C, 'crossAx').setAttribute('val', '999'), 'word/charts/chart1.xml'],
  ['standard bars', xml => node(xml, C, 'grouping').setAttribute('val', 'standard'), 'word/charts/chart1.xml'],
  ['visible data labels', xml => { const labels = xml.createElementNS(C, 'c:dLbls'), show = xml.createElementNS(C, 'c:showVal'); labels.append(show); node(xml, C, 'barChart').append(labels); }, 'word/charts/chart1.xml'],
  ['per-point formatting', xml => node(xml, C, 'ser').append(xml.createElementNS(C, 'c:dPt')), 'word/charts/chart1.xml'],
  ['external workbook', xml => xml.documentElement.append(xml.createElementNS(C, 'c:externalData')), 'word/charts/chart1.xml'],
  ['page positioning', xml => node(xml, WP, 'positionH').setAttribute('relativeFrom', 'page')],
  ['behind text', xml => node(xml, WP, 'anchor').setAttribute('behindDoc', '1')],
  ['nonzero distances', xml => node(xml, WP, 'anchor').setAttribute('distL', '9525')],
  ['unsupported picture outline pattern', xml => node(xml, A, 'ln').append(xml.createElementNS(A, 'a:pattFill'))],
  ['editing locks', xml => node(xml, A, 'picLocks').setAttribute('noMove', '1')],
])('rejects %s before creating an editable package', async (_, change, path) => {
  await expect(DocxPackage.open(changed(change, path))).rejects.toThrow();
});

it('reads schema defaults and percent gap width without changing the source', async () => {
  const pkg = await DocxPackage.open(changed(xml => {
    node(xml, C, 'gapWidth').setAttribute('val', '200%'); node(xml, C, 'grouping').removeAttribute('val'); node(xml, C, 'legendPos').removeAttribute('val');
  }, 'word/charts/chart1.xml'));
  expect(pkg.assets[pictures(pkg)[0].assetId].chart.gap).toBe(200);
  unchanged(unzipSync(await save(pkg, model(pkg))), pkg.parts);
});

it('paints indexed clustered bars around zero using gapWidth in units of one bar', async () => {
  const pkg = await DocxPackage.open(source), chart = pkg.assets[pictures(pkg)[0].assetId].chart;
  const rects = [], labels = [];
  const ctx = { save() {}, restore() {}, measureText: t => ({ width: t.length * 6 }), fillRect(x, y, w, h) { rects.push({ color: this.fillStyle, x, y, w, h }); }, fillText(t) { labels.push(t); }, strokeRect: vi.fn(), beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  paintChart(ctx, chart, 480, 240);
  expect(chartScale(chart.series)).toEqual({ min: -2, max: 8, step: 2 });
  expect(chartScale([{ values: [-8, -4] }]).max).toBe(0); expect(chartScale([{ values: [0, 0] }]).max).toBeGreaterThan(0);
  const bars = rects.filter(r => r.color === '#004586'); expect(bars).toHaveLength(5); // Four bars and the legend key.
  expect(bars[1].x - bars[0].x).toBeCloseTo(bars[0].w * 4); expect(bars[0].h / bars[1].h).toBeCloseTo(1.5);
  expect(labels).toEqual(expect.arrayContaining(['Q1', 'Q2', 'Q3', 'Q4', 'North', 'South', 'West', '-2', '0', '8']));
});
