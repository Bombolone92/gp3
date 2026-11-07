import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage, W } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { contentControlRanges } from '../src/engine/content-controls.js';
const folder = 'tests/fixtures/picture-controls', bytes = readFileSync(`${folder}/control.docx`);
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const name = r => new DOMParser().parseFromString(r.control.shell, 'application/xml').getElementsByTagNameNS(W, 'alias')[0].getAttributeNS(W, 'val');
const range = (d, n) => contentControlRanges(d.paragraphs).find(r => name(r) === n);
const save = async (p,d) => new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());

for (const variant of ['', '/placeholders']) {
const bytes = readFileSync(`${folder}${variant}/control.docx`), reference = JSON.parse(readFileSync(`${folder}${variant}/reference.json`));
for (const native of reference.cases) it(`matches native picture control ${variant || 'ordinary'} ${native.name}`, async () => {
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(reference.sourceSha256);
  const p = await DocxPackage.open(bytes), d = model(p), r = range(d, native.name);
  expect(unzipSync(await save(p,d))).toEqual(p.parts);
  d.select(r.start,r.end); const before = d.snapshot(), selected = {...d.selection};
  const image = r.runs[0].image;
  if (native.name.endsWith('resize')) d.setImageProperties({width:1143000,height:285750});
  else if (native.name.endsWith('replace')) d.insertImage(image.assetId,{width:609600,height:152400});
  else {
    expect(native.error).toBeTruthy();
    expect(() => native.name.endsWith('type') ? d.replace('Typed') : d.delete(1)).toThrow(/picture content control/);
    expect(d.snapshot()).toEqual(before); expect(d.history).toHaveLength(0);
  }
  const edited = await save(p,d), reopened = model(await DocxPackage.open(edited));
  for (const current of [d,reopened]) {
    expect(contentControlRanges(current.paragraphs)).toHaveLength(native.controls);
    expect(current.paragraphs.flatMap(p=>p.runs).filter(r=>r.image)).toHaveLength(native.pictures);
    const control = range(current,native.name); expect(!!control).toBe(native.retained);
    if (control) {
      if ('placeholder' in native) expect(control.control.placeholder).toBe(native.placeholder);
      expect(control.runs.filter(r=>r.image)).toHaveLength(native.insidePictures);
      expect(control.runs.filter(r=>r.image).map(r=>({cx:String(r.image.width),cy:String(r.image.height)}))).toEqual(native.extents);
    }
  }
  for (const [path,data] of Object.entries(p.parts)) if (path !== 'word/document.xml') expect(unzipSync(edited)[path],path).toEqual(data);
  if (!native.error) { d.undo(); expect(d.selection).toEqual(selected); expect(unzipSync(await save(p,d))).toEqual(p.parts); }
}, 60000);
}

it.each(['persistent-type','temporary-type'])('guards all text entry paths atomically for %s', async n => {
  const p = await DocxPackage.open(bytes), d = model(p), r = range(d,n);
  for (const action of [()=>d.replace('\n'),()=>d.replaceMatches('\ufffc','Text',{},true),()=>d.setHyperlink('https://example.com')]) {
    d.select(r.start,r.end); const before = d.snapshot();
    expect(action).toThrow(/picture content control|picture placeholders/); expect(d.snapshot()).toEqual(before); expect(d.history).toHaveLength(0);
  }
  for (const [position,direction] of [[r.start,1],[r.end,-1]]) {
    d.select(position);const before=d.snapshot();expect(()=>d.delete(direction)).toThrow(/picture content control/);
    expect(d.snapshot()).toEqual(before);expect(d.history).toHaveLength(0);
  }
  for (const position of [r.start,r.end]) {
    d.select(position);d.replace('Outside'); expect(range(d,n).runs.map(r=>r.text).join('')).toBe('\ufffc');
    await DocxPackage.open(await save(p,d));d.undo();
  }
  d.select(r.start-1,r.end+1);d.replace('Enclosing');expect(range(d,n)).toBeUndefined();
  await DocxPackage.open(await save(p,d));d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
}, 60000);

it.each(['text','hyperlink','mixed-type','attributes','wrong-drawing'])('rejects unsupported picture contents: %s',async kind=>{
  const parts=unzipSync(bytes),xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');
  const s=xml.getElementsByTagNameNS(W,'sdt')[0],pr=s.getElementsByTagNameNS(W,'sdtPr')[0],c=s.getElementsByTagNameNS(W,'sdtContent')[0];
  const make=n=>xml.createElementNS(W,'w:'+n);
  if(kind==='text'){const t=make('t');t.textContent='Invalid';c.firstElementChild.append(t);}
  if(kind==='hyperlink'){const h=make('hyperlink');h.append(c.firstElementChild);c.append(h);}
  if(kind==='mixed-type')pr.append(make('text'));
  if(kind==='attributes')pr.getElementsByTagNameNS(W,'picture')[0].setAttributeNS(W,'w:val','1');
  if(kind==='wrong-drawing')c.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main','graphicData')[0].setAttribute('uri','unsupported');
  parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
});

it.each(['text','image'])('removes enclosed picture wrappers across cells when inserting %s', async kind => {
  const parts=unzipSync(bytes),xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');
  const body=xml.getElementsByTagNameNS(W,'body')[0],ps=[...body.children].filter(n=>n.localName==='p').slice(0,2);
  const make=n=>xml.createElementNS(W,'w:'+n),table=make('tbl'),grid=make('tblGrid'),row=make('tr');
  table.append(grid,row);body.insertBefore(table,ps[0]);
  // The second cell contains only the wrapper: its edit subrange equals the
  // contents, although the user's original selection encloses both wrappers.
  const second=ps[1].getElementsByTagNameNS(W,'sdt')[0];ps[1].replaceChildren(second);
  for(const p of ps){const col=make('gridCol');col.setAttributeNS(W,'w:w','4320');grid.append(col);const cell=make('tc');cell.append(p);row.append(cell);}
  parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));
  const p=await DocxPackage.open(zipSync(parts)),d=model(p),first=range(d,'persistent-resize'),last=range(d,'persistent-type'),asset=first.runs[0].image.assetId;
  d.select(first.start-1,last.end);const before=d.snapshot();
  if(kind==='image')d.insertImage(asset,{width:609600,height:152400});else d.replace('Text');
  expect(range(d,'persistent-resize')).toBeUndefined();expect(range(d,'persistent-type')).toBeUndefined();
  expect(d.paragraphs.filter(p=>p.cellId)).toHaveLength(2);
  const reopened=model(await DocxPackage.open(await save(p,d)));expect(reopened.text).toBe(d.text);
  expect(contentControlRanges(reopened.paragraphs)).toHaveLength(6);
  if(kind==='image')expect(d.selectedImage.assetId).toBe(asset);
  d.undo();expect(d.snapshot()).toEqual(before);expect(unzipSync(await save(p,d))).toEqual(p.parts);
}, 60000);
