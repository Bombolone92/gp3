import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument,paragraphText} from '../src/engine/model.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
import {createParagraphPaginator} from '../src/engine/pagination.js';
let dom;
beforeAll(()=>{dom=new JSDOM('');globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const refs=JSON.parse(readFileSync('tests/fixtures/section-before-spacing/reference.json')).variants;
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles);
const layout=d=>layoutDocument(d.paragraphs,t=>({width:t.length*7,ascent:11.3*4/3,descent:2.5*4/3}),pageGeometry(d.pageSettings),d.numbering);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles).arrayBuffer());
const same=(a,b)=>{expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());for(const name of Object.keys(b))expect(Buffer.from(a[name]).equals(Buffer.from(b[name])),name).toBe(true);};
for(const ref of refs)it(`matches all native reference page starts and body baselines: ${ref.file}`,async()=>{
 const bytes=readFileSync('public/fixtures/'+ref.file);expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.docxSha256);
 const pkg=await DocxPackage.open(bytes),doc=model(pkg),result=layout(doc);
 expect(result.pageCount).toBe(18);
 for(const row of ref.cases)for(const [prefix,key] of [['Start','startBaseline'],['Body','bodyBaseline']]){
  const p=doc.paragraphs.find(p=>paragraphText(p)===prefix+row.id),line=result.lines.find(l=>l.paragraphId===p.id);
  expect(line.page+1,row.id).toBe(row.page);expect(Math.abs(line.baseline*.75-row[key]),row.id+' '+key).toBeLessThan(.1);
 }
 same(unzipSync(await save(pkg,doc)),pkg.parts);
});
it('updates following section spacing after edits and preserves it through reopening and undo',async()=>{
 const pkg=await DocxPackage.open(readFileSync('public/fixtures/section-before-spacing.docx')),doc=model(pkg);
 const start=()=>layout(doc).lines.find(l=>l.paragraphId===doc.paragraphs.find(p=>paragraphText(p)==='StartS02').id).baseline;
 const original=start();doc.select(doc.text.indexOf('Previous S02'));doc.setParagraphFormat({spaceAfter:8});expect(start()).toBeCloseTo(original-5*4/3,6);
 const bytes=await save(pkg,doc),reopened=model(await DocxPackage.open(bytes));expect(layout(reopened).lines.map(l=>[l.page,l.y,l.baseline])).toEqual(layout(doc).lines.map(l=>[l.page,l.y,l.baseline]));
 const parts=unzipSync(bytes);for(const name of Object.keys(pkg.parts))if(name!=='word/document.xml')expect(Buffer.from(parts[name]).equals(Buffer.from(pkg.parts[name])),name).toBe(true);
 doc.undo();expect(start()).toBe(original);same(unzipSync(await save(pkg,doc)),pkg.parts);
});
it('does not cache a preceding section gap into reusable measured blocks',()=>{
 const paginate=createParagraphPaginator(),page={top:20,bottom:20,height:200};
 const blocks=[{format:{spaceBefore:12,spaceAfter:0},lines:[{paragraphId:'p',start:0,end:1,height:20,baseline:15}]}];
 expect(paginate(blocks,page,10,20,4).lines[0].y).toBe(32);
 expect(paginate(blocks,page,10,20,0).lines[0].y).toBe(36);
 expect(paginate(blocks,page,10,20,30).lines[0].y).toBe(20);
});
