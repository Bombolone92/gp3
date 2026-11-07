import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {pictureEffectPixels,luminancePixels} from '../src/engine/picture-luminance.js';
const source=readFileSync('tests/fixtures/picture-luminance/control.docx'),ref=JSON.parse(readFileSync('tests/fixtures/picture-luminance/reference.json'));
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const pictures=p=>p.paragraphs.flatMap(p=>p.runs.filter(r=>r.image).map(r=>r.image));
it('matches every native opaque color in 29 ordered luminance cases and preserves alpha',async()=>{
 const p=await DocxPackage.open(source),images=pictures(p);expect(images).toHaveLength(29);
 for(const[i,image]of images.entries()){
  const data=Uint8ClampedArray.from(ref.colors.flat()),asset=p.assets[image.assetId];
  if(asset.pictureEffects)pictureEffectPixels(data,asset.pictureEffects);
  for(let j=0;j<16;j++){
   expect(data[j*4+3]).toBe(ref.colors[j][3]);
   if(ref.colors[j][3]===255&&!image.opacity)expect([...data.slice(j*4,j*4+3)],ref.cases[i].id).toEqual(ref.cases[i].colors[j]);
  }
 }
 expect(p.assets[images[1].assetId].bytes).toBe(p.assets[images[0].assetId].bytes);
});
it('preserves effect chains and media through editing, reopening and exact undo',async()=>{
 const p=await DocxPackage.open(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 d.replace('Edited ');const edited=await save(),again=await DocxPackage.open(edited);
 expect(pictures(again).map(i=>again.assets[i.assetId].pictureEffects)).toEqual(pictures(p).map(i=>p.assets[i.assetId].pictureEffects));
 for(const[name,data]of Object.entries(p.parts))if(name!=='word/document.xml')expect(unzipSync(edited)[name]).toEqual(data);
 d.undo();expect(unzipSync(await save())).toEqual(p.parts);
});
it.each([[-1.01,0],[0,1.01],[NaN,0],[0,Infinity]])('rejects invalid transfer values %s %s',(b,c)=>expect(()=>luminancePixels(new Uint8ClampedArray(4),b,c)).toThrow());
it.each(['bright="100001"','contrast="NaN"','extra="1"','bright="-101%"'])('rejects invalid luminance markup %s',async attrs=>{
 const parts=unzipSync(source);parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace(/<a:lum[^>]*\/>/,`<a:lum ${attrs}/>`));
 await expect(DocxPackage.open(zipSync(parts))).rejects.toMatchObject({name:'UnsupportedDocumentError'});
});
it('writes fractional luminance and ordered effects on a newly inserted image',async()=>{
 const p=await DocxPackage.open(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const original=p.assets[pictures(p)[1].assetId],id='fractional-luminance';
 d.assets[id]={...original,pictureEffects:[{type:'luminance',brightness:.123456,contrast:-.234567},['000000','FFFFFF']]};
 d.select(0);d.insertImage(id,{width:914400,height:114300});
 const bytes=new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 const again=await DocxPackage.open(bytes);
 const effects=again.assets[pictures(again)[0].assetId].pictureEffects;
 expect(effects[0].brightness).toBeCloseTo(.123456,12);expect(effects[0].contrast).toBeCloseTo(-.234567,12);
 expect(effects[1]).toEqual(['000000','FFFFFF']);
});
