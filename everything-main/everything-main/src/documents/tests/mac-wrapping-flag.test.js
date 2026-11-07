import {it,expect,beforeAll,afterAll} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
let dom;
beforeAll(()=>{dom=new JSDOM('');globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const root='tests/fixtures/mac-wrapping-flag/',source=readFileSync(root+'one.docx');
const A='http://schemas.openxmlformats.org/drawingml/2006/main',MAC='http://schemas.microsoft.com/office/mac/drawingml/2011/main';
const parse=bytes=>new DOMParser().parseFromString(strFromU8(unzipSync(bytes)['word/document.xml']),'application/xml');
const flags=xml=>[...xml.getElementsByTagNameNS(MAC,'wrappingTextBoxFlag')];
const change=fn=>{const parts=unzipSync(source),xml=parse(source);fn(xml);parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));return zipSync(parts);};
const scenes=p=>JSON.parse(JSON.stringify(Object.values(p.assets).filter(a=>a.scene).map(a=>a.scene),(k,v)=>['id','shell'].includes(k)?undefined:v));
it.each(['empty','false','true','zero','one'])('preserves %s without changing the active drawing scene',async name=>{
 const plain=await DocxPackage.open(readFileSync(root+'absent.docx')),p=await DocxPackage.open(readFileSync(root+name+'.docx'));
 expect(scenes(p)).toEqual(scenes(plain));expect(p.paragraphs.length).toBe(plain.paragraphs.length);
});
it('retains the extension while editing and resizing pictures, then restores exact package bytes',async()=>{
 const p=await DocxPackage.open(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const signature=b=>flags(parse(b)).map(n=>new XMLSerializer().serializeToString(n));
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 d.select(0);d.replace('Edited ');const at=d.text.indexOf('\ufffc');d.select(at,at+1);
 d.setImageProperties({width:d.selectedImage.width*1.5,height:d.selectedImage.height*1.5,flipH:true});
 const edited=await save();expect(signature(edited)).toEqual(signature(source));expect((await DocxPackage.open(edited)).paragraphs.length).toBe(d.paragraphs.length);
 expectBodyEditParts(unzipSync(edited),p.parts);
 while(d.history.length)d.undo();const restored=unzipSync(await save());
 for(const [n,b]of Object.entries(p.parts))expect(Buffer.from(restored[n]).equals(Buffer.from(b)),n).toBe(true);
});
it.each(['boolean','attribute','nested','text','namespace','element','uri','duplicateFlag','duplicateExtension'])('rejects malformed wrapping metadata: %s',async kind=>{
 for(const parent of ['pic','wps']){
  const bytes=change(xml=>{
   const n=flags(xml).find(n=>n.parentNode.parentNode.parentNode.prefix===parent),ext=n.parentNode;
   if(kind==='boolean')n.setAttribute('val','yes');
   if(kind==='attribute')n.setAttribute('future','1');
   if(kind==='nested')n.append(xml.createElementNS(MAC,'ma14:future'));
   if(kind==='text')n.append(xml.createTextNode('unexpected'));
   if(kind==='namespace')n.replaceWith(xml.createElementNS(A,'a:wrappingTextBoxFlag'));
   if(kind==='element')n.replaceWith(xml.createElementNS(MAC,'ma14:future'));
   if(kind==='uri')ext.setAttribute('uri','urn:unknown');
   if(kind==='duplicateFlag')ext.append(n.cloneNode(true));
   if(kind==='duplicateExtension')ext.parentNode.append(ext.cloneNode(true));
  });await expect(DocxPackage.open(bytes)).rejects.toThrow(/shape extensions/);
 }
});
it('does not bypass unsupported active text wrapping or autofit',async()=>{
 for(const kind of ['wrap','autofit'])await expect(DocxPackage.open(change(xml=>{
  const body=xml.getElementsByTagNameNS('http://schemas.microsoft.com/office/word/2010/wordprocessingShape','bodyPr')[0];
  if(kind==='wrap')body.setAttribute('wrap','none');else body.firstElementChild.replaceWith(xml.createElementNS(A,'a:normAutofit'));
 }))).rejects.toThrow(/grouped drawings/);
});
it('accepts XML boolean whitespace but rejects empty values and non-XML whitespace',async()=>{
 await expect(DocxPackage.open(change(xml=>flags(xml).forEach(n=>n.setAttribute('val',' \ttrue\r\n'))))).resolves.toBeTruthy();
 for(const value of ['', '\u00a0true'])await expect(DocxPackage.open(change(xml=>flags(xml).forEach(n=>n.setAttribute('val',value))))).rejects.toThrow(/invalid Mac wrapping flag/);
});
