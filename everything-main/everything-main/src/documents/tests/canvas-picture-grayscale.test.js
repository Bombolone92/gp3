import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument,paragraph} from '../src/engine/model.js';
import {duotonePixels} from '../src/engine/picture-duotone.js';
import {imageReader,A} from '../src/engine/docx-images.js';
const source=readFileSync('public/fixtures/picture-grayscale.docx'),ref=JSON.parse(readFileSync('tests/fixtures/picture-grayscale/reference.json'));
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const pictures=p=>p.paragraphs.flatMap(p=>p.runs.filter(r=>r.image).map(r=>r.image));
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const change=(bytes,fn)=>{const parts=unzipSync(bytes),xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');fn(xml);parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));return zipSync(parts);};
it('matches the native reference grayscale and ordered duotone combinations without changing source alpha',async()=>{
 const p=await DocxPackage.open(source),images=pictures(p);expect(images).toHaveLength(8);
 for(const[i,image]of images.entries()){
  const data=Uint8ClampedArray.from(ref.colors.flat()),effects=p.assets[image.assetId].duotone;if(effects)duotonePixels(data,effects);
  for(let j=0;j<16;j++){
   expect(data[j*4+3]).toBe(ref.colors[j][3]);
   if(ref.colors[j][3]===255&&!image.opacity)expect([...data.slice(j*4,j*4+3)],ref.cases[i].id).toEqual(ref.cases[i].colors[j]);
  }
 }
 expect(ref.cases[1].colors).toEqual(ref.cases[7].colors);
 expect(images[1].assetId).toBe(images[7].assetId);expect(images[4].opacity).toBe(.5);expect(images[5].opacity).toBe(.5);
 expect(p.assets[images[1].assetId].bytes).toBe(p.assets[images[0].assetId].bytes);
});
it('retains original grayscale markup and media through picture edits, reopening and exact undo',async()=>{
 const p=await DocxPackage.open(source),d=model(p),before=d.snapshot();d.replace('Edited ');
 const at=d.text.indexOf('\ufffc');d.select(at,at+1);d.setImageProperties({alt:'Updated grayscale description',width:2743200,height:342900});
 const bytes=await save(p,d),out=unzipSync(bytes),again=await DocxPackage.open(bytes);
 expect(pictures(again).map(i=>again.assets[i.assetId].duotone)).toEqual(pictures(p).map(i=>p.assets[i.assetId].duotone));
 expect(strFromU8(out['word/document.xml']).match(/<a:grayscl\b/g)).toHaveLength(7);
 for(const[name,data]of Object.entries(p.parts))if(name!=='word/document.xml')expect(out[name]).toEqual(data);
 d.undo();d.undo();expect(d.snapshot()).toEqual(before);expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
it.each(['group-picture-flips','shape-picture-fills'])('reads nested grayscale effects: %s',name=>{
 const bytes=change(readFileSync(`public/fixtures/${name}.docx`),xml=>xml.getElementsByTagNameNS(A,'blip')[0].append(xml.createElementNS(A,'a:grayscl')));
 const parts=unzipSync(bytes),assets={},xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');
 const read=imageReader(parts,assets,()=>paragraph(''));
 for(const drawing of xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','drawing'))read(drawing);
 expect(Object.values(assets).filter(a=>a.duotone).map(a=>a.duotone)).toEqual([[['000000','FFFFFF']]]);
});
it('rejects attributes, nested effects, text and effects after extLst on grayscale declarations',async()=>{
 for(const mutate of [e=>e.setAttribute('extra','1'),e=>e.append(e.ownerDocument.createElementNS(A,'a:grayscl')),e=>e.append(e.ownerDocument.createTextNode('invalid')),e=>e.parentElement.insertBefore(e.ownerDocument.createElementNS(A,'a:extLst'),e)])
  await expect(DocxPackage.open(change(source,xml=>mutate(xml.getElementsByTagNameNS(A,'grayscl')[0])))).rejects.toMatchObject({name:'UnsupportedDocumentError'});
});
