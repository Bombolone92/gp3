import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {clippedRectangle} from '../src/engine/drawing-clipped-rectangle.js';
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>dom.window.close());
const source=readFileSync('tests/fixtures/picture-3d-joins/source.docx');
const scenes=p=>Object.values(p.assets).filter(a=>a.scene).map(a=>a.scene);
it('retains sharp/clipped joins and neutral metadata after editing and exact undo',async()=>{
 const p=await DocxPackage.open(source),before=scenes(p);expect(before).toHaveLength(14);
 expect(before[2].outline).toMatchObject({join:'miter',miterLimit:8});expect(before[3].outline.miterLimit).toBe(1);expect(before[4].outline.miterLimit).toBe(8);
 const d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 d.select(0);d.replace('Edited ');expect(scenes(await DocxPackage.open(await save()))).toEqual(before);
 d.undo();expect(unzipSync(await save())).toEqual(p.parts);
});
it.each([
 ['lim="800000"','lim="-1"'],['lim="800000"','lim="NaN"'],['lim="800000"','lim="1.5"'],
 ['<a:miter lim="800000"/>','<a:miter lim="800000"/><a:round/>'],
 ['<ask:type/>','<ask:type><ask:lineSketchScribble/></ask:type>'],
 ['<a:pathLst/>','<a:pathLst><a:path/></a:pathLst>'],
 ['sd="0"','sd="-1"'],
])('guards invalid joins and active/nonempty sketch metadata: %s',async(from,to)=>{
 const parts=unzipSync(source),xml=strFromU8(parts['word/document.xml']);expect(xml).toContain(from);parts['word/document.xml']=strToU8(xml.replace(from,to));await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
});
it('accepts the equivalent percentage spelling of a miter limit',async()=>{
 const parts=unzipSync(source);parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replaceAll('lim="800000"','lim="800%"'));
 expect(scenes(await DocxPackage.open(zipSync(parts)))[2].outline.miterLimit).toBe(8);
});
it('clips front corners and preserves the open diagonal side faces observed in the native reference',()=>{
 const shape=clippedRectangle(20,20,5,2);
 expect(shape.intersect({origin:[9.5,9.5,10],direction:[0,0,-1]})).toBeNull();
 expect(shape.intersect({origin:[8,9,10],direction:[0,0,-1]})).toMatchObject({surface:'front',point:[8,9,0]});
 expect(shape.intersect({origin:[20,0,-2],direction:[-1,0,0]})).toMatchObject({surface:'side',normal:[1,0,0],point:[10,0,-2]});
 expect(shape.intersect({origin:[20,9,-2],direction:[-1,0,0]})).toBeNull();
});
it('also preserves the neutral cache on ordinary two-dimensional pictures',async()=>{
 const parts=unzipSync(source),doc=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');
 const A='http://schemas.openxmlformats.org/drawingml/2006/main';
 for(const name of ['scene3d','sp3d'])for(const n of [...doc.getElementsByTagNameNS(A,name)])n.remove();
 parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(doc));
 const p=await DocxPackage.open(zipSync(parts));expect(p.paragraphs.flatMap(p=>p.runs).filter(r=>r.image)).toHaveLength(14);
 const d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);d.select(0);d.replace('Edited ');
 const out=new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 const again=await DocxPackage.open(out);expect(again.paragraphs.flatMap(p=>p.runs).filter(r=>r.image)).toHaveLength(14);
 expect(strFromU8(unzipSync(out)['word/document.xml']).match(/lineSketchStyleProps/g)).toHaveLength(4);
});
it('keeps unsupported picture formatting local to the structured read-only preview',async()=>{
 const parts=unzipSync(source),doc=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');
 const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',drawing=doc.getElementsByTagNameNS(W,'drawing')[0],run=drawing.parentNode;
 const properties=doc.createElementNS(W,'w:rPr'),script=doc.createElementNS(W,'w:w');script.setAttributeNS(W,'w:val','50');properties.append(script);run.insertBefore(properties,drawing);
 parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(doc));const bytes=zipSync(parts);
 await expect(DocxPackage.open(bytes)).rejects.toThrow('Text width scaling');
 const preview=await DocxPackage.open(bytes,{bestEffort:true});
 expect(preview.paragraphs.flatMap(p=>p.runs).filter(r=>r.image)).toHaveLength(13);
 expect(preview.paragraphs[0].runs.map(r=>r.text).join('')).toBe('flat-absent');
 expect(preview.parts).toEqual(parts);
});
