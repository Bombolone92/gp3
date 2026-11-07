import {it,expect,beforeAll,afterAll} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
const source=readFileSync('public/fixtures/hidden-fill-controls.docx');
const A='http://schemas.openxmlformats.org/drawingml/2006/main',A14='http://schemas.microsoft.com/office/drawing/2010/main';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const parse=bytes=>new DOMParser().parseFromString(strFromU8(unzipSync(bytes)['word/document.xml']),'application/xml');
const saved=xml=>[...xml.getElementsByTagNameNS(A14,'hiddenFill')];
function change(fn){const parts=unzipSync(source),xml=parse(source);fn(xml);parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));return zipSync(parts);}
const scenes=p=>JSON.parse(JSON.stringify(Object.values(p.assets).filter(a=>a.scene).map(a=>a.scene),(k,v)=>['id','shell'].includes(k)?undefined:v));
it('never applies saved solid, gradient, pattern, picture or group fills',async()=>{
 const plain=change(xml=>saved(xml).forEach(n=>n.parentNode.parentNode.remove()));
 const p=await DocxPackage.open(source);expect(p.readOnly).not.toBe(true);
 expect(scenes(p)).toEqual(scenes(await DocxPackage.open(plain)));
 expect(scenes(p)).toHaveLength(8);expect(scenes(p)[2].fill).toBeNull();expect(scenes(p)[3].fill).toBeNull();
});
it('preserves saved fill XML, package parts, edit/reopen and exact undo',async()=>{
 const p=await DocxPackage.open(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 expect(unzipSync(await save())).toEqual(p.parts);d.select(0);d.replace('Edited ');
 const bytes=await save(),reopened=await DocxPackage.open(bytes);
 expect(scenes(reopened)).toEqual(scenes(p));
 const signature=b=>saved(parse(b)).map(n=>new XMLSerializer().serializeToString(n));expect(signature(bytes)).toEqual(signature(source));
 for(const [name,data] of Object.entries(unzipSync(bytes)))if(name!=='word/document.xml')expect(data).toEqual(p.parts[name]);
 d.undo();expect(unzipSync(await save())).toEqual(p.parts);
});
it('accepts dormant no-fill and lower-case extension identifiers',async()=>{
 const p=await DocxPackage.open(change(xml=>saved(xml).forEach(n=>{n.replaceChildren(xml.createElementNS(A,'a:noFill'));n.parentNode.setAttribute('uri',n.parentNode.getAttribute('uri').toLowerCase());})));
 expect(scenes(p)).toEqual(scenes(await DocxPackage.open(source)));
});
it.each(['empty','duplicate fill','unknown fill','wrong namespace','attribute','text','duplicate extension','duplicate element'])('rejects malformed saved-fill %s',async kind=>{
 const bytes=change(xml=>{const n=saved(xml)[0];
  if(kind==='empty')n.replaceChildren();
  if(kind==='duplicate fill')n.append(n.firstElementChild.cloneNode(true));
  if(kind==='unknown fill')n.replaceChildren(xml.createElementNS(A,'a:future'));
  if(kind==='wrong namespace')n.replaceChildren(xml.createElementNS(A14,'a14:solidFill'));
  if(kind==='attribute')n.setAttribute('future','1');
  if(kind==='text')n.append(xml.createTextNode('bad'));
  if(kind==='duplicate extension')n.parentNode.parentNode.append(n.parentNode.cloneNode(true));
  if(kind==='duplicate element')n.parentNode.append(n.cloneNode(true));
 });await expect(DocxPackage.open(bytes)).rejects.toMatchObject({name:'UnsupportedDocumentError'});
});
it('coexists with saved outlines and shadow flags on grouped shapes and pictures',async()=>{
 const original=readFileSync('public/fixtures/shadow-obscured.docx'),parts=unzipSync(original),xml=parse(original);
 for(const flag of [...xml.getElementsByTagNameNS(A14,'shadowObscured')]){
  const list=flag.parentNode.parentNode;
  for(const [name,uri] of [['hiddenFill','{909E8E84-426E-40DD-AFC4-6F175D3DCCD1}'],['hiddenLine','{91240B29-F687-4F45-9708-019B960494DF}']]){
   const ext=xml.createElementNS(A,'a:ext');ext.setAttribute('uri',uri);
   const saved=xml.createElementNS(A14,'a14:'+name);saved.append(xml.createElementNS(A,'a:noFill'));ext.append(saved);list.append(ext);
  }
 }
 parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));
 expect(scenes(await DocxPackage.open(zipSync(parts)))).toEqual(scenes(await DocxPackage.open(original)));
});
