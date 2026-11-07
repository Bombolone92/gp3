import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage,W} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const folder='tests/fixtures/zero-cell-spacing/', source=readFileSync(folder+'source.docx');
let dom,base;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;
 base=unzipSync(source);const xml=new DOMParser().parseFromString(strFromU8(base['word/document.xml']),'application/xml'),body=xml.getElementsByTagNameNS(W,'body')[0];
 for(const n of [...body.children].slice(2))if(n.localName!=='sectPr')n.remove();base['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));
});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const variant=(level,type,value,extra)=>{
 const parts={...base},xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');
 const table=xml.getElementsByTagNameNS(W,'tbl')[0],row=table.getElementsByTagNameNS(W,'tr')[0];
 let parent=level==='table'?table.getElementsByTagNameNS(W,'tblPr')[0]:xml.createElementNS(W,level==='row'?'w:trPr':'w:tblPrEx');
 if(level!=='table')row.insertBefore(parent,row.firstChild);
 const node=xml.createElementNS(W,'w:tblCellSpacing');if(type!==null)node.setAttributeNS(W,'w:type',type);if(value!==null)node.setAttributeNS(W,'w:w',value);parent.insertBefore(node,[...parent.children].find(n=>['tblInd','tblBorders','shd','tblLayout','tblCellMar','tblLook'].includes(n.localName))||null);extra?.(node,xml);
 parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));return zipSync(parts);
};
it('binds no-gap controls to the native reference and confirms identical native geometry',()=>{
 const ref=JSON.parse(readFileSync(folder+'reference.json'));
 expect(createHash('sha256').update(source).digest('hex')).toBe(ref.sourceSha256);expect(createHash('sha256').update(readFileSync(folder+'native.pdf')).digest('hex')).toBe(ref.pdfSha256);
 for(const page of ref.pages)expect(page.bounds,page.name).toEqual(ref.pages[0].bounds);
});
it.each([[null,null],['dxa','0'],['dxa','-0'],['dxa','+000'],['dxa','0.000pt'],['auto','-999999999999999999999'],['pct','999999999999999999999'],['nil','120'],['dxa','25%']])('accepts no-gap spacing %s %s in each property context',async(type,value)=>{
 for(const level of ['table','row','exception'])expect((await DocxPackage.open(variant(level,type,value))).tables).toHaveLength(2);
});
it.each([['dxa','1'],['dxa','-1'],['auto','0.001pt'],['nil','2mm'],['dxa','bad'],['dxa',''],['bad','0']])('rejects nonzero or invalid spacing %s %s in each property context',async(type,value)=>{
 for(const level of ['table','row','exception'])await expect(DocxPackage.open(variant(level,type,value))).rejects.toThrow();
});
it('accepts XML integer whitespace around zero spacing',async()=>{
 for(const level of ['table','row','exception'])expect((await DocxPackage.open(variant(level,'dxa',' \t+000\n'))).tables).toHaveLength(2);
});
it.each(['attribute','child','text','duplicate'])('rejects malformed spacing: %s',async kind=>{
 for(const level of ['table','row','exception'])await expect(DocxPackage.open(variant(level,'dxa','0',(n,x)=>{
  if(kind==='attribute')n.setAttributeNS(W,'w:unknown','1');if(kind==='child')n.append(x.createElementNS(W,'w:foo'));if(kind==='text')n.textContent='bad';if(kind==='duplicate')n.parentNode.append(n.cloneNode(true));
 }))).rejects.toThrow();
});
it('retains spacing declarations through a nested-cell edit, reopening and exact undo',async()=>{
 const p=await DocxPackage.open(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);expect(p.tables).toHaveLength(20);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 const at=d.text.indexOf('Inner1');d.select(at,at+6);d.replace('Edited');const edited=await save();expect((await DocxPackage.open(edited)).paragraphs.some(p=>p.runs.some(r=>r.text?.includes('Edited')))).toBe(true);
 const after=unzipSync(edited),beforeXml=new DOMParser().parseFromString(strFromU8(p.parts['word/document.xml']),'application/xml'),afterXml=new DOMParser().parseFromString(strFromU8(after['word/document.xml']),'application/xml');
 const spacing=x=>[...x.getElementsByTagNameNS(W,'tblCellSpacing')].map(n=>[n.parentNode.localName,n.getAttributeNS(W,'type'),n.getAttributeNS(W,'w')]);expect(spacing(afterXml)).toEqual(spacing(beforeXml));
 expectBodyEditParts(after,p.parts);
 d.undo();const undone=unzipSync(await save());for(const name of Object.keys(p.parts))expect(Buffer.from(undone[name]).equals(Buffer.from(p.parts[name])),name).toBe(true);
},30000);
