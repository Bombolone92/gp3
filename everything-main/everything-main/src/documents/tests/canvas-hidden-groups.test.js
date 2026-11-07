import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const source=readFileSync('tests/fixtures/hidden-groups/control.docx');
const scenes=p=>Object.values(p.assets).filter(a=>a.scene).map(a=>a.scene);
const WPG='http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const mutate=fn=>{const parts=unzipSync(source),doc=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');fn(doc);parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(doc));return zipSync(parts);};
it('omits hidden descendants and preserves visible siblings through editing and undo',async()=>{
 const p=await DocxPackage.open(source),before=scenes(p);
 expect(before.map(s=>s.children.length)).toEqual([2,2,2,2,2]);
 expect(before.map(s=>s.children[1].children.length)).toEqual([2,2,2,0,0]);
 const d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 const same=(out)=>{expect(Object.keys(out).sort()).toEqual(Object.keys(p.parts).sort());for(const[n,b]of Object.entries(p.parts))expect(Buffer.from(out[n]).equals(Buffer.from(b)),n).toBe(true);};
 same(unzipSync(await save()));d.select(0);d.replace('Edited ');const edited=await save();
 expect(scenes(await DocxPackage.open(edited))).toEqual(before);
 const out=unzipSync(edited);for(const[n,b]of Object.entries(p.parts))if(n!=='word/document.xml')expect(Buffer.from(out[n]).equals(Buffer.from(b)),n).toBe(true);
 expect(strFromU8(out['word/document.xml'])).toContain('hidden="1"');
 d.undo();same(unzipSync(await save()));
});
it.each(['2','yes','-1',''])('rejects invalid hidden flags %j',async value=>{
 const bytes=mutate(doc=>doc.getElementsByTagNameNS(WPG,'cNvPr')[0].setAttribute('hidden',value));
 await expect(DocxPackage.open(bytes)).rejects.toThrow('invalid group hidden flag');
});
it('accepts XML boolean whitespace without making hidden children visible',async()=>{
 const bytes=mutate(doc=>{for(const n of doc.getElementsByTagNameNS(WPG,'cNvPr'))if(n.getAttribute('hidden')==='1')n.setAttribute('hidden',' 1 ');});
 expect(scenes(await DocxPackage.open(bytes))[3].children[1].children).toEqual([]);
});
it.each([true,false])('only skips unsupported descendants when their ancestor is hidden: %s',async hidden=>{
 const bytes=mutate(doc=>{const nv=[...doc.getElementsByTagNameNS(WPG,'cNvPr')].find(n=>n.getAttribute('hidden')==='1');if(!hidden)nv.setAttribute('hidden','0');nv.parentNode.children[3].appendChild(doc.createElementNS('http://schemas.openxmlformats.org/drawingml/2006/main','a:unsupported'));});
 if(hidden)expect(scenes(await DocxPackage.open(bytes))[3].children[1].children).toEqual([]);
 else await expect(DocxPackage.open(bytes)).rejects.toThrow('unsupported');
});
