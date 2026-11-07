import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { drawingPageContexts, drawingPageContext, shapeFieldParagraphs, shapeHasFields } from '../src/engine/shape-page-fields.js';
import { capitalizationParts } from '../src/engine/capitalization.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/shape-page-fields.docx');
const save = async (p,d) => new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
for (const suffix of ['', '-header', '-plain']) it(`resolves drawing fields ${suffix} without changing source scenes`, async () => {
  const header = suffix === '-header', name = 'shape-page-fields' + suffix;
  const p = await DocxPackage.open(readFileSync(`public/fixtures/${name}.docx`), { bestEffort: header });
  const ref = JSON.parse(readFileSync(`tests/fixtures/${name}/reference.json`));
  const shapes = Object.values(p.assets).map(a=>a.scene).filter(Boolean), before=structuredClone(shapes);
  expect(shapes).toHaveLength(header ? 8 : 24); expect(shapes.every(shapeHasFields)).toBe(true);
  const contexts=drawingPageContexts({pageSections:[0,0,1],pageCount:3},p.pageStories);
  for (let page=0;page<3;page++) for(let i=0;i<8;i++) {
    const shape=shapes[header?i:page*8+i];
    const text=shapeFieldParagraphs(shape.text.paragraphs,{...contexts[page],pageStory:header}).flatMap(p=>p.runs.map(r=>capitalizationParts(r.text,r)?.map(part=>part.text).join('') ?? r.text)).join('');
    expect(text).toBe(`F${i}: ${ref.pages[page]['F'+i]}`);
  }
  expect(shapes).toEqual(before);
});
it('retains drawing field XML through body edits, export and exact undo', async()=>{
  const p=await DocxPackage.open(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
  d.select(0);d.replace('Edited ');const bytes=await save(p,d),reopened=await DocxPackage.open(bytes);
  const scenes = pkg => JSON.parse(JSON.stringify(Object.values(pkg.assets).map(a=>a.scene), (key,value)=>key==='id'?undefined:value));
  expect(scenes(reopened)).toEqual(scenes(p));
  const parts=unzipSync(bytes);for(const [n,b] of Object.entries(p.parts)) if(n!=='word/document.xml')expect(parts[n]).toEqual(b);
  d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
it.each(['instruction','nested','missing-end'])('rejects unsupported or malformed drawing field %s', async kind=>{
  const parts=unzipSync(source);let xml=strFromU8(parts['word/document.xml']);
  if(kind==='instruction')xml=xml.replace(' PAGE ', ' COMPARE 1 = 1 ');
  if(kind==='nested')xml=xml.replace('w:fldCharType="separate"','w:fldCharType="begin"');
  if(kind==='missing-end')xml=xml.replace(/<w:r><w:fldChar w:fldCharType="end"\/><\/w:r>/,'');
  parts['word/document.xml']=strToU8(xml);
  await expect(DocxPackage.open(zipSync(parts))).rejects.toMatchObject({name:'UnsupportedDocumentError'});
});

it('uses a drawing region for section totals while retaining the page owner for headers', () => {
 const layout={pageSections:[0,1],pageCount:2,pageRegions:[[{section:0},{section:1}],[{section:1},{section:2}]]};
 const contexts=drawingPageContexts(layout,{sections:[{},{},{}]});
 const paragraphs=[{runs:[{text:'cached',field:{type:'SECTIONPAGES',cachedText:'cached'}}]}];
 const text=context=>shapeFieldParagraphs(paragraphs,context)[0].runs[0].text;
 expect(text(drawingPageContext(contexts,0))).toBe('1');
 expect(text(drawingPageContext(contexts,0,1))).toBe('2');
 expect(text(drawingPageContext(contexts,1,0))).toBe('2');
 expect(text(drawingPageContext(contexts,1,1))).toBe('1');
 expect(drawingPageContext(contexts,1,1).pageNumber).toBe(2);
});
