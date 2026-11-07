import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { drawingGroupScale } from '../src/engine/drawing-group-scale.js';
import { imageAtPoint, selectionRects } from '../src/engine/layout.js';
import { positionedImageFrame } from '../src/engine/positioned-images.js';
import { pageGeometry } from '../src/engine/page-settings.js';

const source=readFileSync('public/fixtures/zero-axis-groups.docx');
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());

it.each([[0,0,1],[0,72,0],[36,0,1],[144,72,2],[72,144,.5]])('maps group extent %s and child extent %s to native scale %s',(extent,child,expected)=>{
  expect(drawingGroupScale(extent,child)).toBe(expected);
});

it('retains all twelve native control scenes and untouched package parts through editing and exact undo',async()=>{
  const pkg=await DocxPackage.open(source);
  const drawings=pkg.paragraphs.flatMap(p=>p.runs).filter(r=>r.image).map(r=>r.image);
  expect(drawings).toHaveLength(12);
  expect(drawings.filter(i=>i.flatGroup)).toHaveLength(9);
  const doc=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
  const save=async()=>new Uint8Array(await pkg.export(doc.paragraphs,doc.pageSettings,doc.numbering,doc.styles,doc.tables,doc.assets).arrayBuffer());
  expect(unzipSync(await save())).toEqual(unzipSync(source));
  doc.select(0);doc.replace('Edited ');
  const edited=await save(), parts=unzipSync(edited), original=unzipSync(source);
  for(const name of Object.keys(original)) if(name!=='word/document.xml') expect(parts[name],name).toEqual(original[name]);
  const reopened=await DocxPackage.open(edited);
  expect(Object.values(reopened.assets).map(a=>a.scene)).toEqual(Object.values(pkg.assets).map(a=>a.scene));
  doc.undo();expect(unzipSync(await save())).toEqual(original);
});

it('selects a rotated collapsed group using its thin physical frame without adding layout width',()=>{
  const image={width:0,height:952500,flatGroup:{rotation:5400000,strokeWidth:25400,flipH:false,flipV:false}};
  const object={image,page:0,x:20,y:10,width:0,height:100,start:0,end:1};
  const layout={page:{width:816},lines:[],floatingObjects:[object]};
  expect(imageAtPoint(layout,0,20,60)).toBe(object);
  expect(imageAtPoint(layout,0,50,60)).toBe(object);
  expect(imageAtPoint(layout,0,20,20)).toBe(null);
  const rects=selectionRects(layout,0,1);
  expect(rects.length).toBeGreaterThan(0);
  expect(rects.every(r=>[r.x,r.y,r.width,r.height].every(Number.isFinite))).toBe(true);
  expect(object.width).toBe(0);
});

it('uses the expanded native reference outer frame for percentage-sized group selection',async()=>{
  const pkg=await DocxPackage.open(readFileSync('public/fixtures/zero-axis-group-relative.docx'));
  const frames=pkg.paragraphs.flatMap(p=>p.runs).filter(r=>r.image).map((r,i)=>positionedImageFrame({...r,start:i,end:i+1},{page:0,y:0},pageGeometry(pkg.pageSettings)));
  // Native reference Shape.Width/Height, points, from the same six control shapes.
  const native=[[0,198],[153,0],[153,72],[72,198],[153,198],[153,198]];
  frames.forEach((f,i)=>{
    expect(f.width*.75).toBeCloseTo(native[i][0]);expect(f.height*.75).toBeCloseTo(native[i][1]);
    const layout={page:{width:816},lines:[],floatingObjects:[f]};
    expect(imageAtPoint(layout,0,f.x+f.width*.2,f.y+f.height*.8)).toBe(f);
    if(f.width&&f.height) expect(selectionRects(layout,i,i+1)).toEqual([{page:0,x:f.x,y:f.y,width:f.width,height:f.height}]);
  });
});

it.each(['both zero','negative group','negative child','mismatched frame','collapsed text'])('rejects malformed or unsupported %s',async kind=>{
  const parts=unzipSync(source),xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');
  const a='http://schemas.openxmlformats.org/drawingml/2006/main';
  const ext=xml.getElementsByTagNameNS(a,'ext')[0];
  if(kind==='both zero') ext.setAttribute('cy','0');
  if(kind==='negative group') ext.setAttribute('cx','-1');
  if(kind==='negative child') xml.getElementsByTagNameNS(a,'chExt')[0].setAttribute('cx','-1');
  if(kind==='mismatched frame') xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing','extent')[0].setAttribute('cy','0');
  if(kind==='collapsed text') {
    const wps='http://schemas.microsoft.com/office/word/2010/wordprocessingShape',w='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const shape=xml.getElementsByTagNameNS(wps,'wsp')[0];
    const tx=xml.createElementNS(wps,'wps:txbx');let parent=tx;
    for(const name of ['txbxContent','p','r','t']) {const n=xml.createElementNS(w,'w:'+name);parent.append(n);parent=n;}
    parent.textContent='Collapsed text';shape.insertBefore(tx,shape.lastChild);
  }
  parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/extents|flat group|collapsed groups/);
});
