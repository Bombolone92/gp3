import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage, createDocx } from '../src/engine/docx.js';
import { TextDocument, paragraph } from '../src/engine/model.js';
import { paintText } from '../src/engine/canvas-paint-text.js';
let dom;
beforeAll(()=>{dom=new JSDOM('');globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const source=readFileSync('public/fixtures/text-outline-control.docx');
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const run=(d,t)=>d.paragraphs.flatMap(p=>p.runs).find(r=>r.text===t);
const select=(d,t)=>{const at=d.text.indexOf(t);expect(at).toBeGreaterThanOrEqual(0);d.select(at,at+t.length);};
const equal=(a,b,except=[])=>{expect(Object.keys(a)).toEqual(Object.keys(b));for(const n of Object.keys(a))if(!except.includes(n))expect(Buffer.from(a[n]).equals(Buffer.from(b[n])),n).toBe(true);};
it('imports direct and inherited outlines while retaining table placement and original package',async()=>{
 const p=await DocxPackage.open(source),d=model(p);expect(p.readOnly).toBeFalsy();expect(d.tables).toHaveLength(1);
 for(const t of ['Direct outlined text','Inherited outlined text','Direct color plus outline','Left card','Right card'])expect(run(d,t).textOutline).toEqual({width:9525,color:'008080',join:'bevel',cap:'rnd',miter:8});
 expect(run(d,'Ordinary text control').textOutline).toBeNull();expect(run(d,'Direct color plus outline').color).toBe('FFC000');equal(unzipSync(await save(p,d)),p.parts);
});
it('retains an outline through splitting, typing, foreground edits, export and exact undo',async()=>{
 const p=await DocxPackage.open(source),d=model(p);select(d,'Inherited outlined text');d.setRunFormat({color:'AA2200'});
 const at=d.text.indexOf('Direct outlined text')+7;d.select(at,at);d.replace('new ');
 let reopened=model(await DocxPackage.open(await save(p,d)));expect(reopened.text).toContain('Direct new outlined text');expect(run(reopened,'Inherited outlined text').color).toBe('AA2200');expect(run(reopened,'Inherited outlined text').textOutline.color).toBe('008080');
 equal(unzipSync(await save(p,d)),p.parts,['word/document.xml']);d.undo();d.undo();equal(unzipSync(await save(p,d)),p.parts);
});
it('serializes a changed outline, explicit no-outline and inherited style removal',async()=>{
 const p=await DocxPackage.open(source),d=model(p);select(d,'Inherited outlined text');d.setRunFormat({textOutline:{width:19050,color:'112233',join:'round',cap:'flat',miter:8}});
 select(d,'Direct outlined text');d.setRunFormat({textOutline:null});d.editCharacterStyle('Outlined',{run:{textOutline:null}});
 const r=model(await DocxPackage.open(await save(p,d)));expect(run(r,'Inherited outlined text').textOutline.width).toBe(19050);expect(run(r,'Direct outlined text').textOutline).toBeNull();expect(run(r,'Left card').textOutline).toBeNull();
});
it('rejects unsupported outline geometry and colors instead of silently dropping them',async()=>{
 for(const [from,to]of [['w14:cmpd="sng"','w14:cmpd="dbl"'],['w14:algn="ctr"','w14:algn="in"'],['w14:val="solid"','w14:val="dash"'],['w14:w="9525"','w14:w="-1"'],['<w14:bevel/>','<w14:unknown/>'],['w14:val="008080"','w14:val="not-rgb"']]){
  const parts=unzipSync(source);parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace(from,to));await expect(DocxPackage.open(zipSync(parts))).rejects.toMatchObject({name:'UnsupportedDocumentError'});
 }
});
it('paints fill followed by centered outline and restores stroke state',()=>{
 const calls=[],ctx={fillText:(...a)=>calls.push(['fill',...a]),strokeText:(...a)=>calls.push(['stroke',...a]),save:()=>calls.push(['save']),restore:()=>calls.push(['restore']),setLineDash:a=>calls.push(['dash',a]),measureText:()=>({width:1})};
 paintText(ctx,{text:'Outline',x:4,textOutline:{width:9525,color:'008080',join:'bevel',cap:'rnd',miter:8}},20);
 expect(calls[0]).toEqual(['fill','Outline',4,20]);expect(calls.at(-2)).toEqual(['stroke','Outline',4,20]);expect(calls.at(-1)).toEqual(['restore']);expect(ctx.lineWidth).toBe(1);expect(ctx.strokeStyle).toBe('#008080');
});

it('declares markup compatibility when adding outlines to a new package',async()=>{
 const p=createDocx([paragraph('New outline')]),d=model(p);select(d,'New outline');d.setRunFormat({textOutline:{width:9525,color:'008080'}});
 const bytes=await save(p,d),xml=strFromU8(unzipSync(bytes)['word/document.xml']);expect(xml).toContain('mc:Ignorable="w14"');expect(model(await DocxPackage.open(bytes)).paragraphs[0].runs[0].textOutline.color).toBe('008080');
});
it('resolves theme outline colors while retaining their source declarations',async()=>{
 const parts=unzipSync(source),theme=unzipSync(readFileSync('public/fixtures/text-colors.docx'));
 const themeName=Object.keys(theme).find(n=>/^word\/theme\/.*\.xml$/.test(n));parts['word/theme/theme1.xml']=theme[themeName];
 parts['word/_rels/document.xml.rels']=strToU8(strFromU8(parts['word/_rels/document.xml.rels']).replace('</Relationships>','<Relationship Id="theme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>'));
 parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace('<w14:srgbClr w14:val="008080"/>','<w14:schemeClr w14:val="accent1"/>'));
 const p=await DocxPackage.open(zipSync(parts)),d=model(p);expect(run(d,'Direct outlined text').textOutline.color).toBe('4F81BD');equal(unzipSync(await save(p,d)),parts);
});

it('keeps outlined and plain paint spans distinct without breaking kerning or caret geometry',async()=>{
 const {layoutDocument}=await import('../src/engine/layout.js'),{pageGeometry}=await import('../src/engine/page-settings.js');
 const d=new TextDocument([paragraph('AVAV')]),measure=(t,s)=>({width:(t.length-(t.match(/AV/g)?.length||0)/3)*8,ascent:12,descent:4});
 const layout=()=>layoutDocument(d.paragraphs,measure,pageGeometry(d.pageSettings),d.numbering,d.tables);
 const before=layout();d.select(1,3);d.setRunFormat({textOutline:{width:9525,color:'008080'}});const after=layout(),f=after.lines[0].fragments;
 expect(f).toHaveLength(1);expect(f[0].text).toBe('AVAV');expect(f[0].width).toBe(before.lines[0].fragments[0].width);expect(after.lines[0].stops).toEqual(before.lines[0].stops);
 expect(f[0].colors.map(c=>c.textOutline?.color??null)).toEqual([null,'008080',null]);
 d.select(0,1);d.setRunFormat({textOutline:{width:19050,color:'AA2200'}});expect(layout().lines[0].fragments[0].colors.map(c=>c.textOutline?.color??null)).toEqual(['AA2200','008080',null]);
});

it('retains zero, fractional and omitted miter limits through typing and exact undo',async()=>{
 const bytes=readFileSync('tests/fixtures/text-outline-miters/control.docx'),p=await DocxPackage.open(bytes),d=model(p);
 expect(d.paragraphs.map(p=>p.runs[0].textOutline.miter)).toEqual([0,.5,1,2,4,8,0,8]);
 d.select(0);d.replace('Edited ');const edited=await save(p,d),reopened=model(await DocxPackage.open(edited));
 expect(reopened.paragraphs[0].runs[0].textOutline.miter).toBe(0);equal(unzipSync(edited),p.parts,['word/document.xml']);
 d.undo();equal(unzipSync(await save(p,d)),p.parts);
});
it.each([0,.5,1,8,20])('paints the native reference miter limit while retaining declared %s',miter=>{
 const ctx={strokeText:()=>{},save:()=>{},restore:()=>{},setLineDash:()=>{}};
 const outline={width:38100,color:'9040B0',join:'miter',cap:'sq',miter};
 paintText(ctx,{text:'MWAV',x:0,textFill:'none',textOutline:outline},60);
 expect(ctx.miterLimit).toBe(10);expect(outline.miter).toBe(miter);expect(ctx.lineJoin).toBe('miter');
});

it('resolves ordered outline luminance transforms and preserves their XML through editing',async()=>{
 const bytes=readFileSync('tests/fixtures/text-outline-luminance/control.docx'),p=await DocxPackage.open(bytes),d=model(p);
 const colors=d.paragraphs.map(p=>p.runs[0].textOutline.color);
 // Independently checked with Python colorsys HLS. Native reference quantization
 // differs by one channel value in ten rows; that precision gap remains open.
 expect(colors).toEqual(['9040B0','6C3084','000000','F3E9F7','BC84D2','532565','853BA3','672E7D','376092','E46C0A','808080','04080D','000000','666666','000000','FFFFFF']);
 const native=JSON.parse(readFileSync('tests/fixtures/text-outline-luminance/reference.json')).colors;
 for(const [i,color] of colors.entries())color.match(/../g).forEach((v,k)=>expect(Math.abs(parseInt(v,16)-native[i][k])).toBeLessThanOrEqual(1));
 d.select(0);d.replace('Edited ');const edited=await save(p,d),reopened=model(await DocxPackage.open(edited));
 expect(reopened.paragraphs.map(p=>p.runs[0].textOutline.color)).toEqual(colors);
 equal(unzipSync(edited),p.parts,['word/document.xml']);
 expect(strFromU8(unzipSync(edited)['word/document.xml'])).toContain('w14:lumMod');
 d.undo();equal(unzipSync(await save(p,d)),p.parts);
});

it.each(['NaN','1.5','2147483648','-2147483649',''])('rejects malformed outline luminance %s',async raw=>{
 const parts=unzipSync(readFileSync('tests/fixtures/text-outline-luminance/control.docx'));
 parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace('w14:val="75000"','w14:val="'+raw+'"'));
 await expect(DocxPackage.open(zipSync(parts))).rejects.toMatchObject({name:'UnsupportedDocumentError'});
});
