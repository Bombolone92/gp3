import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument,paragraphText} from '../src/engine/model.js';
import {StorySession} from '../src/engine/story-session.js';
import {pageStoryPath} from '../src/engine/page-stories.js';

let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const folder='tests/fixtures/section-editing',reference=JSON.parse(readFileSync(`${folder}/reference.json`));
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function semantics(pkg,d,allStories=false,cellOwnership=false){
 const body=new DOMParser().parseFromString(strFromU8(pkg.parts['word/document.xml']),'application/xml').getElementsByTagNameNS(W,'body')[0];
 const final=[...body.children].find(n=>n.namespaceURI===W&&n.localName==='sectPr');
 const sections=[...d.paragraphs.filter(p=>p.sectionEnd).map(p=>p.sectionProperties),final?new XMLSerializer().serializeToString(final):`<w:sectPr xmlns:w="${W}"/>`];
 const inherited=new Map();
 const sectionProperties=sections.map((xml,i)=>{
  const s=xml?new DOMParser().parseFromString(xml,'application/xml').documentElement:null;
  const settings=i===sections.length-1?d.pageSettings:d.paragraphs.filter(p=>p.sectionEnd)[i].sectionEnd;
  const rels=new DOMParser().parseFromString(strFromU8(pkg.parts['word/_rels/document.xml.rels']),'application/xml');
  for(const kind of ['header','footer'])for(const ref of s.getElementsByTagNameNS(W,kind+'Reference')){
   const id=ref.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');
   inherited.set(kind+':'+ref.getAttributeNS(W,'type'),[...rels.documentElement.children].find(r=>r.getAttribute('Id')===id).getAttribute('Target'));
  }
  const result={width:settings.width/20,height:settings.height/20,left:settings.left/20};
  if(allStories)result.firstPageDifferent=s.getElementsByTagNameNS(W,'titlePg').length>0;
  for(const [kind,name,variant] of [['header','header','default'],['header','headerFirst','first'],['header','headerEven','even'],['footer','footer','default'],['footer','footerFirst','first'],['footer','footerEven','even']]){
   if(!allStories&&name!=='header')continue;
   const target=inherited.get(kind+':'+variant),hdr=target&&new DOMParser().parseFromString(strFromU8(pkg.parts['word/'+target]),'application/xml');
   result[name]=hdr?[...hdr.getElementsByTagNameNS(W,'t')].map(t=>t.textContent).join(''):'';
  }
  return result;
 });
 return {paragraphs:d.paragraphs.map(p=>({text:paragraphText(p),alignment:p.format.alignment,sectionEnd:!!p.sectionEnd,...(cellOwnership?{inTable:!!p.cellId}:{})})),sections:sectionProperties,tables:d.tables.length};
}
function selection(d,name){
 if(name==='delete-first')return [26,27,''];
 if(name==='replace-at-break')return [26,27,'Edited'];
 if(name==='insert-text')return [26,27,'New'];
 if(name==='multiline-at-break')return [26,27,'One\nTwo'];
 if(name==='replace-first')return [24,29,'Edited'];
 if(name==='replace-to-second')return [24,d.text.indexOf('Delta boundary')+2,'Edited'];
 if(name==='replace-both')return [24,d.text.indexOf('Echo final')+2,'Edited'];
 return [24,29,'One\nTwo'];
}
it.each(reference.cases)('matches native section, paragraph and whole-table ownership: $fixture $name',async item=>{
 const source=readFileSync(`${folder}/${item.fixture}.docx`),pkg=await DocxPackage.open(source),d=model(pkg),original=unzipSync(source);
 expect(createHash('sha256').update(source).digest('hex')).toBe(item.sourceSha256);
 const [start,end,text]=selection(d,item.name);d.select(start,end);expect(d.replace(text)).toBe(true);
 const exported=await save(pkg,d),reopened=await DocxPackage.open(exported);
 expect(semantics(reopened,model(reopened),['inheritance','implicit-final'].includes(item.fixture),item.fixture==='boundary-table')).toEqual(item.expected);
 for(const [name,part] of Object.entries(original))if(name!=='word/document.xml')expect(unzipSync(exported)[name],name).toEqual(part);
 d.undo();expect(unzipSync(await save(pkg,d))).toEqual(original);d.redo();expect(unzipSync(await save(pkg,d))).toEqual(unzipSync(exported));
});
it.each([-1,1])('keyboard deletion across a section break preserves the native ending alignment, direction %s',async direction=>{
 const pkg=await DocxPackage.open(readFileSync(`${folder}/formats.docx`)),d=model(pkg),caret=direction<0?27:26;
 d.select(caret);d.delete(direction);expect(d.paragraphs[1].format.alignment).toBe('center');expect(d.paragraphs.filter(p=>p.sectionEnd)).toHaveLength(1);
 d.undo();expect(d.selection).toEqual({anchor:caret,focus:caret});expect(d.paragraphs[1].format.alignment).toBe('right');
});
it('rejects a section and partial-cell replacement atomically',async()=>{
 const pkg=await DocxPackage.open(readFileSync(`${folder}/table.docx`)),d=model(pkg);d.select(24,d.text.indexOf('Table middle')+2);
 const before=d.snapshot();expect(()=>d.replace('Edited')).toThrow('partial table selection');expect(d.snapshot()).toEqual(before);expect(d.history).toHaveLength(0);
});
it('forward Delete before a table moves the retained body prefix into its first cell and restores the caret on undo',async()=>{
 const pkg=await DocxPackage.open(readFileSync(`${folder}/boundary-table.docx`)),d=model(pkg),cell=d.tables[0].rows[0].cells[0];
 d.select(26);expect(d.delete(1)).toBe(true);expect(d.paragraphs[1].cellId).toBe(cell.id);expect(paragraphText(d.paragraphs[1])).toBe('Bravo boundaryTable middle');
 expect(d.paragraphs[1].format.alignment).toBe('left');expect(d.paragraphs.filter(p=>p.sectionEnd)).toHaveLength(1);
 d.undo();expect(d.selection).toEqual({anchor:26,focus:26});expect(d.paragraphs[1].cellId).toBeUndefined();expect(d.paragraphs[1].format.alignment).toBe('right');
});
it('matches native first-cell Backspace without removing the preceding section mark',async()=>{
 const source=readFileSync(`${folder}/boundary-table.docx`),pkg=await DocxPackage.open(source),d=model(pkg),before=semantics(pkg,d,true,true);
 const native=JSON.parse(readFileSync(`${folder}/native-boundary-commands.json`)).commands.find(c=>c.command==='backspace');
 const original=d.text;d.select(27);expect(d.delete(-1)).toBe(native.changed);
 expect(d.text).toBe(original.slice(0,25)+original.slice(26));expect(d.selection).toEqual({anchor:native.caret,focus:native.caret});
 expect(d.paragraphs.map(paragraphText)).toEqual(native.paragraphs.filter(p=>p!=='\r\u0007').map(p=>p.replace(/[\r\f\u0007]/g,'')));
 const exported=await save(pkg,d),reopened=await DocxPackage.open(exported),after=semantics(reopened,model(reopened),true,true);
 expect(after.sections).toEqual(before.sections);expect(after.sections).toHaveLength(native.sections);expect(after.tables).toBe(before.tables);
 expect(after.paragraphs).toEqual(before.paragraphs.map((p,i)=>i===1?{...p,text:'Bravo boundar'}:p));
 for(const [name,part] of Object.entries(unzipSync(source)))if(name!=='word/document.xml')expect(unzipSync(exported)[name],name).toEqual(part);
 d.undo();expect(d.selection).toEqual({anchor:27,focus:27});expect(unzipSync(await save(pkg,d))).toEqual(unzipSync(source));
 d.redo();expect(unzipSync(await save(pkg,d))).toEqual(unzipSync(exported));
});
it('uses whole-grapheme deletion before a section/table boundary',async()=>{
 const pkg=await DocxPackage.open(readFileSync(`${folder}/boundary-table.docx`)),d=model(pkg);
 d.select(25,26);d.replace('A\u0301👨‍👩‍👧‍👦');const caret=d.text.indexOf('Table middle'),before=d.text;
 d.select(caret);expect(d.delete(-1)).toBe(true);expect(paragraphText(d.paragraphs[1])).toBe('Bravo boundarA\u0301');
 expect(d.paragraphs.filter(p=>p.sectionEnd)).toHaveLength(2);expect(d.tables).toHaveLength(1);
 d.undo();expect(d.text).toBe(before);expect(d.selection).toEqual({anchor:caret,focus:caret});
});
it('keeps the table-boundary guard when the preceding section paragraph is empty',async()=>{
 const pkg=await DocxPackage.open(readFileSync(`${folder}/boundary-table.docx`)),d=model(pkg);
 d.select(12,26);d.replace('');d.select(d.text.indexOf('Table middle'));const before=d.snapshot(),history=d.history.length;
 expect(d.delete(-1)).toBe(false);expect(d.snapshot()).toEqual(before);expect(d.history).toHaveLength(history);
});
it('restores the first-cell caret and history when preceding protected content rejects deletion',async()=>{
 const pkg=await DocxPackage.open(readFileSync(`${folder}/boundary-table.docx`));
 for(const run of pkg.paragraphs[1].runs)run.contentControl={id:'protected',persistent:true,picture:true};
 const d=model(pkg);d.select(27);const before=d.snapshot();
 expect(()=>d.delete(-1)).toThrow('picture content control');expect(d.snapshot()).toEqual(before);expect(d.history).toHaveLength(0);
});
it.each(['formats','inheritance','implicit-final'])('remaps live %s stories and preserves their edits through section deletion and history',async fixture=>{
 const source=readFileSync(`${folder}/${fixture}.docx`),pkg=await DocxPackage.open(source),session=new StorySession(model(pkg),pkg.pageStories);
 const path=fixture==='formats'?'word/header2.xml':'word/header1.xml';
 session.activate(path);session.model.select(0,session.model.text.length);session.run(d=>d.replace('Changed header'));
 session.activate();session.model.select(26,27);session.run(d=>d.replace(''));
 const stories=session.pageStories;expect(stories.sections).toHaveLength(2);
 expect(pageStoryPath(stories,0,'header',1,false)).toBe(path);
 expect(stories.stories[path].paragraphs.map(paragraphText).join('\n')).toBe('Changed header');
 if(fixture!=='formats'){
  expect(pageStoryPath(stories,0,'header',1,true)).toBe('word/headerFirst.xml');
  expect(pageStoryPath(stories,0,'header',2,false)).toBe('word/headerEven.xml');
  expect(pageStoryPath(stories,0,'footer',1,true)).toBe('word/footerFirst.xml');
 }
 const edited=new Uint8Array(await session.export(pkg).arrayBuffer()),reopened=await DocxPackage.open(edited);
 expect(reopened.pageStories.stories[path].paragraphs.map(paragraphText).join('\n')).toBe('Changed header');
 session.undo();expect(session.pageStories.sections).toHaveLength(3);expect(pageStoryPath(session.pageStories,0,'header',1,false)).toBe('word/header1.xml');
 session.redo();expect(session.pageStories.sections).toHaveLength(2);expect(unzipSync(new Uint8Array(await session.export(pkg).arrayBuffer()))).toEqual(unzipSync(edited));
 session.undo();session.undo();expect(unzipSync(new Uint8Array(await session.export(pkg).arrayBuffer()))).toEqual(unzipSync(source));
});
it('keeps final inherited stories when successive keyboard deletions remove both section marks',async()=>{
 const pkg=await DocxPackage.open(readFileSync(`${folder}/inheritance.docx`)),session=new StorySession(model(pkg),pkg.pageStories);
 session.model.select(26);session.run(d=>d.delete(1));
 const mark=session.model.text.indexOf('Delta boundary')+'Delta boundary'.length;
 session.model.select(mark);session.run(d=>d.delete(1));
 expect(session.pageStories.sections).toHaveLength(1);
 expect(pageStoryPath(session.pageStories,0,'footer',2,false)).toBe('word/footerEven.xml');
 const reopened=await DocxPackage.open(new Uint8Array(await session.export(pkg).arrayBuffer()));
 expect(reopened.pageStories.sections).toEqual(session.pageStories.sections);
 session.undo();expect(session.pageStories.sections).toHaveLength(2);session.undo();expect(session.pageStories.sections).toHaveLength(3);
});
