import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutDocument, caretRect } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
const source=readFileSync('public/fixtures/empty-section-boundary.docx');
const reference=JSON.parse(readFileSync('tests/fixtures/empty-section-boundary/reference.json','utf8'));
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
const layout=d=>layoutDocument(d.paragraphs,t=>({width:t.length*6,ascent:12,descent:4}),pageGeometry(d.pageSettings),d.numbering,d.tables);
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
it('matches the native reference pages, including real whitespace/text overflow and suppressed empty decorations',async()=>{
 expect(createHash('sha256').update(source).digest('hex')).toBe(reference.sourceSha256);
 const p=await DocxPackage.open(source),d=model(p),before=structuredClone(d.paragraphs),l=layout(d);
 expect(l.pages).toHaveLength(reference.pages.length);
 for(const {page,text} of reference.pages) if(text) {
  const bodyText=text.replace(/^1\. /,'');
  const paragraph=d.paragraphs.find(p=>p.runs.map(r=>r.text).join('')===bodyText);expect(paragraph,text).toBeDefined();
  const line=l.lines.find(line=>line.paragraphId===paragraph.id);expect(line.page,text).toBe(page-1);
  if(bodyText!==text)expect(line.marker.text).toBe('1.');
 }
 expect(l.paragraphBorders).toHaveLength(0);
 expect(l.lines.some(line=>line.paragraphBackground)).toBe(false);
 expect(d.paragraphs).toEqual(before);
 for(const line of l.lines.filter(l=>l.emptySectionBoundary)){
  const caret=caretRect(l,line.start),page=l.pages[line.page];
  expect(caret.page).toBe(line.page);expect(caret.y).toBeGreaterThanOrEqual(page.top);
  expect(caret.y+caret.height).toBeLessThanOrEqual(page.height-page.bottom+1e-6);
 }
});
it('makes typed boundary content consume space, preserving section XML through export/reopen/undo',async()=>{
 const p=await DocxPackage.open(source),d=model(p);
 const boundary=d.paragraphs.findIndex(p=>p.sectionEnd),offset=d.paragraphs.slice(0,boundary).reduce((n,p)=>n+p.runs.reduce((m,r)=>m+r.text.length,0)+1,0);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 d.select(offset);d.replace('Typed boundary');expect(layout(d).pages).toHaveLength(reference.pages.length+1);
 const bytes=await save(),reopened=model(await DocxPackage.open(bytes));expect(layout(reopened).pages).toHaveLength(reference.pages.length+1);
 const parts=unzipSync(bytes);for(const name of Object.keys(p.parts)) if(name!=='word/document.xml')expect(parts[name]).toEqual(p.parts[name]);
 d.undo();expect(layout(d).pages).toHaveLength(reference.pages.length);expect(unzipSync(await save())).toEqual(p.parts);
});
it('bounds the virtual caret when automatic line spacing compresses the font box',async()=>{
 const d=model(await DocxPackage.open(source)),p=d.paragraphs.find(p=>p.sectionEnd);
 p.format.lineRule='auto';p.format.lineSpacing=.9;
 const l=layout(d),line=l.lines.find(l=>l.paragraphId===p.id),caret=caretRect(l,line.start),page=l.pages[line.page];
 expect(line.virtual).toBe(true);expect(caret.height).toBeGreaterThan(0);
 expect(caret.y).toBeGreaterThanOrEqual(page.top);expect(caret.y+caret.height).toBeLessThanOrEqual(page.height-page.bottom+1e-6);
});
