import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {parseXml} from '../src/engine/docx-xml.js';
import {readDiagramDrawing,DGM} from '../src/engine/docx-diagram-drawing.js';
import {drawingColor} from '../src/engine/docx-drawing-style.js';
const bytes=readFileSync('tests/fixtures/diagram-drawings/control.docx');
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
const read=parts=>readDiagramDrawing(parts,parseXml(parts['word/_rels/document.xml.rels']),parseXml(parts['[Content_Types].xml']),parseXml(parts['word/document.xml']).getElementsByTagNameNS(DGM,'relIds')[0],'word/document.xml',2540000,1270000);
it('renders saved geometry only in read-only preview and preserves every source part',async()=>{
  const unsupported=unzipSync(bytes);
  for(const key of Object.keys(unsupported).filter(k=>/diagrams\/layout/.test(k)))unsupported[key]=strToU8(strFromU8(unsupported[key]).replaceAll('type="lin"','type="composite"'));
  let error;try{await DocxPackage.open(zipSync(unsupported));}catch(e){error=e;}expect(error?.message).toContain('non-linear root');
  const pkg=await DocxPackage.open(zipSync(unsupported),{bestEffort:true});
  expect(pkg.readOnly).toBe(true);
  const scenes=Object.values(pkg.assets).filter(a=>a.scene).map(a=>a.scene);
  expect(scenes).toHaveLength(3);
  expect(scenes.map(s=>s.children[0].fill)).toEqual(['#228844','#8040C0','#CC4422']);
  expect(scenes[0]).toMatchObject({width:2540000,height:1270000,childWidth:2540000,childHeight:1270000});
  expect(pkg.parts).toEqual(unsupported);
  expect(()=>pkg.export()).toThrow('read-only');
});
it.each([
 ['word/_rels/document.xml.rels','Id="probe0dm"','Id="unresolved"'],
 ['word/_rels/document.xml.rels','Target="diagrams/data0.xml"','Target="https://example.invalid/data.xml"'],
 ['word/_rels/document.xml.rels','Target="diagrams/data0.xml"','Target="diagrams/data0.xml" TargetMode="External"'],
 ['word/_rels/document.xml.rels','/relationships/diagramDrawing','/relationships/image'],
 ['[Content_Types].xml','application/vnd.ms-office.drawingml.diagramDrawing+xml','application/xml'],
 ['word/diagrams/data0.xml','relId="probe0draw"','relId="missing"'],
 ['word/diagrams/drawing0.xml','<dsp:spTree>','<dsp:spTree><dsp:unknown/>'],
 ['word/diagrams/drawing0.xml','<dsp:spPr>','<dsp:spPr><a:blipFill/>'],
 ['word/diagrams/drawing0.xml','</dsp:sp>','<dsp:txBody><a:bodyPr/><a:p><a:r><a:t>Text</a:t></a:r></a:p></dsp:txBody></dsp:sp>'],
 ['word/diagrams/drawing0.xml','</dsp:sp>','<dsp:txBody><a:bodyPr/><a:p><a:pPr><a:defRPr u="sng"/></a:pPr><a:r><a:t> </a:t></a:r></a:p></dsp:txBody></dsp:sp>'],
])('rejects unsafe or unsupported saved drawings: %s %s',(path,before,after)=>{
  const parts=unzipSync(bytes),text=strFromU8(parts[path]);expect(text).toContain(before);
  parts[path]=strToU8(text.replace(before,after));expect(()=>read(parts)).toThrow();
});
it('accepts empty text without inventing a text frame',()=>{
  const parts=unzipSync(bytes);parts['word/diagrams/drawing0.xml']=strToU8(strFromU8(parts['word/diagrams/drawing0.xml']).replace('</dsp:sp>','<dsp:txBody><a:bodyPr/><a:p><a:r><a:t> </a:t></a:r></a:p></dsp:txBody></dsp:sp>'));
  expect(read(parts).getElementsByTagNameNS('http://schemas.microsoft.com/office/word/2010/wordprocessingShape','txbx')).toHaveLength(0);
});
it.each([['hueOff','0'],['hueOff','-0'],['satOff','0%'],['satOff','+0']])('accepts a validated identity %s %s',(kind,value)=>{
  const node=parseXml(`<a:srgbClr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" val="228844"><a:${kind} val="${value}"/></a:srgbClr>`).documentElement;
  expect(drawingColor(node)).toBe('228844');
});
it.each([['hueOff','0%'],['hueOff','60000'],['satOff','10%'],['satOff','NaN']])('keeps active or malformed %s %s guarded',(kind,value)=>{
  const node=parseXml(`<a:srgbClr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" val="228844"><a:${kind} val="${value}"/></a:srgbClr>`).documentElement;
  expect(()=>drawingColor(node)).toThrow();
});
