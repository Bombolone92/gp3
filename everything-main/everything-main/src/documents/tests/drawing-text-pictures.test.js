import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {JSDOM} from 'jsdom';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {StorySession} from '../src/engine/story-session.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const source=readFileSync('tests/fixtures/drawing-text-pictures/control.docx');
const pictures=ps=>ps.flatMap(p=>p.runs).filter(r=>r.image).map(r=>r.image);
const save=async(pkg,m)=>new Uint8Array(await pkg.export(m.paragraphs,m.pageSettings,m.numbering,m.styles,m.tables,m.assets).arrayBuffer());
const draft=(pkg,frame)=>new TextDocument(frame.paragraphs,undefined,pkg.numbering,pkg.styles,frame.tables,pkg.assets);
it('edits text around SVG/fallback and PNG pictures in standalone and grouped frames, retaining parts and undo',async()=>{
 const pkg=await DocxPackage.open(source),model=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets),session=new StorySession(model);
 let count=0;
 for(const original of pictures(pkg.paragraphs))for(const [index,frame]of pkg.drawingTextFrames(original).entries()){
  expect(frame.reason).toBeNull();const originalPicture=pictures(frame.paragraphs)[0];expect(originalPicture.shell).toBeTruthy();
  const d=draft(pkg,frame),at=d.text.indexOf('Before');d.select(at,at+6);d.replace('Edited');
  const image=pictures(model.paragraphs).find(i=>i.id===original.id),position=model.text.indexOf('\ufffc',count?model.text.indexOf('\ufffc')+1:0);model.select(position,position+1);
  const prepared=pkg.prepareDrawingTextEdit(image,index,d.paragraphs,model.assets,model.styles,model.numbering,d.tables);
  expect(pictures(prepared.asset.scene.text?.paragraphs||prepared.asset.scene.children[index].text.paragraphs)[0]).toEqual(originalPicture);
  const id='edited'+count++;model.assets[id]=prepared.asset;session.run(()=>model.replaceDrawingText(image,id,prepared.shell));
 }
 expect(count).toBe(3);const bytes=await save(pkg,model),reopened=await DocxPackage.open(bytes),frames=pictures(reopened.paragraphs).flatMap(i=>reopened.drawingTextFrames(i));
 expect(frames.every(f=>f.reason===null&&f.paragraphs.some(p=>p.runs.some(r=>r.text.includes('Edited'))))).toBe(true);
 expect(frames.map(f=>pictures(f.paragraphs)[0].assetId)).toEqual(['word/media/square.svg','word/media/square.png','word/media/square.svg']);
 const old=unzipSync(source),parts=unzipSync(bytes);for(const name of Object.keys(old).filter(n=>n!=='word/document.xml'))expect(parts[name]).toEqual(old[name]);
 for(let i=0;i<3;i++)session.undo();expect(unzipSync(await save(pkg,model))).toEqual(old);
},30000);
it('uses shared picture geometry serialization for resize, crop, flip, rotation, alt text and text-position moves',async()=>{
 const pkg=await DocxPackage.open(source),image=pictures(pkg.paragraphs)[0],frame=pkg.drawingTextFrames(image)[0],d=draft(pkg,frame);
 const at=d.text.indexOf('\ufffc');d.select(at,at+1);d.setImageProperties({width:342900,height:342900,crop:{left:10000,right:0,top:0,bottom:0},flipH:true,rotation:5400000,alt:'Changed alt'});d.moveImage(d.text.length);
 const prepared=pkg.prepareDrawingTextEdit(image,0,d.paragraphs),next=pictures(prepared.asset.scene.text.paragraphs)[0];
 expect(next).toMatchObject({width:342900,height:342900,flipH:true,rotation:5400000,alt:'Changed alt',assetId:'word/media/square.svg',fallbackAssetId:'word/media/square.png',crop:{left:10000}});
 expect(prepared.asset.scene.text.paragraphs.at(-1).runs.at(-1).image).toEqual(next);
 expect(pkg.parts).toEqual(unzipSync(source));
},30000);
it('permits deletion and refuses new, duplicate or rewritten resource identities before changing source',async()=>{
 const pkg=await DocxPackage.open(source),image=pictures(pkg.paragraphs)[0],frame=pkg.drawingTextFrames(image)[0];
 expect(pkg.prepareDrawingTextEdit(image,0,frame.paragraphs)).toBeNull();
 for(const mutate of [r=>{r.image.assetId='new';},r=>{r.image.relId='new';},r=>{r.image.fallbackRelId='new';},r=>{r.image.shell=r.image.shell.replace('rPng','new');},r=>{r.image.id=700;},r=>{r.text='wrong';},r=>{r.bodySymbol={font:'Symbol',char:'F061'};}]){
  const ps=structuredClone(frame.paragraphs),r=ps.flatMap(p=>p.runs).find(r=>r.image);mutate(r);expect(()=>pkg.prepareDrawingTextEdit(image,0,ps)).toThrow('source identity');
 }
 const ps=structuredClone(frame.paragraphs);ps[1].runs.push(structuredClone(ps[1].runs.find(r=>r.image)));expect(()=>pkg.prepareDrawingTextEdit(image,0,ps)).toThrow('source identity');
 const d=draft(pkg,frame),at=d.text.indexOf('\ufffc');d.select(at,at+1);d.replace('');expect(pictures(pkg.prepareDrawingTextEdit(image,0,d.paragraphs).asset.scene.text.paragraphs)).toHaveLength(0);
 expect(pkg.parts).toEqual(unzipSync(source));
},30000);

it('keeps pictures editable inside retained block controls and table cells without consuming source drawing IDs on repeated drafts',async()=>{
 const pkg=await DocxPackage.open(readFileSync('tests/fixtures/drawing-text-pictures/structures.docx')),image=pictures(pkg.paragraphs)[1];
 for(const index of [0,1]){
  const first=pkg.drawingTextFrames(image)[index],second=pkg.drawingTextFrames(image)[index];expect(first.reason).toBeNull();expect(second).toEqual(first);
  const d=draft(pkg,first),at=d.text.indexOf('Before');d.select(at,at+6);d.replace('Edited');
  const prepared=pkg.prepareDrawingTextEdit(image,index,d.paragraphs,pkg.assets,pkg.styles,pkg.numbering,d.tables);
  const ps=structuredClone(pkg.paragraphs),id='structured-edit';pictures(ps).find(i=>i.id===image.id).assetId=id;pictures(ps).find(i=>i.id===image.id).shell=prepared.shell;
  const bytes=new Uint8Array(await pkg.export(ps,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,{...pkg.assets,[id]:prepared.asset}).arrayBuffer()),reopened=await DocxPackage.open(bytes),frame=reopened.drawingTextFrames(pictures(reopened.paragraphs)[1])[index];
  expect(frame.reason).toBeNull();expect(pictures(frame.paragraphs)).toHaveLength(1);expect(frame.paragraphs.some(p=>p.runs.some(r=>r.text.includes('Edited')))).toBe(true);
  if(index===0)expect(frame.paragraphs.some(p=>p.blockControls?.some(c=>new DOMParser().parseFromString(c.shell,'application/xml').getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','id')[0]?.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','val')==='900'))).toBe(true);else expect(frame.tables).toHaveLength(1);
 }
},30000);
it('serializes a header text-box picture through its owning relationships, retaining body and undo',async()=>{
 const bytes=readFileSync('tests/fixtures/drawing-text-pictures/header.docx'),pkg=await DocxPackage.open(bytes),model=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets),session=new StorySession(model,pkg.pageStories),header=session.activate('word/header1.xml');header.select(0,1);const image=header.selectedImage,frame=pkg.drawingTextFrames(image)[0],d=draft(pkg,frame),at=d.text.indexOf('Before');d.select(at,at+6);d.replace('Edited');const pos=d.text.indexOf('\ufffc');d.select(pos,pos+1);d.setImageProperties({width:342900,height:342900});
 const prepared=pkg.prepareDrawingTextEdit(image,0,d.paragraphs);header.assets['header-edit']=prepared.asset;session.run(()=>header.replaceDrawingText(image,'header-edit',prepared.shell));
 const output=new Uint8Array(await session.export(pkg).arrayBuffer()),old=unzipSync(bytes),parts=unzipSync(output);for(const n of Object.keys(old).filter(n=>n!=='word/header1.xml'))expect(parts[n]).toEqual(old[n]);
 const reopened=await DocxPackage.open(output),rf=reopened.drawingTextFrames(pictures(reopened.pageStories.stories['word/header1.xml'].paragraphs)[0])[0];expect(rf.reason).toBeNull();expect(pictures(rf.paragraphs)[0]).toMatchObject({assetId:'word/media/square.svg',fallbackRelId:'rPng',width:342900,height:342900});
 session.undo();expect(unzipSync(new Uint8Array(await session.export(pkg).arrayBuffer()))).toEqual(old);
},30000);
