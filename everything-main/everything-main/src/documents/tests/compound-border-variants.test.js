import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { borderWidth } from '../src/engine/paragraph-borders.js';
import { borderBands } from '../src/engine/border-patterns.js';
import { tableBorderWidth, winningTableBorder } from '../src/engine/table-border-layout.js';
const reference = JSON.parse(readFileSync('tests/fixtures/compound-border-variants/reference.json', 'utf8'));
const mediumReference = JSON.parse(readFileSync('tests/fixtures/thin-thick-medium/reference.json', 'utf8'));
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
it.each([...reference.cases,...mediumReference.cases])('matches native ink and gap widths: $style $size frame=$frame', c => {
  const edge = { style:c.style, size:c.size, frame:c.frame };
  for (const native of c.horizontalBands) {
    const width = native.context === 'table' ? tableBorderWidth(edge) : borderWidth(edge);
    const bands = borderBands(edge, width, native.side);
    expect(bands).toHaveLength(2);
    // The reference export's serialized path bounds have up to 0.024 pt coordinate rounding.
    expect(Math.abs(bands[0][1] * .75 - native.first)).toBeLessThan(.03);
    expect(Math.abs((bands[1][0] - bands[0][1]) * .75 - native.gap)).toBeLessThan(.03);
    expect(Math.abs(bands[1][1] * .75 - native.last)).toBeLessThan(.03);
  }
});
// This 42-table fixture performs six complete edit/reopen/undo cycles. A loaded
// local host can exceed 30 seconds without failing any fidelity assertion.
it('preserves all source parts, edits every new paragraph/cell style and undoes exactly', async () => {
  const p = await DocxPackage.open(readFileSync('tests/fixtures/compound-border-variants/control.docx'));
  const d = new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
  expect(d.tables).toHaveLength(42);
  const save = async () => new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
  const same = bytes => { const parts=unzipSync(bytes); expect(Object.keys(parts).sort()).toEqual(Object.keys(p.parts).sort()); for(const [n,b] of Object.entries(p.parts)) expect(Buffer.from(parts[n]).equals(Buffer.from(b)),n).toBe(true); };
  same(await save());
  for (const [i, style] of ['thinThickSmallGap','thickThinSmallGap','thickThinMediumGap'].entries()) {
    const border = {style,size:13,space:0,color:'CC3300',frame:false,shadow:false};
    d.selectCell(d.tables[i*14].rows[0].cells[0].id); d.setCellBorders({top:border});
    let again = await DocxPackage.open(await save());
    expect(again.tables[i*14].rows[0].cells[0].borders.top).toMatchObject(border);
    d.undo(); same(await save());
    const index = d.paragraphs.findIndex(p=>p.format.paragraphBorders?.top?.style===style);
    const at = d.paragraphs.slice(0,index).reduce((n,p)=>n+p.runs.reduce((n,r)=>n+r.text.length,0)+1,0);
    d.select(at,at);d.setParagraphFormat({paragraphBorders:{top:border}});
    again = await DocxPackage.open(await save());
    expect(again.paragraphs[index].format.paragraphBorders.top).toMatchObject(border);
    d.undo();same(await save());
  }
}, 120000);
it.each([['thinThickSmallGap',11],['thickThinSmallGap',12],['thinThickMediumGap',14],['thickThinMediumGap',15]])('resolves shared-edge weight for %s', (style,rank) => {
 const edge=(style,size)=>({border:{style,size,color:'000000'},order:0});
 const a=edge(style,2),b=edge('single',2*rank);
 expect(winningTableBorder(a,edge('single',2*rank-1))).toBe(a);
 expect(winningTableBorder(a,b)).toBe(b);
});
it('edits medium thin/thick paragraph and cell borders, preserves unrelated parts and undoes exactly',async()=>{
 const bytes=readFileSync('tests/fixtures/thin-thick-medium/control.docx'),p=await DocxPackage.open(bytes);
 const d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets),parts=unzipSync(bytes);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 expect(unzipSync(await save())).toEqual(parts);
 const border={style:'thinThickMediumGap',size:13,space:0,color:'CC3300',frame:false,shadow:false};
 d.selectCell(d.tables[0].rows[0].cells[0].id);d.setCellBorders({top:border});
 let exported=await save(),reopened=await DocxPackage.open(exported);
 expect(reopened.tables[0].rows[0].cells[0].borders.top).toMatchObject(border);
 for(const[n,b]of Object.entries(parts))if(n!=='word/document.xml')expect(unzipSync(exported)[n],n).toEqual(b);
 d.undo();expect(unzipSync(await save())).toEqual(parts);
 const index=d.paragraphs.findIndex(p=>p.format.paragraphBorders?.top),at=d.paragraphs.slice(0,index).reduce((n,p)=>n+p.runs.reduce((n,r)=>n+r.text.length,0)+1,0);
 d.select(at);d.setParagraphFormat({paragraphBorders:{top:border}});reopened=await DocxPackage.open(await save());
 expect(reopened.paragraphs[index].format.paragraphBorders.top).toMatchObject(border);
 d.undo();expect(unzipSync(await save())).toEqual(parts);
},30000);
