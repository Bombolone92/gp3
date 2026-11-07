import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument,paragraphText} from '../src/engine/model.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
let dom;
beforeAll(()=>{dom=new JSDOM('');globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const refs=JSON.parse(readFileSync('tests/fixtures/leading-break-spacing/reference.json')).variants;
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles);
const layout=d=>layoutDocument(d.paragraphs,t=>({width:t.length*7,ascent:11.3*4/3,descent:2.5*4/3}),pageGeometry(d.pageSettings),d.numbering);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles).arrayBuffer());
const same=(a,b)=>{expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());for(const name of Object.keys(b))expect(Buffer.from(a[name]).equals(Buffer.from(b[name])),name).toBe(true);};
for(const ref of refs)it(`matches the native reference leading-break spacing and retains blank pages: ${ref.file}`,async()=>{
 const bytes=readFileSync('public/fixtures/'+ref.file);expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.docxSha256);
 const pkg=await DocxPackage.open(bytes),doc=model(pkg),result=layout(doc);
 expect(result.pageCount).toBe(ref.pageCount);
 for(const row of ref.cases)for(const [prefix,key] of [['Start','startBaseline'],['Body','bodyBaseline']]){
  const offset=doc.text.indexOf(prefix+row.id),line=result.lines.find(l=>l.start===offset);
  expect(line.page+1,row.id).toBe(row.page);expect(Math.abs(line.baseline*.75-row[key]),row.id+' '+key).toBeLessThan(.1);
 }
 same(unzipSync(await save(pkg,doc)),pkg.parts);
});
it('reflows a leading break into a mid-paragraph break after typing, round trips and undoes exactly',async()=>{
 const pkg=await DocxPackage.open(readFileSync('public/fixtures/leading-break-spacing-modern.docx')),doc=model(pkg);
 const target=()=>layout(doc).lines.find(l=>l.start===doc.text.indexOf('StartL02'));
 const original=target().baseline;
 doc.select(doc.text.indexOf('\fStartL02'));doc.replace('Before');expect(target().baseline).toBeCloseTo(original-12,6);
 const bytes=await save(pkg,doc),out=await DocxPackage.open(bytes),reopened=model(out);
 expect(layout(reopened).lines.map(l=>[l.page,l.y,l.baseline])).toEqual(layout(doc).lines.map(l=>[l.page,l.y,l.baseline]));
 for(const name of Object.keys(pkg.parts))if(name!=='word/document.xml')expect(Buffer.from(out.parts[name]).equals(Buffer.from(pkg.parts[name])),name).toBe(true);
 doc.undo();expect(target().baseline).toBe(original);same(unzipSync(await save(pkg,doc)),pkg.parts);
});
