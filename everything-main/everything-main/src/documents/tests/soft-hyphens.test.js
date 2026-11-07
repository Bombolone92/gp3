import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,strFromU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument,paragraph} from '../src/engine/model.js';
import {layoutDocument,caretRect} from '../src/engine/layout.js';
import {cellIntrinsicWidths} from '../src/engine/intrinsic-widths.js';
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const measure=t=>({width:t.length*8,ascent:12,descent:4}),page={width:56,height:800,left:0,right:0,top:0,bottom:0};
const lines=l=>l.lines.map(l=>l.fragments.map(f=>f.text).join(''));
const render=(text,width=56)=>layoutDocument([paragraph(text)],measure,{...page,width});
it('hides discretionary characters without losing their caret positions',()=>{
 const l=render('AV\u00adAV',200);expect(lines(l)).toEqual(['AVAV']);expect(caretRect(l,2).x).toBe(caretRect(l,3).x);expect(l.lines[0].stops.map(s=>s.offset)).toContain(3);
 expect(lines(render('\u00ad',200))).toEqual(['']);expect(lines(render('word\u00ad',200))).toEqual(['word']);
});
it('uses the last fitting discretionary break and preserves source offsets',()=>{
 const l=render('ab\u00adcd\u00adefgh');expect(lines(l)).toEqual(['abcd-','efgh']);expect(l.lines[0].end).toBe(6);expect(l.lines[1].start).toBe(6);
 expect(lines(render('ab\u00adcd',24))).toEqual(['ab-','cd']);
 expect(lines(render('abc\u00add',24)).join('')).toBe('abcd');
});
it('retains ordinary and forced breaks without showing unused hyphens',()=>{
 expect(lines(render('a\u00adb\vc\u00add',200))).toEqual(['ab','cd']);
 expect(lines(render('a\u00ad\u00adb',200))).toEqual(['ab']);
});
it('shares hidden maximum widths and visible break minima with table sizing',()=>{
 const size=text=>cellIntrinsicWidths({margins:{left:0,right:0},content:[{paragraph:paragraph(text),index:0}]},measure,page,undefined,[]);
 expect(size('ab\u00adcd')).toMatchObject({min:24,max:32,floor:8});
 expect(size('abc\u00ad')).toMatchObject({min:24,max:24,floor:8});
});
it('imports, edits, exports canonical elements and undoes to original package bytes',async()=>{
 const p=await DocxPackage.open(readFileSync('public/fixtures/soft-hyphens.docx')),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 const at=d.text.indexOf('\u00ad');expect(at).toBeGreaterThan(0);d.select(at,at);d.replace('X');const bytes=await save(),parts=unzipSync(bytes);expect(strFromU8(parts['word/document.xml'])).toContain('softHyphen');const reopened=await DocxPackage.open(bytes);expect(reopened.paragraphs.flatMap(p=>p.runs).map(r=>r.text).join('')).toContain('extraX\u00adordinary');
 for(const n in p.parts)if(n!=='word/document.xml')expect(parts[n]).toEqual(p.parts[n]);d.undo();const undo=unzipSync(await save());for(const n in p.parts)expect(undo[n]).toEqual(p.parts[n]);
});
it('does not turn trailing spaces into visible content',()=>{
 const p=paragraph('a  \u00ad',{formatOverrides:{alignment:'right'}}),q=paragraph('a  ',{formatOverrides:{alignment:'right'}});
 const a=layoutDocument([p],measure,{...page,width:200}),b=layoutDocument([q],measure,{...page,width:200});expect(a.lines[0].fragments[0].x).toBe(b.lines[0].fragments[0].x);
 const size=text=>cellIntrinsicWidths({margins:{left:0,right:0},content:[{paragraph:paragraph(text),index:0}]},measure,page,undefined,[]);expect(size('a  \u00ad').max).toBe(size('a  ').max);
});
