import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { DocxPackage } from '../src/engine/docx.js';
import { layoutDocument, imageAtPoint } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
it('positions paragraph anchors before their own spacing and borders, retaining preceding after-spacing',async()=>{
 const p=await DocxPackage.open(readFileSync('public/fixtures/paragraph-anchor-spacing.docx'));
 const ref=JSON.parse(readFileSync('tests/fixtures/paragraph-anchor-spacing/reference.json'));
 const layout=layoutDocument(p.paragraphs,(text,style)=>({width:text.length*style.fontSize*.5,ascent:10,descent:3}),pageGeometry(p.pageSettings),p.numbering,p.tables,p.pageStories);
 expect(layout.pageCount).toBe(ref.bounds.length);expect(layout.floatingObjects).toHaveLength(ref.bounds.length);
 for(const f of layout.floatingObjects){
  [f.x,f.y,f.width,f.height].forEach((v,j)=>expect(v*.75).toBeCloseTo(ref.bounds[f.page][j],2));
  expect(imageAtPoint(layout,f.page,f.x+10,f.y+10)?.image.id).toBe(f.image.id);
 }
});
