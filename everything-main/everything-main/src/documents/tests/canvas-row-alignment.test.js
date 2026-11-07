import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';
import {DocxPackage,W} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
const source=readFileSync('public/fixtures/table-row-alignment.docx');
const reference=JSON.parse(readFileSync('tests/fixtures/table-row-alignment/reference.json','utf8'));
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const layout=d=>layoutDocument(d.paragraphs,(text,s)=>({width:text.length*s.fontSize*.5,ascent:s.fontSize,descent:s.fontSize/3}),pageGeometry(d.pageSettings),d.numbering,d.tables);
const aligns=t=>t.rows.map(r=>r.alignment??t.alignment);
function sameParts(bytes){const actual=unzipSync(bytes),expected=unzipSync(source);for(const name of Object.keys(expected))expect(Buffer.from(actual[name]).equals(Buffer.from(expected[name])),name).toBe(true);}
function change(fn){const parts=unzipSync(source),xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');fn(xml);parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));return zipSync(parts);}
it('matches all 36 native reference horizontal origins, including direct, exception and style precedence',async()=>{
 const p=await DocxPackage.open(source),d=model(p),result=layout(d);
 expect(d.tables.map(aligns)).toEqual([['center','right','left'],['left','center','right'],['center','center','center'],['left','center','right'],['right','left','center'],['left','left','left']]);
 for(const ref of reference.text){const line=result.lines.find(l=>l.fragments.map(f=>f.text).join('')===ref.text);expect(line,ref.text).toBeTruthy();expect(Math.abs(line.fragments[0].x*.75-ref.x),ref.text).toBeLessThan(.3);}
 sameParts(await save(p,d));
});
it('aligns every row even when the requested value equals the table default; preserves undo and reopening',async()=>{
 const p=await DocxPackage.open(source),d=model(p),t=d.tables[0];d.selectCell(t.rows[0].cells[0].id);
 expect(d.mergeBelowContext).toBeNull();expect(()=>d.mergeCellBelow()).toThrow(/alignment/);expect(d.history).toHaveLength(0);
 expect(d.setTableProperties({alignment:'left'})).toBe(true);expect(aligns(t)).toEqual(['left','left','left']);
 const reopened=model(await DocxPackage.open(await save(p,d)));expect(aligns(reopened.tables[0])).toEqual(['left','left','left']);
 expect(d.mergeBelowContext).not.toBeNull();d.undo();sameParts(await save(p,d));
});
it('does not collapse conflicting borders of physically disjoint rows',async()=>{
 const d=model(await DocxPackage.open(source)),t=d.tables[0];
 for(const cell of t.rows[0].cells)cell.borders.bottom={style:'dotted',size:64,color:'FF0000'};
 for(const cell of t.rows[1].cells)cell.borders.top={style:'single',size:8,color:'000000'};
 const cells=layout(d).cells,a=cells.find(c=>c.id===t.rows[0].cells[0].id),b=cells.find(c=>c.id===t.rows[1].cells[0].id);
 expect(a.borderInsets.bottom).toBeCloseTo(8*4/3/2);expect(b.borderInsets.top).toBeCloseTo(a.borderInsets.bottom);
});
it('preserves row overrides during row insertion, deletion, surrounding edits and round trips',async()=>{
 const p=await DocxPackage.open(source),d=model(p),t=d.tables[0];d.selectCell(t.rows[1].cells[0].id);d.insertTableRow();
 expect(aligns(t)).toEqual(['center','right','right','left']);d.replace('Added');
 const reopened=model(await DocxPackage.open(await save(p,d)));expect(aligns(reopened.tables[0])).toEqual(aligns(t));expect(reopened.text).toContain('Added');
 d.deleteTablePart('row');expect(aligns(t)).toEqual(['center','right','left']);d.undo();d.undo();d.undo();sameParts(await save(p,d));
});
it('positions nested row overrides inside their containing cell and serializes newly created rows',async()=>{
 const p=await DocxPackage.open(source),d=model(p);d.selectCell(d.tables[0].rows[0].cells[0].id);d.insertTable(2,1,1400);
 const t=d.tables.at(-1);t.grid=[600];t.width={type:'dxa',value:600};for(const row of t.rows)row.cells[0].width={type:'dxa',value:600};t.rows[0].alignment='right';t.rows[1].alignment='left';
 const result=layout(d),a=result.cells.find(c=>c.id===t.rows[0].cells[0].id),b=result.cells.find(c=>c.id===t.rows[1].cells[0].id);
 expect(a.x).toBeGreaterThan(b.x);const reopened=model(await DocxPackage.open(await save(p,d)));expect(aligns(reopened.tables.find(t=>t.parentCellId))).toEqual(['right','left']);
});
it.each([
 ['bad value',xml=>xml.querySelector('trPr jc').setAttributeNS(W,'w:val','both')],
 ['missing value',xml=>xml.querySelector('trPr jc').removeAttributeNS(W,'val')],
 ['duplicate',xml=>{const n=xml.querySelector('trPr jc');n.parentElement.append(n.cloneNode(true));}],
 ['content',xml=>xml.querySelector('trPr jc').append('invalid')],
 ['unknown attribute',xml=>xml.querySelector('trPr jc').setAttribute('unsupported','1')],
])('guards malformed row justification: %s',async(_,fn)=>{await expect(DocxPackage.open(change(fn))).rejects.toMatchObject({name:'UnsupportedDocumentError'});});
