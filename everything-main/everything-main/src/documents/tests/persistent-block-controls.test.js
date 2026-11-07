import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage,W} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {blockControlGroups} from '../src/engine/block-controls.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const source=readFileSync('tests/fixtures/persistent-block-controls/control.docx');
const refs=JSON.parse(readFileSync('tests/fixtures/persistent-block-controls/native-results.json','utf8').replace(/^\uFEFF/,''));
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const title=c=>new DOMParser().parseFromString(c.shell,'application/xml').getElementsByTagNameNS(W,'alias')[0].getAttributeNS(W,'val');
const range=(d,name)=>blockControlGroups(d.paragraphs).find(r=>title(r.control)===name);
for(const ref of refs.cases)it(`retains block wrapper and native content after ${ref.name}`,async()=>{
 const p=await DocxPackage.open(source),d=model(p),r=range(d,ref.name);
 switch(ref.name){
  case 'insert':d.select(r.start+2);d.replace('NEW ');break;
  case 'split':d.select(r.start+5);d.replace('\n');break;
  case 'format':d.select(r.start,r.start+5);d.toggleBold();break;
  case 'delete-all':d.select(r.start,r.end);d.replace('');break;
  default:d.select(r.start,r.end);d.replace('Edited value');
 }
 const bytes=await save(p,d),reopened=model(await DocxPackage.open(bytes));
 for(const current of [d,reopened]){
  expect(blockControlGroups(current.paragraphs)).toHaveLength(8);
  const actual=range(current,ref.name);
  expect(current.text.slice(actual.start,actual.end)).toBe(ref.after.replaceAll('\r','\n'));
  expect(actual.control.placeholder).toBe(ref.placeholder);
  if(ref.name==='split')expect(actual.paragraphs).toHaveLength(2);
  if(ref.name==='format')expect(actual.paragraphs[0].runs[0]).toMatchObject({text:'Alpha',bold:true});
 }
 for(const[n,b]of Object.entries(p.parts))if(n!=='word/document.xml')expect(unzipSync(bytes)[n]).toEqual(b);
 d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
 d.redo();expect(d.text).toBe(reopened.text);
},30000);
it.each(['Edited',''])('preserves persistent blocks during search replacement %j',async text=>{
 const p=await DocxPackage.open(source),d=model(p);
 expect(d.replaceMatches('Alpha beta',text,{},true)).toBe(8);
 const bytes=await save(p,d),reopened=model(await DocxPackage.open(bytes));
 expect(reopened.text).toBe(d.text);expect(blockControlGroups(reopened.paragraphs)).toHaveLength(8);
 for(const name of ['insert','replace','delete-all','split','format','placeholder','temporary-false'])expect(range(reopened,name).control.placeholder).toBe(!text);
 expect(range(reopened,'two-paragraphs').control.placeholder).toBe(false);
 d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
it('removes a fully covered persistent wrapper while keeping outside text',async()=>{
 const p=await DocxPackage.open(source),d=model(p),r=range(d,'replace');
 d.select(r.start-1,r.end+1);d.replace('X');
 const reopened=model(await DocxPackage.open(await save(p,d)));
 expect(range(reopened,'replace')).toBeUndefined();expect(reopened.text).toBe(d.text);
 d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
it('keeps an unsupported partial boundary join atomic',async()=>{
 const p=await DocxPackage.open(source),d=model(p),r=range(d,'two-paragraphs');
 d.select(r.start-2,r.start+12);const before=d.snapshot();
 expect(()=>d.replace('X')).toThrow('boundary');expect(d.snapshot()).toEqual(before);
 d.select(r.start);const atStart=d.snapshot();expect(d.delete(-1)).toBe(false);expect(d.snapshot()).toEqual(atStart);
});
it('uses the default empty prompt consistently before and after reopening',async()=>{
 const p=await DocxPackage.open(source),d=model(p);let r=range(d,'placeholder');d.select(r.start,r.end);d.replace('Entered');
 const saved=await save(p,d),p2=await DocxPackage.open(saved),d2=model(p2);
 for(const current of [d,d2]){r=range(current,'placeholder');current.select(r.start,r.end);current.replace('');r=range(current,'placeholder');expect(current.text.slice(r.start,r.end)).toBe('     ');expect(r.control.placeholder).toBe(true);}
});

it('restores a nested inline prompt without removing its persistent block siblings',async()=>{
 const parts=unzipSync(source),xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');
 const outer=xml.getElementsByTagNameNS(W,'sdt')[0],content=outer.getElementsByTagNameNS(W,'sdtContent')[0];
 const replacement=new DOMParser().parseFromString('<w:p xmlns:w="'+W+'"><w:r><w:t xml:space="preserve">Left </w:t></w:r><w:sdt><w:sdtPr><w:id w:val="901"/><w:richText/></w:sdtPr><w:sdtContent><w:r><w:t>Inner</w:t></w:r></w:sdtContent></w:sdt><w:r><w:t xml:space="preserve"> Right</w:t></w:r></w:p>','application/xml').documentElement;
 content.replaceChildren(xml.importNode(replacement,true));parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));
 const p=await DocxPackage.open(zipSync(parts)),d=model(p),at=d.text.indexOf('Inner');d.select(at,at+5);d.replace('');
 expect(d.text).toContain('Left       Right');expect(range(d,'insert').control.placeholder).toBe(false);
 const reopened=model(await DocxPackage.open(await save(p,d)));expect(reopened.text).toBe(d.text);expect(range(reopened,'insert').control.placeholder).toBe(false);
 d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
it.each(['table'])('keeps persistent %s wrappers read-only until structural semantics are supported',async name=>{
 const bytes=readFileSync(`public/fixtures/block-control-${name}.docx`),parts=unzipSync(bytes);
 parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace('<w:temporary/>',''));
 await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow('persistent controls around tables');
});
