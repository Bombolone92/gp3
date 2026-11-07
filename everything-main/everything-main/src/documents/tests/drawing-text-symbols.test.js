import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {JSDOM} from 'jsdom';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {StorySession} from '../src/engine/story-session.js';
import {bodySymbolText,bodySymbolStyle} from '../src/engine/body-symbols.js';
const root='tests/fixtures/drawing-text-symbols/',read=name=>readFileSync(root+name),cases=JSON.parse(read('cases.json'));
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const frames=pkg=>pkg.paragraphs.flatMap(p=>p.runs).filter(r=>r.image).flatMap(r=>pkg.drawingTextFrames(r.image));
it('binds the native edits to the authored symbol frames and their independent run fonts',()=>{
 const reference=JSON.parse(read('native-edits.json').toString().replace(/^\uFEFF/,''));
 expect(createHash('sha256').update(read('control.docx')).digest('hex')).toBe(reference.sourceSha256);expect(reference.sourceUnchanged).toBe(true);
 for(const[name,digest]of Object.entries(JSON.parse(read('hashes.json'))))expect(createHash('sha256').update(read(name)).digest('hex')).toBe(digest);
 expect(reference.frames.map(f=>[f.symbolComCode,f.underlyingFont,f.allCaps,f.smallCaps])).toEqual([[40,'Courier New',-1,0],[40,'Courier New',0,-1],[40,'Courier New',0,0]]);
});
for(const name of ['control.docx','native-edited.docx'])it(`retains symbols in editable drawing frames and exact no-edit bytes: ${name}`,async()=>{
 const pkg=await DocxPackage.open(read(name));expect(pkg.readOnly).toBeFalsy();const fs=frames(pkg);expect(fs).toHaveLength(3);
 for(const[at,f]of fs.entries()){
  expect(f.reason).toBeNull();const run=f.paragraphs[1].runs.find(r=>r.bodySymbol);
  expect(run.text).toBe('\ufffc');expect(run.bodySymbol).toEqual({font:cases[at].font,code:cases[at].code});
  expect(run.fontAscii).toBe('Courier New');expect(bodySymbolStyle(run,run).fontAscii).toBe('Arial');expect(bodySymbolStyle(run,run).capitalization).toBe('normal');
  expect(bodySymbolText(run,run.text)).toBe(at<2?'a':'A');
 }
 expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(unzipSync(read(name)));
},30000);
it('edits neighboring text and formatting without replacing symbol identity; undo restores originals',async()=>{
 const pkg=await DocxPackage.open(read('control.docx')),model=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets),session=new StorySession(model);
 const position=model.text.indexOf('\ufffc');model.select(position,position+1);const image=model.selectedImage;
 const draft=new TextDocument(pkg.drawingTextFrames(image)[0].paragraphs,undefined,pkg.numbering,pkg.styles);
 const symbol=draft.text.indexOf('\ufffc');draft.select(symbol+1);draft.replace(' next');
 draft.select(symbol,symbol+1);draft.toggleBold();draft.setRunFormat({fontAscii:'Times New Roman',fontHAnsi:'Times New Roman'});
 const prepared=pkg.prepareDrawingTextEdit(image,0,draft.paragraphs);model.assets.edited=prepared.asset;session.run(()=>model.replaceDrawingText(image,'edited',prepared.shell));
 const bytes=new Uint8Array(await session.export(pkg).arrayBuffer()),reopened=await DocxPackage.open(bytes),run=frames(reopened)[0].paragraphs[1].runs.find(r=>r.bodySymbol);
 expect(run.bodySymbol).toEqual({font:'Arial',code:'0061'});expect(run.bold).toBe(true);expect(run.fontAscii).toBe('Times New Roman');
 expect(frames(reopened)[0].paragraphs[1].runs.some(r=>r.text.includes('next')&&!r.bodySymbol&&r.fontAscii==='Courier New')).toBe(true);
 const parts=unzipSync(bytes),original=unzipSync(read('control.docx'));for(const name of Object.keys(original).filter(p=>p!=='word/document.xml'))expect(parts[name]).toEqual(original[name]);
 session.undo();expect(unzipSync(new Uint8Array(await session.export(pkg).arrayBuffer()))).toEqual(original);
},30000);
it('replaces/deletes a selected symbol as one atom and never gives typed text its symbol metadata',async()=>{
 const pkg=await DocxPackage.open(read('control.docx')),image=pkg.paragraphs.flatMap(p=>p.runs).find(r=>r.image).image;
 for(const replacement of ['Z','']){
  const draft=new TextDocument(pkg.drawingTextFrames(image)[0].paragraphs,undefined,pkg.numbering,pkg.styles);const position=draft.text.indexOf('\ufffc');draft.select(position,position+1);draft.replace(replacement);
  const prepared=pkg.prepareDrawingTextEdit(image,0,draft.paragraphs);expect(prepared.asset.scene.text.paragraphs.flatMap(p=>p.runs).some(r=>r.bodySymbol)).toBe(false);
 }
},30000);
