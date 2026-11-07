import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const source=readFileSync('tests/fixtures/column-bookmarks/collapsed.docx');
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
it('imports collapsed column metadata without dropping source markers and distinguishes active ranges',async()=>{
 const p=await DocxPackage.open(source),d=model(p);
 expect(d.bookmarks.map(b=>[b.name,b.start===b.end])).toEqual([['CollapsedCell',true],['CollapsedInline',true]]);
 expect(unzipSync(await save(p,d))).toEqual(unzipSync(source));
 const active=model(await DocxPackage.open(readFileSync('tests/fixtures/column-bookmarks/control.docx')));
 expect(active.bookmarks.filter(b=>b.columnRange)).toHaveLength(4);
});
it.each(['text','split','insert row','insert column','delete row','delete column','rename','remove'])('preserves point semantics and exact undo through %s',async operation=>{
 const p=await DocxPackage.open(source),d=model(p);const point=d.bookmarks[0];d.select(point.start);
 if(operation==='text')d.replace('Added ');
 if(operation==='split')d.replace('\n');
 if(operation==='insert row')d.insertTableRow();
 if(operation==='insert column')d.insertTableColumn();
 if(operation==='delete row')d.deleteTablePart('row');
 if(operation==='delete column')d.deleteTablePart('column');
 if(operation==='rename')d.renameBookmark(point.id,'RenamedPoint');
 if(operation==='remove')d.removeBookmark(point.id);
 const bytes=await save(p,d),again=model(await DocxPackage.open(bytes));
 expect(again.text).toBe(d.text);
 expect(again.bookmarks.map(b=>[b.name,b.start,b.end])).toEqual(d.bookmarks.map(b=>[b.name,b.start,b.end]));
 for(const b of again.bookmarks){expect(b.start).toBe(b.end);expect(b.startMarker.tableColumns).toBeDefined();}
 const out=unzipSync(bytes),original=unzipSync(source);if(['rename','remove'].includes(operation)){for(const name of Object.keys(original))if(name!=='word/document.xml')expect(out[name],name).toEqual(original[name]);}else expectBodyEditParts(out,original);
 d.undo();expect(unzipSync(await save(p,d))).toEqual(original);
});
