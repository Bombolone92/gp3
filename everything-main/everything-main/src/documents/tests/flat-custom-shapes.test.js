import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { geometryGuides } from '../src/engine/geometry-guides.js';

let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());

for(const fixture of ['flat-custom-shapes','flat-custom-standalone']) {
const source=readFileSync(`public/fixtures/${fixture}.docx`);
it('preserves flat geometry and every untouched part across edit, reopen and exact undo',async()=>{
  const pkg=await DocxPackage.open(source);
  expect(Object.values(pkg.assets)).toHaveLength(12);
  const scenes=Object.values(pkg.assets).map(a=>a.scene);
  expect(scenes.slice(8).every(s=>(s.children?.[0] || s).paths.every(p=>p.points.length===0))).toBe(true);
  const doc=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
  const save=async()=>new Uint8Array(await pkg.export(doc.paragraphs,doc.pageSettings,doc.numbering,doc.styles,doc.tables,doc.assets).arrayBuffer());
  const original=unzipSync(source);
  expect(unzipSync(await save())).toEqual(original);
  doc.select(0);doc.replace('Edited ');
  const edited=await save(),parts=unzipSync(edited);
  for(const name of Object.keys(original))if(name!=='word/document.xml')expect(parts[name],name).toEqual(original[name]);
  expect(Object.values((await DocxPackage.open(edited)).assets).map(a=>a.scene)).toEqual(scenes);
  doc.undo();expect(unzipSync(await save())).toEqual(original);
});

it.each(['negative extent','explicit zero viewport','invalid guide'])('still rejects %s',async kind=>{
  const parts=unzipSync(source),xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');
  const a='http://schemas.openxmlformats.org/drawingml/2006/main';
  if(kind==='negative extent')xml.getElementsByTagNameNS(a,'ext')[1].setAttribute('cx','-1');
  if(kind==='explicit zero viewport')xml.getElementsByTagNameNS(a,'path')[0].setAttribute('h','0');
  if(kind==='invalid guide')xml.getElementsByTagNameNS(a,'pt')[0].setAttribute('x','missing');
  parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/extents|dimensions|guide/);
});

}

it('evaluates zero-axis guides without admitting nonfinite dimensions or division',()=>{
  expect(geometryGuides(72,0)('h')).toBe(0);
  expect(geometryGuides(0,0)('ss')).toBe(0);
  for(const width of [-1,NaN,Infinity])expect(()=>geometryGuides(width,0)).toThrow();
  expect(()=>geometryGuides(72,0,[],[{name:'bad',formula:'*/ w 1 h'}])).toThrow(/nonfinite/);
});
