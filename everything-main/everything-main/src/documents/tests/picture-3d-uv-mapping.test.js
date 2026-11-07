import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/picture-3d-uv-mapping/';
const ref=JSON.parse(readFileSync(root+'native/reference.json'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});

it('binds seven native texture-mapping pages and both distinct playback policies to unchanged sources',()=>{
 for(const c of ref.cases){
  expect(hash(readFileSync(root+c.source))).toBe(c.sourceSha256);
  const folder=root+'native/'+c.kind+'/',capture=JSON.parse(readFileSync(folder+'capture.json','utf8').replace(/^\uFEFF/,''));
  expect(capture).toMatchObject({sourceSha256:c.sourceSha256,sourceUnchanged:true,savedBefore:true,savedAfter:true});
  expect(capture.captures.length).toBe(c.kind==='projected'?5:1);
  for(const p of capture.captures){
   const emf=gunzipSync(readFileSync(folder+p.file+'.gz'));
   expect(emf.length).toBe(p.length);expect(hash(emf)).toBe(p.sha256);
   expect(p).toMatchObject({widthPt:612,heightPt:792});
   for(const mode of ['default','half']){
    const i=c.images.find(i=>i.page===p.page&&i.mode===mode);
    expect(hash(readFileSync(folder+i.file))).toBe(i.sha256);
   }
  }
 }
});
for(const c of ref.cases)it(`${c.kind} mapping controls retain scenes, media and exact undo`,async()=>{
 const source=readFileSync(root+c.source),pkg=await DocxPackage.open(new Uint8Array(source));
 const scenes=Object.values(pkg.assets).filter(a=>a.scene).map(a=>a.scene);
 expect(scenes.length).toBe(c.kind==='projected'?5:c.kind==='left'?1:0);
 if(c.kind==='projected'){
  expect(scenes[0]).toEqual(scenes[1]);expect(scenes[0]).toEqual(scenes[2]);
  expect(scenes[0]).not.toEqual(scenes[3]);
 }
 const d=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
 const save=async()=>new Uint8Array(await pkg.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 const original=unzipSync(source);expect(unzipSync(await save())).toEqual(original);
 d.select(0);d.replace('Edited ');const edited=await save(),parts=unzipSync(edited);
 expect(parts['word/document.xml']).not.toEqual(original['word/document.xml']);
 expectBodyEditParts(parts,original);
 const reopened=await DocxPackage.open(edited);
 expect(Object.values(reopened.assets).filter(a=>a.scene).map(a=>a.scene)).toEqual(scenes);
 d.undo();expect(unzipSync(await save())).toEqual(original);
},30000);
