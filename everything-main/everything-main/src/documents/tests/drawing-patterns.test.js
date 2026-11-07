import {it,expect,beforeAll,afterAll} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {DocxPackage} from '../src/engine/docx.js';
import {readPatternFill,patternPixels,shapeHasPatterns} from '../src/engine/drawing-patterns.js';
import {PATTERN_MASKS} from '../src/engine/drawing-pattern-masks.js';
import {TextDocument} from '../src/engine/model.js';
import {unzipSync,strFromU8} from 'fflate';
const A='http://schemas.openxmlformats.org/drawingml/2006/main';
let dom;
beforeAll(()=>{dom=new JSDOM('');globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const parse=xml=>new DOMParser().parseFromString(`<a:pattFill xmlns:a="${A}" ${xml}`,'application/xml').documentElement;
const refs=JSON.parse(readFileSync('tests/fixtures/pattern-fills/reference.json'));
it('imports all independent preset, default and transformed shapes',async()=>{
 const p=await DocxPackage.open(readFileSync('tests/fixtures/pattern-fills/controls.docx'));
 const scenes=Object.values(p.assets).filter(a=>a.scene).map(a=>a.scene);
 expect(scenes).toHaveLength(74);expect(scenes.every(shapeHasPatterns)).toBe(true);
 expect(Object.keys(PATTERN_MASKS)).toHaveLength(54);
 for(const ref of refs.pages.slice(0,54)){
  const fill=readPatternFill(parse(`prst="${ref.preset}"><a:fgClr><a:srgbClr val="1248A0"/></a:fgClr><a:bgClr><a:srgbClr val="F0D080"/></a:bgClr></a:pattFill>`));
  const pixels=patternPixels(fill);
  for(let y=0;y<8;y++)for(let x=0;x<8;x++)for(let c=0;c<4;c++)expect(Math.abs(pixels[(y*8+x)*4+c]-ref.palette[Number(ref.rows[y][x])][c]),`${ref.preset} ${x},${y} channel ${c}`).toBeLessThanOrEqual(2);
 }
});
it('resolves defaults, theme colors and independent opacity',()=>{
 expect(readPatternFill(parse('/>'))).toEqual({type:'pattern',preset:'pct5',foreground:{rgb:'000000',alpha:1},background:{rgb:'FFFFFF',alpha:1}});
 const f=readPatternFill(parse('prst=" dkUpDiag "><a:fgClr><a:schemeClr val="accent1"><a:alpha val="50000"/></a:schemeClr></a:fgClr></a:pattFill>'),()=> '123456');
 expect(f.foreground).toEqual({rgb:'123456',alpha:.5});expect(new Set(patternPixels(f).filter((_,i)=>i%4===3))).toEqual(new Set([128,255]));
});
it('retains drawing XML through body edits, reopen and exact undo',async()=>{
 const source=readFileSync('tests/fixtures/pattern-fills/controls.docx'),pkg=await DocxPackage.open(source);
 const doc=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
 const save=async()=>new Uint8Array(await pkg.export(doc.paragraphs,doc.pageSettings,doc.numbering,doc.styles,doc.tables,doc.assets).arrayBuffer());
 const drawings=bytes=>[...new DOMParser().parseFromString(strFromU8(unzipSync(bytes)['word/document.xml']),'application/xml').getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','drawing')].map(n=>new XMLSerializer().serializeToString(n));
 doc.select(0);doc.replace('Edited ');const edited=await save();expect(drawings(edited)).toEqual(drawings(source));
 const reopened=await DocxPackage.open(edited);expect(new TextDocument(reopened.paragraphs).text).toBe(doc.text);
 expect(Object.values(reopened.assets).filter(a=>a.scene).every(a=>shapeHasPatterns(a.scene))).toBe(true);
 doc.undo();const parts=unzipSync(await save()),before=unzipSync(source);
 expect(Object.keys(parts).sort()).toEqual(Object.keys(before).sort());for(const[n,b]of Object.entries(before))expect(Buffer.from(parts[n]).equals(Buffer.from(b)),n).toBe(true);
});
it.each([
 'prst="unknown"/>','prst=""/>','extra="1"/>',
 '><a:fgClr/><a:bgClr/></a:pattFill>',
 '><a:bgClr><a:srgbClr val="FFFFFF"/></a:bgClr><a:fgClr><a:srgbClr val="000000"/></a:fgClr></a:pattFill>',
 '><a:fgClr><a:srgbClr val="000000"/></a:fgClr><a:fgClr><a:srgbClr val="000000"/></a:fgClr></a:pattFill>',
 '>unexpected</a:pattFill>',
 '><a:unknown/></a:pattFill>',
 '><a:fgClr extra="1"><a:srgbClr val="000000"/></a:fgClr></a:pattFill>',
])('rejects malformed pattern properties: %s',xml=>expect(()=>readPatternFill(parse(xml))).toThrow());
