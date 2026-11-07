import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {canResizeRetainedPicture} from '../src/engine/picture-resize.js';
import {A,WP} from '../src/engine/docx-images.js';
import {bindUsedNamespaces} from '../src/engine/docx-compatibility.js';
let dom;
beforeAll(()=>{dom=new JSDOM('');globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const open=()=>DocxPackage.open(readFileSync('tests/fixtures/retained-picture-resize/control.docx'));
const images=pkg=>pkg.paragraphs.flatMap(p=>p.runs.filter(r=>r.image).map(r=>r.image));
it('rebuilds standalone picture geometry, preserving physical pen, shadow and 3D parameters',async()=>{
  const pkg=await open();
  for(const image of images(pkg).filter(i=>!i.anchor?.relativeSize)){
    expect(canResizeRetainedPicture(image)).toBe(true);
    const width=image.width+228600,height=image.aspectLocked?Math.round(width*image.height/image.width):image.height+66675;
    const rebuilt=pkg.resizeDrawingPicture(image,width,height);
    expect([rebuilt.image.width,rebuilt.image.height]).toEqual([width,height]);expect(rebuilt.asset.scene).toBeTruthy();
    const xml=s=>new DOMParser().parseFromString(s,'application/xml');const old=xml(image.shell),next=xml(rebuilt.image.shell);
    expect(next.getElementsByTagNameNS(WP,'extent')[0].getAttribute('cx')).toBe(String(width));
    for(const name of ['ln','outerShdw','sp3d','scene3d','prstGeom','custGeom']){
      const node=d=>d.getElementsByTagNameNS(A,name)[0];
      expect(node(next)?.outerHTML).toBe(node(old)?.outerHTML);
    }
  }
});
it('preserves the inner-to-outer transform ratio and rejects locked/relative/invalid dimensions',async()=>{
  const pkg=await open(),all=images(pkg),image=all.find(i=>i.id===7),width=image.width*2,height=image.height*2;
  const next=pkg.resizeDrawingPicture(image,width,height),xml=new DOMParser().parseFromString(next.image.shell,'application/xml');
  const extent=xml.getElementsByTagNameNS(A,'ext')[0];expect(extent.getAttribute('cx')).toBe('1905000');expect(extent.getAttribute('cy')).toBe('1371600');
  expect(()=>pkg.resizeDrawingPicture(image,width,image.height)).toThrow(/aspect ratio/);
  expect(canResizeRetainedPicture(all.find(i=>i.id===8))).toBe(false);
  expect(()=>pkg.resizeDrawingPicture(all.find(i=>i.id===8),width,height)).toThrow(/fixed-size/);
  expect(()=>pkg.resizeDrawingPicture(all[0],0,height)).toThrow();
  expect(()=>pkg.resizeDrawingPicture(all[0],22*914400+1,height)).toThrow();
});
it('retains inherited MCE namespace scope across repeated edits without changing source parts',async()=>{
  const parts=unzipSync(readFileSync('tests/fixtures/retained-picture-resize/control.docx'));
  const source=new DOMParser().parseFromString(new TextDecoder().decode(parts['word/document.xml']),'application/xml');
  const MC='http://schemas.openxmlformats.org/markup-compatibility/2006';
  source.documentElement.removeAttributeNS(MC,'Ignorable');
  const body=source.documentElement.firstElementChild;
  body.setAttributeNS('http://www.w3.org/2000/xmlns/','xmlns:futureSize','http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing');
  body.setAttributeNS(MC,'mc:Ignorable','futureSize');
  bindUsedNamespaces(source.documentElement);
  parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(source));
  const pkg=await DocxPackage.open(zipSync(parts)),image=images(pkg).find(i=>i.id===1);
  const first=pkg.resizeDrawingPicture(image,image.width+95250,image.height+28575);
  const second=pkg.resizeDrawingPicture(first.image,image.width+190500,image.height+57150);
  expect(second.asset.scene).toBeTruthy();expect(second.image.width).toBe(image.width+190500);
  expect(pkg.parts).toEqual(parts);
  pkg.readOnly=true;
  expect(()=>pkg.resizeDrawingPicture(image,image.width+9525,image.height)).toThrow(/read-only/);
  body.removeAttributeNS(MC,'Ignorable');
  parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(source));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/sizeRelH/);
});
