import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage, W } from '../src/engine/docx.js';
import { TextDocument, paragraphFormat, paragraphText } from '../src/engine/model.js';
import { hyperlinkRanges, openableHyperlink } from '../src/engine/hyperlinks.js';
import { defineNumberFormat } from '../src/engine/list-definitions.js';
import { listMarkers } from '../src/engine/numbering.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { fontMetrics } from '../src/engine/font-metrics.js';

let dom;
beforeAll(() => { dom = new JSDOM(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) globalThis[name] = dom.window[name]; });
afterAll(() => { dom.window.close(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) delete globalThis[name]; });
const source = readFileSync('tests/fixtures/list-borders-retained-links/combined.docx');
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const save = async (p, d) => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
const xml = (bytes, part) => new DOMParser().parseFromString(strFromU8(unzipSync(bytes)[part]), 'application/xml');
const find = (d, text) => d.paragraphs.find(p => paragraphText(p) === text);
const borders = (d, text) => Object.fromEntries(Object.entries(paragraphFormat(find(d, text), d.numbering).paragraphBorders).map(([side, b]) => [side, [b.style, b.size, b.color]]));
const select = (d, text) => { const a = d.text.indexOf(text); expect(a).toBeGreaterThanOrEqual(0); d.select(a, a + text.length); };
const targets = bytes => Object.fromEntries([...xml(bytes, 'word/_rels/document.xml.rels').documentElement.children].filter(r => r.getAttribute('TargetMode') === 'External').map(r => [r.getAttribute('Id'), r.getAttribute('Target')]));
const LINKS = { relative: '../Shared Documents/Plan v2.docx', file: 'file:///C:\\Reports\\Q3 summary.docx', web: 'https://example.com/report', drawingLink: 'Appendix A.docx' };

function expectBorders(d) {
  expect(borders(d, 'Bordered item one')).toEqual({ bottom: ['single', 6, '2F5496'] });
  expect(borders(d, 'Nested bordered item')).toEqual({ left: ['double', 12, 'C00000'] });
  // Direct paragraph borders override the level's side.
  expect(borders(d, 'Direct border override')).toEqual({ bottom: ['nil', 0, 'auto'] });
  // Style numbering: the style's own side wins; the level fills the other.
  expect(borders(d, 'Style list item')).toEqual({ left: ['single', 4, '000000'], bottom: ['dotted', 4, '00B050'] });
  expect(borders(d, 'List level borders')).toEqual({});
}

it('opens list-level paragraph properties, picture nvPr and unopenable link targets for editing', async () => {
  const p = await DocxPackage.open(source);
  expect(p.readOnly).not.toBe(true);
  expect(p.previewIssues || []).toEqual([]);
  const d = model(p);
  expectBorders(d);
  const picture = d.paragraphs.flatMap(q => q.runs).find(r => r.image).image;
  expect(picture.shell).toContain('nvPr');
  expect(picture.hyperlink).toMatchObject({ target: 'Appendix A.docx', retainedTarget: true });
  const links = Object.fromEntries(hyperlinkRanges(d.paragraphs).filter(r => !r.drawing).map(r => [r.link.sourceId, r.link]));
  for (const id of ['relative', 'file']) expect(links[id]).toMatchObject({ target: LINKS[id], retainedTarget: true });
  expect(links.web.retainedTarget).toBeUndefined();
  expect(openableHyperlink(links.relative)).toBe(false);
  expect(openableHyperlink(links.file)).toBe(false);
  expect(openableHyperlink(links.web)).toBe(true);
  const original = unzipSync(source), out = unzipSync(await save(p, d));
  expect(Object.keys(out).sort()).toEqual(Object.keys(original).sort());
  for (const part of Object.keys(original)) expect(Buffer.from(out[part]).equals(Buffer.from(original[part])), part).toBe(true);
});

const spacing = (d, text) => { const f = paragraphFormat(find(d, text), d.numbering); return [f.spaceBefore, f.spaceAfter, f.lineRule, f.lineSpacing, f.alignment, f.keepNext]; };
function expectSpacing(d, suffix = '') {
  // The level's spacing, alignment and keepNext apply where nothing outranks them.
  expect(spacing(d, 'Bordered item one' + suffix)).toEqual([6, 3, 'auto', 1.5, 'left', false]);
  expect(spacing(d, 'Nested bordered item')).toEqual([0, 8, 'auto', 278 / 240, 'center', false]);
  // A direct after="0" wins; the level's before and line still apply.
  expect(spacing(d, 'Direct border override')).toEqual([6, 0, 'auto', 1.5, 'left', false]);
  // Style numbering: the style's before="0" wins over the level's 12pt.
  expect(spacing(d, 'Style list item' + suffix)).toEqual([0, 12, 'auto', 278 / 240, 'left', true]);
  expect(spacing(d, 'List level borders')).toEqual([0, 8, 'auto', 278 / 240, 'left', false]);
}

it('applies level spacing, alignment and pagination through the list cascade', async () => {
  const d = model(await DocxPackage.open(source));
  expectSpacing(d);
  // An edit outranks the level.
  select(d, 'Bordered item one'); d.setParagraphFormat({ spaceBefore: 18 });
  expect(spacing(d, 'Bordered item one')[0]).toBe(18);
});

it('keeps list markers in the preview when a level property is still unsupported', async () => {
  const parts = unzipSync(source);
  parts['word/numbering.xml'] = strToU8(strFromU8(parts['word/numbering.xml']).replace('<w:ind w:left="720" w:hanging="360"/></w:pPr>', '<w:ind w:left="720" w:hanging="360"/><w:textAlignment w:val="top"/></w:pPr>'));
  const bytes = zipSync(parts);
  await expect(DocxPackage.open(bytes)).rejects.toThrow('Unsupported numbering paragraph property: textAlignment.');
  const p = await DocxPackage.open(bytes, { bestEffort: true });
  expect(p.readOnly).toBe(true);
  expect(p.previewIssues).toEqual(expect.arrayContaining([expect.stringContaining('Unsupported numbering paragraph property: textAlignment.')]));
  const d = new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets, { displayOnly: true });
  const markers = listMarkers(d.paragraphs, p.numbering);
  for (const text of ['Bordered item one', 'Nested bordered item', 'Direct border override', 'Style list item']) expect(markers[d.paragraphs.indexOf(find(d, text))]?.text, text).toBeTruthy();
  expectBorders(d); expectSpacing(d);
  expect(paragraphFormat(find(d, 'Bordered item one'), d.numbering).indentLeft).toBe(720);
});

it('lays out level borders on list paragraphs', async () => {
  const d = model(await DocxPackage.open(source));
  const measure = (text, style) => ({ ...fontMetrics(style), width: [...text].length * style.fontSize * 2 / 3 });
  const layout = layoutDocument(d.paragraphs, measure, pageGeometry(d.pageSettings), d.numbering, d.tables);
  const framed = new Map(layout.lines.filter(line => line.paragraphFrame).map(line => [line.paragraphId, line.paragraphFrame.borders]));
  for (const text of ['Bordered item one', 'Nested bordered item', 'Style list item']) expect(framed.get(find(d, text).id), text).toEqual(paragraphFormat(find(d, text), d.numbering).paragraphBorders);
  for (const text of ['List level borders', 'Direct border override']) expect(framed.has(find(d, text).id), text).toBe(false);
  expect(layout.paragraphBorders.length).toBeGreaterThan(0);
});

it('keeps retained targets and level borders through edits, export and reopen', async () => {
  const p = await DocxPackage.open(source), d = model(p);
  for (const text of ['relative destination', 'file destination', 'Bordered item one', 'Style list item']) { select(d, text); d.replace(`${text} edited`); }
  const bytes = await save(p, d);
  expect(targets(bytes)).toEqual(LINKS);
  // Level borders stay in the numbering part; edited paragraphs do not gain direct pBdr.
  const body = xml(bytes, 'word/document.xml');
  const direct = [...body.getElementsByTagNameNS(W, 'p')].filter(n => n.getElementsByTagNameNS(W, 'pBdr').length).map(n => n.textContent);
  expect(direct).toEqual(['Direct border override']);
  expect(strFromU8(unzipSync(bytes)['word/numbering.xml'])).toBe(strFromU8(unzipSync(source)['word/numbering.xml']));
  const again = model(await DocxPackage.open(bytes));
  expect(borders(again, 'Bordered item one edited')).toEqual({ bottom: ['single', 6, '2F5496'] });
  expect(borders(again, 'Style list item edited')).toEqual({ left: ['single', 4, '000000'], bottom: ['dotted', 4, '00B050'] });
  expectSpacing(again, ' edited');
  const links = hyperlinkRanges(again.paragraphs).filter(r => !r.drawing).map(r => [r.link.target, !!r.link.retainedTarget]);
  expect(links).toEqual([[LINKS.relative, true], [LINKS.file, true], [LINKS.web, false]]);
});

it('replaces a retained target only when a supported address is given', async () => {
  const p = await DocxPackage.open(source), d = model(p);
  select(d, 'relative destination');
  expect(() => d.setHyperlink('../Other folder/x.docx')).toThrow();
  d.setHyperlink('https://example.com/plan');
  expect(d.hyperlink.link.retainedTarget).toBeUndefined();
  const bytes = await save(p, d);
  expect(Object.values(targets(bytes))).toEqual(expect.arrayContaining([...Object.values(LINKS), 'https://example.com/plan']));
  const again = model(await DocxPackage.open(bytes));
  expect(hyperlinkRanges(again.paragraphs).find(r => r.link.target === 'https://example.com/plan')).toBeTruthy();
});

it('writes level borders for a list definition derived from a bordered level', async () => {
  const p = await DocxPackage.open(source), d = model(p);
  select(d, 'Bordered item one');
  defineNumberFormat(d, { format: 'upperRoman', after: ')' });
  expect(borders(d, 'Bordered item one')).toEqual({ bottom: ['single', 6, '2F5496'] });
  const bytes = await save(p, d), numbering = xml(bytes, 'word/numbering.xml');
  const generated = [...numbering.getElementsByTagNameNS(W, 'abstractNum')].filter(n => !['0', '1'].includes(n.getAttributeNS(W, 'abstractNumId')));
  expect(generated).toHaveLength(1);
  const levels = [...generated[0].getElementsByTagNameNS(W, 'lvl')];
  const bottom = levels[0].getElementsByTagNameNS(W, 'pBdr')[0].getElementsByTagNameNS(W, 'bottom')[0];
  expect([bottom.getAttributeNS(W, 'val'), bottom.getAttributeNS(W, 'sz'), bottom.getAttributeNS(W, 'color')]).toEqual(['single', '6', '2F5496']);
  // The level's declared properties are kept, in CT_PPrBase order around the dialog-owned geometry.
  expect([...levels[0].getElementsByTagNameNS(W, 'pPr')[0].children].map(n => n.localName)).toEqual(['pBdr', 'spacing', 'ind']);
  expect([...levels[1].getElementsByTagNameNS(W, 'pPr')[0].children].map(n => n.localName)).toEqual(['pBdr', 'ind', 'jc']);
  const again = model(await DocxPackage.open(bytes));
  expect(borders(again, 'Bordered item one')).toEqual({ bottom: ['single', 6, '2F5496'] });
  expect(spacing(again, 'Bordered item one')).toEqual([6, 3, 'auto', 1.5, 'left', false]);
  expect(spacing(again, 'Nested bordered item')[4]).toBe('center');
  expect(borders(again, 'Nested bordered item')).toEqual({ left: ['double', 12, 'C00000'] });
});

it.each([
  ['duplicate nvPr', xml => xml.replace('<pic:nvPr/>', '<pic:nvPr/><pic:nvPr/>'), 'unsupported or duplicate nvPr'],
  ['nvPr before cNvPicPr', xml => xml.replace('<pic:cNvPicPr/><pic:nvPr/>', '<pic:nvPr/><pic:cNvPicPr/>'), 'unsupported or duplicate nvPr'],
  ['nvPr referencing a part', xml => xml.replace('<pic:nvPr/>', '<pic:nvPr><a:extLst><a:ext uri="{00000000-0000-0000-0000-000000000000}"><a:x r:id="image1"/></a:ext></a:extLst></pic:nvPr>'), 'related parts in non-visual properties'],
])('keeps unsupported picture non-visual properties guarded: %s', async (_, change, reason) => {
  const parts = unzipSync(source);
  parts['word/document.xml'] = strToU8(change(strFromU8(parts['word/document.xml'])));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(reason);
});

it('reads a PresentationML-namespaced nvPr the same way', async () => {
  const parts = unzipSync(source);
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('<pic:nvPr/>', '<p:nvPr xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>'));
  const p = await DocxPackage.open(zipSync(parts));
  expect(p.readOnly).not.toBe(true);
  expect(p.paragraphs.flatMap(q => q.runs).find(r => r.image).image.shell).toContain('p:nvPr');
});
