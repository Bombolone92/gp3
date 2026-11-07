import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strToU8} from 'fflate';
import {parseXml} from '../src/engine/docx-xml.js';
import {DocxPackage} from '../src/engine/docx.js';
const D='http://schemas.openxmlformats.org/drawingml/2006/diagram',A='http://schemas.openxmlformats.org/drawingml/2006/main';
const bytes=readFileSync('tests/fixtures/diagram-styling/control.docx');
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>dom.window.close());
it.each([
 ['visible text','data10',r=>{r.getElementsByTagNameNS(A,'t')[0].textContent='Visible';}],
 ['decorated spaces','data10',r=>{const run=r.getElementsByTagNameNS(A,'r')[0],props=r.createElementNS(A,'a:rPr');props.setAttribute('u','sng');run.prepend(props);}],
 ['active scene rotation','style11',r=>{r.getElementsByTagNameNS(A,'camera')[0].setAttribute('prst','perspectiveFront');}],
 ['active bevel','style11',r=>{r.getElementsByTagNameNS(D,'sp3d')[0].append(r.createElementNS(A,'a:bevelT'));}],
 ['custom point geometry','data0',r=>{r.getElementsByTagNameNS(D,'spPr')[0].append(r.createElementNS(A,'a:xfrm'));}],
 ['layout child ordering','layout0',r=>{r.getElementsByTagNameNS(D,'layoutNode')[0].setAttribute('chOrder','t');}],
 ['active adjustment','layout0',r=>{const list=r.createElementNS(D,'d:adjLst'),adj=r.createElementNS(D,'d:adj');adj.setAttribute('idx','1');adj.setAttribute('val','.25');list.append(adj);r.getElementsByTagNameNS(D,'shape')[0].append(list);}],
])('keeps unsupported %s guarded',async(_,part,mutate)=>{
 const parts=unzipSync(bytes),path=`word/diagrams/${part}.xml`,doc=parseXml(parts[path]);mutate(doc);parts[path]=strToU8(new XMLSerializer().serializeToString(doc));
 let error;try{await DocxPackage.open(zipSync(parts));}catch(e){error=e;}expect(error?.name).toBe('UnsupportedDocumentError');
});
it('recalculates without requiring saved drawing geometry',async()=>{
 const parts=unzipSync(bytes);for(const key of Object.keys(parts).filter(n=>/diagrams\/drawing/.test(n)))delete parts[key];
 const pkg=await DocxPackage.open(zipSync(parts));expect(pkg.readOnly).not.toBe(true);expect(Object.values(pkg.assets).filter(a=>a.scene)).toHaveLength(12);
});
