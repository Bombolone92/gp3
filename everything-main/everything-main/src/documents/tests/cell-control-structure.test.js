import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
vi.setConfig({testTimeout:60000});let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>dom.window.close());
const source=readFileSync('public/fixtures/cell-controls.docx'),W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const tree=b=>new DOMParser().parseFromString(strFromU8(unzipSync(b)['word/document.xml']),'application/xml');
it('adds ordinary cells without duplicating control IDs or losing existing wrappers',async()=>{
 const pkg=await DocxPackage.open(source),d=model(pkg);d.select(d.text.indexOf('Cell alpha'));d.insertTableRow();
 const bytes=await save(pkg,d),xml=tree(bytes),wrappers=[...xml.getElementsByTagNameNS(W,'sdt')];
 expect(wrappers).toHaveLength(6);expect(new Set(wrappers.map(s=>s.getElementsByTagNameNS(W,'id')[0].getAttributeNS(W,'val'))).size).toBe(6);
 expect(model(await DocxPackage.open(bytes)).text).toBe(d.text);d.undo();expect(unzipSync(await save(pkg,d))).toEqual(unzipSync(source));
});
it('retains a wrapped empty vertical continuation when unrelated content changes',async()=>{
 const parts=unzipSync(source),xml=tree(source),rows=xml.getElementsByTagNameNS(W,'tr');
 const owner=[...rows[0].children].find(n=>n.localName==='tc');
 const wrapper=[...rows[1].children].filter(n=>n.localName==='sdt')[1],continuation=wrapper.getElementsByTagNameNS(W,'tc')[0];
 for(const [cell,val] of [[owner,'restart'],[continuation,'continue']]){const merge=xml.createElementNS(W,'w:vMerge');merge.setAttributeNS(W,'w:val',val);cell.getElementsByTagNameNS(W,'tcPr')[0].append(merge);}
 parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));const bytes=zipSync(parts),pkg=await DocxPackage.open(bytes),d=model(pkg);
 d.select(0);d.replace('Edited ');const saved=await save(pkg,d),out=tree(saved);
 const retained=[...out.getElementsByTagNameNS(W,'sdt')].find(s=>s.getElementsByTagNameNS(W,'id')[0].getAttributeNS(W,'val')==='104');
 expect(retained.parentElement.localName).toBe('tr');expect(retained.getElementsByTagNameNS(W,'vMerge')[0].getAttributeNS(W,'val')).toBe('continue');
 expect(model(await DocxPackage.open(saved)).text).toBe(d.text);d.undo();expect(unzipSync(await save(pkg,d))).toEqual(parts);
});
