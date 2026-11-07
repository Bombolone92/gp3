import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {readShapeGeometry} from '../src/engine/docx-shapes.js';
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
function geometry(a1,a2,width=100,height=80){
 const av=[['adj1',a1],['adj2',a2]].filter(v=>v[1]!==undefined).map(([n,v])=>`<a:gd name="${n}" fmla="${v}"/>`).join('');
 const r=new DOMParser().parseFromString(`<a:spPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:prstGeom prst="downArrow"><a:avLst>${av}</a:avLst></a:prstGeom></a:spPr>`,'application/xml');return readShapeGeometry(r.documentElement,{width,height});
}
it('resolves the default arrow and its inscribed text rectangle',()=>{
 const g=geometry();expect(g.paths[0].points).toEqual([['M',0,40],['L',25,40],['L',25,0],['L',75,0],['L',75,40],['L',100,40],['L',50,80],['Z']]);expect(g.textRect).toEqual({left:.25,top:0,right:.75,bottom:.75});
});
it('supports the full-width shaft without changing the arrow tip or text bounds',()=>{
 const g=geometry('val 100000','val 25000');expect(g.textRect).toEqual({left:0,top:0,right:1,bottom:.75});expect(g.paths[0].points[6]).toEqual(['L',50,80]);
});
it('clamps adjustment limits against the shorter side and full height',()=>{
 const g=geometry('val 150000','val 200000',60,110);expect(g.paths[0].points[0]).toEqual(['M',0,0]);expect(g.textRect).toEqual({left:0,top:0,right:1,bottom:0});
 const zero=geometry('val -5000','val -5000');expect(zero.textRect).toEqual({left:.5,top:0,right:.5,bottom:1});
});
it.each(['val missing','*/ 1 2 0','bogus 2'])('rejects invalid arrow adjustment %s',f=>expect(()=>geometry(f)).toThrow());
const source=readFileSync('tests/fixtures/down-arrow/control.docx');
function changeBody(mode,index){const p=unzipSync(source),r=new DOMParser().parseFromString(strFromU8(p['word/document.xml']),'application/xml');r.getElementsByTagNameNS('http://schemas.microsoft.com/office/word/2010/wordprocessingShape','bodyPr')[index].setAttribute('vert',mode);p['word/document.xml']=strToU8(new XMLSerializer().serializeToString(r));return zipSync(p);}
it.each(['horz','vert','vert270','wordArtVert','eaVert','mongolianVert','wordArtVertRtl'])('preserves inactive orientation %s with no text box',async mode=>{const p=await DocxPackage.open(changeBody(mode,2));expect(Object.values(p.assets)).toHaveLength(12);});
it('keeps visible vertical text and malformed orientations guarded',async()=>{
 await expect(DocxPackage.open(changeBody('eaVert',0))).rejects.toThrow('vertical text bodies');
 await expect(DocxPackage.open(changeBody('invalid',2))).rejects.toThrow('invalid vertical text mode');
});
