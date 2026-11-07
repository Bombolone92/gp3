import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage, W } from '../src/engine/docx.js';
import { TextDocument, paragraphText } from '../src/engine/model.js';
import { layoutDocument, imageAtPoint, selectionRects } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { rowGrid, fixedColumnWidths, autoColumnWidths } from '../src/engine/tables.js';
import { WP } from '../src/engine/docx-images.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
import { canonicalXml } from './helpers/canonical-xml.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/annual-report.docx');
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const save = async (p, d) => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
const layout = d => layoutDocument(d.paragraphs, (text, style) => ({ width: text.length * style.fontSize * .6, ascent: style.fontSize, descent: style.fontSize / 3 }), pageGeometry(d.pageSettings), d.numbering, d.tables);
const first = (root, ns, name) => root.getElementsByTagNameNS(ns, name)[0];
function changed(fn) {
  const parts = unzipSync(source), doc = new DOMParser().parseFromString(strFromU8(parts['word/document.xml']), 'application/xml');
  fn(doc); parts['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(doc)); return zipSync(parts);
}
function retained(bytes, parts, edited = false) {
  const out = unzipSync(bytes); if (edited) { expectBodyEditParts(out, parts); return; }
  expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort());
  for (const [name, bytes] of Object.entries(parts)) expect(Buffer.from(out[name]).equals(Buffer.from(bytes)), name).toBe(true);
}

it('reads omitted grid columns and resolves row margin exceptions below direct cell margins', async () => {
  const folder = 'tests/fixtures/annual-report-origin', native = JSON.parse(readFileSync(`${folder}/reference.json`));
  expect(createHash('sha256').update(source).digest('hex')).toBe(native.sourceSha256);
  expect(createHash('sha256').update(readFileSync(`${folder}/native.pdf`)).digest('hex')).toBe(native.pdfSha256);
  const pkg = await DocxPackage.open(source), doc = model(pkg), table = doc.tables[0];
  expect(table.indent).toBe(-360); expect(table.rows.map(r => r.cells.length)).toEqual([4, 2, 3]);
  expect(rowGrid(table.rows[2]).map(c => [c.column, c.span])).toEqual([[0, 1], [1, 1], [2, 2]]);
  expect(table.rows[1]).toMatchObject({ gridBefore: 1, gridAfter: 1, widthBefore: { type: 'dxa', value: 2160 }, widthAfter: { type: 'dxa', value: 2160 } });
  expect(rowGrid(table.rows[1]).map(c => c.column)).toEqual([1, 2]);
  expect(table.rows[0].cells[0].margins).toEqual({ top: 30, left: 180, bottom: 120, right: 180 });
  expect(table.rows[0].cells[1].margins.top).toBe(120);
  const result = layout(doc), boxes = result.cells.filter(c => c.rowId === table.rows[1].id);
  expect(boxes).toHaveLength(2);
  const writingInset = table.rows[1].cells[0].margins.left / 20;
  expect(Math.abs(boxes[0].x * .75 + writingInset - native.positions['Cell 2.2'].x)).toBeLessThanOrEqual(.1);
  const cells = doc.paragraphs.filter(p => p.cellId && native.positions[paragraphText(p).replace(/\ufffc/g, '').trim()]);
  expect(cells).toHaveLength(Object.keys(native.positions).length);
  for (const p of cells) {
    const expected = native.positions[paragraphText(p).replace(/\ufffc/g, '').trim()];
    const line = result.lines.find(l => l.paragraphId === p.id);
    expect(line.page).toBe(expected.page);
    expect(Math.abs(line.stops[0].x * .75 - expected.x)).toBeLessThanOrEqual(.1);
  }
  retained(await save(pkg, doc), pkg.parts);
});

it('retains zero spacing and source XML through text and cell edits, paragraph splitting, reopening and full undo', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  expect(doc.paragraphs[1].format.lineSpacing).toBe(0); expect(layout(doc).lines.find(l => l.paragraphId === doc.paragraphs[1].id).height).toBe(0);
  doc.select(doc.paragraphOffset(1)); doc.setParagraphFormat({ alignment: 'right' }); doc.replace('Zero'); doc.insertParagraph();
  doc.select(doc.text.indexOf('Cell 2.2')); doc.replace('Changed ');
  const bytes = await save(pkg, doc), reopened = model(await DocxPackage.open(bytes));
  expect(reopened.text).toBe(doc.text); expect(reopened.tables[0].rows[1].gridBefore).toBe(1);
  expect(reopened.paragraphs.slice(1, 3).map(p => p.format.lineSpacing)).toEqual([0, 0]);
  expect(layout(reopened).pageCount).toBeGreaterThan(0); expectBodyEditParts(unzipSync(bytes), pkg.parts);
  while (doc.history.length) doc.undo(); retained(await save(pkg, doc), pkg.parts);
});

it('keeps sparse rows intact through insertion, deletion, undo, formatting and namespace-preserving export', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  doc.select(doc.text.indexOf('Cell 2.2')); doc.insertTableRow();
  let reopened = model(await DocxPackage.open(await save(pkg, doc)));
  expect(reopened.tables[0].rows).toHaveLength(4); expect(reopened.tables[0].rows[2]).toMatchObject({ gridBefore: 1, gridAfter: 1 });
  expect(reopened.tables[0].rows[2].cells).toHaveLength(2); layout(reopened);
  doc.undo(); doc.select(doc.text.indexOf('Cell 2.2')); const before = doc.snapshot();
  expect(() => doc.insertTableColumn()).toThrow(/omitted/); expect(() => doc.deleteTablePart('column')).toThrow(/omitted/);
  expect(doc.snapshot()).toEqual(before);
  doc.setTableProperties({ indent: -180 }); doc.setCellMargins({ top: 240 });
  reopened = model(await DocxPackage.open(await save(pkg, doc)));
  expect(reopened.tables[0].indent).toBe(-180); expect(reopened.tables[0].rows[1].cells[0].margins.top).toBe(240);
  doc.deleteTablePart('row'); expect(doc.tables[0].rows).toHaveLength(2); layout(doc); doc.undo(); layout(doc);
});

it('positions floating cell icons relative to cell text margins and excludes them from inline advances', async () => {
  const doc = model(await DocxPackage.open(source)), result = layout(doc), icon = result.floatingObjects.find(f => f.image.anchor.wrap === 'none');
  const host = result.lines.find(l => l.start <= icon.start && l.end >= icon.end), box = result.cells.find(c => c.id === host.cellId && c.page === host.page);
  expect(icon.x).toBeCloseTo(box.x + 12 + 10); expect(icon.y).toBeCloseTo(host.y + 2);
  expect(host.fragments.find(f => f.image).width).toBe(0); expect(icon.baselineShift).toBe(-11.5);
  expect(box.y + box.height).toBeLessThan(icon.y + icon.height); expect(icon.cellClip).toBeUndefined();
  expect(imageAtPoint(result, icon.page, icon.x + 1, icon.y + 1)).toEqual(icon);
  expect(selectionRects(result, icon.start, icon.end)).toContainEqual({ page: icon.page, x: icon.x, y: icon.y, width: icon.width, height: icon.height });
  doc.select(icon.start, icon.end); doc.replace(''); expect(layout(doc).floatingObjects).toHaveLength(1); doc.undo(); expect(layout(doc)).toEqual(result);
});

it('positions lowered inline images below the text baseline and hit-tests the full picture', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), result = layout(doc);
  const line = result.lines.find(l => l.fragments.some(f => f.image && !f.image.anchor));
  const image = line.fragments.find(f => f.image); expect(image.descent).toBeCloseTo(11.5 * 4 / 3);
  expect(image.ascent + image.descent).toBeCloseTo(image.image.height / 9525);
  expect(imageAtPoint(result, line.page, image.x + 1, line.baseline + image.descent - 1)).toEqual(image);
  doc.select(image.start, image.end); doc.setRunFormat({ baselineShift: 3 });
  const reopened = model(await DocxPackage.open(await save(pkg, doc)));
  const raised = layout(reopened).lines.flatMap(l => l.fragments).find(f => f.image && !f.image.anchor);
  expect(raised.descent).toBe(-4); doc.undo(); expect(layout(doc)).toEqual(result);
});

it('repeats floating header icons on each physical header and permits unwrapped cell overflow', async () => {
  const doc = model(await DocxPackage.open(source)), table = doc.tables[0];
  const host = doc.paragraphs.find(p => p.runs.some(r => r.image?.anchor?.wrap === 'none'));
  const run = host.runs.find(r => r.image), target = doc.paragraphs.find(p => p.cellId === table.rows[0].cells[1].id);
  host.runs = host.runs.filter(r => r !== run); target.runs.push(run); table.rows[0].header = true;
  doc.setPageSettings({ height: 6120, top: 360, bottom: 360 });
  doc.select(doc.text.indexOf('Cell 2.2')); doc.replace('Flowing body text. '.repeat(120));
  const result = layout(doc), icons = result.floatingObjects.filter(f => f.image.anchor.wrap === 'none');
  expect(icons.length).toBeGreaterThan(1);
  for (const icon of icons) {
    const header = [...result.lines, ...result.repeatedLines].find(l => l.paragraphId === target.id && l.page === icon.page);
    expect(icon.y).toBeCloseTo(header.y + 2); expect(imageAtPoint(result, icon.page, icon.x + 1, icon.y + 1)).toEqual(icon);
  }
  run.image.anchor.y = -914400;
  const overflow = layout(doc).floatingObjects.filter(f => f.image.anchor.wrap === 'none');
  expect(overflow.length).toBe(icons.length);
  expect(overflow.every(f => !f.cellClip)).toBe(true);
  expect(overflow[0].y).toBeCloseTo(icons[0].y - 96 - 2);
});

it('authors fractional and zero automatic spacing in shared styles without resetting picture position', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  doc.select(0); doc.editParagraphStyle('Normal', { paragraph: { lineRule: 'auto', lineSpacing: .25 } });
  doc.select(doc.paragraphOffset(1)); doc.setParagraphLineSpacing({ lineRule: 'auto', lineSpacing: 0 });
  const reopened = model(await DocxPackage.open(await save(pkg, doc)));
  expect(reopened.paragraphs[0].format.lineSpacing).toBe(.25); expect(reopened.paragraphs[1].format.lineSpacing).toBe(0);
  expect(reopened.paragraphs.flatMap(p => p.runs).find(r => r.image).baselineShift).toBe(-11.5);
});

it('uses page-text width for percentage omitted-width preferences and augments an explicit short grid', async () => {
  const table = { grid: [1000, 1000, 1000], rows: [{ gridBefore: 1, gridAfter: 1, widthBefore: { type: 'pct', value: 1000 }, widthAfter: { type: 'dxa', value: 1400 }, cells: [{ width: { type: 'dxa', value: 1600 } }] }] };
  expect(fixedColumnWidths(table, 6000)).toEqual([1200, 1600, 1400]);
  expect(autoColumnWidths(table, 6000, table.grid.map(() => ({ min: 1, max: 100, floor: 1 })))).toEqual([1200, 1600, 1400]);
  const pkg = await DocxPackage.open(changed(x => first(x, W, 'tblGrid').lastElementChild.remove()));
  expect(pkg.tables[0].grid).toHaveLength(4);
});

it('updates omitted-width preferences with explicit columns and clears them for AutoFit, preserving row-property order', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  doc.select(doc.text.indexOf('Cell 1.1')); doc.setTableProperties({ columns: [1800, 2200, 2200, 1800] });
  doc.setTableRowHeight({ rule: 'atLeast', value: 1440 });
  let bytes = await save(pkg, doc), reopened = model(await DocxPackage.open(bytes));
  expect(reopened.tables[0].rows[1]).toMatchObject({ widthBefore: { type: 'dxa', value: 1800 }, widthAfter: { type: 'dxa', value: 1800 } });
  expect(layout(reopened).tableWidths[reopened.tables[0].id]).toEqual([120, 2200 / 15, 2200 / 15, 120]);
  const xml = new DOMParser().parseFromString(strFromU8(unzipSync(bytes)['word/document.xml']), 'application/xml');
  expect([...first(xml, W, 'tr').children].slice(0, 2).map(n => n.localName)).toEqual(['tblPrEx', 'trPr']);
  doc.fitTable('contents'); bytes = await save(pkg, doc); reopened = model(await DocxPackage.open(bytes));
  expect(reopened.tables[0].rows[1]).toMatchObject({ widthBefore: { type: 'auto', value: 0 }, widthAfter: { type: 'auto', value: 0 } });
  layout(reopened); while (doc.history.length) doc.undo(); retained(await save(pkg, doc), pkg.parts);
});

it('retains active relative picture sizing through surrounding edits and prevents conflicting property changes', async () => {
  const bytes = changed(x => first(x, 'http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing', 'pctWidth').textContent = '50000');
  const pkg = await DocxPackage.open(bytes), doc = model(pkg);
  const picture = doc.paragraphs.flatMap(p => p.runs).find(r => r.image?.anchor?.relativeSize).image;
  expect(picture.retainedDrawing).toBe(true);
  expect(picture.anchor.relativeSize.width.percentage).toBe(50000);
  retained(await save(pkg, doc), pkg.parts);
  doc.select(0); doc.replace('Edited ');
  const exported = await save(pkg, doc), reopened = model(await DocxPackage.open(exported));
  const restored = reopened.paragraphs.flatMap(p => p.runs).find(r => r.image?.anchor?.relativeSize).image;
  expect(canonicalXml(restored.shell)).toBe(canonicalXml(picture.shell));
  expect(restored.anchor.relativeSize).toEqual(picture.anchor.relativeSize);
  retained(exported, pkg.parts, true);
  const paragraph = doc.paragraphs.findIndex(p => p.runs.some(r => r.image?.id === picture.id));
  const runs = doc.paragraphs[paragraph].runs;
  const offset = runs.slice(0, runs.findIndex(r => r.image?.id === picture.id)).reduce((n, r) => n + r.text.length, 0);
  const start = doc.paragraphOffset(paragraph) + offset;
  doc.select(start, start + 1);
  const before = doc.snapshot();
  expect(() => doc.setImageProperties({ width: picture.width + 9525 })).toThrow(/retained/);
  expect(doc.snapshot()).toEqual(before);
  doc.undo(); retained(await save(pkg, doc), pkg.parts);
});

it.each([
  ['unsupported row exceptions', x => first(x, W, 'tblPrEx').append(x.createElementNS(W, 'w:tblW'))],
  ['duplicate row exceptions', x => { const n = first(x, W, 'tblPrEx'); n.after(n.cloneNode(true)); }],
  ['negative omissions', x => first(x, W, 'gridAfter').setAttributeNS(W, 'w:val', '-1')],
  ['missing omission counts', x => first(x, W, 'gridBefore').removeAttributeNS(W, 'val')],
  ['inconsistent grid coverage', x => first(x, W, 'gridAfter').setAttributeNS(W, 'w:val', '2')],
  ['unsupported relative image size bases', x => { const n = first(x, 'http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing', 'pctWidth'); n.textContent = '50000'; n.parentElement.setAttribute('relativeFrom', 'leftMargin'); }],
  ['nonignorable size extensions', x => { for (let n = first(x, WP, 'anchor'); n?.nodeType === 1; n = n.parentElement) n.removeAttributeNS('http://schemas.openxmlformats.org/markup-compatibility/2006', 'Ignorable'); }],
])('rejects %s before attaching editable content', async (_, mutate) => {
  await expect(DocxPackage.open(changed(mutate)).then(() => 'opened')).rejects.toThrow();
});
