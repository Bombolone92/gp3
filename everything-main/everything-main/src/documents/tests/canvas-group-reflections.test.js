import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const source=readFileSync('tests/fixtures/group-reflections/control.docx');
const scenes=p=>Object.values(p.assets).filter(a=>a.scene).map(a=>a.scene);
it('retains reflected group scenes and source transforms through editing and undo',async()=>{
 const p=await DocxPackage.open(source),before=scenes(p);
 expect(before).toHaveLength(12);
 expect(before.map(s=>[!!s.flipH,!!s.flipV])).toEqual([[false,false],[false,false],[false,false],[true,false],[true,false],[true,false],[false,true],[false,true],[false,true],[true,true],[true,true],[true,true]]);
 expect(before[5].children[0].flipH).toBe(true);
 const d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 d.select(0);d.replace('Edited ');const edited=await save();expect(scenes(await DocxPackage.open(edited))).toEqual(before);
 for(const [n,b] of Object.entries(p.parts))if(n!=='word/document.xml')expect(unzipSync(edited)[n]).toEqual(b);
 d.undo();expect(unzipSync(await save())).toEqual(p.parts);
});
it.each(['2','yes','-1'])('rejects malformed group reflection %s',async(value)=>{
 const p=unzipSync(source);p['word/document.xml']=strToU8(strFromU8(p['word/document.xml']).replace('flipH="1"',`flipH="${value}"`));
 await expect(DocxPackage.open(zipSync(p))).rejects.toThrow('rotated or flipped shape transforms');
});
it('retains readable text contents inside reflected groups',async()=>{
 const p=unzipSync(source),doc=new DOMParser().parseFromString(strFromU8(p['word/document.xml']),'application/xml');
 const ns='http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
 const shape=doc.getElementsByTagNameNS(ns,'wsp')[3];
 const text=new DOMParser().parseFromString('<wps:txbx xmlns:wps="'+ns+'" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:txbxContent><w:p><w:r><w:t>Text</w:t></w:r></w:p></w:txbxContent></wps:txbx>','application/xml').documentElement;
 shape.insertBefore(doc.importNode(text,true),shape.getElementsByTagNameNS(ns,'bodyPr')[0]);
 p['word/document.xml']=strToU8(new XMLSerializer().serializeToString(doc));
 const imported=await DocxPackage.open(zipSync(p));
 expect(scenes(imported)[3].flipH).toBe(true);
 expect(scenes(imported)[3].children[0].text.paragraphs[0].runs.map(r=>r.text).join('')).toBe('Text');
});
