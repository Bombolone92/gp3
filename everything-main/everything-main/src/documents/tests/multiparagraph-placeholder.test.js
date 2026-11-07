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
const source=readFileSync('tests/fixtures/multiparagraph-placeholder/control.docx');
const refs=JSON.parse(readFileSync('tests/fixtures/multiparagraph-placeholder/native-results.json','utf8').replace(/^\uFEFF/,''));
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const title=c=>new DOMParser().parseFromString(c.shell,'application/xml').getElementsByTagNameNS(W,'alias')[0].getAttributeNS(W,'val');
const range=(d,name)=>blockControlGroups(d.paragraphs).find(r=>title(r.control)===name);
for (const ref of refs.cases) it(`restores native multi-paragraph prompt after ${ref.name}`, async()=>{
 const p=await DocxPackage.open(source),d=model(p);
 expect(unzipSync(await save(p,d))).toEqual(p.parts);
 let r=range(d,ref.name);
 if(ref.name==='showing'){d.select(r.start+2);d.replace('Typed replacement');r=range(d,ref.name);}
 const entered=await save(p,d),p2=await DocxPackage.open(entered),reopened=model(p2);
 for(const [pkg,current] of [[p,d],[p2,reopened]]){
  const before=await save(pkg,current);r=range(current,ref.name);current.select(r.start,r.end);current.replace('');
  const out=await save(pkg,current),restored=model(await DocxPackage.open(out));
  for(const actual of [current,restored]){
   r=range(actual,ref.name);expect(actual.text.slice(r.start,r.end)).toBe(ref.restored.replaceAll('\r','\n'));
   expect(r.paragraphs).toHaveLength(2);expect(r.control.placeholder).toBe(true);
   expect(r.paragraphs[0].runs[0].bold).toBe(true);expect(r.paragraphs[1].runs[0].italic).toBe(true);
   const native=model(await DocxPackage.open(readFileSync('tests/fixtures/multiparagraph-placeholder/native-restored.docx')));
   const expected=range(native,ref.name);
   for(let i=0;i<2;i++)for(const key of ['indentLeft','spaceAfter'])expect(r.paragraphs[i].format[key]).toBe(expected.paragraphs[i].format[key]);
  }
  for(const[n,b]of Object.entries(pkg.parts))if(n!=='word/document.xml')expect(unzipSync(out)[n]).toEqual(b);
  current.undo();expect(unzipSync(await save(pkg,current))).toEqual(unzipSync(before));
  current.redo();expect(current.text).toBe(restored.text);
 }
},30000);
it('restores paragraph boundaries when search deletes all real content',async()=>{
 const p=await DocxPackage.open(source),d=model(p);
 expect(d.replaceMatches('Existing value','',{},true)).toBe(1);
 const reopened=model(await DocxPackage.open(await save(p,d)));
 expect(reopened.text).toBe(d.text);expect(range(reopened,'filled').paragraphs).toHaveLength(2);
 expect(range(reopened,'filled').control.placeholder).toBe(true);
 d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
it('keeps multi-paragraph glossary prompts invalid inside inline controls',async()=>{
 const parts=unzipSync(source);let xml=strFromU8(parts['word/document.xml']);
 const start=xml.indexOf('<w:sdt>'),end=xml.indexOf('</w:sdt>',start)+8;
 const block=xml.slice(start,end).replace(/<w:p><w:pPr><\/w:pPr>/,'').replace('</w:p></w:sdtContent>','</w:sdtContent>');
 xml=xml.slice(0,start)+'<w:p>'+block+'</w:p>'+xml.slice(end);parts['word/document.xml']=strToU8(xml);
 await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow('non-inline placeholder definitions');
});
