import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutDocument, caretRect } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { LineBuilder } from '../src/engine/line-builder.js';
import { paragraphFormat, paragraph, runFormat } from '../src/engine/model.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const folder = 'tests/fixtures/positional-tabs/';
const source = readFileSync(folder + 'source.docx');
const cases = JSON.parse(readFileSync(folder + 'cases.json'));
const reference = JSON.parse(readFileSync(folder + 'reference.json'));
const measure = text => ({ width: text.length * 6, ascent: 12, descent: 4 });

it.each(['contexts', 'contexts-autofit'])('pins the native contextual reference to its actual source: %s', name => {
  const ref = JSON.parse(readFileSync(folder + name + '-reference.json'));
  for (const [file, hash] of [[name + '.docx', ref.sourceSha256], [name + '-native.pdf', ref.pdfSha256]])
    expect(createHash('sha256').update(readFileSync(folder + file)).digest('hex')).toBe(hash);
});

it('excludes trailing spaces from positional alignment while preserving caret advances and discretionary measurement', () => {
  const builder = new LineBuilder(0, 200, paragraphFormat(paragraph('')), { width: 200, left: 0, right: 0 }, measure, 0);
  const style = runFormat({});
  builder.add({ text: '\t', start: 0, end: 1, style, positionalTab: { alignment: 'center', relativeTo: 'margin', leader: 'none' } });
  builder.add({ text: 'A', start: 1, end: 2, style });
  expect(builder.field.origin).toBe(97);
  const end = builder.end;
  expect(builder.discretionaryEnd()).toBe(106);
  expect(builder.end).toBe(end);
  builder.add({ text: ' ', start: 2, end: 3, style });
  expect(builder.field.origin).toBe(97);
  expect(builder.end).toBe(109);
  builder.add({ text: '\t', start: 3, end: 4, style, positionalTab: { alignment: 'right', relativeTo: 'margin', leader: 'none' } });
  expect(builder.fields[1].origin).toBe(97);
});

it('matches native alignment anchors and wrapping across 60 independent reference controls', async () => {
  for (const [name, hash] of [['source.docx', reference.sourceSha256], ['native.pdf', reference.pdfSha256]])
    expect(createHash('sha256').update(readFileSync(folder + name)).digest('hex')).toBe(hash);
  const pkg = await DocxPackage.open(source);
  const result = layoutDocument(pkg.paragraphs, measure, pageGeometry(pkg.pageSettings));
  expect(result.pages).toHaveLength(cases.length);
  for (const [i, c] of cases.entries()) {
    const fragments = result.lines.filter(l => l.page === i).flatMap(l => l.fragments.filter(f => f.image).map(f => ({ ...f, line: l })));
    const [red, blue] = fragments.slice(-2);
    const anchor = { left: red.x, center: (red.x + blue.x + blue.width) / 2, right: blue.x + blue.width }[c.alignment] * .75;
    expect(anchor, c.name).toBeCloseTo(reference.pages[i].alignmentAnchor, 2);
    if (c.lead) {
      const wrapped = reference.pages[i].markers['777777'].y !== reference.pages[i].markers.e03040.y;
      expect(fragments[0].line !== red.line, c.name + ' wrap').toBe(wrapped);
    }
    expect(red.line.stops.every(s => Number.isFinite(s.x))).toBe(true);
    const tabOffset = red.start - 1;
    expect(Number.isFinite(caretRect(result, tabOffset).x)).toBe(true);
  }
});

it('keeps positional tabs through edits, formatting, undo and package roundtrip without inheriting them into typing', async () => {
  const pkg = await DocxPackage.open(source), doc = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  const save = async () => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
  const at = doc.text.indexOf('\t');
  doc.select(at + 1); doc.replace('X\tY');
  expect(doc.paragraphs.flatMap(p => p.runs).filter(r => r.positionalTab).every(r => /^\t+$/.test(r.text))).toBe(true);
  expect(doc.paragraphs.flatMap(p => p.runs).filter(r => r.positionalTab).map(r => r.text).join('')).toHaveLength(60);
  const edited = await save(), parts = unzipSync(edited), reopened = await DocxPackage.open(edited);
  expect(strFromU8(parts['word/document.xml']).match(/<w:ptab\b/g)).toHaveLength(60);
  expect(reopened.paragraphs.flatMap(p => p.runs).filter(r => r.positionalTab)).toHaveLength(60);
  expectBodyEditParts(parts, pkg.parts);
  doc.undo(); const undo = unzipSync(await save()); for (const n in pkg.parts) expect(undo[n]).toEqual(pkg.parts[n]);
  doc.select(at, at + 1); doc.setRunFormat({ bold: true });
  expect((await DocxPackage.open(await save())).paragraphs.flatMap(p => p.runs).find(r => r.positionalTab).bold).toBe(true);
  doc.undo(); doc.select(at, at + 1); doc.replace('ordinary');
  expect(doc.paragraphs.flatMap(p => p.runs).filter(r => r.positionalTab)).toHaveLength(59);
}, 60000);

it.each([
  ['alignment="left"', 'alignment="decimal"'],
  ['relativeTo="margin"', 'relativeTo="page"'],
  ['leader="none"', 'leader="heavy"'],
  ['w:leader="none"', ''],
  ['w:leader="none"', 'w:leader="none" w:unknown="1"'],
])('rejects malformed positional tabs: %s → %s', async (from, to) => {
  const parts = unzipSync(source); parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace(from, to));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/positional tab/);
});
