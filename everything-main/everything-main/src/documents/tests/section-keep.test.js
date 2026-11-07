import { beforeAll,afterAll,it,expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DocxPackage } from '../src/engine/docx.js';
import { layoutDocument,caretRect,hitTest } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
const root='tests/fixtures/section-keep/';
const refs=JSON.parse(readFileSync(root+'reference.json','utf8')).cases;
let dom;
beforeAll(()=>{dom=new JSDOM('');globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const hash=path=>createHash('sha256').update(readFileSync(root+path)).digest('hex');
const measure=text=>({width:text.length*6,ascent:10,descent:3});
it.each(refs)('matches native section-boundary page assignments: $name',async c=>{
 expect(hash(c.name+'.docx')).toBe(c.sourceSha256);expect(hash(c.name+'-native.pdf')).toBe(c.pdfSha256);
 const p=await DocxPackage.open(readFileSync(root+c.name+'.docx'));
 const layout=layoutDocument(p.paragraphs,measure,pageGeometry(p.pageSettings),p.numbering,p.tables,p.pageStories,{styles:p.styles});
 expect(layout.pageCount).toBe(c.pageCount);
 const textLines=layout.lines.filter(l=>l.fragments.some(f=>f.text));
 expect(textLines.map(l=>({text:l.fragments.map(f=>f.text).join(''),page:l.page}))).toEqual(c.runs.map(({text,page})=>({text,page})));
 for(const line of textLines){const caret=caretRect(layout,line.start);expect(caret.page).toBe(line.page);expect(hitTest(layout,caret.page,caret.x,caret.y+1)).toBe(line.start);}
 const boundary=layout.lines.find(l=>l.emptySectionBoundary);
 if(boundary)expect(boundary.page).toBe(textLines.find(l=>l.fragments.some(f=>f.text===(c.target===''?'INTRO':'TARGET'))).page);
});
