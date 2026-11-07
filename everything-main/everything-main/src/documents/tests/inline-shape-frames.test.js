import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {imageExtents,inlineImagePaintFrame,validateImage} from '../src/engine/images.js';
const folder='tests/fixtures/inline-shape-frames/',refs=JSON.parse(readFileSync(folder+'reference.json'));
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const images=p=>p.paragraphs.flatMap(p=>p.runs.filter(r=>r.image).map(r=>r.image));
it('binds all original controls to their independent native references',()=>{for(const ref of Object.values(refs))for(const[name,hash]of Object.entries(ref.hashes))expect(createHash('sha256').update(readFileSync(folder+name)).digest('hex')).toBe(hash);});
it.each([12,14,15])('mode %i retains native inline widths and scene rotation through editing and exact undo',async mode=>{
 const p=await DocxPackage.open(readFileSync(folder+`mode-${mode}.docx`)),all=images(p);
 expect(all).toHaveLength(36);
 for(const [i,image]of all.entries()){
  const c=refs[mode].cases[i],extent=imageExtents(image),frame=inlineImagePaintFrame(image,0,0),scene=p.assets[image.assetId].scene;
  expect(Math.abs(extent.width/12700-c.inlineAdvancePt)).toBeLessThan(.1);
  expect(image.rotation).toBeUndefined();expect(scene.shapeRotation||scene.groupRotation||scene.lineRotation||0).toBe(c.angle*60000);
  expect(frame.width).toBe(96);expect(frame.height).toBe(48);
  expect(frame.x+frame.width/2).toBe(extent.width/9525/2);
  expect(frame.y+frame.height/2).toBe(extent.height/9525/2);
 }
 const d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 expect(unzipSync(await save())).toEqual(p.parts);d.select(0);d.replace('Edited ');
 const bytes=await save(),again=await DocxPackage.open(bytes);expect(images(again)).toEqual(all);
 for(const[name,part]of Object.entries(unzipSync(bytes)))if(name!=='word/document.xml')expect(part).toEqual(p.parts[name]);
 d.undo();expect(unzipSync(await save())).toEqual(p.parts);
});
it('rejects invalid or externally applied retained-frame rotation metadata',()=>{
 const image={kind:'drawing',retainedDrawing:true,width:914400,height:457200,alt:'',frameRotation:5400000};
 expect(()=>validateImage(image)).not.toThrow();
 for(const patch of [{kind:'picture'},{retainedDrawing:false},{frameRotation:1.5},{frameRotation:-1},{frameRotation:21600000},{anchor:{}},{flatLine:{}}])expect(()=>validateImage({...image,...patch})).toThrow();
});
