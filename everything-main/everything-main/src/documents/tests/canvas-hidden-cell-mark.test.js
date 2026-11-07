import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage, W } from '../src/engine/docx.js';
import { readTable } from '../src/engine/docx-tables.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutDocument, caretRect, hitTest } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { fontMetrics } from '../src/engine/font-metrics.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
const source = readFileSync('public/fixtures/hidden-cell-mark.docx');
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const open = async () => { const p = await DocxPackage.open(source); return [p, model(p)]; };
const layout = d => layoutDocument(d.paragraphs, (text, style) => ({ ...fontMetrics(style), width: [...text].length * style.fontSize * 2 / 3 }), pageGeometry(d.pageSettings), d.numbering, d.tables);
const height = size => { const m = fontMetrics({ fontSize: size }); return m.ascent + m.descent; };
// The engine applies these consumer defaults because the original fixture has no
// styles part; see tests/fixtures/hidden-cell-mark/native-spacing.json.
const multiple = 278 / 240, afterGap = 8 * 4 / 3;
const paragraphHeight = size => height(size) * multiple + afterGap;
const save = async (p, d) => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
const sameParts = (bytes, parts) => { const out = unzipSync(bytes); expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort()); for (const [name, bytes] of Object.entries(parts)) expect(Buffer.from(out[name]).equals(Buffer.from(bytes)), name).toBe(true); };
const mutate = change => { const parts = unzipSync(source), xml = new DOMParser().parseFromString(strFromU8(parts['word/document.xml']), 'application/xml'); change(xml); parts['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(xml)); return zipSync(parts); };
const nodes = (root, name) => [...root.getElementsByTagNameNS(W, name)];
it('matches the native reference empty-cell spacing controls and restores authored spacing on typing, export and undo', async () => {
 const p = await DocxPackage.open(readFileSync('public/fixtures/hidden-cell-spacing-controls.docx')), d = model(p), before = layout(d);
 expect(d.tables).toHaveLength(8);
 for (const table of d.tables) {
  const cell = table.rows[0].cells[0], paragraph = d.paragraphs.find(p => p.cellId === cell.id), stored = structuredClone(paragraph.format);
  expect(before.lines.find(l => l.cellId === cell.id).height).toBe(0);
  // The cell box spans border centers: 3pt content plus two half-0.5pt borders.
  expect(before.cells.find(c => c.id === cell.id).height).toBeCloseTo(3.5 * 4 / 3);
  d.selectCell(cell.id); d.replace('X');
  const lineHeight = stored.lineRule === 'exact' ? 16 : height(36);
  expect(layout(d).lines.find(l => l.cellId === cell.id).height).toBeCloseTo(lineHeight);
  expect(d.paragraphs.find(p => p.cellId === cell.id).format).toEqual(stored);
  const reopened = model(await DocxPackage.open(await save(p, d)));
  expect(layout(reopened).cells.map(c => c.height)).toEqual(layout(d).cells.map(c => c.height));
  d.undo(); expect(layout(d)).toEqual(before); sameParts(await save(p, d), p.parts);
 }
});
it('excludes only the final cell marker while retaining earlier paragraphs, breaks, pictures, numbering and row rules', async () => {
 const [p, d] = await open(), result = layout(d), rows = d.tables[0].rows;
 const box = i => result.cells.find(c => c.id === rows[i].cells[0].id);
 expect(box(0).height).toBeCloseTo(paragraphHeight(36)); expect(box(1).height).toBeCloseTo(paragraphHeight(6)); expect(box(2).height).toBeCloseTo(4);
 expect(box(3).height).toBeCloseTo(paragraphHeight(18) + paragraphHeight(6)); expect(box(4).height).toBeCloseTo(16); expect(box(5).height).toBeCloseTo(paragraphHeight(6));
 // This legacy image-only cell excludes its final mark. With no text metrics
 // contributing leading, the 12pt picture keeps its natural 16px line height.
 expect(box(6).height).toBeCloseTo(16 + afterGap);
 // The 10pt numbering label raises the baseline; the visible 6pt text supplies
 // descent and automatic leading. The marker does not multiply that leading.
 // See the independent native references in marker-line-metrics.
 expect(box(7).height).toBeCloseTo(fontMetrics({fontSize:10}).ascent + fontMetrics({fontSize:6}).descent + height(6) * (multiple - 1) + afterGap);
 expect(box(8).height).toBeCloseTo(paragraphHeight(6) * 2); expect(result.lines.some(l => l.marker?.text === '1.')).toBe(true);
 expect(d.paragraphs.filter(p => p.cellId).every(p => p.markFormat.fontSize >= 18)).toBe(true); sameParts(await save(p, d), p.parts);
});
it('keeps empty-cell caret and typing format, grows on insertion, round-trips and restores exact source bytes on undo', async () => {
 const [p, d] = await open(), cell = d.tables[0].rows[2].cells[0], before = layout(d); d.selectCell(cell.id); const at = d.range[0];
 const caret = caretRect(before, at), box = before.cells.find(c => c.id === cell.id); expect(caret.height).toBeCloseTo(height(36)); expect(hitTest(before, box.page, box.x + 1, box.y + box.height / 2)).toBe(at);
 d.replace('New text'); const after = layout(d); expect(after.cells.find(c => c.id === cell.id).height).toBeCloseTo(paragraphHeight(36));
 const again = model(await DocxPackage.open(await save(p, d))); expect(again.text).toBe(d.text); expect(again.tables[0].rows[2].cells[0].hideMark).toBe(true);
 d.undo(); expect(layout(d)).toEqual(before); sameParts(await save(p, d), p.parts);
});
it('permits an entirely empty zero-height row without removing its paragraphs or insertion positions', async () => {
 const [, d] = await open(), row = d.tables[0].rows[2], ids = row.cells.map(c => c.id); row.minHeight = 0; row.heightRule = 'auto';
 const before = layout(d); expect(before.lines.filter(l => ids.includes(l.cellId))).toHaveLength(2); expect(before.lines.filter(l => ids.includes(l.cellId)).every(l => l.height === 0)).toBe(true);
 d.selectCell(ids[1]); expect(caretRect(before, d.range[0]).height).toBeGreaterThan(0); d.replace('Visible'); expect(layout(d).cells.find(c => c.id === ids[1]).height).toBeCloseTo(paragraphHeight(36));
});
it('retains margins, explicit line spacing, row minima and repeated header content', async () => {
 const [, d] = await open(), table = d.tables[0], cell = table.rows[1].cells[0];
 cell.margins.top = 30; cell.margins.bottom = 60; const box = () => layout(d).cells.find(c => c.id === cell.id);
 expect(box().height).toBeCloseTo(paragraphHeight(6) + 6);
 const p = d.paragraphs.find(p => p.cellId === cell.id); p.format.lineRule = 'atLeast'; p.format.lineSpacing = 20; expect(box().height).toBeCloseTo(20 * 4 / 3 + afterGap + 6);
 table.rows[0].header = true; table.rows[0].cells.forEach(c => { c.hideMark = true; }); d.pageSettings.height = 1800; d.pageSettings.top = d.pageSettings.bottom = 240;
 const result = layout(d); expect(result.pageCount).toBeGreaterThan(1); expect(result.repeatedLines.some(l => l.fragments.some(f => f.text.includes('Marker included')))).toBe(true);
 expect(result.repeatedLines.every(l => l.height === 0 || Math.abs(l.height - height(6) * multiple) < 1e-6)).toBe(true);
});
it('preserves the cell property when rows are inserted and when a cell shell must be authored', async () => {
 const [p, d] = await open(); d.selectCell(d.tables[0].rows[1].cells[0].id); d.insertTableRow(); const row = d.tableContext.row;
 expect(row.cells.every(c => c.hideMark)).toBe(true); row.cells[0].shell = null;
 const again = model(await DocxPackage.open(await save(p, d))); expect(again.tables[0].rows.filter(r => r.cells.every(c => c.hideMark)).length).toBeGreaterThan(1);
 expect(again.tables[0].rows[2].cells.every(c => c.hideMark)).toBe(true);
});
it.each([['on', true], ['true', true], ['1', true], ['off', false], ['false', false], ['0', false]])('reads hideMark=%s as %s', async (value, expected) => {
 const p = await DocxPackage.open(mutate(xml => nodes(xml, 'hideMark')[2].setAttributeNS(W, 'w:val', value))); expect(p.tables[0].rows[1].cells[0].hideMark).toBe(expected);
});
it.each(['invalid', 'attribute', 'nested', 'duplicate'])('rejects %s hideMark before editable attachment', async kind => {
 const bytes = mutate(xml => { const n = nodes(xml, 'hideMark')[0]; if (kind === 'invalid') n.setAttributeNS(W, 'w:val', 'yes'); if (kind === 'attribute') n.setAttributeNS(W, 'w:other', 'on'); if (kind === 'nested') n.appendChild(xml.createElementNS(W, 'w:r')); if (kind === 'duplicate') n.parentNode.appendChild(n.cloneNode(true)); });
 await expect(DocxPackage.open(bytes)).rejects.toThrow();
});
it('rejects hideMark in a used table style rather than inheriting a property not allowed there', () => {
 const xml = new DOMParser().parseFromString(strFromU8(unzipSync(source)['word/document.xml']), 'application/xml');
 const styles = new DOMParser().parseFromString(`<w:styles xmlns:w="${W}"><w:style w:type="table" w:default="1" w:styleId="Hidden"><w:tcPr><w:hideMark/></w:tcPr></w:style></w:styles>`, 'application/xml').documentElement;
 expect(() => readTable(nodes(xml, 'tbl')[0], () => {}, styles)).toThrow('hideMark declared by table styles');
});
