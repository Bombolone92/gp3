import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {JSDOM} from 'jsdom';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {StorySession} from '../src/engine/story-session.js';
import {inlineDisplayText} from '../src/engine/inline-display-text.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const source=readFileSync('tests/fixtures/drawing-text-fields/control.docx');
const images=pkg=>pkg.paragraphs.flatMap(p=>p.runs).filter(r=>r.image).map(r=>r.image);
const fields=paragraphs=>paragraphs.flatMap(p=>p.runs).filter(r=>r.field).map(r=>r.field);
const save=async(pkg,model)=>new Uint8Array(await pkg.export(model.paragraphs,model.pageSettings,model.numbering,model.styles,model.tables,model.assets).arrayBuffer());

it('binds native neighbor edits to unchanged source and retains the five field codes/results/locks',async()=>{
 const reference=JSON.parse(readFileSync('tests/fixtures/drawing-text-fields/native-edits.json','utf8').replace(/^\uFEFF/,''));
 expect(createHash('sha256').update(source).digest('hex')).toBe(reference.sourceSha256);expect(reference.sourceUnchanged).toBe(true);
 expect(reference.frames.map(f=>f.fieldsBefore.length)).toEqual([1,1,3]);
 for(const frame of reference.frames){expect(frame.fieldsAfter).toEqual(frame.fieldsBefore);expect(frame.after).toBe(frame.before.replace('Before','Edited'));}
 const pkg=await DocxPackage.open(readFileSync('tests/fixtures/drawing-text-fields/native-edited.docx'));
 const fs=images(pkg).flatMap(image=>pkg.drawingTextFrames(image));
 expect(fs).toHaveLength(3);expect(fs.map(f=>fields(f.paragraphs).length)).toEqual([1,1,3]);
 for(const[at,frame]of fs.entries()){
  expect(frame.reason).toBeNull();expect(fields(frame.paragraphs).map(f=>({code:f.instruction,result:f.cachedText,locked:f.locked}))).toEqual(reference.frames[at].fieldsAfter);
 }
},30000);

it('draws cached fields as atoms without replacing expanded page values',()=>{
 const run={text:'\ufffc',field:{cachedText:'123'}};
 expect(inlineDisplayText(run,'\ufffc')).toBe('123');
 expect(inlineDisplayText({...run,text:'8'},'8')).toBe('8');
 expect(inlineDisplayText({text:'ordinary'},'ordinary')).toBe('ordinary');
});

it('keeps identical adjacent envelopes separate and exposes only endpoint stops',async()=>{
 const pkg=await DocxPackage.open(source),frame=pkg.drawingTextFrames(images(pkg)[1])[1];
 expect(frame.reason).toBeNull();
 const model=new TextDocument(frame.paragraphs,undefined,pkg.numbering,pkg.styles,frame.tables);
 expect(fields(model.paragraphs)).toHaveLength(3);
 const measure=(text)=>({width:text.length*10,ascent:10,descent:2});
 const layout=layoutDocument(model.paragraphs,measure,pageGeometry(model.pageSettings),model.numbering,model.tables);
 const line=layout.lines.at(-1),start=model.text.lastIndexOf('\ufffc\ufffc');
 expect(line.fragments.map(f=>f.text).join('')).toBe('9999');
 expect(line.stops.map(s=>s.offset)).toEqual([start,start+1,start+2]);
 expect(line.stops.map(s=>s.x-line.stops[0].x)).toEqual([0,20,40]);
},30000);

it('edits neighboring text, preserving every field envelope, package parts and undo',async()=>{
 const pkg=await DocxPackage.open(source),model=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets),session=new StorySession(model);
 for(const originalImage of images(pkg))for(const [index,frame]of pkg.drawingTextFrames(originalImage).entries()){
  const image=model.paragraphs.flatMap(p=>p.runs).find(r=>r.image?.id===originalImage.id).image;
  const at=model.text.indexOf('\ufffc',originalImage===images(pkg)[0]?0:model.text.indexOf('\ufffc')+1);model.select(at,at+1);
  expect(frame.reason).toBeNull();
  const draft=new TextDocument(frame.paragraphs,undefined,pkg.numbering,pkg.styles,frame.tables),before=fields(draft.paragraphs);
  const position=draft.text.indexOf('Before');draft.select(position,position+6);draft.replace('Edited');
  expect(fields(draft.paragraphs)).toEqual(before);
  const prepared=pkg.prepareDrawingTextEdit(image,index,draft.paragraphs,model.assets,model.styles,model.numbering,draft.tables);
  const id='edited'+session.revision;model.assets[id]=prepared.asset;session.run(()=>model.replaceDrawingText(image,id,prepared.shell));
 }
 const bytes=await save(pkg,model),reopened=await DocxPackage.open(bytes),frames=images(reopened).flatMap(image=>reopened.drawingTextFrames(image));
 expect(frames.map(f=>fields(f.paragraphs).length)).toEqual([1,1,3]);
 expect(frames.every(f=>f.reason===null&&f.paragraphs.some(p=>p.runs.some(r=>r.text.includes('Edited'))))).toBe(true);
 const original=unzipSync(source),parts=unzipSync(bytes);
 for(const name of Object.keys(original).filter(n=>n!=='word/document.xml'))expect(parts[name]).toEqual(original[name]);
 for(let i=0;i<3;i++)session.undo();expect(unzipSync(await save(pkg,model))).toEqual(original);
},30000);

it('allows atom deletion but rejects duplicated or altered field envelopes/formatting',async()=>{
 const pkg=await DocxPackage.open(source),image=images(pkg)[0],frame=pkg.drawingTextFrames(image)[0];
 for(const mutate of [r=>{r.field.instruction=' PAGE \\* ROMAN ';},r=>{r.field.cachedText='7';},r=>{r.overrides={bold:true};}]){
  const paragraphs=structuredClone(frame.paragraphs),run=paragraphs.flatMap(p=>p.runs).find(r=>r.field);mutate(run);
  expect(()=>pkg.prepareDrawingTextEdit(image,0,paragraphs)).toThrow('must be retained');
 }
 const duplicated=structuredClone(frame.paragraphs),run=duplicated[1].runs.find(r=>r.field);duplicated[1].runs.push({...run});
 expect(()=>pkg.prepareDrawingTextEdit(image,0,duplicated)).toThrow('must be retained');
 const draft=new TextDocument(frame.paragraphs,undefined,pkg.numbering,pkg.styles),at=draft.text.indexOf('\ufffc');draft.select(at,at+1);draft.replace('');
 expect(fields(pkg.prepareDrawingTextEdit(image,0,draft.paragraphs).asset.scene.text.paragraphs)).toHaveLength(0);
},30000);
