import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument, paragraphFormat, paragraphText } from '../src/engine/model.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';

let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const fixture = () => DocxPackage.open(readFileSync('public/fixtures/list-style-indents.docx'));
const model = pkg => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles);
const save = async (pkg, doc) => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles).arrayBuffer());
const reference = JSON.parse(readFileSync('tests/fixtures/list-style-indents/reference.json'));
const sameParts = (a,b) => { expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort()); for (const name of Object.keys(b)) expect(Buffer.from(a[name]).equals(Buffer.from(b[name])),name).toBe(true); };

it('matches the native reference marker and continuation positions for all 24 independent style hierarchy cases', async () => {
  const doc = model(await fixture());
  const result = layoutDocument(doc.paragraphs, (text) => ({width:text.length*7,ascent:12,descent:4}), pageGeometry(doc.pageSettings), doc.numbering);
  for (const row of reference.cases) {
    const p = doc.paragraphs.find(p => paragraphText(p).startsWith('First'+row.id));
    const lines = result.lines.filter(l => l.paragraphId === p.id);
    expect(lines.length, row.id).toBe(2);
    expect(Math.abs(lines[0].marker.x*.75-row.markerX),row.id+' marker').toBeLessThan(.1);
    expect(Math.abs(lines[0].stops[0].x*.75-row.firstX),row.id+' first').toBeLessThan(.1);
    expect(Math.abs(lines[1].stops[0].x*.75-row.secondX),row.id+' continuation').toBeLessThan(.1);
  }
});

it('recomputes hierarchy after style edits and preserves original package after undo', async () => {
  const pkg = await fixture(), doc = model(pkg), p = () => doc.paragraphs[3];
  const format = () => paragraphFormat(p(),doc.numbering);
  sameParts(unzipSync(await save(pkg,doc)),pkg.parts);
  doc.editParagraphStyle('Base2',{paragraph:{indentLeft:2880,firstLine:1080}});
  expect(format()).toMatchObject({indentLeft:1440,firstLine:-360});
  doc.editParagraphStyle('Number2',{paragraph:{firstLine:720}});
  expect(format().firstLine).toBe(720);
  doc.editParagraphStyle('Leaf2',{paragraph:{firstLine:-720}});
  expect(format().firstLine).toBe(-720);
  const reopened = model(await DocxPackage.open(await save(pkg,doc)));
  expect(paragraphFormat(reopened.paragraphs[3],reopened.numbering)).toEqual(format());
  doc.undo(); doc.undo(); doc.undo();
  sameParts(unzipSync(await save(pkg,doc)),pkg.parts);
});

it('retains direct paragraph geometry through text edits, list removal, save/reopen and undo', async () => {
  const pkg = await fixture(), doc = model(pkg);
  const position = doc.text.indexOf('FirstA02'); doc.select(position); doc.replace('Edited ');
  doc.setParagraphFormat({firstLine:0,indentLeft:1800});
  expect(doc.paragraphFormatting).toMatchObject({firstLine:0,indentLeft:1800});
  const bytes = await save(pkg,doc), opened = await DocxPackage.open(bytes), reopened = model(opened);
  expect(paragraphFormat(reopened.paragraphs[3],reopened.numbering)).toMatchObject({firstLine:0,indentLeft:1800});
  for (const name of Object.keys(pkg.parts)) if(name!=='word/document.xml') expect(Buffer.from(opened.parts[name]).equals(Buffer.from(pkg.parts[name])),name).toBe(true);
  doc.toggleList('number'); expect(doc.paragraphs[3].list).toBeNull();
  expect(doc.paragraphFormatting).toMatchObject({firstLine:0,indentLeft:1800});
  doc.undo(); doc.undo(); doc.undo(); sameParts(unzipSync(await save(pkg,doc)),pkg.parts);
});
