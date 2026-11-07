import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
const source=readFileSync('public/fixtures/group-fills.docx');
const A='http://schemas.openxmlformats.org/drawingml/2006/main';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
function changed(change){const parts=unzipSync(source),xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');change(xml);parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));return zipSync(parts);}
const find=(xml,name)=>xml.getElementsByTagNameNS(A,name)[0];
it('resolves group fills through nested groups without filling implicit children',async()=>{
 const p=await DocxPackage.open(source);
 const colors=Object.values(p.assets).map(a=>{let n=a.scene;while(n.type==='group')n=n.children[0];return n.fill;});
 expect(colors).toEqual(['#C04030','#3050C0',null,null,'#C04030','#C04030','#208060','#C04030',null,null,'#3050C0',null]);
});
it.each([
 ['unknown noFill child',xml=>[...xml.getElementsByTagNameNS(A,'noFill')].find(n=>n.parentNode.localName==='grpSpPr').appendChild(xml.createElementNS(A,'a:solidFill'))],
 ['unknown group fill child',xml=>find(xml,'grpFill').appendChild(xml.createElementNS(A,'a:solidFill'))],
 ['unknown group fill attribute',xml=>find(xml,'grpFill').setAttribute('value','red')],
 ['conflicting child fill',xml=>find(xml,'grpFill').parentNode.appendChild(xml.createElementNS(A,'a:noFill'))],
 ['conflicting group fill',xml=>{const pr=xml.getElementsByTagNameNS('http://schemas.microsoft.com/office/word/2010/wordprocessingGroup','grpSpPr')[0];pr.appendChild(xml.createElementNS(A,'a:noFill'));}],
])('rejects %s',async(_,change)=>{
 await expect(DocxPackage.open(changed(change))).rejects.toMatchObject({name:'UnsupportedDocumentError'});
});

it('does not replace explicit grpFill with the theme fill reference',async()=>{
 const p=await DocxPackage.open(changed(xml=>{
  const S='http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
  const shape=xml.getElementsByTagNameNS(S,'wsp')[0],style=xml.createElementNS(S,'wps:style');
  for(const [name,index] of [['lnRef','0'],['fillRef','1'],['effectRef','0'],['fontRef','none']]){
   const ref=xml.createElementNS(A,'a:'+name);ref.setAttribute('idx',index);
   const color=xml.createElementNS(A,'a:srgbClr');color.setAttribute('val','0000FF');ref.appendChild(color);style.appendChild(ref);
  }
  shape.insertBefore(style,shape.getElementsByTagNameNS(S,'bodyPr')[0]);
 }));
 expect(Object.values(p.assets)[0].scene.children[0].fill).toBe('#C04030');
});
