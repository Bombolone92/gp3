import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {listMarkers} from '../src/engine/numbering.js';
const root='tests/fixtures/numbering-override-sequences/',bytes=readFileSync(root+'control.docx');
const ref=JSON.parse(readFileSync(root+'reference.json'));
let dom;
beforeAll(()=>{dom=new JSDOM();for(const name of ['Node','document','DOMParser','XMLSerializer'])globalThis[name]=dom.window[name];});
afterAll(()=>{dom.window.close();for(const name of ['Node','document','DOMParser','XMLSerializer'])delete globalThis[name];});
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const markers=d=>listMarkers(d.paragraphs,d.numbering).map(m=>m?.text);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
it('matches 72 native sequence markers, including invisible counters and shared restarts',async()=>{
 const sha=b=>createHash('sha256').update(b).digest('hex');expect(sha(bytes)).toBe(ref.sourceSha256);expect(sha(readFileSync(root+'native.pdf'))).toBe(ref.pdfSha256);
 const pkg=await DocxPackage.open(bytes);expect(pkg.readOnly).not.toBe(true);
 expect(markers(model(pkg))).toEqual(ref.rows.map(r=>r.marker));
});
it.each([['R04.1','O9.'],['R08.1',''],['R10.1','B9.']])('restarts %s and preserves effective labels through export, reopen and exact undo',async(label,expected)=>{
 const pkg=await DocxPackage.open(bytes),d=model(pkg),original=unzipSync(bytes),index=ref.rows.findIndex(r=>r.label===label);
 expect(unzipSync(await save(pkg,d))).toEqual(original);
 d.select(d.text.indexOf(label));d.restartNumbering(9);
 expect(markers(d)[index]).toBe(expected);expect(markers(d)[index+1]).toBe('N9.4');
 const output=await save(pkg,d),parts=unzipSync(output);
 for(const[name,data]of Object.entries(original))if(!['word/document.xml','word/numbering.xml'].includes(name))expect(parts[name],name).toEqual(data);
 const again=model(await DocxPackage.open(output));expect(again.text).toBe(d.text);expect(markers(again)).toEqual(markers(d));
 d.undo();expect(unzipSync(await save(pkg,d))).toEqual(original);
 d.redo();expect(markers(d)).toEqual(markers(again));
});
it('preserves unsupported-looking source declarations through ordinary text editing',async()=>{
 const pkg=await DocxPackage.open(bytes),d=model(pkg),parts=unzipSync(bytes);d.select(d.text.indexOf('R05.1'));d.replace('Added ');
 const output=await save(pkg,d),changed=unzipSync(output);
 for(const[name,data]of Object.entries(parts))if(name!=='word/document.xml')expect(changed[name],name).toEqual(data);
 expect(markers(model(await DocxPackage.open(output)))).toEqual(ref.rows.map(r=>r.marker));
});

it('uses full child starts when ancestor items reset the overridden level',async()=>{
 const bytes=readFileSync(root+'nested.docx'),ref=JSON.parse(readFileSync(root+'nested-reference.json'));
 const sha=b=>createHash('sha256').update(b).digest('hex');expect(sha(bytes)).toBe(ref.sourceSha256);expect(sha(readFileSync(root+'nested-native.pdf'))).toBe(ref.pdfSha256);
 const p=await DocxPackage.open(bytes),d=model(p),actual=listMarkers(d.paragraphs,d.numbering);
 expect(actual.map(m=>m?.text)).toEqual(ref.rows.map(r=>r.marker));
 expect([21,26,31,36].map(i=>actual[i].counters[1])).toEqual([0,7,0,7]);
});

it('updates a numerically equivalent zero-padded override instead of adding a duplicate',async()=>{
 const parts=unzipSync(bytes);parts['word/numbering.xml']=strToU8(strFromU8(parts['word/numbering.xml']).replaceAll('w:ilvl="0"','w:ilvl="00"'));
 const p=await DocxPackage.open(zipSync(parts)),d=model(p);d.select(d.text.indexOf('R04.1'));d.restartNumbering(9);
 const out=await save(p,d),again=model(await DocxPackage.open(out));expect(markers(again)).toEqual(markers(d));expect(markers(again)[12]).toBe('O9.');
});

it.each(JSON.parse(readFileSync(root+'restart-exports/reference.json')))('matches the independent native reference reading of the browser restart export: $name',async ref=>{
 const folder=root+'restart-exports/',source=readFileSync(folder+ref.name+'.docx');const sha=b=>createHash('sha256').update(b).digest('hex');
 expect(sha(source)).toBe(ref.sourceSha256);expect(sha(readFileSync(folder+ref.name+'-native.pdf'))).toBe(ref.pdfSha256);
 expect(markers(model(await DocxPackage.open(source)))).toEqual(ref.markers);
});
