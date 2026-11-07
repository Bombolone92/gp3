import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
const source=readFileSync('public/fixtures/group-picture-flips.docx');
const images=p=>Object.values(p.assets).filter(a=>a.scene).map(a=>a.scene.children[0].children[0].image);
it('keeps both flip axes and crop inside immutable nested pictures across editing and exact undo',async()=>{
 const p=await DocxPackage.open(source), before=images(p);
 expect(before.map(i=>[i.flipH,i.flipV])).toEqual([[false,false],[true,false],[false,true],[true,true],[true,false],[true,true]]);
 expect(before[4].crop).toMatchObject({left:25000,top:12500});expect(before[5].crop).toMatchObject({left:-50000,top:-100000});
 const d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 expect(unzipSync(await save())).toEqual(p.parts);d.select(0);d.replace('Edited ');
 const saved=await save(), reopened=await DocxPackage.open(saved);
 expect(images(reopened)).toEqual(before);
 d.undo();expect(unzipSync(await save())).toEqual(p.parts);
});
it.each(['flipH="yes"','flipV="2"','rot="2147483648"'])('keeps unsupported or malformed picture transforms guarded: %s',async attr=>{
 const parts=unzipSync(source);parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace('flipH="true"',attr));
 await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
});
