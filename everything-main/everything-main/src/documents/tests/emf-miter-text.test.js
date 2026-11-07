import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {emfInfo} from '../src/engine/emf-images.js';
import {DocxPackage} from '../src/engine/docx.js';
import {JSDOM} from 'jsdom';
for(const [name,limits] of [['emf-miter-text',[1,8,1,8]],['emf-miter-text-integers',[1,2,8,10]],['emf-miter-text-empty-buffers',[1,8,8,8]],['emf-miter-text-effects',[8,8,8,8]]]){
 const parts=unzipSync(readFileSync(`tests/fixtures/${name}/control.docx`));
 it.each(limits.map((limit,row)=>({limit,row})))(`${name} row $row applies native text-record miter values only for pixel effects`,({limit,row})=>{
  for(const index of [row*2,row*2+1]){
   const bytes=parts[`word/media/edge${index}.emf`];
   expect(emfInfo(bytes,{pixelEffects:true}).svg).toContain(`stroke-miterlimit="${limit}"`);
   expect(emfInfo(bytes).svg).toContain(`stroke-miterlimit="${name==='emf-miter-text'&&row===3?8:1}"`);
   const stripMiter=svg=>svg.replace(/stroke-miterlimit="[^"]*"/g,'stroke-miterlimit=""');
   expect(stripMiter(emfInfo(bytes,{pixelEffects:true}).svg)).toBe(stripMiter(emfInfo(bytes).svg));
  }
 });
}
it('retains each saved miter state when text appears after all the affected paths',()=>{
 const original=unzipSync(readFileSync('tests/fixtures/emf-miter-text-integers/control.docx'))['word/media/edge2.emf'];
 const view=new DataView(original.buffer,original.byteOffset,original.byteLength),records=[];let firstPath=[],collect=false,strokes=0;
 const record=(type,value)=>{const b=new Uint8Array(value===undefined?8:12),v=new DataView(b.buffer);v.setUint32(0,type,true);v.setUint32(4,b.length,true);if(value!==undefined)v.setInt32(8,value,true);return b;};
 for(let at=0;at<original.length;){
  const type=view.getUint32(at,true),size=view.getUint32(at+4,true),bytes=original.slice(at,at+size);records.push(bytes);
  if(type===59&&!strokes)collect=true;if(collect)firstPath.push(bytes);
  if(type===64){strokes++;collect=false;if(strokes===1)records.push(record(33),record(58,8));else records.push(record(34,-1));}
  if(type===84)records.push(...firstPath);at+=size;
 }
 const changed=new Uint8Array(records.reduce((n,r)=>n+r.length,0));let at=0;for(const r of records){changed.set(r,at);at+=r.length;}
 const header=new DataView(changed.buffer);header.setUint32(48,changed.length,true);header.setUint32(52,records.length,true);
 expect([...emfInfo(changed,{pixelEffects:true}).svg.matchAll(/stroke-miterlimit="([^"]+)"/g)].map(m=>+m[1])).toEqual([2,8,2]);
});
it('inspects text records independently of emitted glyphs without changing default info',()=>{
 const parts=unzipSync(readFileSync('tests/fixtures/emf-miter-text-empty-buffers/control.docx'));
 const empty=parts['word/media/edge3.emf'],plain=parts['word/media/edge1.emf'];
 expect(emfInfo(empty)).not.toHaveProperty('hasTextRecord');
 expect(emfInfo(empty,{inspectText:true})).toMatchObject({hasTextRecord:true,textFonts:[]});
 expect(emfInfo(plain,{inspectText:true}).hasTextRecord).toBe(false);
});
it('keeps opacity playback separate from opaque reused media and does not serialize the session variant',async()=>{
 const dom=new JSDOM();const priorParser=globalThis.DOMParser,priorSerializer=globalThis.XMLSerializer;
 globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;
 try{
  const bytes=readFileSync('tests/fixtures/emf-miter-text-effects/control.docx'),parts=unzipSync(bytes),pkg=await DocxPackage.open(bytes);
  const opacity=pkg.paragraphs.flatMap(p=>p.runs.filter(r=>r.image).map(r=>r.image)).find(i=>i.opacity===.5);
  const variant=pkg.assets[opacity.assetId],source=pkg.assets['word/media/edge7.emf'];
  expect(variant.metafileOpacity).toBe(true);expect(source).not.toHaveProperty('metafileOpacity');expect(variant.bytes).toBe(source.bytes);
  const exported=pkg.export(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
  expect(unzipSync(new Uint8Array(await exported.arrayBuffer()))).toEqual(parts);
 }finally{globalThis.DOMParser=priorParser;globalThis.XMLSerializer=priorSerializer;dom.window.close();}
});
