import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument, paragraphText } from '../src/engine/model.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { borderOutset } from '../src/engine/paragraph-borders.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const refs = JSON.parse(readFileSync('tests/fixtures/joined-border-spacing/reference.json'));
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const layout = d => layoutDocument(d.paragraphs, (t,s) => ({ width: t.length * s.fontSize * .5, ascent: s.fontSize, descent: s.fontSize / 3 }), pageGeometry(d.pageSettings), d.numbering, d.tables);
const save = async (p,d) => new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const lineFor = (d,l,text) => l.lines.find(l => l.paragraphId === d.paragraphs.find(p => paragraphText(p) === text).id);
for (const ref of refs) it('matches the native reference joined border spacing in body and cells: ' + ref.file, async () => {
  const p = await DocxPackage.open(readFileSync('public/fixtures/' + ref.file)), d = model(p), l = layout(d);
  expect(l.pageCount).toBe(8);
  for (const [page, lines] of ref.pages.entries()) {
    const first = lineFor(d,l,lines[0].text);
    for (const expected of lines) {
      const actual = lineFor(d,l,expected.text); expect(actual.page).toBe(page);
      expect(Math.abs((actual.baseline-first.baseline)*.75 - expected.baseline + lines[0].baseline),expected.text).toBeLessThan(.35);
    }
  }
  expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
it('edits border grouping, preserves export and exact undo, and retains top clearance after a page break', async () => {
  const p = await DocxPackage.open(readFileSync('public/fixtures/joined-border-spacing-15.docx')), d = model(p), before = layout(d);
  d.select(d.text.indexOf('BodyJoinedB'));
  d.setParagraphFormat({ paragraphBorders: { bottom: { style:'single',size:2,space:18,color:'224466' } } });
  const edited = layout(d); expect(lineFor(d,edited,'BodyJoinedB').y).toBeGreaterThan(lineFor(d,before,'BodyJoinedB').y);
  const bytes = await save(p,d), reopened = model(await DocxPackage.open(bytes));
  expect(layout(reopened).lines.map(l=>[l.page,l.y])).toEqual(edited.lines.map(l=>[l.page,l.y]));
  for (const [name,data] of Object.entries(p.parts)) if (name !== 'word/document.xml') expect(unzipSync(bytes)[name]).toEqual(data);
  d.undo(); expect(layout(d)).toEqual(before); expect(unzipSync(await save(p,d))).toEqual(p.parts);
  d.select(d.text.indexOf('BodyJoinedB')); d.setParagraphFormat({ pageBreakBefore:true });
  const broken = layout(d), line = lineFor(d,broken,'BodyJoinedB');
  expect(line.page).toBe(1); expect(line.y).toBeCloseTo(broken.page.top + borderOutset(line.paragraphFrame.borders.top),5);
});
