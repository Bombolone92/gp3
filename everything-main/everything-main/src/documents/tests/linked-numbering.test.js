import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {listMarkers} from '../src/engine/numbering.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/linked-numbering/',source=readFileSync(root+'control.docx');
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const markers=d=>listMarkers(d.paragraphs,d.numbering).filter(Boolean).map(m=>m.text);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const exact=(bytes,parts,edited=false)=>{const out=unzipSync(bytes);expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort());if(edited)return expectBodyEditParts(out,parts);for(const[n,b]of Object.entries(parts))expect(Buffer.from(out[n]).equals(Buffer.from(b)),n).toBe(true);};
it('matches native aliases, independent counters, inheritance and override precedence',async()=>{
 const ref=JSON.parse(readFileSync(root+'reference.json'))[0],hash=b=>createHash('sha256').update(b).digest('hex');
 expect(hash(source)).toBe(ref.sourceSha256);expect(hash(readFileSync(root+'native.pdf'))).toBe(ref.pdfSha256);
 expect(markers(model(await DocxPackage.open(source)))).toEqual(ref.rows.map(r=>r.marker));
});
it.each(['text','split','restart'])('retains linked definitions through %s, reopen and exact undo',async operation=>{
 const p=await DocxPackage.open(source),d=model(p),parts=unzipSync(source);exact(await save(p,d),parts);const before=markers(d);
 d.select(d.text.indexOf('Linked first'));
 if(operation==='text')d.replace('Added ');
 if(operation==='split')d.replace('\n');
 if(operation==='restart')d.restartNumbering(8);
 const bytes=await save(p,d);if(operation!=='restart')exact(bytes,parts,true);
 const again=model(await DocxPackage.open(bytes));expect(again.text).toBe(d.text);expect(markers(again)).toEqual(markers(d));
 if(operation==='text')expect(markers(d)).toEqual(before);
 if(operation==='restart')expect(markers(d)[1]).toBe('8.');
 if(operation==='split')expect(markers(d).length).toBe(before.length+1);
 d.undo();exact(await save(p,d),parts);
});
it.each(['missing','style-cycle','abstract-cycle','ambiguous','empty'])('guards %s links without hanging',async kind=>{
 const parts=unzipSync(source),W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
 const path=kind==='missing'||kind==='style-cycle'?'word/styles.xml':'word/numbering.xml';
 const doc=new DOMParser().parseFromString(strFromU8(parts[path]),'application/xml');
 const all=name=>[...doc.getElementsByTagNameNS(W,name)];
 const attr=(n,k)=>n.getAttributeNS(W,k);
 if(kind==='missing')all('style').find(n=>attr(n,'styleId')==='Link').remove();
 if(kind==='style-cycle')all('style').find(n=>attr(n,'styleId')==='Inherited').getElementsByTagNameNS(W,'basedOn')[0].setAttributeNS(W,'w:val','Inherited');
 if(kind==='abstract-cycle'){const n=doc.createElementNS(W,'w:numStyleLink');n.setAttributeNS(W,'w:val','Link');all('abstractNum').find(n=>attr(n,'abstractNumId')==='100').prepend(n);}
 if(kind==='ambiguous'){const n=all('abstractNum').find(n=>attr(n,'abstractNumId')==='100').cloneNode(true);n.setAttributeNS(W,'w:abstractNumId','999');doc.documentElement.prepend(n);}
 if(kind==='empty')all('numStyleLink')[0].setAttributeNS(W,'w:val','');
 parts[path]=strToU8(new XMLSerializer().serializeToString(doc));await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
});
it('keeps empty definitions without backlinks read-only',async()=>{
 await expect(DocxPackage.open(readFileSync(root+'no-backlink.docx'))).rejects.toThrow(/underlying definition/);
});
