import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument,paragraph} from '../src/engine/model.js';
import {duotonePixels} from '../src/engine/picture-duotone.js';
import {imageReader,A} from '../src/engine/docx-images.js';
import {drawingEffectColor} from '../src/engine/docx-drawing-style.js';
import {drawingPresetColors} from '../src/engine/drawing-preset-colors.js';
const source=readFileSync('public/fixtures/picture-duotone.docx'),ref=JSON.parse(readFileSync('tests/fixtures/picture-duotone/reference.json'));
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const pictures=p=>p.paragraphs.flatMap(p=>p.runs.filter(r=>r.image).map(r=>r.image));
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const change=(bytes,fn)=>{const parts=unzipSync(bytes),xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');fn(xml);parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));return zipSync(parts);};
it('matches independent native reference opaque colors, ordered effects and signed saturation while retaining source alpha',async()=>{
 const p=await DocxPackage.open(source),images=pictures(p);expect(images).toHaveLength(17);
 for(const[i,image]of images.entries()){
  const data=Uint8ClampedArray.from(ref.colors.flat()),effects=p.assets[image.assetId].duotone;if(effects)duotonePixels(data,effects);
  for(let j=0;j<16;j++){
   expect(data[j*4+3]).toBe(ref.colors[j][3]);
   if(ref.colors[j][3]===255 && !image.opacity)expect([...data.slice(j*4,j*4+3)],ref.cases[i].id).toEqual(ref.cases[i].colors[j]);
  }
 }
 expect(images[1].assetId).toBe(images[5].assetId);expect(images[1].assetId).toBe(images[6].assetId);
 expect(p.assets[images[0].assetId].duotone).toBeUndefined();expect(p.assets[images[13].assetId].duotone).toEqual([['BB0609','FFFFFF']]);
 expect(p.assets[images[13].assetId].bytes).toBe(p.assets[images[0].assetId].bytes);
});
it('preserves effect markup, source images and theme through image edits, reopen and exact undo',async()=>{
 const p=await DocxPackage.open(source),d=model(p),before=d.snapshot();d.replace('Edited ');
 const at=d.text.indexOf('\ufffc');d.select(at,at+1);d.setImageProperties({alt:'Updated description',width:2743200,height:342900});
 const bytes=await save(p,d),out=unzipSync(bytes),again=await DocxPackage.open(bytes);
 expect(pictures(again).map(i=>again.assets[i.assetId].duotone)).toEqual(pictures(p).map(i=>p.assets[i.assetId].duotone));
 for(const[name,data]of Object.entries(p.parts))if(name!=='word/document.xml')expect(Buffer.from(out[name]).equals(Buffer.from(data)),name).toBe(true);
 d.undo();d.undo();expect(d.snapshot()).toEqual(before);const restored=unzipSync(await save(p,d));for(const[name,data]of Object.entries(p.parts))expect(Buffer.from(restored[name]).equals(Buffer.from(data)),name).toBe(true);
});
it('serializes effect colors for newly materialized pictures without modifying the source media',async()=>{
 const p=await DocxPackage.open(source),d=model(p),image=pictures(d)[3];delete image.shell;
 const again=await DocxPackage.open(await save(p,d)),copied=pictures(again)[3];
 expect(again.assets[copied.assetId].duotone).toEqual([['CC2244','FFFFFF']]);expect(again.assets[copied.assetId].bytes).toEqual(p.assets[image.assetId].bytes);
});
it.each(['group-picture-flips','shape-picture-fills'])('passes theme colors into nested picture readers: %s',name=>{
 const bytes=change(readFileSync(`public/fixtures/${name}.docx`),xml=>{
  const effect=xml.createElementNS(A,'a:duotone');for(const[k,v]of[['schemeClr','accent3'],['prstClr','white']]){const c=xml.createElementNS(A,'a:'+k);c.setAttribute('val',v);effect.append(c);}xml.getElementsByTagNameNS(A,'blip')[0].append(effect);
 });
 const parts=unzipSync(bytes),assets={},xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');
 const read=imageReader(parts,assets,()=>paragraph(''),name=>name==='accent3'?'EA2F32':undefined);
 for(const drawing of xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','drawing'))read(drawing);
 expect(Object.values(assets).filter(a=>a.duotone).map(a=>a.duotone)).toEqual([[['EA2F32','FFFFFF']]]);
});
it('recognizes preset aliases and rejects unknown colors and malformed duotone declarations',async()=>{
 expect(Object.keys(drawingPresetColors)).toHaveLength(190);
 for(const[name,rgb]of[['white','FFFFFF'],['red','FF0000'],['darkSlateGrey','2F4F4F'],['dkSlateGray','2F4F4F'],['mediumAquamarine','66CDAA'],['medAquamarine','66CDAA']])expect(drawingEffectColor(new DOMParser().parseFromString(`<a:prstClr xmlns:a="${A}" val="${name}"/>`,'application/xml').documentElement).rgb).toBe(rgb);
 for(const mutate of [e=>e.firstElementChild.remove(),e=>e.append(e.firstElementChild.cloneNode(true)),e=>e.setAttribute('extra','1'),e=>e.firstElementChild.setAttribute('val','bad'),e=>e.append(e.ownerDocument.createTextNode('invalid'))]){
  await expect(DocxPackage.open(change(source,xml=>mutate(xml.getElementsByTagNameNS(A,'duotone')[0])))).rejects.toMatchObject({name:'UnsupportedDocumentError'});
 }
 for(const effect of [null,[],[['000000']],[['bad','FFFFFF']]])expect(()=>duotonePixels(new Uint8ClampedArray(4),effect)).toThrow(/duotone/);
});
