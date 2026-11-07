import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { isWmf, wmfInfo, WMF_MIME } from '../src/engine/wmf-images.js';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
const source = readFileSync('tests/fixtures/wmf-vectors/control.docx'), parts = unzipSync(source), base = parts['word/media/control0.wmf'];
const standardSource=readFileSync('tests/fixtures/wmf-standard/control.docx'),standardParts=unzipSync(standardSource);
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
const change = fn => { const b = base.slice(); fn(new DataView(b.buffer, b.byteOffset, b.byteLength), b); return b; };
function at(type) { const v = new DataView(base.buffer, base.byteOffset, base.byteLength); for (let n = 40; n < base.length; n += v.getUint32(n, true) * 2) if (v.getUint16(n + 4, true) === type) return n; throw Error('Missing record'); }
it('recognizes placeable WMF without treating arbitrary short inputs as metafiles', () => {
  expect(isWmf(base)).toBe(true); expect(isWmf(base.slice(0, 3))).toBe(false); expect(isWmf(new Uint8Array(40))).toBe(false);
});
it('recognizes standard headers and uses the embedding viewport with the recorded window mapping',()=>{
 const expected=wmfInfo(base),viewport={width:96,height:43.2};
 for(let i=1;i<7;i++){
  const bytes=standardParts[`word/media/control${i}.${i===5?'emf':'wmf'}`];
  expect(isWmf(bytes)).toBe(true);expect(wmfInfo(bytes,viewport)).toEqual(expected);
 }
 const bytes=standardParts['word/media/control1.wmf'];
 expect(()=>wmfInfo(bytes)).toThrow(/frame/);
 for(const viewport of [{width:0,height:1},{width:Infinity,height:10},{width:9000,height:10},{width:5000,height:5000}])expect(()=>wmfInfo(bytes,viewport)).toThrow(/frame/);
 const disk=bytes.slice();new DataView(disk.buffer).setUint16(0,2,true);expect(wmfInfo(disk,viewport)).toEqual(expected);
});
it('rejects malformed standard streams, missing window extents and unsafe escape records',()=>{
 const bytes=standardParts['word/media/control3.wmf'],viewport={width:96,height:43.2};
 for(let length=0;length<bytes.length;length++)expect(()=>wmfInfo(bytes.slice(0,length),viewport)).toThrow(/Unsupported WMF/);
 for(const mutate of [
  v=>v.setUint32(6,9,true),v=>v.setUint32(12,3,true),v=>v.setUint16(18+6,19,true),
  v=>v.setUint16(18+8,65535,true),v=>v.setUint32(18+10,0x43464d57,true),
 ]){
  const copy=bytes.slice();mutate(new DataView(copy.buffer));expect(()=>wmfInfo(copy,viewport)).toThrow(/Unsupported WMF/);
 }
 const noExtent=standardParts['word/media/control1.wmf'].slice(),v=new DataView(noExtent.buffer);
 for(let at=18;at<noExtent.length;at+=v.getUint32(at,true)*2)if((v.getUint16(at+4,true)&255)===12)v.setUint16(at+4,0x020b,true);
 expect(()=>wmfInfo(noExtent,viewport)).toThrow(/missing window extent/);
});
it('preserves standard WMF and swapped WMF/EMF names through export, reopen and undo',async()=>{
 const p=await DocxPackage.open(standardSource),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 expect(p.assets['word/media/control5.emf'].mime).toBe(WMF_MIME);expect(p.assets['word/media/control7.wmf'].mime).toBe('image/emf');
 expect(p.assets['word/media/control1.wmf'].wmfViewport).toEqual({width:200*4/3,height:120});
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 d.select(0);d.replace('Edited ');const out=await save(),again=await DocxPackage.open(out);
 expect(again.assets['word/media/control1.wmf'].wmfViewport).toEqual(p.assets['word/media/control1.wmf'].wmfViewport);
 for(const[name,bytes]of Object.entries(p.parts))if(name!=='word/document.xml')expect(unzipSync(out)[name]).toEqual(bytes);
 d.undo();expect(unzipSync(await save())).toEqual(p.parts);
});
it('matches explicit mapping, negative extents, translated origins and padded pens', () => {
  const expected = wmfInfo(base); expect(expected.mime).toBe(WMF_MIME);
  for (let i = 1; i < 6; i++) expect(wmfInfo(parts[`word/media/control${i}.wmf`])).toEqual(expected);
  expect(wmfInfo(parts['word/media/control6.wmf']).svg).toContain('fill-rule="evenodd"');
  expect(wmfInfo(parts['word/media/control7.wmf']).svg).toContain('fill-rule="nonzero"');
});
it.each([
  ['checksum', v => v.setUint16(20, 0, true)],
  ['size', v => v.setUint32(28, 9, true)],
  ['version', v => v.setUint16(26, 0, true)],
  ['max record', v => v.setUint32(34, 3, true)],
  ['object overflow', v => v.setUint16(32, 1, true)],
  ['zero extent', v => v.setInt16(at(0x020c) + 6, 0, true)],
  ['point overrun', v => v.setUint16(at(0x0324) + 6, 65535, true)],
  ['unknown object', v => v.setUint16(at(0x012d) + 6, 8, true)],
  ['visible pen', v => v.setUint16(at(0x02fa) + 6, 0, true)],
  ['pattern brush', v => v.setUint16(at(0x02fc) + 6, 3, true)],
  ['palette color', v => v.setUint32(at(0x02fc) + 8, 0x1000000, true)],
  ['raster operation', v => v.setUint16(at(0x0104) + 6, 7, true)],
  ['unknown record', v => v.setUint16(at(0x0324) + 4, 0x9999, true)],
  ['zero record', v => v.setUint32(40, 0, true)],
])('rejects %s before editing', (_, mutate) => expect(() => wmfInfo(change(mutate))).toThrow(/Unsupported WMF/));
it('rejects every truncated prefix', () => { for (let n = 0; n < base.length; n++) expect(() => wmfInfo(base.slice(0, n))).toThrow(/Unsupported WMF/); });
function record(type, ...values) {
  const b = new Uint8Array(6 + 2 * values.length), v = new DataView(b.buffer);
  v.setUint32(0, b.length / 2, true); v.setUint16(4, type, true);
  values.forEach((n, i) => v.setInt16(6 + i * 2, n, true)); return b;
}
function insertBeforePolygon(...records) {
  const pos = at(0x0324), length = records.reduce((n, r) => n + r.length, 0), result = new Uint8Array(base.length + length);
  result.set(base.slice(0, pos)); let cursor = pos;
  for (const r of records) { result.set(r, cursor); cursor += r.length; }
  result.set(base.slice(pos), cursor); const v = new DataView(result.buffer); v.setUint32(28, (result.length - 22) / 2, true); return result;
}
it('restores mapping and selected objects from saved device contexts', () => {
  for (const restore of [-1, 1]) {
    const bytes = insertBeforePolygon(record(0x001e), record(0x020b, 123, 456), record(0x020c, 50, 50), record(0x0106, 2), record(0x0127, restore));
    expect(wmfInfo(bytes)).toEqual(wmfInfo(base));
  }
});
it('reuses the lowest freed object slot after selecting a different brush', () => {
  const brush = record(0x02fc, 0, 0x1234, 0x56, 0);
  const bytes = insertBeforePolygon(record(0x02fc, 1, 0, 0, 0), record(0x012d, 2), record(0x01f0, 1), brush, record(0x012d, 1));
  new DataView(bytes.buffer).setUint16(32, 3, true);
  expect(wmfInfo(bytes).svg).toContain('fill="#341256"');
});
it('rejects missing saved contexts and deletion of missing objects', () => {
  for (const r of [record(0x0127, -1), record(0x0127, 0), record(0x01f0, 7), record(0x01f0, 1)]) expect(() => wmfInfo(insertBeforePolygon(r))).toThrow(/Unsupported WMF/);
});
it('rejects mismatched media content types', async () => {
  const changed = { ...parts, '[Content_Types].xml': strToU8(strFromU8(parts['[Content_Types].xml']).replace('image/x-wmf', 'image/png')) };
  await expect(DocxPackage.open(zipSync(changed))).rejects.toThrow(/content types/);
});
it('preserves every media part through edit, export, reopen and exact undo', async () => {
  const pkg = await DocxPackage.open(source); expect(Object.values(pkg.assets).map(a => a.mime)).toEqual(Array(8).fill(WMF_MIME));
  const doc = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  const save = async () => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
  doc.select(0); doc.replace('Edited '); const edited = await save(), out = unzipSync(edited);
  expect((await DocxPackage.open(edited)).paragraphs[0].runs[0].text).toMatch(/^Edited /);
  for (const name of Object.keys(parts)) if (name !== 'word/document.xml') expect(out[name]).toEqual(parts[name]);
  doc.undo(); expect(unzipSync(await save())).toEqual(parts);
});
it.each(['image/wmf', 'image/x-wmf'])('accepts and preserves %s', async mime => {
  const changed = { ...parts, '[Content_Types].xml': strToU8(strFromU8(parts['[Content_Types].xml']).replace('image/x-wmf', mime)) };
  const pkg = await DocxPackage.open(zipSync(changed)); expect(Object.keys(pkg.assets)).toHaveLength(8); expect(pkg.parts['[Content_Types].xml']).toEqual(changed['[Content_Types].xml']);
});
it('retains unsupported operations in the read-only package', async () => {
  const changed = { ...parts, 'word/media/control0.wmf': change(v => v.setUint16(at(0x0324) + 4, 0x9999, true)) };
  await expect(DocxPackage.open(zipSync(changed))).rejects.toThrow(/record 0x9999/);
  const pkg = await DocxPackage.open(zipSync(changed), { bestEffort: true }); expect(pkg.readOnly).toBe(true); expect(pkg.parts).toEqual(changed);
});
