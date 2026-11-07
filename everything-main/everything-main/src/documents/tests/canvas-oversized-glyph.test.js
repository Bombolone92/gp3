import {it,expect,beforeAll,afterAll} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {layoutDocument,caretRect,hitTest,selectionRects} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const source=readFileSync('public/fixtures/oversized-glyph.docx');
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const measure=(t,s)=>({width:[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(t)].length*(s.fontSize*.8+s.characterSpacing*4/3),ascent:s.fontSize,descent:s.fontSize/4});
const layout=d=>layoutDocument(d.paragraphs,measure,pageGeometry(d.pageSettings),d.numbering,d.tables);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
it('keeps fixed widths and clips caret, selection and ink bounds for oversized text',async()=>{
 const p=await DocxPackage.open(source),d=model(p),result=layout(d);
 for(const t of d.tables){
  const cell=t.rows[0].cells[1],box=result.cells.find(c=>c.id===cell.id),lines=result.lines.filter(l=>l.cellId===cell.id);
  expect(t.grid).toEqual([1440,540,7380]);expect(lines.map(l=>l.fragments.map(f=>f.text).join(''))).toEqual(['T','T']);
  for(const l of lines){
   expect(l.textClip).toEqual({left:box.x,right:box.x+box.width});
   expect(l.stops.at(-1).x).toBeLessThanOrEqual(box.x+box.width);
   expect(caretRect(result,l.end,'backward').x).toBeLessThanOrEqual(box.x+box.width);
   expect(selectionRects(result,l.start,l.end).every(r=>r.x+r.width<=box.x+box.width)).toBe(true);
   expect(selectionRects(result,l.start,l.end+1).filter(r=>r.page===l.page && r.y===l.y).every(r=>r.x+r.width<=box.x+box.width)).toBe(true);
   expect(hitTest(result,l.page,box.x+box.width-1,l.y+l.height/2)).toBe(l.end);
  }
 }
});
it('keeps combining graphemes intact through cell edits, export, reopen and undo',async()=>{
 const p=await DocxPackage.open(source),d=model(p);
 d.selectCell(d.tables[0].rows[0].cells[1].id);d.select(d.selection.focus,d.selection.focus+2);const before=d.snapshot();d.replace('A\u0301T');
 const lines=layout(d).lines.filter(l=>l.cellId===d.tables[0].rows[0].cells[1].id);
 expect(lines.map(l=>l.fragments.map(f=>f.text).join(''))).toEqual(['A\u0301','T']);
 const reopened=model(await DocxPackage.open(await save(p,d)));expect(reopened.text).toBe(d.text);expect(layout(reopened).lines.map(l=>l.stops)).toEqual(layout(d).lines.map(l=>l.stops));
 d.undo();expect(d.snapshot()).toEqual(before);
 const out=unzipSync(await save(p,d));for(const[name,bytes]of Object.entries(p.parts))expect(Buffer.from(out[name]).equals(Buffer.from(bytes)),name).toBe(true);
});
