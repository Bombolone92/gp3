import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage,W} from '../src/engine/docx.js';import {TextDocument} from '../src/engine/model.js';import {activeDescendants} from '../src/engine/docx-compatibility.js';import {StorySession} from '../src/engine/story-session.js';
const root='tests/fixtures/drawing-text-structures/',read=name=>readFileSync(root+name),cases=JSON.parse(read('cases.json'));
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const frames=pkg=>{const fs=[],walk=n=>{if(n.text)fs.push(n.text);n.children?.forEach(walk);};Object.values(pkg.assets).filter(a=>a.scene).forEach(a=>walk(a.scene));return fs;};
const activeControls=bytes=>{const xml=new DOMParser().parseFromString(strFromU8(unzipSync(bytes)['word/document.xml']),'application/xml');return activeDescendants(xml.documentElement).filter(n=>n.namespaceURI===W&&n.localName==='sdt').map(n=>{const pr=[...n.children].find(n=>n.namespaceURI===W&&n.localName==='sdtPr'),item=key=>[...pr.children].find(n=>n.namespaceURI===W&&n.localName===key);return {tag:item('tag')?.getAttributeNS(W,'val'),id:item('id')?.getAttributeNS(W,'val'),temporary:!!item('temporary'),placeholder:!!item('showingPlcHdr')};});};
it('binds native edits to the authored drawing source and preserves persistent identity',()=>{
 for(const[name,hash]of Object.entries(JSON.parse(read('hashes.json'))))expect(createHash('sha256').update(read(name)).digest('hex')).toBe(hash);
 const native=JSON.parse(read('native-edits.json').toString().replace(/^\uFEFF/,''));expect(native.sourceSha256).toBe(createHash('sha256').update(read('control.docx')).digest('hex'));expect(native.sourceUnchanged).toBe(true);
 expect(native.frames.map(f=>f.tablesBefore)).toEqual([1,1,0]);expect(native.frames.map(f=>f.tablesAfter)).toEqual([1,1,0]);
 expect(native.frames.flatMap(f=>f.controlsBefore).map(c=>c.tag)).toEqual(cases.tags);
 expect(native.frames.flatMap(f=>f.controlsAfter)).toEqual([{tag:'persistent-table',id:'202',placeholder:false,temporary:false}]);
 for(const[before,after]of Object.entries(cases.edits)){expect(native.frames.some(f=>f.before.includes(before))).toBe(true);expect(native.frames.some(f=>f.after.includes(after))).toBe(true);}
 expect(activeControls(read('control.docx'))).toEqual([{tag:'temp-table',id:'201',temporary:true,placeholder:true},{tag:'persistent-table',id:'202',temporary:false,placeholder:true},{tag:'temp-frame',id:'203',temporary:true,placeholder:true}]);
 expect(activeControls(read('native-edited.docx'))).toEqual([{tag:'persistent-table',id:'202',temporary:false,placeholder:false}]);
});
for(const name of ['control.docx','native-edited.docx'])it(`retains nested drawing tables and saved control text without flattening: ${name}`,async()=>{
 const pkg=await DocxPackage.open(read(name));expect(pkg.readOnly).toBeFalsy();const fs=frames(pkg);expect(fs).toHaveLength(3);expect(fs.map(f=>(f.tables||[]).length)).toEqual([2,1,0]);expect(pkg.tables).toEqual([]);
 const text=fs.flatMap(f=>f.paragraphs.flatMap(p=>p.runs.map(r=>r.text))).join('\n');for(const t of Object[name==='control.docx'?'keys':'values'](cases.edits))expect(text).toContain(t);
 expect(fs[0].tables.some(t=>t.parentCellId)).toBe(true);expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(unzipSync(read(name)));
},30000);
it('preserves every drawing and unrelated part through an ordinary body edit and exact undo',async()=>{
 const source=read('control.docx'),pkg=await DocxPackage.open(source),model=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets),parts=unzipSync(source);
 const save=async()=>unzipSync(new Uint8Array(await pkg.export(model.paragraphs,model.pageSettings,model.numbering,model.styles,model.tables,model.assets).arrayBuffer()));
 model.select(0);model.replace('Edited ');const edited=await save();for(const name of Object.keys(parts).filter(n=>n!=='word/document.xml'))expect(edited[name]).toEqual(parts[name]);
 const drawings=bytes=>{const xml=new DOMParser().parseFromString(strFromU8(bytes),'application/xml');return [...xml.getElementsByTagNameNS(W,'drawing')].map(n=>new XMLSerializer().serializeToString(n));};
 expect(drawings(edited['word/document.xml'])).toEqual(drawings(parts['word/document.xml']));model.undo();expect(await save()).toEqual(parts);
},30000);

it('edits standalone, nested and grouped table cells with native control lifetime and exact undo',async()=>{
 const source=read('control.docx'),pkg=await DocxPackage.open(source),model=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
 const native=await DocxPackage.open(read('native-edited.docx'));
 const selections=[];let at=0;for(const p of model.paragraphs){for(const r of p.runs){if(r.image)selections.push(at);at+=r.text.length;}at++;}
 for(const [drawing,frame,edits]of [[0,0,Object.entries(cases.edits).slice(0,4)],[1,0,[['Group cell','Group edited']]],[1,1,[['Prompt B','Filled frame']]]]){
  model.select(selections[drawing],selections[drawing]+1);const image=model.selectedImage,descriptor=pkg.drawingTextFrames(image,model.assets)[frame];expect(descriptor.reason).toBeNull();
  const draft=new TextDocument(descriptor.paragraphs,undefined,pkg.numbering,pkg.styles,descriptor.tables);
  for(const[before,after]of edits){const start=draft.text.indexOf(before);expect(start).toBeGreaterThanOrEqual(0);draft.select(start,start+before.length);draft.replace(after);}
  const prepared=pkg.prepareDrawingTextEdit(image,frame,draft.paragraphs,model.assets,model.styles,model.numbering,draft.tables),id=`structure-edit:${drawing}:${frame}`;model.assets[id]=prepared.asset;model.replaceDrawingText(image,id,prepared.shell);
 }
 const bytes=new Uint8Array(await pkg.export(model.paragraphs,model.pageSettings,model.numbering,model.styles,model.tables,model.assets).arrayBuffer()),reopened=await DocxPackage.open(bytes);
 const content=pkg=>frames(pkg).map(f=>f.paragraphs.map(p=>p.runs.map(r=>r.text).join('')));
 expect(content(reopened)).toEqual(content(native));expect(activeControls(bytes)).toEqual(activeControls(read('native-edited.docx')));
 expect(frames(reopened).map(f=>(f.tables||[]).length)).toEqual([2,1,0]);
 const before=unzipSync(source),after=unzipSync(bytes);for(const n of Object.keys(before).filter(n=>n!=='word/document.xml'))expect(after[n]).toEqual(before[n]);
 model.undo();model.undo();model.undo();expect(unzipSync(new Uint8Array(await pkg.export(model.paragraphs,model.pageSettings,model.numbering,model.styles,model.tables,model.assets).arrayBuffer()))).toEqual(before);
},30000);
it('caches editable ownership per immutable drawing version and does not consume global control IDs',async()=>{
 const pkg=await DocxPackage.open(read('control.docx')),images=pkg.paragraphs.flatMap(p=>p.runs).filter(r=>r.image).map(r=>r.image);
 for(let i=0;i<3;i++)for(const image of images){const a=pkg.drawingTextFrames(image),b=pkg.drawingTextFrames(image);expect(a.map(f=>f.reason)).toEqual(a.map(()=>null));expect(a.map(f=>f.paragraphs)).toEqual(b.map(f=>f.paragraphs));for(const f of a)expect(pkg.prepareDrawingTextEdit(image,f.index,f.paragraphs,pkg.assets,pkg.styles,pkg.numbering,f.tables)).toBeNull();}
 const fs=pkg.drawingTextFrames(images[0]),controls=fs[0].paragraphs.flatMap(p=>p.runs).filter(r=>r.contentControl).map(r=>r.contentControl);
 expect(controls.map(c=>!!c.persistent)).toEqual([false,true]);expect(controls.map(c=>c.id)).toEqual(['sdt1','sdt2']);
 expect(frames(pkg)[0].paragraphs.flatMap(p=>p.runs).some(r=>r.contentControl)).toBe(false); // Paint projection is still separate.
},30000);

it.each(['locked','duplicate','input-property'])('guards an unsafe %s control even in best-effort open and preserves its source',async kind=>{
 const parts=unzipSync(read('control.docx'));let xml=strFromU8(parts['word/document.xml']);
 if(kind==='locked')xml=xml.replace('<w:id w:val="201"/>','<w:id w:val="201"/><w:lock w:val="sdtContentLocked"/>');
 if(kind==='duplicate')xml=xml.replace('<w:id w:val="202"/>','<w:id w:val="201"/>');
 if(kind==='input-property')xml=xml.replace('<w:id w:val="201"/>','<w:id w:val="201"/><w:rPr><w:shd w:val="pct5" w:color="000000" w:fill="FFFFFF"/></w:rPr>');
 parts['word/document.xml']=strToU8(xml);const pkg=await DocxPackage.open(zipSync(parts),{bestEffort:true});expect(pkg.readOnly).toBeFalsy();
 const images=pkg.paragraphs.flatMap(p=>p.runs).filter(r=>r.image).map(r=>r.image),frame=pkg.drawingTextFrames(images[0])[0];expect(frame.reason).toContain('cannot be edited yet');
 expect(()=>pkg.prepareDrawingTextEdit(images[0],0,frame.paragraphs)).toThrow('cannot be edited yet');expect(pkg.drawingTextFrames(images[1]).map(f=>f.reason)).toEqual([null,null]);
 expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(parts);
},30000);
it('edits a merged-cell table while preserving its continuation XML and physical frame',async()=>{
 const pkg=await DocxPackage.open(readFileSync('tests/fixtures/shape-tables/source.docx')),image=pkg.paragraphs.flatMap(p=>p.runs).find(r=>r.image).image,frame=pkg.drawingTextFrames(image)[0];expect(frame.reason).toBeNull();
 const draft=new TextDocument(frame.paragraphs,undefined,pkg.numbering,pkg.styles,frame.tables),position=draft.text.indexOf('Merged');expect(position).toBeGreaterThanOrEqual(0);draft.select(position,position+6);draft.replace('Changed');
 const before=pkg.assets[image.assetId],prepared=pkg.prepareDrawingTextEdit(image,0,draft.paragraphs,pkg.assets,pkg.styles,pkg.numbering,draft.tables);
 expect(prepared.asset.width).toBe(before.width);expect(prepared.asset.height).toBe(before.height);expect(prepared.asset.scene.text.tables.map(t=>t.grid)).toEqual(before.scene.text.tables.map(t=>t.grid));
 expect(prepared.asset.scene.text.paragraphs.some(p=>p.runs.some(r=>r.text.includes('Changed')))).toBe(true);
 expect(prepared.asset.scene.text.tables.flatMap(t=>t.rows.flatMap(r=>r.cells)).map(c=>c.vMerge)).toEqual(before.scene.text.tables.flatMap(t=>t.rows.flatMap(r=>r.cells)).map(c=>c.vMerge));
},30000);

it('unwraps an edited temporary block around a table without losing its inner inline controls',async()=>{
 const parts=unzipSync(read('control.docx')),xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml'),frame=xml.getElementsByTagNameNS(W,'txbxContent')[0];
 const wrapper=xml.createElementNS(W,'w:sdt'),pr=xml.createElementNS(W,'w:sdtPr'),temporary=xml.createElementNS(W,'w:temporary'),id=xml.createElementNS(W,'w:id'),content=xml.createElementNS(W,'w:sdtContent');id.setAttributeNS(W,'w:val','700');pr.append(id,temporary);content.append(...frame.children);wrapper.append(pr,content);frame.append(wrapper);parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));
 const pkg=await DocxPackage.open(zipSync(parts)),image=pkg.paragraphs.flatMap(p=>p.runs).find(r=>r.image).image,descriptor=pkg.drawingTextFrames(image)[0];expect(descriptor.reason).toBeNull();
 const draft=new TextDocument(descriptor.paragraphs,undefined,pkg.numbering,pkg.styles,descriptor.tables);draft.select(draft.text.indexOf('First cell'));draft.replace('New ');
 const prepared=pkg.prepareDrawingTextEdit(image,0,draft.paragraphs,pkg.assets,pkg.styles,pkg.numbering,draft.tables);expect(prepared.shell).not.toContain('w:val="700"');expect(prepared.shell).toContain('w:val="201"');expect(prepared.shell).toContain('w:val="202"');expect(prepared.asset.scene.text.tables).toHaveLength(2);
 expect(pkg.drawingTextFrames(image)[0].paragraphs.every(p=>p.blockControls?.length)).toBe(true); // Draft did not mutate source cache.
},30000);

it('keeps formatting-only temporary and persistent controls owned without filling their prompts',async()=>{
 const pkg=await DocxPackage.open(read('control.docx')),image=pkg.paragraphs.flatMap(p=>p.runs).find(r=>r.image).image,descriptor=pkg.drawingTextFrames(image)[0],draft=new TextDocument(descriptor.paragraphs,undefined,pkg.numbering,pkg.styles,descriptor.tables);
 for(const prompt of ['Prompt A','Persistent A']){const at=draft.text.indexOf(prompt);draft.select(at,at+prompt.length);draft.setRunFormat({bold:true});}
 const edit=pkg.prepareDrawingTextEdit(image,0,draft.paragraphs,pkg.assets,pkg.styles,pkg.numbering,draft.tables);
 const xml=new DOMParser().parseFromString(edit.shell,'application/xml'),controls=activeDescendants(xml.documentElement).filter(n=>n.namespaceURI===W&&n.localName==='sdt');expect(controls).toHaveLength(2);
 expect(controls.every(n=>n.getElementsByTagNameNS(W,'showingPlcHdr').length===1)).toBe(true);expect(controls[0].getElementsByTagNameNS(W,'temporary')).toHaveLength(1);
 expect(edit.asset.scene.text.paragraphs.flatMap(p=>p.runs).filter(r=>['Prompt A','Persistent A'].includes(r.text)).every(r=>r.bold)).toBe(true);
},30000);
it('keeps a controlled drawing table edit in its header part through reopening and shared undo',async()=>{
 const parts=unzipSync(read('control.docx')),source=strFromU8(parts['word/document.xml']),drawing=source.match(/<w:drawing>[\s\S]*?<\/w:drawing>/)[0],opening=source.match(/<w:document\b[^>]*>/)[0].replace('<w:document','<w:hdr');
 parts['word/header1.xml']=strToU8(`${opening}<w:p><w:r>${drawing}</w:r></w:p></w:hdr>`);
 parts['word/document.xml']=strToU8(source.replace('<w:sectPr>','<w:sectPr><w:headerReference w:type="default" r:id="rHeader" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>'));
 parts['word/_rels/document.xml.rels']=strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>');
 parts['[Content_Types].xml']=strToU8(strFromU8(parts['[Content_Types].xml']).replace('</Types>','<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'));
 const pkg=await DocxPackage.open(zipSync(parts)),body=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets),session=new StorySession(body,pkg.pageStories),model=session.activate('word/header1.xml');model.select(0,1);
 const image=model.selectedImage,descriptor=pkg.drawingTextFrames(image)[0],draft=new TextDocument(descriptor.paragraphs,undefined,pkg.numbering,pkg.styles,descriptor.tables),at=draft.text.indexOf('Prompt A');draft.select(at,at+8);draft.replace('Header value');
 const edit=pkg.prepareDrawingTextEdit(image,0,draft.paragraphs,model.assets,model.styles,model.numbering,draft.tables);model.assets['header-table-edit']=edit.asset;session.run(()=>model.replaceDrawingText(image,'header-table-edit',edit.shell));
 const bytes=new Uint8Array(await session.export(pkg).arrayBuffer()),saved=unzipSync(bytes);for(const name of Object.keys(parts).filter(n=>n!=='word/header1.xml'))expect(saved[name]).toEqual(parts[name]);
 const reopened=await DocxPackage.open(bytes),header=reopened.pageStories.stories['word/header1.xml'].paragraphs[0].runs[0].image,frame=reopened.drawingTextFrames(header)[0];expect(frame.reason).toBeNull();expect(frame.tables).toHaveLength(2);expect(frame.paragraphs.every(p=>p.pageStory==='word/header1.xml')).toBe(true);expect(frame.paragraphs.flatMap(p=>p.runs).some(r=>r.text==='Header value')).toBe(true);
 session.undo();expect(unzipSync(new Uint8Array(await session.export(pkg).arrayBuffer()))).toEqual(parts);
},30000);
