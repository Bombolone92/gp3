import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';import {readFileSync} from 'node:fs';import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';import {layoutDocument} from '../src/engine/layout.js';import {pageGeometry} from '../src/engine/page-settings.js';
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>dom.window.close());
const folder='tests/fixtures/multipage-floating-preview/';
const measure=(text,style)=>({width:text.length*style.fontSize*.5,ascent:style.fontSize,descent:style.fontSize*.25});
for(const mode of ['vertical','multiple'])it(`${mode}: preserves the rich package and locally approximates unsupported floating flow`,async()=>{
 const bytes=readFileSync(folder+mode+'-unsupported.docx'),pkg=await DocxPackage.open(bytes),control=await DocxPackage.open(readFileSync(folder+mode+'-matched.docx'));
 const before=JSON.stringify({paragraphs:pkg.paragraphs,tables:pkg.tables});
 const layout=(p,bestEffort=false)=>layoutDocument(p.paragraphs,measure,pageGeometry(p.pageSettings),p.numbering,p.tables,p.pageStories,{bestEffort});
 expect(()=>layout(pkg)).toThrow(/Multi-page floating tables with aligned positions/);
 const actual=layout(pkg,true),expected=layout(control);
 const geometry=l=>JSON.parse(JSON.stringify({lines:l.lines,cells:l.cells,repeatedLines:l.repeatedLines,tableBorders:l.tableBorders},(key,value)=>['id','paragraphId','cellId','cellIds','rowId','tableId','parentCellId'].includes(key)?undefined:value));
 expect(geometry(actual)).toEqual(geometry(expected));
 expect(actual.pageCount).toBe(expected.pageCount);expect(actual.pageCount).toBeGreaterThan(1);
 expect(actual.floatingTableApproximations).toHaveLength(mode==='multiple'?2:1);
 expect(actual.floatingTableApproximations.every(a=>a.message.includes('ordinary flow'))).toBe(true);
 expect(JSON.stringify({paragraphs:pkg.paragraphs,tables:pkg.tables})).toBe(before);
 expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(unzipSync(bytes));
},30000);

it('horizontal: retains the rich table, pictures and original package on the supported path', async () => {
 const bytes=readFileSync(folder+'horizontal-unsupported.docx'),pkg=await DocxPackage.open(bytes);
 const before=JSON.stringify({paragraphs:pkg.paragraphs,tables:pkg.tables});
 const result=layoutDocument(pkg.paragraphs,measure,pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables,pkg.pageStories);
 expect(result.pageCount).toBeGreaterThan(1);
 expect(result.floatingTableApproximations).toBeUndefined();
 expect(result.floatingTables.length).toBeGreaterThan(1);
 expect(pkg.tables).toHaveLength(2);
 expect(Object.keys(pkg.assets)).toHaveLength(2);
 expect(JSON.stringify({paragraphs:pkg.paragraphs,tables:pkg.tables})).toBe(before);
 expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(unzipSync(bytes));
},30000);
