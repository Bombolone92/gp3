import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
const source=readFileSync('public/fixtures/shape-theme.docx');
const nativeSamples=JSON.parse(readFileSync('tests/fixtures/shape-theme/samples.json','utf8'));
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
const scenes=p=>Object.values(p.assets).filter(a=>a.scene).map(a=>a.scene);
it('resolves theme fills, placeholder colors, partial line overrides and ordered color transforms without rewriting source',async()=>{
 for(const [path,hash] of Object.entries(JSON.parse(readFileSync('tests/fixtures/shape-theme/manifest.json','utf8'))))expect(createHash('sha256').update(readFileSync(path)).digest('hex'),path).toBe(hash);
 const p=await DocxPackage.open(source),shapes=scenes(p);
 // Interior colors come from the retained native reference PDF, including the reversed
 // luminance sequence's #194D7F after native linear-RGB quantization.
 expect(shapes.map(s=>s.fill)).toEqual(nativeSamples.map(samples=>'#'+samples[0].rgb.map(c=>c.toString(16).padStart(2,'0')).join('').toUpperCase()));
 expect(shapes[0].outline).toMatchObject({color:'#442F23',width:50800,join:'miter',miterLimit:8});
 expect(shapes[1].outline).toMatchObject({color:'#604333',width:76200});
 expect(shapes.slice(2).map(s=>s.outline)).toEqual([null,null,null,null]);
 const d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 expect(unzipSync(await save())).toEqual(p.parts);d.select(0);d.replace('Edited ');
 const saved=await save();expect(scenes(await DocxPackage.open(saved))).toEqual(shapes);
 const parts=unzipSync(saved);for(const key of Object.keys(p.parts))if(key!=='word/document.xml')expect(parts[key]).toEqual(p.parts[key]);
 d.undo();expect(unzipSync(await save())).toEqual(p.parts);
});
it.each([
 ['<a:lumMod val="20000"/>','<a:lumMod val="bad"/>'],
 ['<a:lumOff val="80000"/>','<a:alpha val="100001"/>'],
 ['<a:shade val="50000"/>','<a:shade val="100001"/>'],
 ['<a:lnRef idx="2">','<a:lnRef idx="99">'],
 ['<a:fillRef idx="1">','<a:fillRef idx="99">'],
 ['<a:effectRef idx="0">','<a:effectRef idx="99">'],
])('keeps invalid or unsupported styles guarded: %s',async(before,after)=>{
 const parts=unzipSync(source);parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replaceAll(before,after));
 await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
});
