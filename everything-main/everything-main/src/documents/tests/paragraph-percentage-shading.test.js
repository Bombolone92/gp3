import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {paragraphBackgroundRect} from '../src/engine/paragraph-backgrounds.js';
const root='tests/fixtures/paragraph-percentage-shading/';
const refs=JSON.parse(readFileSync(root+'reference.json','utf8'));
const cases=JSON.parse(readFileSync(root+'cases.json','utf8'));
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const shadings=bytes=>[...new DOMParser().parseFromString(strFromU8(unzipSync(bytes)['word/document.xml']),'application/xml').getElementsByTagNameNS(W,'shd')].map(n=>[...n.attributes].map(a=>[a.localName,a.value]).sort());
for(const ref of refs){
it(`${ref.source}: matches every native percentage, automatic and nil sample`,async()=>{
 for(const [file,hash] of [[ref.source,ref.sourceSha256],[ref.pdf,ref.pdfSha256]])expect(createHash('sha256').update(readFileSync(root+file)).digest('hex')).toBe(hash);
 const p=await DocxPackage.open(readFileSync(root+ref.source)),d=model(p);
 cases.forEach((c,i)=>{
  const p=d.paragraphs.find(p=>p.runs.map(r=>r.text).join('').startsWith(c.label+' '));expect(p,c.label).toBeTruthy();
  const value=p.format.paragraphShading,base=c.context==='dark-cell'||ref.source==='dark.docx'?'#224466':'#FFFFFF';
  const rect=paragraphBackgroundRect({y:40,height:20,paragraphBackground:{value,x:0,width:200,before:0,after:0}},{width:300,height:400,top:0,bottom:0,background:base});
  const expected='#'+ref.rows[i].rgb.map(n=>n.toString(16).padStart(2,'0')).join('').toUpperCase();expect(rect.color,c.label).toBe(expected);
 });
 expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
it(`${ref.source}: retains percentage/nil XML through text and style edits, reopen and undo`,async()=>{
 const source=readFileSync(root+ref.source),p=await DocxPackage.open(source),d=model(p);
 d.select(0);d.replace('Edited ');const out=await save(p,d);expect(shadings(out)).toEqual(shadings(source));
 const again=model(await DocxPackage.open(out));expect(again.text).toBe(d.text);
 for(const[name,bytes]of Object.entries(p.parts))if(name!=='word/document.xml')expect(unzipSync(out)[name]).toEqual(bytes);
 d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
 d.editParagraphStyle('ShadeBase',{paragraph:{paragraphShading:'123456'}});
 expect(d.paragraphs.find(p=>p.styleId==='ShadeBase').format.paragraphShading).toBe('123456');
 const edited=await save(p,d);expect(shadings(edited)).toEqual(shadings(source));
 expect(model(await DocxPackage.open(edited)).paragraphs.find(p=>p.styleId==='ShadeBase').format.paragraphShading).toBe('123456');
 d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
it(`${ref.source}: replaces only explicitly edited percentage fill with clear RGB`,async()=>{
 const source=readFileSync(root+ref.source),p=await DocxPackage.open(source),d=model(p);
 d.select(0);d.setParagraphFormat({paragraphShading:'AABBCC'});const out=await save(p,d),before=shadings(source),after=shadings(out);
 expect(after[0]).toEqual([['color','auto'],['fill','AABBCC'],['val','clear']]);expect(after.slice(1)).toEqual(before.slice(1));
 expect(model(await DocxPackage.open(out)).paragraphs[0].format.paragraphShading).toBe('AABBCC');
 d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
}
