import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage, W } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { fontMetrics } from '../src/engine/font-metrics.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
const source = name => readFileSync(`public/fixtures/${name}.docx`);
const model = p => new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const open = async (name = 'table-bookmarks') => { const p = await DocxPackage.open(source(name)); return [p,model(p)]; };
const save = async (p,d) => new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const xml = bytes => new DOMParser().parseFromString(strFromU8(unzipSync(bytes)['word/document.xml']), 'application/xml');
const nodes = (n,name) => [...n.getElementsByTagNameNS(W,name)];
const ranges = d => d.bookmarks.map(b => [b.name,d.text.slice(b.start,b.end)]);
const pairs = d => d.bookmarks.map(b => [b.name,b.start,b.end]);
const geometry = d => layoutDocument(d.paragraphs,(text,style) => ({...fontMetrics(style),width: text.length * style.fontSize * 2/3}),pageGeometry(d.pageSettings),d.numbering,d.tables);
const replaceXml = change => { const parts=unzipSync(source('table-bookmarks')),root=xml(source('table-bookmarks'));change(root);parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(root));return zipSync(parts); };
function markerPositions(root) {
 const result=[]; let position=0;
 const walk = n => { if(n.namespaceURI===W && ['bookmarkStart','bookmarkEnd'].includes(n.localName))result.push([n.localName,n.getAttributeNS(W,'id'),n.parentNode.localName,position]);if(n.namespaceURI===W && n.localName==='t')position+=n.textContent.length;for(const c of n.children)walk(c);if(n.namespaceURI===W && n.localName==='p')position++; };walk(root.documentElement);return result;
}
it('reads crossing, overlapping, point and whole-row ranges in XML order without changing layout',async()=>{
 const [p,d]=await open();expect(ranges(d)).toEqual([
  ['IntoTable','table\nAlpha\nBeta\nGamma\nDelta\nEpsilon\nZeta\n'],['AllRows','Alpha\nBeta\nGamma\nDelta\nEpsilon\nZeta\n'],['FirstRow','Alpha\nBeta\n'],['AcrossRows','Beta\nGamma\nDelta\n'],['Overlap','mma\nDelta\n'],['RowPoint',''],['OutOfTable','Zeta\nAfter table\n']]);
 const before=geometry(d);for(const paragraph of d.paragraphs)delete paragraph.bookmarks;expect(geometry(d)).toEqual(before);
 expect(unzipSync(await save(p,model(p)))).toEqual(unzipSync(source('table-bookmarks')));
});
it.each(['format','text','split','search','rename','remove'])('round-trips structural markers through %s and exact undo',async operation=>{
 const [p,d]=await open();d.select(d.text.indexOf('Alpha')+2);
 if(operation==='format'){d.select(d.text.indexOf('Alpha'),d.text.indexOf('Alpha')+5);d.toggleBold();}
 if(operation==='text')d.replace('X');
 if(operation==='split')d.replace('\n');
 if(operation==='search')d.replaceMatches('a','expanded',{},true);
 if(operation==='rename')d.renameBookmark('3','RenamedRow');
 if(operation==='remove')d.removeBookmark('3');
 const bytes=await save(p,d),again=model(await DocxPackage.open(bytes));expect(again.text).toBe(d.text);expect(pairs(again)).toEqual(pairs(d));
 if(operation==='format')expect(markerPositions(xml(bytes))).toEqual(markerPositions(xml(source('table-bookmarks'))));
 if(operation==='rename')expect(again.paragraphs.flatMap(p=>p.runs).find(r=>r.text==='Go to first row').link.anchor).toBe('RenamedRow');
 d.undo();expect(unzipSync(await save(p,d))).toEqual(unzipSync(source('table-bookmarks')));
});
it.each(['insert row','insert column','delete row','delete column','merge cells','merge rows','split cell','delete table'])('retains valid boundary ranges through %s without duplicate IDs',async operation=>{
 const [p,d]=await open();d.select(d.text.indexOf('Alpha')+2);
 if(operation==='insert row')d.insertTableRow();
 if(operation==='insert column')d.insertTableColumn();
 if(operation==='delete row')d.deleteTablePart('row');
 if(operation==='delete column')d.deleteTablePart('column');
 if(operation==='merge cells'||operation==='split cell'){d.select(d.text.indexOf('Alpha'),d.text.indexOf('Beta')+4);d.mergeCells();if(operation==='split cell')d.splitCell();}
 if(operation==='merge rows')d.mergeCellBelow();
 if(operation==='delete table')d.deleteTablePart('table');
 const bytes=await save(p,d),again=model(await DocxPackage.open(bytes));expect(again.text).toBe(d.text);expect(pairs(again)).toEqual(pairs(d));
 if(operation==='merge rows')expect(ranges(d).find(([name])=>name==='AcrossRows')[1]).toBe('Gamma\nBeta\nDelta\n');
 expect(new Set(again.bookmarks.map(b=>b.id)).size).toBe(again.bookmarks.length);
 while(d.history.length)d.undo();expect(unzipSync(await save(p,d))).toEqual(unzipSync(source('table-bookmarks')));
});
it('moves an end marker after an appended row, matching the native reference insertion affinity',async()=>{
 const [p,d]=await open();const end=d.bookmarks.find(b=>b.name==='AllRows').end;d.select(d.text.indexOf('Zeta'));d.insertTableRow();
 expect(d.bookmarks.find(b=>b.name==='AllRows').end).toBe(end+2);const out=xml(await save(p,d));const marker=nodes(out,'bookmarkEnd').find(n=>n.getAttributeNS(W,'id')==='2');expect(marker.previousElementSibling.localName).toBe('tr');expect(nodes(marker.parentNode,'tr')).toHaveLength(4);expect(marker.nextElementSibling.localName).toBe('bookmarkEnd');expect(marker.nextElementSibling.nextElementSibling).toBeNull();
});
it('retains markers around empty vertical continuation rows and cells without inventing editable paragraphs',async()=>{
 const [p,d]=await open('table-bookmarks-merged');expect(d.paragraphs).toHaveLength(6);expect(d.bookmarks).toHaveLength(3);expect(d.bookmarks.every(b=>b.start===b.end)).toBe(true);
 d.select(d.text.indexOf('Next')+2);d.replace('X');const bytes=await save(p,d),again=model(await DocxPackage.open(bytes));expect(pairs(again)).toEqual(pairs(d));
 const a=markerPositions(xml(source('table-bookmarks-merged'))),b=markerPositions(xml(bytes));expect(b).toEqual(a);
 d.undo();expect(unzipSync(await save(p,d))).toEqual(unzipSync(source('table-bookmarks-merged')));
});
it('moves a before-row boundary into inline text if typing at its start excludes inserted text',async()=>{
 const [p,d]=await open();d.select(d.text.indexOf('Alpha'));d.replace('X');const b=d.bookmarks.find(b=>b.name==='AllRows');expect(d.text.slice(b.start,b.end).startsWith('Alpha')).toBe(true);
 const bytes=await save(p,d);expect(pairs(model(await DocxPackage.open(bytes)))).toEqual(pairs(d));expect(nodes(xml(bytes),'bookmarkStart').find(n=>n.getAttributeNS(W,'id')==='2').parentNode.localName).toBe('p');
});
it.each(['unmatched','duplicate','content','attribute'])('rejects unsupported or malformed %s markers before editing',async kind=>{
 const bytes=replaceXml(root=>{const n=nodes(root,'bookmarkStart').find(n=>n.getAttributeNS(W,'id')==='2');if(kind==='columns'){n.setAttributeNS(W,'w:colFirst','0');n.setAttributeNS(W,'w:colLast','1');}if(kind==='unmatched')n.remove();if(kind==='duplicate')n.parentNode.insertBefore(n.cloneNode(true),n);if(kind==='content')n.appendChild(root.createElementNS(W,'w:r'));if(kind==='attribute')n.setAttributeNS(W,'w:invalid','1');});await expect(DocxPackage.open(bytes)).rejects.toThrow();
});
it.each(['split','insert row','delete owner row','delete column'])('preserves empty continuation boundary pairs through %s',async operation=>{
 const [p,d]=await open('table-bookmarks-merged');d.select(d.text.indexOf('Owner'));
 if(operation==='split')d.splitCell();if(operation==='insert row')d.insertTableRow();if(operation==='delete owner row')d.deleteTablePart('row');if(operation==='delete column')d.deleteTablePart('column');
 const bytes=await save(p,d),again=model(await DocxPackage.open(bytes));expect(again.text).toBe(d.text);expect(pairs(again)).toEqual(pairs(d));d.undo();expect(unzipSync(await save(p,d))).toEqual(unzipSync(source('table-bookmarks-merged')));
});
it('preserves a leading marker before table properties when serializing an edit',async()=>{
 const bytes=replaceXml(root=>{const table=nodes(root,'tbl')[0],marker=nodes(root,'bookmarkStart').find(n=>n.getAttributeNS(W,'id')==='2');table.insertBefore(marker,table.firstChild);});const p=await DocxPackage.open(bytes),d=model(p);d.select(d.text.indexOf('Alpha')+2);d.replace('X');const saved=await save(p,d);expect(nodes(xml(saved),'tbl')[0].firstElementChild.localName).toBe('bookmarkStart');expect(pairs(model(await DocxPackage.open(saved)))).toEqual(pairs(d));d.undo();expect(unzipSync(await save(p,d))).toEqual(unzipSync(bytes));
});
it('rejects bookmarks inside hidden continuation paragraphs instead of dropping their ranges',async()=>{
 const parts=unzipSync(source('table-bookmarks-merged')),root=xml(source('table-bookmarks-merged')),continuation=nodes(root,'vMerge').find(n=>n.getAttributeNS(W,'val')==='continue').parentNode.parentNode;
 const p=nodes(continuation,'p')[0];for(const name of ['bookmarkStart','bookmarkEnd']){const n=root.createElementNS(W,'w:'+name);n.setAttributeNS(W,'w:id','99');if(name==='bookmarkStart')n.setAttributeNS(W,'w:name','InsideContinuation');p.appendChild(n);}parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(root));await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow('vertical continuations containing text, numbering or bookmarks');
});
it('retains every range in a large sequence of bookmarked rows after an interior edit',async()=>{
 const parts=unzipSync(source('table-bookmarks')),count=512;
 const rows=Array.from({length:count},(_,i)=>`<w:bookmarkStart w:id="${i}" w:name="Row${i}"/><w:tr>${['left','right'].map(side=>`<w:tc><w:tcPr><w:tcW w:w="2880" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Row ${i} ${side}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr><w:bookmarkEnd w:id="${i}"/>`).join('');
 parts['word/document.xml']=strToU8(`<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblW w:w="5760" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="2880"/><w:gridCol w:w="2880"/></w:tblGrid>${rows}</w:tbl><w:p/></w:body></w:document>`);
 const p=await DocxPackage.open(zipSync(parts)),d=model(p);d.select(d.text.indexOf('Row 256 right')+4);d.replace('X');const again=model(await DocxPackage.open(await save(p,d)));expect(pairs(again)).toEqual(pairs(d));expect(ranges(again)).toEqual(Array.from({length:count},(_,i)=>[`Row${i}`,`Row ${i} left\nRow ${i===256?'X':''}${i} right\n`]));
 d.undo();expect(unzipSync(await save(p,d))).toEqual(parts);
// The 512-row import/edit/export control exceeds 15s on Windows even on the
// unchanged baseline; allow its preservation assertions to finish.
}, 120000);
