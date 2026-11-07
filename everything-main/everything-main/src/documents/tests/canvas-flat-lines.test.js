import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { validateImage } from '../src/engine/images.js';
import { flatLineContains } from '../src/engine/flat-drawing-lines.js';
import { imageAtPoint, selectionRects } from '../src/engine/layout.js';
const source=readFileSync('tests/fixtures/flat-lines/flat-lines.docx');
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
const changed = change => { const parts=unzipSync(source); const xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml'); change(xml); parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml)); return zipSync(parts); };
const A='http://schemas.openxmlformats.org/drawingml/2006/main';
it('retains zero frames and immutable drawing XML through surrounding edits, reopen and undo',async()=>{
  const pkg=await DocxPackage.open(source), drawings=pkg.paragraphs.flatMap(p=>p.runs.filter(r=>r.image).map(r=>r.image));
  expect(drawings).toHaveLength(8);
  expect(drawings.every(i=>!!i.width!==!!i.height)).toBe(true);
  const doc=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
  doc.select(0);doc.replace('Edited ');
  const save=async()=>new Uint8Array(await pkg.export(doc.paragraphs,doc.pageSettings,doc.numbering,doc.styles,doc.tables,doc.assets).arrayBuffer());
  const reopened=await DocxPackage.open(await save());
  expect(reopened.paragraphs.flatMap(p=>p.runs.filter(r=>r.image).map(r=>r.image.shell))).toEqual(drawings.map(i=>i.shell));
  expect(Object.values(reopened.assets).map(a=>a.scene)).toEqual(Object.values(pkg.assets).map(a=>a.scene));
  doc.undo();expect(unzipSync(await save())).toEqual(unzipSync(source));
});
it.each(['both zero','negative','rectangle','frame mismatch'])('rejects unsupported or malformed %s geometry',async kind=>{
  const bytes=changed(xml=>{
    const ext=xml.getElementsByTagNameNS(A,'ext')[0];
    if(kind==='both zero') ext.setAttribute('cx','0');
    if(kind==='negative') ext.setAttribute('cy','-1');
    if(kind==='rectangle') xml.getElementsByTagNameNS(A,'prstGeom')[0].setAttribute('prst','rect');
    if(kind==='frame mismatch') xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing','extent')[0].setAttribute('cy','1');
  });
  await expect(DocxPackage.open(bytes)).rejects.toThrow(/extents|flat line/);
});
it('does not permit ordinary zero-sized pictures or malformed retained-line metadata',()=>{
  const ordinary={width:9525,height:0,alt:''};
  expect(()=>validateImage(ordinary)).toThrow(/dimensions/);
  for(const change of [{rotation:NaN},{strokeWidth:-1},{flipH:1}]) expect(()=>validateImage({...ordinary,kind:'drawing',retainedDrawing:true,flatLine:{rotation:0,strokeWidth:25400,flipH:false,flipV:false,...change}})).toThrow(/flat/);
});
it('retains percentage sizing on a flat frame without rewriting its saved dimensions',async()=>{
  const bytes=changed(xml=>{
    const ns='http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing';
    xml.documentElement.setAttributeNS('http://www.w3.org/2000/xmlns/','xmlns:wp14',ns);
    xml.documentElement.setAttributeNS('http://schemas.openxmlformats.org/markup-compatibility/2006','mc:Ignorable','wp14');
    const size=xml.createElementNS(ns,'wp14:sizeRelH');size.setAttribute('relativeFrom','page');
    const pct=xml.createElementNS(ns,'wp14:pctWidth');pct.textContent='50000';size.append(pct);
    xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing','anchor')[0].append(size);
  });
  const p=await DocxPackage.open(bytes);
  const image=p.paragraphs.flatMap(p=>p.runs).find(r=>r.image).image;
  expect(image.height).toBe(0);
  expect(image.anchor.relativeSize.width).toEqual({base:'page',percentage:50000});
  expect(p.assets[image.assetId].relativeFrame).toBe(true);
});
it('targets the rotated stroke rather than its diagonal bounding rectangle and respects cell clipping',()=>{
  const image={flatLine:{rotation:2700000,strokeWidth:25400,flipH:false,flipV:false}};
  expect(flatLineContains(image,0,0,100,0,50,0)).toBe(true);
  expect(flatLineContains(image,0,0,100,0,15,35)).toBe(false);
  const f={image,page:0,x:0,y:0,width:100,height:0,start:0,end:1,cellClip:{left:0,right:100,top:0,bottom:40}};
  const layout={page:{width:816},lines:[],floatingObjects:[f]};
  expect(imageAtPoint(layout,0,40,-10)).toBe(null);
  expect(imageAtPoint(layout,0,60,10)).toBe(f);
  expect(selectionRects(layout,0,1).every(r=>r.y>=0)).toBe(true);
});
it('retains physical baselines when selecting a flat inline line in a wrapped text segment',()=>{
  const image={width:952500,height:0,flatLine:{rotation:0,strokeWidth:25400,flipH:false,flipV:false}};
  const fragment={image,start:0,end:1,x:20,width:100,ascent:0,descent:0};
  const segment={start:0,end:1,stops:[{offset:0,x:20},{offset:1,x:120}],fragments:[fragment]};
  const line={...segment,page:0,y:10,height:14,baseline:20,wrapSegments:[segment]};
  const rects=selectionRects({page:{width:816},lines:[line]},0,1);
  expect(rects.every(r=>[r.x,r.y,r.width,r.height].every(Number.isFinite))).toBe(true);
  expect(rects.some(r=>r.y<20&&r.y+r.height>20)).toBe(true);
});
