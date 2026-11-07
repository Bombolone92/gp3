import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const source=readFileSync('public/fixtures/group-rotation.docx');
const scenes=p=>Object.values(p.assets).filter(a=>a.scene).map(a=>a.scene);
it('retains nested rotations, flips and custom paths through editing and exact undo',async()=>{
 const p=await DocxPackage.open(source),before=scenes(p),pictures=before.map(s=>s.children[0].children[0]);
 expect(pictures).toHaveLength(16);
 expect(before.map(s=>s.groupRotation||0)).toEqual([0,1800000,2699940,2700000,2700060,5400000,8100000,10800000,13500000,16200000,18900000,19800000,1800000,5400000,1800000,10800000]);
 expect(pictures[12].flipH).toBe(true);expect(pictures[13].flipV).toBe(true);
 expect(pictures[14].paths).toHaveLength(1);
 const d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 expect(unzipSync(await save())).toEqual(p.parts);d.select(0);d.replace('Edited ');
 const edited=await save();expect(scenes(await DocxPackage.open(edited))).toEqual(before);
 for(const [name,data] of Object.entries(unzipSync(edited)))if(name!=='word/document.xml')expect(data).toEqual(p.parts[name]);
 d.undo();expect(unzipSync(await save())).toEqual(p.parts);
});
it.each([
 ['rot="1800000"','rot="2147483648"'],
 ['rot="1800000"','rot="1.5"'],

])('continues to reject malformed shape rotations %s',async(before,after)=>{
 const p=unzipSync(source);p['word/document.xml']=strToU8(strFromU8(p['word/document.xml']).replaceAll(before,after));
 await expect(DocxPackage.open(zipSync(p))).rejects.toThrow();
});

