import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
it('resolves explicit, theme and inherited font declarations without changing their package representation',async()=>{
 const root='tests/fixtures/montserrat-theme/',ref=JSON.parse(readFileSync(root+'reference.json')),cases=JSON.parse(readFileSync(root+'cases.json'));
 for(const[n,h]of Object.entries(ref.sha256))expect(createHash('sha256').update(readFileSync(root+n)).digest('hex')).toBe(h);
 const source=readFileSync(root+'control.docx'),p=await DocxPackage.open(source);
 expect(p.readOnly).not.toBe(true);expect(p.paragraphs).toHaveLength(9);
 for(const [i,paragraph]of p.paragraphs.entries()){
  expect(paragraph.runs.map(r=>r.text).join('')).toBe(cases[i].text);
  for(const r of paragraph.runs){expect(r.fontAscii).toBe('Montserrat Light');expect(r.bold).toBe(cases[i].bold);}
 }
 const out=new Uint8Array(await p.export(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets).arrayBuffer());expect(unzipSync(out)).toEqual(unzipSync(source));
});
