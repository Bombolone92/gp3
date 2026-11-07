import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {levelFor} from '../src/engine/numbering.js';
const root='tests/fixtures/symbol-cs-numbering/',source=readFileSync(root+'control.docx'),ref=JSON.parse(readFileSync(root+'reference.json'));
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>dom.window.close());
it('binds the exact native control and PDF',()=>{for(const[n,h]of Object.entries(ref.sha256))expect(createHash('sha256').update(readFileSync(root+n)).digest('hex')).toBe(h);});
it('keeps ordinary marker size and glyphs despite inactive complex-script properties',async()=>{
 const p=await DocxPackage.open(source);expect(p.paragraphs).toHaveLength(8);
 for(const [i,para]of p.paragraphs.entries()){const level=levelFor(p.numbering,para.list);expect(level.markerStyle.fontSize).toBe(11);expect(level.markerStyle.bold).not.toBe(true);expect(level.markerStyle.italic).not.toBe(true);expect(level.symbol?.text||level.text).toBe(ref.cases[i].glyph);}
});
it('still rejects malformed complex-script property values and unsupported active-script labels',async()=>{
 for(const [before,after]of [['w:szCs w:val="96"','w:szCs w:val="999"'],['w:bCs w:val="1"','w:bCs w:val="invalid"'],['\uf0b7','\u0627']]){
  const parts=unzipSync(source),xml=strFromU8(parts['word/numbering.xml']);expect(xml.includes(before)).toBe(true);parts['word/numbering.xml']=strToU8(xml.replaceAll(before,after));await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
 }
});
