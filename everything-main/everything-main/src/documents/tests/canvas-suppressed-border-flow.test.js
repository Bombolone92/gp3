import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';

let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const source=readFileSync('tests/fixtures/caption-spacer-flow/control.docx');
const measure=(text,style)=>({width:text.length*style.fontSize*2/3,ascent:style.fontSize,descent:style.fontSize/3});

it.each([4,8,16,24])('keeps suppressed-edge flow independent of paint conflict widths: %i eighth-points',async size=>{
 const parts=unzipSync(source),styles=strFromU8(parts['word/styles.xml']);
 // Vary only the independently authored Grid style; paragraph sizes and
 // direct caption/nested-table edges retain their original declarations.
 const xml=new dom.window.DOMParser().parseFromString(styles,'application/xml');
 const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
 const grid=[...xml.getElementsByTagNameNS(ns,'style')].find(s=>s.getAttributeNS(ns,'styleId')==='Grid');
 for(const edge of grid.getElementsByTagNameNS(ns,'tblBorders')[0].children)edge.setAttributeNS(ns,'w:sz',String(size));
 parts['word/styles.xml']=strToU8(new dom.window.XMLSerializer().serializeToString(xml));
 const pkg=await DocxPackage.open(zipSync(parts));
 const layout=layoutDocument(pkg.paragraphs,measure,pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
 const gap=page=>{const lines=layout.lines.filter(l=>l.page===page),text=l=>l.fragments.map(f=>f.text||'').join('');return lines.find(l=>text(l)==='W:').baseline-lines.filter(l=>text(l)==='Caption').at(-1).baseline;};
 expect(gap(0)).toBeCloseTo(gap(1),8);expect(gap(2)).toBeCloseTo(gap(3),8);
 expect((gap(0)-gap(2))*.75).toBeCloseTo(size/8,8);
 expect(gap(4)).toBeCloseTo(gap(5),8);
});
