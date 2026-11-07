import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument,paragraph} from '../src/engine/model.js';
import {pictureEffectPixels} from '../src/engine/picture-luminance.js';
import {colorChangePixels} from '../src/engine/picture-color-change.js';
import {imageReader,A} from '../src/engine/docx-images.js';
const root='tests/fixtures/picture-color-change/';
const source=readFileSync(root+'control.docx'),ref=JSON.parse(readFileSync(root+'reference.json'));
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const pictures=p=>p.paragraphs.flatMap(p=>p.runs.filter(r=>r.image).map(r=>r.image));
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const change=(bytes,fn)=>{const parts=unzipSync(bytes),xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');fn(xml);parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));return zipSync(parts);};
it('matches the native reference replacement, RGBA tolerance, useA and effect-order controls',async()=>{
 const p=await DocxPackage.open(source),images=pictures(p);expect(images).toHaveLength(ref.cases.length);
 for(const[i,image]of images.entries()){
  const data=Uint8ClampedArray.from(ref.colors.flat()),asset=p.assets[image.assetId];
  if(asset.pictureEffects)pictureEffectPixels(data,asset.pictureEffects);
  for(let j=0;j<ref.colors.length;j++){
   const a=data[j*4+3]/255*(image.opacity??1),color=[0,1,2].map(k=>Math.round(data[j*4+k]*a+[102,153,170][k]*(1-a)));
   // The reference PDF's partial-alpha premultiplication differs by up to four bytes.
   // Replacement-only opaque output is exact; grayscale combinations also
   // expose a one-byte luma rounding difference on near-red inputs.
   const combined=asset.pictureEffects?.some(e=>e.type!=='colorChange');
   for(let k=0;k<3;k++)expect(Math.abs(color[k]-ref.cases[i].colors[j][k]),`${i}/${j}/${k}`).toBeLessThanOrEqual(a===1&&ref.colors[j][3]===255?(combined?1:0):5);
  }
 }
 expect(ref.cases[11].colors).toEqual(ref.cases[12].colors);
 expect(ref.cases[15].colors).not.toEqual(ref.cases[16].colors);
 expect(p.assets[images[1].assetId].bytes).toBe(p.assets[images[0].assetId].bytes);
});
it('preserves source effects and media through picture edits, reopening and exact undo',async()=>{
 const p=await DocxPackage.open(source),d=model(p);
 const exact=bytes=>{const out=unzipSync(bytes);expect(Object.keys(out).sort()).toEqual(Object.keys(p.parts).sort());for(const[n,b]of Object.entries(p.parts))expect(Buffer.from(out[n]).equals(Buffer.from(b)),n).toBe(true);};
 exact(await save(p,d));d.replace('Edited ');const at=d.text.indexOf('\ufffc');d.select(at,at+1);d.setImageProperties({alt:'Updated picture',width:2743200,height:342900});
 const bytes=await save(p,d),out=unzipSync(bytes),again=await DocxPackage.open(bytes);
 expect(pictures(again).map(i=>again.assets[i.assetId].pictureEffects)).toEqual(pictures(p).map(i=>p.assets[i.assetId].pictureEffects));
 for(const[n,b]of Object.entries(p.parts))if(n!=='word/document.xml')expect(Buffer.from(out[n]).equals(Buffer.from(b)),n).toBe(true);
 d.undo();d.undo();exact(await save(p,d));
});
it('serializes color-change colors, alpha and useA for a newly inserted asset',async()=>{
 const p=await DocxPackage.open(source),d=model(p),id=pictures(p)[13].assetId;
 d.select(0);d.insertImage(id,{width:914400,height:114300});
 const again=await DocxPackage.open(await save(p,d));
 expect(again.assets[pictures(again)[0].assetId].pictureEffects).toEqual(p.assets[id].pictureEffects);
});
it.each(['group-picture-flips','shape-picture-fills'])('shares color-change decoding with nested pictures: %s',name=>{
 const bytes=change(readFileSync(`public/fixtures/${name}.docx`),xml=>{
  const reference=new DOMParser().parseFromString(strFromU8(unzipSync(source)['word/document.xml']),'application/xml');
  xml.getElementsByTagNameNS(A,'blip')[0].append(xml.importNode(reference.getElementsByTagNameNS(A,'clrChange')[0],true));
 });
 const parts=unzipSync(bytes),assets={},xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml'),read=imageReader(parts,assets,()=>paragraph(''));
 for(const drawing of xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','drawing'))read(drawing);
 expect(Object.values(assets).filter(a=>a.pictureEffects?.some(e=>e.type==='colorChange'))).toHaveLength(1);
});
it.each(['flag','attribute','missing','duplicate','order','text','color-text','extension'])('rejects malformed color changes: %s',async kind=>{
 const bytes=change(source,xml=>{
  const e=xml.getElementsByTagNameNS(A,'clrChange')[0];
  if(kind==='flag')e.setAttribute('useA','yes');
  if(kind==='attribute')e.setAttribute('unknown','1');
  if(kind==='missing')e.firstElementChild.remove();
  if(kind==='duplicate')e.append(e.firstElementChild.cloneNode(true));
  if(kind==='order')e.prepend(e.lastElementChild);
  if(kind==='text')e.append(xml.createTextNode('bad'));
  if(kind==='color-text')e.firstElementChild.firstElementChild.append(xml.createTextNode('bad'));
  if(kind==='extension')e.parentElement.insertBefore(xml.createElementNS(A,'a:extLst'),e);
 });
 await expect(DocxPackage.open(bytes)).rejects.toMatchObject({name:'UnsupportedDocumentError'});
});
it('validates color effects before processing pixels',()=>{
 expect(()=>colorChangePixels(new Uint8ClampedArray(4),{from:{rgb:'FFFFFF',alpha:2},to:{rgb:'000000',alpha:1},useAlpha:true})).toThrow();
});
