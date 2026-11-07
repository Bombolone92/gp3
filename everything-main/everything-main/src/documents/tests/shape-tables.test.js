import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage, W } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutShapeText } from '../src/engine/shape-text-layout.js';
import { bodySymbolText, bodySymbolStyle } from '../src/engine/body-symbols.js';
import { assertPackageParts } from './helpers/assert-package-parts.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

const folder = 'tests/fixtures/shape-tables';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
const shapes = pkg => {
  const result = [], walk = n => { if (n.text) result.push(n); n.children?.forEach(walk); };
  Object.values(pkg.assets).filter(a => a.scene).forEach(a => walk(a.scene)); return result;
};
const measure = (t, s) => ({ width: t.length * s.fontSize * .6, ascent: s.fontSize, descent: s.fontSize / 3 });
const drawingXml = bytes => {
  const xml = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml');
  return [...xml.getElementsByTagNameNS(W, 'drawing')].map(n => [...n.getElementsByTagName('*')].map(e => [e.namespaceURI, e.localName, [...e.attributes].filter(a => a.namespaceURI !== 'http://www.w3.org/2000/xmlns/').map(a => [a.namespaceURI,a.localName,a.value]).sort(), e.children.length ? '' : e.textContent]));
};

it('keeps table models and cell positions inside their owning drawing', async () => {
  const pkg = await DocxPackage.open(readFileSync(`${folder}/source.docx`)), nodes = shapes(pkg);
  expect(pkg.tables).toEqual([]);
  expect(pkg.paragraphs.every(p => !p.cellId)).toBe(true);
  expect(nodes.map(n => n.text.tables.length)).toEqual([1,1,2,1]);
  expect(nodes[0].text.upright).toBe(true);
  for (const [i,node] of nodes.entries()) {
    const result = layoutShapeText(node, measure, i === 1 ? {x:2,y:2} : undefined);
    expect(result.layout.cells.length).toBeGreaterThanOrEqual(5);
    expect(result.layout.tableBorders.some(b => !b.guide)).toBe(true);
    expect(result.layout.lines.some(l => l.fragments.some(f => f.text.includes('Merged')))).toBe(true);
    if (i === 1 || i === 2) expect(result.shift).toBeGreaterThan(0);
    if (i === 3) { expect(result.shift).toBe(0); expect(result.layout.endY).toBeGreaterThan(result.clip.height); }
  }
});

it.each(['source','symbols'])('retains %s drawings through body edits, export, reopen and exact undo', async name => {
  const source = readFileSync(`${folder}/${name}.docx`), pkg = await DocxPackage.open(source);
  const d = new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets), before = unzipSync(source);
  const save = async () => unzipSync(new Uint8Array(await pkg.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer()));
  assertPackageParts(await save(), before);
  d.select(0); d.replace('Edited ');
  const after = await save();
  expect(drawingXml(after['word/document.xml'])).toEqual(drawingXml(before['word/document.xml']));
  expectBodyEditParts(after, before);
  const reopened = await DocxPackage.open(zipSync(after));
  expect(shapes(reopened).length).toBe(shapes(pkg).length);
  expect(reopened.paragraphs[0].runs.map(r => r.text).join('')).toMatch(/^Edited /);
  d.undo(); assertPackageParts(await save(), before);
});

it('resolves sym font independently and restores the surrounding run font', async () => {
  const pkg = await DocxPackage.open(readFileSync(`${folder}/symbols.docx`));
  const ps = shapes(pkg)[0].text.paragraphs;
  expect(ps.map(p => p.runs.map(r => r.fontAscii))).toEqual(Array.from({length:5},()=>['Courier New','Courier New','Courier New']));
  expect(ps.map(p => p.runs[1].text)).toEqual(Array(5).fill('\ufffc'));
  expect(ps.map(p => p.runs.map(r => bodySymbolStyle(r,r).fontAscii))).toEqual([
    ['Courier New','Wingdings 2','Courier New'], ['Courier New','Wingdings 2','Courier New'],
    ['Courier New','Arial','Courier New'], ['Courier New','Arial','Courier New'], ['Courier New','Arial','Courier New']
  ]);
  expect(ps.map(p => bodySymbolText(p.runs[1],p.runs[1].text))).toEqual(['\uf0a3','\u00a3','A','\uf041','Ω']);
});

it('preserves simultaneous body and drawing symbols through editing, export and exact undo', async () => {
  const parts = unzipSync(readFileSync(`${folder}/symbols.docx`));
  const xml = new DOMParser().parseFromString(strFromU8(parts['word/document.xml']), 'application/xml');
  const symbol = xml.getElementsByTagNameNS(W, 'sym')[0];
  xml.getElementsByTagNameNS(W, 'body')[0].firstElementChild.getElementsByTagNameNS(W, 'r')[0].append(symbol.cloneNode(true));
  parts['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(xml));
  const pkg = await DocxPackage.open(zipSync(parts));
  expect(pkg.readOnly).toBeFalsy();
  const bodySymbols = p => p.paragraphs.flatMap(p => p.runs).filter(r => r.bodySymbol).map(r => ({text:r.text, symbol:r.bodySymbol}));
  const expected = [{text:'\ufffc', symbol:{font:'Wingdings 2',code:'F0A3'}}];
  expect(bodySymbols(pkg)).toEqual(expected);
  const d = new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
  const save = async () => unzipSync(new Uint8Array(await pkg.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer()));
  assertPackageParts(await save(), parts);
  d.select(0);d.replace('Edited ');
  const edited = await save(), reopened = await DocxPackage.open(zipSync(edited));
  expect(bodySymbols(reopened)).toEqual(expected);
  expect(shapes(reopened).map(n=>n.text.paragraphs.map(p=>p.runs.map(r=>r.text)))).toEqual(shapes(pkg).map(n=>n.text.paragraphs.map(p=>p.runs.map(r=>r.text))));
  expect(drawingXml(edited['word/document.xml'])).toEqual(drawingXml(parts['word/document.xml']));
  expectBodyEditParts(edited, parts);
  expect(reopened.paragraphs[0].runs.map(r=>r.text).join('')).toMatch(/^Edited /);
  d.undo();assertPackageParts(await save(), parts);
}, 60000);

it.each(['bad-grid','floating','bad-symbol','empty-font'])('rejects unsafe %s instead of flattening it into editable text', async kind => {
  const parts = unzipSync(readFileSync(`${folder}/${kind.includes('symbol') || kind === 'empty-font' ? 'symbols' : 'source'}.docx`));
  const xml = new DOMParser().parseFromString(strFromU8(parts['word/document.xml']), 'application/xml');
  if (kind === 'bad-grid') xml.getElementsByTagNameNS(W,'tblGrid')[0].remove();
  if (kind === 'floating') xml.getElementsByTagNameNS(W,'tblPr')[0].append(xml.createElementNS(W,'w:tblpPr'));
  const sym = xml.getElementsByTagNameNS(W,'sym')[0];
  if (kind === 'bad-symbol') sym.setAttributeNS(W,'w:char','XYZ');
  if (kind === 'empty-font') sym.setAttributeNS(W,'w:font','');
  parts['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(xml));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toMatchObject({name:'UnsupportedDocumentError'});
});
