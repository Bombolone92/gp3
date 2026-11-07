import { it, expect, beforeAll, afterAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutDocument, imageAtPoint, selectionRects } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
let dom;
beforeAll(() => { dom=new JSDOM(''); globalThis.DOMParser=dom.window.DOMParser; globalThis.XMLSerializer=dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/oversized-inline.docx');
const reference = JSON.parse(readFileSync('tests/fixtures/oversized-inline/reference.json', 'utf8'));
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const measure = (text, style) => ({width: text.length * style.fontSize * .65, ascent: style.fontSize, descent: style.fontSize / 3});
const layout = d => layoutDocument(d.paragraphs, measure, pageGeometry(d.pageSettings), d.numbering, d.tables);
const save = async (p,d) => new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
it('matches the native reference picture widths and left origins for all alignments in body paragraphs and fixed cells', async () => {
 const d=model(await DocxPackage.open(source)), result=layout(d);
 const lines=result.lines.filter(l=>l.fragments.some(f=>f.image));
 expect(result.pageCount).toBe(6); expect(lines).toHaveLength(6);
 for(const [i,line] of lines.entries()) {
  const f=line.fragments.find(f=>f.image), ref=reference.pictures[i];
  expect(line.page).toBe(ref.page); expect(f.x*.75).toBeCloseTo(ref.x,1); expect(f.width*.75).toBeCloseTo(ref.width,1); expect(f.ascent*.75).toBeCloseTo(ref.height,1);
  expect(line.fragments.map(f=>f.text).join('')).toBe('\ufffc');
  const cell=result.cells.find(c=>c.id===line.cellId && c.page===line.page);
  if(cell) expect(f.x+f.width).toBeGreaterThan(cell.x+cell.width);
  const visibleRight=(ref.visibleX+ref.visibleWidth)/.75;
  expect(imageAtPoint(result,line.page,visibleRight-1,line.baseline-f.ascent/2)).toBe(f);
  if(visibleRight<f.x+f.width-1) expect(imageAtPoint(result,line.page,visibleRight+1,line.baseline-f.ascent/2)).toBeNull();
  const selection=selectionRects(result,f.start,f.end).find(r=>r.page===line.page);
  expect(selection.x*.75).toBeCloseTo(ref.visibleX,1);
  expect(selection.width*.75).toBeCloseTo(ref.visibleWidth,1);
 }
});
it('preserves oversized drawings through surrounding edits, export/reopen and complete undo', async () => {
 const p=await DocxPackage.open(source), d=model(p), original=layout(d);
 d.select(d.text.indexOf('Before')); d.replace('Edited ');
 const exported=await save(p,d), reopened=model(await DocxPackage.open(exported)); expect(reopened.text).toBe(d.text); expect(layout(reopened).pageCount).toBe(6);
 d.undo(); expect(layout(d)).toEqual(original);
 const out=unzipSync(await save(p,d)); for(const [name,bytes] of Object.entries(p.parts)) expect(Buffer.from(out[name]).equals(Buffer.from(bytes)),name).toBe(true);
});
