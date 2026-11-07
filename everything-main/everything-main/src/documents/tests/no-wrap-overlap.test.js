import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
let dom;
vi.setConfig({ testTimeout: 60000 });
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
const source=readFileSync('public/fixtures/no-wrap-overlap.docx');
const reference=JSON.parse(readFileSync('tests/fixtures/no-wrap-overlap/reference.json'));
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const layout=d=>layoutDocument(d.paragraphs,(text,style)=>({width:text.length*style.fontSize*.5,ascent:style.fontSize,descent:style.fontSize/3}),pageGeometry(d.pageSettings),d.numbering,d.tables);
const save=async(p,d)=>unzipSync(new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer()));
const frames=d=>layout(d).floatingObjects.map(f=>[f.page,f.x,f.y,f.width,f.height]);
it('matches all 22 independently captured native reference collision geometries',async()=>{
 const pkg=await DocxPackage.open(source),doc=model(pkg),result=layout(doc);
 expect(result.pageCount).toBe(reference.length);
 for(const ref of reference){
  const page=result.floatingObjects.filter(f=>f.page===ref.case);
  expect(page).toHaveLength(2);
  ['red','blue'].forEach((color,i)=>[page[i].x,page[i].y,page[i].width,page[i].height].forEach((v,j)=>expect(v*.75).toBeCloseTo(ref.frames[color][j],5)));
 }
 expect(await save(pkg,doc)).toEqual(unzipSync(source));
});
it('recomputes collisions after deletion and resize; retains flags, other parts and exact undo',async()=>{
 const pkg=await DocxPackage.open(source),doc=model(pkg),before=frames(doc);
 // Delete the red obstacle on page two: the blue frame returns to its authored position.
 let at=-1;for(let i=0;i<3;i++)at=doc.text.indexOf('\ufffc',at+1);
 doc.select(at,at+1);doc.replace('');
 expect(layout(doc).floatingObjects.filter(f=>f.page===1)[0].x*.75).toBe(180);
 let out=await save(pkg,doc),again=model(await DocxPackage.open(zipSync(out)));
 expect(frames(again)).toEqual(frames(doc));
 for(const name of Object.keys(pkg.parts))if(name!=='word/document.xml')expect(out[name]).toEqual(pkg.parts[name]);
 doc.undo();expect(frames(doc)).toEqual(before);expect(await save(pkg,doc)).toEqual(pkg.parts);
 doc.select(at,at+1);doc.setImageProperties({width:1828800,height:1828800});
 expect(layout(doc).floatingObjects.filter(f=>f.page===1)[1].x*.75).toBeCloseTo(287.95);
 out=await save(pkg,doc);again=model(await DocxPackage.open(zipSync(out)));expect(frames(again)).toEqual(frames(doc));
 expect(strFromU8(out['word/document.xml'])).toContain('allowOverlap="0"');
 doc.undo();expect(await save(pkg,doc)).toEqual(pkg.parts);
});
it.each(['false','0'])('accepts boolean false spelling %s without losing it on export',async value=>{
 const parts=unzipSync(source);parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replaceAll('allowOverlap="0"',`allowOverlap="${value}"`));
 const pkg=await DocxPackage.open(zipSync(parts)),doc=model(pkg);
 expect(doc.paragraphs.flatMap(p=>p.runs).some(r=>r.image?.anchor.allowOverlap===false)).toBe(true);
 expect(await save(pkg,doc)).toEqual(parts);
});
it.each(['no','', '2'])('rejects invalid overlap boolean %s',async value=>{
 const parts=unzipSync(source);parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace('allowOverlap="0"',`allowOverlap="${value}"`));
 await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/allowOverlap/);
});
