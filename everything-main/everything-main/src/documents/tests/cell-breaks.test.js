import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument,paragraphText} from '../src/engine/model.js';
import {layoutDocument,caretRect} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
const root='tests/fixtures/cell-breaks/';
const reference=JSON.parse(readFileSync(root+'reference.json'));
const measure=(t,s)=>({width:t.length*s.fontSize/2,ascent:s.fontSize,descent:s.fontSize/4});
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
const layout=p=>layoutDocument(p.paragraphs,measure,pageGeometry(p.pageSettings),p.numbering,p.tables);
it.each(['page','column','empty-page','line'])('preserves independent reference control %s through edit/export/undo',async name=>{
 const bytes=readFileSync(root+name+'.docx'),r=reference.cases.find(c=>c.source===name+'.docx');
 const hash=b=>createHash('sha256').update(b).digest('hex');
 expect(hash(bytes)).toBe(r.sourceSha256);expect(hash(readFileSync(root+name+'-native.pdf'))).toBe(r.pdfSha256);
 const p=await DocxPackage.open(bytes),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const initial=layout(p),visible=initial.lines.map(l=>l.fragments.map(f=>f.text).join(''));
 expect(Math.max(...initial.lines.map(l=>l.page))).toBe(0);
 if(name==='page'||name==='column')expect(visible).toContain('BeforeAfter');
 else {expect(visible).toContain('Before');expect(visible).toContain('After');}
 const original=d.paragraphs.map(paragraphText).join('\n'),pos=original.indexOf('Before')+6;
 if(name==='page'||name==='column'){
  expect(caretRect(initial,pos).x).toBe(caretRect(initial,pos+1).x);
  expect(caretRect(initial,pos+1).height).toBeGreaterThan(0);
 }
 const parts=unzipSync(bytes),save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 expect(unzipSync(await save())).toEqual(parts);
 d.select(pos);d.replace('X\f\u000eY');const edited=await save(),out=unzipSync(edited);
 for(const n of Object.keys(parts))if(n!=='word/document.xml')expect(out[n],n).toEqual(parts[n]);
 const reopened=await DocxPackage.open(edited);
 expect(reopened.paragraphs.map(paragraphText).join('\n')).toBe(original.slice(0,pos)+'X\f\u000eY'+original.slice(pos));
 expect(layout(reopened).lines.some(l=>l.hardBreak==='page'||l.hardBreak==='column')).toBe(false);
 d.undo();expect(unzipSync(await save())).toEqual(parts);
});
it.each(['before-first','before-second'])('keeps paragraph pagination guarded: %s',async name=>{
 await expect(DocxPackage.open(readFileSync(root+name+'.docx'))).rejects.toThrow('paragraph page breaks inside table cells');
});
it('does not split intrinsic width or shaping at an invisible cell break',async()=>{
 const p=await DocxPackage.open(readFileSync(root+'page.docx'));
 // Exercise AutoFit as well as the source fixture's fixed grid.
 for(const t of Object.values(p.tables))t.layout='autofit';
 const withBreak=layout(p);
 for(const para of p.paragraphs)for(const r of para.runs)r.text=r.text.replace(/[\f\u000e]/g,'');
 const without=layout(p),geometry=l=>l.lines.map(x=>({page:x.page,x:x.x,y:x.y,height:x.height,text:x.fragments.map(f=>f.text).join(''),width:x.width}));
 expect(geometry(withBreak)).toEqual(geometry(without));
});
it.each(['left','both'])('retains wrapping, spaces and empty paragraph metrics (%s)',async alignment=>{
 for(const text of ['\f\u000eX','Before \f\u000eAfter','BeforeAfter   \f','\f   Before After After After After After After After   \u000e','\f\u000e','\fW']){
  const p=await DocxPackage.open(readFileSync(root+'page.docx')),para=p.paragraphs.find(p=>p.cellId);
  para.runs=[{...para.runs[0],text,fontSize:text==='\fW'?500:12}];para.format.alignment=alignment;
  const withBreak=layout(p);para.runs[0].text=text.replace(/[\f\u000e]/g,'');
  const without=layout(p),geometry=l=>l.lines.map(x=>({page:x.page,x:x.x,y:x.y,height:x.height,text:x.fragments.map(f=>f.text).join(''),width:x.width}));
  expect(geometry(withBreak),JSON.stringify(text)).toEqual(geometry(without));
 }
});
