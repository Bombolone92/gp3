import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {transformedShapeBounds} from '../src/engine/transformed-shape-bounds.js';
const root='tests/fixtures/minimum-outline-width/';
const refs=JSON.parse(readFileSync(root+'reference.json','utf8'));
let dom;
beforeAll(()=>{dom=new JSDOM('');globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const walk=n=>[n,...(n.children||[]).flatMap(walk)];
const pens=pkg=>Object.values(pkg.assets).filter(a=>a.scene).flatMap(a=>walk(a.scene)).filter(n=>n.outline).map(n=>n.outline);
it.each(['shape','picture'])('matches native %s minimum pens and preserves source widths through edit/export/undo',async kind=>{
  const source=readFileSync(root+kind+'.docx'),ref=refs.controls[kind];
  expect(createHash('sha256').update(source).digest('hex')).toBe(ref.sourceSha256);
  expect(createHash('sha256').update(readFileSync(root+kind+'-native.pdf')).digest('hex')).toBe(ref.pdfSha256);
  const pkg=await DocxPackage.open(source),outlines=pens(pkg),native=ref.pages.flat();
  expect(outlines).toHaveLength(kind==='shape'?32:12);
  for(const [i,pen] of outlines.entries()) expect(pen.width/12700).toBeCloseTo(native[i],5);
  expect(outlines[0]).toMatchObject({width:1778,declaredWidth:0});
  const doc=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
  const save=async()=>new Uint8Array(await pkg.export(doc.paragraphs,doc.pageSettings,doc.numbering,doc.styles,doc.tables,doc.assets).arrayBuffer());
  expect(unzipSync(await save())).toEqual(pkg.parts);
  doc.select(0);doc.replace('Edited ');
  const edited=await save();expect(pens(await DocxPackage.open(edited))).toEqual(outlines);
  for(const [name,data] of Object.entries(pkg.parts)) if(name!=='word/document.xml')expect(unzipSync(edited)[name]).toEqual(data);
  doc.undo();expect(unzipSync(await save())).toEqual(pkg.parts);
});

it('keeps the zero-width picture centerline at the native frame while bounding the visible pen',async()=>{
  const pkg=await DocxPackage.open(readFileSync(root+'picture.docx'));
  const asset=Object.values(pkg.assets).find(a=>a.scene);
  const outline=walk(asset.scene).find(n=>n.pictureOutline);
  const ref=refs.controls.picture,rect=ref.firstStrokeRectanglePt;
  // The independent picture source is anchored at (60,90), size 144 by 72pt.
  expect(rect).toEqual([60,90,144,72]);
  const bounds=transformedShapeBounds(outline,[asset.width/outline.width,0,0,asset.height/outline.height,0,0]),half=ref.pages[0][0]/2;
  expect(bounds.left*.75).toBeCloseTo(rect[0]-60-half,6);
  expect(bounds.top*.75).toBeCloseTo(rect[1]-90-half,6);
  expect(bounds.right*.75).toBeCloseTo(rect[0]-60+rect[2]+half,6);
  expect(bounds.bottom*.75).toBeCloseTo(rect[1]-90+rect[3]+half,6);
});
