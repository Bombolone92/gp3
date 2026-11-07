import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const folder='tests/fixtures/picture-3d-frames/';
const source=readFileSync(folder+'source.docx'), cases=JSON.parse(readFileSync(folder+'cases.json'));
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
it('ties frame controls to their independent reference capture',()=>{
 const reference=JSON.parse(readFileSync(folder+'reference.json'));
 expect(createHash('sha256').update(source).digest('hex')).toBe(reference.sourceSha256);
 expect(createHash('sha256').update(readFileSync(folder+'native.pdf')).digest('hex')).toBe(reference.pdfSha256);
});
it('fits solid proportions without scaling physical effects or changing frame reservation and retained XML',async()=>{
 const p=await DocxPackage.open(source), images=p.paragraphs.flatMap(p=>p.runs.filter(r=>r.image).map(r=>r.image));
 expect(images).toHaveLength(24);
 for(const [i,image] of images.entries()){
  const c=cases[i],asset=p.assets[image.assetId];
  const narrow=c.name.includes('narrow')||c.name.includes('unlocked')||c.name==='inline-72-216';
  const wide=c.name.includes('wide')||c.name==='inline-288-54';
  expect([asset.scene.width/12700,asset.scene.height/12700],c.name).toEqual(narrow?[36,108]:wide?[144,27]:[144,108]);
  expect([image.width/12700,image.height/12700]).toEqual([144,108]);
  expect([asset.width,asset.height]).toEqual([192,144]);
  if(c.bevel)expect(asset.scene.bevel).toMatchObject({width:12,height:6,preset:'angle'});
  if(c.name.endsWith('unlocked'))expect(image.aspectLocked).toBe(false);
 }
 const d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 d.select(0);d.replace('Edited '); const edited=await save(), reopened=await DocxPackage.open(edited);
 expect(Object.values(reopened.assets).filter(a=>a.scene).map(a=>a.scene)).toEqual(Object.values(p.assets).filter(a=>a.scene).map(a=>a.scene));
 const parts=unzipSync(edited);
 expectBodyEditParts(parts,p.parts);
 d.undo(); const undone=unzipSync(await save());
 for(const name of Object.keys(p.parts))expect(Buffer.from(undone[name]).equals(Buffer.from(p.parts[name])),name).toBe(true);
},30000);
