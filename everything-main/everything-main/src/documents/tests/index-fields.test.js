import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {bodyFieldRanges} from '../src/engine/body-fields.js';
import {bodyFieldInstruction} from '../src/engine/docx-body-fields.js';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const root='tests/fixtures/content-control-index-fields/';
const source=readFileSync(root+'control.docx');
const native=JSON.parse(readFileSync(root+'native-edits.json','utf8').replace(/^\uFEFF/,''));
const reference=JSON.parse(readFileSync(root+'reference.json','utf8'));
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const parse=s=>new DOMParser().parseFromString(s,'application/xml');
function semantics(xml){
 const doc=parse(xml),paragraphs=[...doc.getElementsByTagNameNS(W,'p')];
 return paragraphs.map(p=>{
  let at=0;const fields=[],controls=[];
  const visit=n=>{
   if(n.namespaceURI===W&&n.localName==='t')at+=n.textContent.length;
   if(n.namespaceURI===W&&n.localName==='fldChar'){
    let owner=n.parentElement;while(owner&&!(owner.namespaceURI===W&&owner.localName==='sdt'))owner=owner.parentElement;
    fields.push([at,n.getAttributeNS(W,'fldCharType'),!!owner]);
   }
   const start=at;for(const c of n.children)visit(c);
   if(n.namespaceURI===W&&n.localName==='sdt')controls.push([start,at]);
  };visit(p);
  return {text:[...p.getElementsByTagNameNS(W,'t')].map(n=>n.textContent).join(''),fields,controls};
 });
}
it('binds the native sources and imports all invisible entries without changing text',async()=>{
 expect(createHash('sha256').update(source).digest('hex').toUpperCase()).toBe(native.sourceSha256);
 for(const[name,hash]of Object.entries(reference.sha256))expect(createHash('sha256').update(readFileSync(root+name)).digest('hex')).toBe(hash);
 const p=await DocxPackage.open(source),d=model(p);
 expect(d.text.split('\n')).toEqual(reference.visibleLines);expect(bodyFieldRanges(d.paragraphs)).toHaveLength(8);
 expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
for(const ref of native.cases)it(`matches the native reference ${ref.name}, export, reopen and exact undo`,async()=>{
 const p=await DocxPackage.open(source),d=model(p),before=d.text;
 const lines=d.text.split('\n'),at=lines.slice(0,ref.paragraph-1).reduce((n,s)=>n+s.length+1,0),r=at+lines[ref.paragraph-1].indexOf('R');
 if(ref.name==='temporary-replace'){d.select(r-1,r+1);d.replace('Replaced');}
 else if(ref.name==='temporary-format'){d.select(r,r+1);d.toggleBold();}
 else {d.select(r);d.replace('X');}
 const out=await save(p,d),parts=unzipSync(out);
 expect(semantics(strFromU8(parts['word/document.xml']))).toEqual(semantics(ref.documentXml));
 expect(strFromU8(parts['word/document.xml'])).not.toContain('fldCharType="separate"');
 const again=model(await DocxPackage.open(out));expect(again.text).toBe(d.text);
 expect(bodyFieldRanges(again.paragraphs).map(r=>[r.start,r.end,r.field.instruction])).toEqual(bodyFieldRanges(d.paragraphs).map(r=>[r.start,r.end,r.field.instruction]));
 for(const[name,bytes]of Object.entries(p.parts))if(name!=='word/document.xml')expect(parts[name]).toEqual(bytes);
 d.undo();expect(d.text).toBe(before);expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
it('rebuilds fields at both control boundaries once without moving them out of the control',async()=>{
 const p=await DocxPackage.open(source),d=model(p);
 d.select(0,d.text.length);d.toggleBold();
 expect(semantics(strFromU8(unzipSync(await save(p,d))['word/document.xml']))).toEqual(semantics(strFromU8(p.parts['word/document.xml'])));
});
it('retains XE switches and bookmark reference positions',()=>{
 const instruction=' XE "main:sub" \\b \\i \\f "A" \\r range \\t "see other" \\y "sort" ';
 const field=bodyFieldInstruction(instruction);expect(field.type).toBe('XE');expect(field.bookmark).toBe('range');expect(instruction.slice(...field.bookmarkCodeRange)).toBe('range');
 for(const s of ['XE','XE "entry" \\r','XE "entry" \\unknown'])expect(()=>bodyFieldInstruction(s)).toThrow();
});
it('retains cached INDEX contents and instruction through result editing',async()=>{
 const parts=unzipSync(source);parts['word/document.xml']=strToU8(`<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> INDEX \\c "2" \\z "1033" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Entry 1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:body></w:document>`);
 const p=await DocxPackage.open(zipSync(parts)),d=model(p);d.select(6,7);d.replace('2');const again=model(await DocxPackage.open(await save(p,d)));
 expect(again.text).toBe('Entry 2');expect(bodyFieldRanges(again.paragraphs)[0].field.instruction).toBe(' INDEX \\c "2" \\z "1033" ');
});
it('rejects field/control boundary crossings and visible XE results',async()=>{
 const original=strFromU8(unzipSync(source)['word/document.xml']);
 for(const xml of [
  original.replace('<w:fldChar w:fldCharType="end"/>','<w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>bad</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/>'),
  original.replace('<w:t xml:space="preserve">L</w:t>','<w:fldChar w:fldCharType="begin"/><w:instrText> PAGE </w:instrText><w:fldChar w:fldCharType="separate"/><w:t>L</w:t>'),
 ]){
  const parts=unzipSync(source);parts['word/document.xml']=strToU8(xml);await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
 }
});
it('preserves ordinary complex field results inside inline controls',async()=>{
 const parts=unzipSync(source);parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replaceAll(' XE "',' PAGE ').replaceAll('<w:instrText>entry</w:instrText>','<w:instrText/>').replaceAll('<w:instrText xml:space="preserve">" </w:instrText>','<w:instrText/>').replaceAll('<w:fldChar w:fldCharType="end"/>','<w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/>'));
 const p=await DocxPackage.open(zipSync(parts)),d=model(p);d.select(0,d.text.length);d.toggleBold();
 const out=await save(p,d);expect(semantics(strFromU8(unzipSync(out)['word/document.xml']))).toEqual(semantics(strFromU8(parts['word/document.xml'])));
 const again=model(await DocxPackage.open(out));expect(again.text).toBe(d.text);expect(bodyFieldRanges(again.paragraphs)).toHaveLength(8);
});
