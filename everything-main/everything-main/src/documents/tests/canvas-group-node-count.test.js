import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const source=readFileSync('tests/fixtures/group-node-count/control.docx');
const scenes=p=>Object.values(p.assets).filter(a=>a.scene).map(a=>a.scene);
it('retains every child past the old boundary through editing, reopening and undo',async()=>{
 const p=await DocxPackage.open(source),before=scenes(p);
 expect(before.map(s=>s.children.length)).toEqual([198,199,200,201]);
 const d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 d.select(0);d.replace('Edited ');const edited=await save();expect(scenes(await DocxPackage.open(edited))).toEqual(before);
 const editedParts=unzipSync(edited);
 for(const [n,b] of Object.entries(p.parts))if(n!=='word/document.xml')expect(editedParts[n]).toEqual(b);
 d.undo();expect(unzipSync(await save())).toEqual(p.parts);
},30000);
it('still validates unsupported content after the former boundary',async()=>{
 const p=unzipSync(source),doc=new DOMParser().parseFromString(strFromU8(p['word/document.xml']),'application/xml');
 const groups=doc.getElementsByTagNameNS('http://schemas.microsoft.com/office/word/2010/wordprocessingGroup','wgp');
 const shapes=groups[3].getElementsByTagNameNS('http://schemas.microsoft.com/office/word/2010/wordprocessingShape','wsp');
 shapes[200].appendChild(doc.createElementNS('http://schemas.openxmlformats.org/drawingml/2006/main','a:unsupported'));
 p['word/document.xml']=strToU8(new XMLSerializer().serializeToString(doc));
 await expect(DocxPackage.open(zipSync(p))).rejects.toThrow(/unsupported/);
},30000);
