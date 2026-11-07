import {it,expect,beforeAll,afterAll} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {JSDOM} from 'jsdom';
import {DocxPackage} from '../src/engine/docx.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
for(const folder of ['picture-3d-circle-outlines','picture-3d-texture-markers']){
 const root=`tests/fixtures/${folder}/`,ref=JSON.parse(readFileSync(root+'reference.json'));
 it(`binds ${folder} measurements to the original controls and native PDF`,()=>{
  for(const [file,hash]of [['control.docx',ref.sourceSha256],['native.pdf',ref.pdfSha256]])expect(createHash('sha256').update(readFileSync(root+file)).digest('hex')).toBe(hash);
  expect(ref.cases.map(c=>c.outlinePt)).toEqual([0,.75,.75,3,8]);
  for(const c of ref.cases){expect(c.pdfImageFilters).toEqual(['/FlateDecode']);expect(c.boundaryPt.length).toBeGreaterThan(1000);if(folder.endsWith('markers'))for(const axis of ['x','y'])for(const band of ['dark','bright'])expect(c.bandsPt[axis][band]).toHaveLength(1);}
  const xml=new dom.window.DOMParser().parseFromString(new TextDecoder().decode(unzipSync(readFileSync(root+'control.docx'))['word/document.xml']),'application/xml');
  const shapes=[...xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/picture','spPr')];
  expect(shapes).toHaveLength(5);
  const lines=shapes.map(s=>s.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main','ln')[0]);
  expect(lines[0]).toBeUndefined();expect(lines[1].hasAttribute('w')).toBe(false);
  expect(lines.slice(2).map(l=>Number(l.getAttribute('w')))).toEqual([9525,38100,101600]);
 });
 it(`strictly imports and exactly round trips ${folder}`,async()=>{
  const bytes=readFileSync(root+'control.docx'),pkg=await DocxPackage.open(bytes);
  expect(pkg.readOnly).toBeFalsy();
  expect(Object.values(pkg.assets).filter(a=>a.scene?.type==='picture3d'||a.scene?.geometry&&a.scene?.lighting)).toHaveLength(5);
  const output=new Uint8Array(await pkg.export(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets).arrayBuffer());
  expect(unzipSync(output)).toEqual(unzipSync(bytes));
 },30000);
}
