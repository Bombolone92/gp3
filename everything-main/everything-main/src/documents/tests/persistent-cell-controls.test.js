import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage,W} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {blockControlGroups} from '../src/engine/block-controls.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const source=readFileSync('tests/fixtures/persistent-cell-controls/control.docx');
const refs=JSON.parse(readFileSync('tests/fixtures/persistent-cell-controls/native-results.json','utf8').replace(/^\uFEFF/,''));
const structures=JSON.parse(readFileSync('tests/fixtures/persistent-cell-controls/native-structure-results.json','utf8').replace(/^\uFEFF/,''));
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const parse=text=>new DOMParser().parseFromString(text,'application/xml');
const title=c=>parse(c.shell).getElementsByTagNameNS(W,'alias')[0].getAttributeNS(W,'val');
const range=(d,name)=>blockControlGroups(d.paragraphs).find(r=>title(r.control)===name);
const tree=bytes=>parse(strFromU8(unzipSync(bytes)['word/document.xml']));
const wrapper=(xml,name)=>[...xml.getElementsByTagNameNS(W,'sdt')].find(c=>c.getElementsByTagNameNS(W,'alias')[0]?.getAttributeNS(W,'val')===name);
const shape=node=>({parent:node.parentNode.localName,contents:[...node.getElementsByTagNameNS(W,'sdtContent')[0].children].map(n=>n.localName)});
const changedSource=edit=>{const parts=unzipSync(source),xml=tree(source);edit(xml);parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));return zipSync(parts);};
for(const ref of refs.cases)it(`matches native cell control ${ref.name} through export, undo and redo`,async()=>{
 const p=await DocxPackage.open(source),d=model(p),r=range(d,ref.name);
 expect(unzipSync(await save(p,d))).toEqual(p.parts);
 switch(ref.name){
  case 'insert':d.select(r.start+2);d.replace('NEW ');break;
  case 'split':d.select(r.start+5);d.replace('\n');break;
  case 'format':d.select(r.start,r.start+5);d.toggleBold();break;
  case 'delete-all':d.select(r.start,r.end);d.replace('');break;
  default:d.select(r.start,r.end);d.replace('Edited value');
 }
 const bytes=await save(p,d),reopened=model(await DocxPackage.open(bytes));
 for(const current of [d,reopened]){
  expect(blockControlGroups(current.paragraphs)).toHaveLength(8);
  const actual=range(current,ref.name);
  expect(current.text.slice(actual.start,actual.end)).toBe(ref.after.replaceAll('\r','\n'));
  expect(actual.control.placeholder).toBe(ref.placeholder);
  expect(actual.control.kind).toBe('cell');
  if(ref.name==='split')expect(actual.paragraphs).toHaveLength(2);
  if(ref.name==='format')expect(actual.paragraphs[0].runs[0]).toMatchObject({text:'Alpha',bold:true});
 }
 expect(shape(wrapper(tree(bytes),ref.name))).toEqual({parent:'tr',contents:['tc']});
 for(const[n,b]of Object.entries(p.parts))if(n!=='word/document.xml')expect(unzipSync(bytes)[n]).toEqual(b);
 d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
 d.redo();expect(d.text).toBe(reopened.text);
},30000);
it.each([false,true])('converts a merged cell control without absorbing its neighbor (control on right: %s)',async right=>{
 const bytes=right?changedSource(xml=>{const s=wrapper(xml,'insert');s.parentNode.append(s);}):source;
 const p=await DocxPackage.open(bytes),d=model(p),r=range(d,'insert');
 const row=d.tables[0].rows[0],ids=new Set(row.cells.map(c=>c.id)),ps=d.paragraphs.filter(p=>ids.has(p.cellId));
 const start=d.paragraphOffset(d.paragraphs.indexOf(ps[0])),end=d.paragraphOffset(d.paragraphs.indexOf(ps.at(-1)))+ps.at(-1).runs.reduce((n,r)=>n+r.text.length,0);
 d.select(start,end);d.mergeCells();
 const out=await save(p,d),actual=shape(wrapper(tree(out),'insert'));
 const native=structures.cases.find(c=>c.name==='merge-controlled-first');
 expect(actual).toEqual({parent:native.afterShape.parent,contents:native.afterShape.contents});
 for(const current of [d,model(await DocxPackage.open(out))]){
  const group=range(current,'insert');expect(current.text.slice(group.start,group.end)).toBe(native.controlText);
  expect(group.control.kind).not.toBe('cell');expect(current.tables[0].rows[0].cells).toHaveLength(native.cellCount);
  expect(current.text).toContain(right?'Ordinary neighbor\nAlpha beta':'Alpha beta\nOrdinary neighbor');
 }
 d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
 d.redo();expect(shape(wrapper(tree(await save(p,d)),'insert'))).toEqual(actual);
});
it('splits a spanning cell without duplicating its persistent wrapper',async()=>{
 const bytes=changedSource(xml=>{
  const s=wrapper(xml,'insert'),tc=s.getElementsByTagNameNS(W,'tc')[0],grid=s.parentNode.parentNode.getElementsByTagNameNS(W,'tblGrid')[0];
  grid.append(grid.firstElementChild.cloneNode(true));const span=xml.createElementNS(W,'w:gridSpan');span.setAttributeNS(W,'w:val','2');tc.firstElementChild.append(span);
 });
 const p=await DocxPackage.open(bytes),d=model(p),r=range(d,'insert');d.select(r.start);d.splitCell();
 const native=structures.cases.find(c=>c.name==='split-controlled'),out=await save(p,d);
 expect(d.tables[0].rows[0].cells).toHaveLength(native.cellCount);
 expect(shape(wrapper(tree(out),'insert'))).toEqual({parent:native.afterShape.parent,contents:native.afterShape.contents});
 const again=model(await DocxPackage.open(out));expect(blockControlGroups(again.paragraphs)).toHaveLength(8);expect(again.text).toBe(d.text);
 d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
it.each(['row','column','table'])('deletes the containing %s without orphaning its wrapper',async kind=>{
 const p=await DocxPackage.open(source),d=model(p);d.select(range(d,'insert').start);d.deleteTablePart(kind);
 expect(range(d,'insert')).toBeUndefined();const out=await save(p,d),again=model(await DocxPackage.open(out));
 expect(range(again,'insert')).toBeUndefined();expect(blockControlGroups(again.paragraphs)).toHaveLength(7);expect(again.text).toBe(d.text);
 if(kind!=='column')expect(again.tables).toHaveLength(structures.cases.find(c=>c.name==='delete-controlled-row').tableCount);
 d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
it.each(['Edited',''])('preserves cell ownership in search replacement %j',async text=>{
 const p=await DocxPackage.open(source),d=model(p);expect(d.replaceMatches('Alpha beta',text,{},true)).toBe(8);
 const out=await save(p,d),again=model(await DocxPackage.open(out));expect(again.text).toBe(d.text);expect(blockControlGroups(again.paragraphs)).toHaveLength(8);
 d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
it('matches native vertical merge conversion and retains it when the merged row is deleted',async()=>{
 const p=await DocxPackage.open(source),d=model(p);d.select(range(d,'insert').start);d.insertTableRow();d.replace('Lower neighbor');
 d.select(range(d,'insert').start);d.mergeCellBelow();
 const native=structures.cases.find(c=>c.name==='merge-vertical');
 const out=await save(p,d);expect(shape(wrapper(tree(out),'insert'))).toEqual({parent:native.afterShape.parent,contents:native.afterShape.contents});
 const again=model(await DocxPackage.open(out));expect(again.text).toBe(d.text);expect(d.text.slice(range(d,'insert').start,range(d,'insert').end)).toBe(native.controlText);
 d.select(range(d,'insert').start+2);d.replace('Added ');d.select(range(d,'insert').start);d.deleteTablePart('row');
 const promoted=model(await DocxPackage.open(await save(p,d)));expect(promoted.text).toBe(d.text);expect(range(promoted,'insert')).toBeDefined();
 expect(promoted.text.slice(range(promoted,'insert').start,range(promoted,'insert').end)).toBe('AlAdded pha beta');
 for(let i=0;i<5;i++)d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
it.each(['row','column'])('does not copy persistent controls into inserted %ss',async kind=>{
 const p=await DocxPackage.open(source),d=model(p);d.select(range(d,'insert').start);
 if(kind==='row')d.insertTableRow();else d.insertTableColumn();
 const again=model(await DocxPackage.open(await save(p,d)));expect(blockControlGroups(again.paragraphs)).toHaveLength(8);expect(again.text).toBe(d.text);
 d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
it('rejects an unsupported nested table before mutating a persistent cell',async()=>{
 const p=await DocxPackage.open(source),d=model(p);d.select(range(d,'insert').start+2);const before=d.snapshot(),history=d.history.length;
 expect(()=>d.insertTable(2,2,3000)).toThrow('persistent content controls');expect(d.snapshot()).toEqual(before);expect(d.history).toHaveLength(history);
});
it('retains placeholder state when its right-hand cell moves into a merged cell',async()=>{
 const bytes=changedSource(xml=>{const s=wrapper(xml,'placeholder');s.parentNode.append(s);});
 const p=await DocxPackage.open(bytes),d=model(p),r=range(d,'placeholder'),first=d.paragraphs.findIndex(p=>p.cellId===d.tables[5].rows[0].cells[0].id);
 d.select(d.paragraphOffset(first),r.end);d.mergeCells();
 const out=await save(p,d),again=model(await DocxPackage.open(out));
 for(const current of [d,again]){const group=range(current,'placeholder');expect(group.control.placeholder).toBe(true);expect(current.text.slice(group.start,group.end)).toBe('Alpha beta\nSecond paragraph');}
 d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
it('restores multi-paragraph glossary prompts inside cells with their run formatting',async()=>{
 const parts=unzipSync(readFileSync('tests/fixtures/multiparagraph-placeholder/control.docx')),xml=parse(strFromU8(parts['word/document.xml']));
 for(const s of [...xml.getElementsByTagNameNS(W,'sdt')].filter(n=>n.parentNode.localName==='body')){
  const table=parse(`<w:tbl xmlns:w="${W}"><w:tblPr><w:tblW w:w="7200" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="7200"/></w:tblGrid><w:tr/></w:tbl>`).documentElement;
  const node=xml.importNode(table,true),content=s.getElementsByTagNameNS(W,'sdtContent')[0],cell=xml.createElementNS(W,'w:tc');
  cell.append(...content.childNodes);content.append(cell);s.parentNode.replaceChild(node,s);node.lastElementChild.append(s);
 }
 parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));const p=await DocxPackage.open(zipSync(parts)),d=model(p),r=range(d,'filled');
 d.select(r.start,r.end);d.replace('');const again=model(await DocxPackage.open(await save(p,d)));
 for(const current of [d,again]){const restored=range(current,'filled');expect(restored.control.placeholder).toBe(true);expect(restored.control.kind).toBe('cell');expect(restored.paragraphs).toHaveLength(2);expect(restored.paragraphs[0].runs[0].bold).toBe(true);expect(restored.paragraphs[1].runs[0].italic).toBe(true);}
 expect(again.text).toBe(d.text);d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
it('keeps a separately controlled vertical continuation read-only rather than losing its wrapper on splitting',async()=>{
 const bytes=changedSource(xml=>{
  const s=wrapper(xml,'insert'),pr=s.getElementsByTagNameNS(W,'tcPr')[0],merge=xml.createElementNS(W,'w:vMerge');pr.append(merge);
 });
 await expect(DocxPackage.open(bytes)).rejects.toThrow('persistent controls on vertical continuation cells');
});
