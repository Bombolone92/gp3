import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { layoutDocument, imageAtPoint, selectionRects } from '../src/engine/layout.js';
let dom;
beforeAll(() => { dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const measure=(text,style)=>({width:text.length*style.fontSize*.45,ascent:style.fontSize,descent:style.fontSize/3});
const layout=d=>layoutDocument(d.paragraphs,measure,pageGeometry(d.pageSettings),d.numbering,d.tables);
const save=async(p,d)=>unzipSync(new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer()));
it('keeps table layout in a read-only preview when one drawing has unsupported mixed cell coordinates', async () => {
 const parts=unzipSync(readFileSync('public/fixtures/table-global-anchors.docx'));
 const xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');
 const WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
 xml.getElementsByTagNameNS(WP,'positionV')[0].setAttribute('relativeFrom','paragraph');
 const horizontal=xml.getElementsByTagNameNS(WP,'positionH')[0],align=xml.createElementNS(WP,'wp:align');
 align.textContent='center';horizontal.replaceChildren(align);
 parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));
 const bytes=zipSync(parts);
 await expect(DocxPackage.open(bytes)).rejects.toThrow(/drawing coordinate combinations inside table cells/);
 const pkg=await DocxPackage.open(bytes,{bestEffort:true});
 expect(pkg.readOnly).toBe(true);expect(pkg.tables).toHaveLength(22);
 const result=layout(model(pkg));expect(result.pageCount).toBe(22);expect(result.floatingObjects).toHaveLength(21);
 for(const name of Object.keys(parts))expect(Buffer.from(pkg.parts[name]).equals(Buffer.from(parts[name])),name).toBe(true);
 expect(()=>pkg.export()).toThrow(/read-only/);
});
for(const family of ['table-global-anchors','table-relative-anchors','relative-group-anchors','relative-body-anchors']) for(const suffix of (family.startsWith('table-') ? ['', '-legacy'] : [''])) {
 const source=()=>readFileSync(`public/fixtures/${family}${suffix}.docx`);
 const reference=JSON.parse(readFileSync(`tests/fixtures/${family}/reference${suffix}.json`));
 it(`matches the native reference cell-relative page/margin anchors, overflow and compatibility flags ${family}${suffix}`,async()=>{
  const pkg=await DocxPackage.open(source()),doc=model(pkg),placed=layout(doc);
  expect(placed.pageCount).toBe(reference.cases.length);expect(placed.floatingObjects).toHaveLength(reference.cases.length);
  placed.floatingObjects.forEach((f,i)=>{
   expect(f.page).toBe(i);
   const first=placed.lines.find(l=>l.fragments.some(r=>r.image?.id===f.image.id));
   const cell=placed.cells.find(c=>c.id===first.cellId&&c.page===f.page),ref=reference.cases[i];
   const outside=!ref.cell || f.image.anchor.layoutInCell===false&&suffix;
   // Font metrics do not participate: compare the native reference offset from its own
   // physical cell to the canvas offset from its physical cell.
   expect(f.x*3/4).toBeCloseTo(ref.frame[0],0);
   expect((outside?f.y:f.y-cell.y)*3/4).toBeCloseTo(ref.frame[1]-(outside?0:ref.cell[1]),0);
   expect(f.width*3/4).toBeCloseTo(ref.frame[2],0);expect(f.height*3/4).toBeCloseTo(ref.frame[3],0);expect(f.cellClip).toBeUndefined();
   if(ref.cell){expect(cell.width).toBeCloseTo(192);expect(cell.height*3/4).toBeCloseTo(ref.cell[3],0);}
   expect(first.fragments.find(r=>r.image).width).toBe(0);
   // Check the explicit picture-selection path; ordinary overlapping text
   // hits are covered separately by image-interaction.test.js.
   expect(imageAtPoint(placed,f.page,f.x+2,f.y+2,{includeBehindText:true})?.image.id).toBe(f.image.id);
   expect(selectionRects(placed,f.start,f.end)).toContainEqual({page:f.page,x:f.x,y:f.y,width:f.width,height:f.height});
  });
  expect(await save(pkg,doc)).toEqual(unzipSync(source()));
 });
 it(`preserves anchor flags and coordinates through body/cell edits, export and undo ${family}${suffix}`,async()=>{
  const pkg=await DocxPackage.open(source()),doc=model(pkg),before=layout(doc);
  doc.select(0);doc.replace('Edited ');doc.select(doc.text.indexOf('Anchor cell'));doc.replace('Cell ');
  const out=await save(pkg,doc),again=model(await DocxPackage.open(zipSync(out)));
  expect(layout(again).floatingObjects.map(f=>f.image.anchor)).toEqual(before.floatingObjects.map(f=>f.image.anchor));
  for(const name of Object.keys(pkg.parts))if(name!=='word/document.xml')expect(out[name]).toEqual(pkg.parts[name]);
  doc.undo();doc.undo();expect(await save(pkg,doc)).toEqual(pkg.parts);
 });
}
