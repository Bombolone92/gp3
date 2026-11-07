import {beforeAll, afterAll, it, expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync, zipSync, strToU8, strFromU8} from 'fflate';
import {DocxPackage, W} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {contentControlRanges} from '../src/engine/content-controls.js';

let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/persistent-inline-controls.docx');
const references = JSON.parse(readFileSync('tests/fixtures/persistent-inline-controls/reference.json'));
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const save = async (p,d) => new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const title = c => new DOMParser().parseFromString(c.shell,'application/xml').getElementsByTagNameNS(W,'alias')[0].getAttributeNS(W,'val');
const range = (d,name) => contentControlRanges(d.paragraphs).find(r => title(r.control) === name);

for (const ref of references.filter(r => !r.error)) it(`retains the persistent control through ${ref.case}, matching the native reference`, async () => {
  const p = await DocxPackage.open(source), d = model(p), r = range(d,ref.case);
  expect(unzipSync(await save(p,d))).toEqual(p.parts);
  switch (ref.case) {
    case 'insert': d.select(r.start+2); d.replace('X'); break;
    case 'replace': case 'temporary-false': d.select(r.start,r.end); d.replace('Changed'); break;
    case 'delete-part': d.select(r.start+2,r.start+4); d.replace(''); break;
    case 'delete-all': d.select(r.start,r.end); d.replace(''); break;
    case 'format': d.select(r.start,r.start+5); d.toggleBold(); break;
    case 'start-boundary': d.select(r.start); d.replace('X'); break;
    case 'end-boundary': d.select(r.end); d.replace('X'); break;
    case 'placeholder': d.select(r.start+2); d.replace('Entered'); break;
  }
  const bytes = await save(p,d), reopened = model(await DocxPackage.open(bytes));
  for (const current of [d,reopened]) {
    expect(contentControlRanges(current.paragraphs)).toHaveLength(ref.controlCount);
    const actual = range(current,ref.case);
    expect(actual.runs.map(r => r.text).join('')).toBe(ref.text);
    expect(actual.control.placeholder).toBe(ref.placeholder);
    if (ref.case === 'format') expect(actual.runs[0]).toMatchObject({text:'Alpha',bold:true});
  }
  expect(reopened.text).toBe(d.text);
  for (const [name,data] of Object.entries(p.parts)) if (name !== 'word/document.xml') expect(unzipSync(bytes)[name]).toEqual(data);
  d.undo(); expect(unzipSync(await save(p,d))).toEqual(p.parts);
  d.redo(); expect(d.text).toBe(reopened.text);
}, 30000);

it('keeps a rejected inline paragraph split atomic, as the native reference does', async () => {
  const p = await DocxPackage.open(source), d = model(p), r = range(d,'split');
  d.select(r.start+5); const before = d.snapshot();
  expect(() => d.replace('\n')).toThrow(/paragraph.*control|control.*paragraph/i);
  expect(d.snapshot()).toEqual(before);
  expect(unzipSync(await save(p,d))).toEqual(p.parts);
});

it('preserves internal bookmarks and hyperlinks through edit, reopen and undo', async () => {
  const p = await DocxPackage.open(source), d = model(p), r = range(d,'insert');
  d.select(r.start+1,r.end-1); d.addBookmark('InsidePersistent');
  d.setHyperlink('https://example.com/');
  const reopened = model(await DocxPackage.open(await save(p,d)));
  expect(reopened.bookmarks[0]).toMatchObject({name:'InsidePersistent',start:r.start+1,end:r.end-1});
  expect(range(reopened,'insert').runs.some(r => r.link?.target === 'https://example.com/')).toBe(true);
  expect(contentControlRanges(reopened.paragraphs)).toHaveLength(10);
  d.undo(); d.undo(); expect(unzipSync(await save(p,d))).toEqual(p.parts);
});

it.each(['Changed',''])('retains controls and bookmark positions after search replacement with %j', async text => {
  const p = await DocxPackage.open(source), d = model(p);
  const first = range(d,'insert'); d.select(first.start,first.end); d.addBookmark('AroundPersistent');
  expect(d.replaceMatches('Alpha beta',text,{},true)).toBe(10);
  const reopened = model(await DocxPackage.open(await save(p,d)));
  expect(contentControlRanges(reopened.paragraphs)).toHaveLength(10);
  expect(reopened.text).toBe(d.text);
  const positions = current => current.bookmarks.map(({name,start,end}) => ({name,start,end}));
  expect(positions(reopened)).toEqual(positions(d));
  for (const r of contentControlRanges(reopened.paragraphs)) expect(r.control.placeholder).toBe(!text);
  d.undo(); d.undo(); expect(unzipSync(await save(p,d))).toEqual(p.parts);
});

it('restores the glossary placeholder with its formatting after editing and reopening', async () => {
  const bytes = readFileSync('public/fixtures/persistent-inline-glossary.docx');
  const p = await DocxPackage.open(bytes), d = model(p), first = range(d,'insert');
  d.select(first.start,first.end); d.replace('A name');
  const reopenedPackage = await DocxPackage.open(await save(p,d)), reopened = model(reopenedPackage);
  const r = range(reopened,'insert'); reopened.select(r.start,r.end); reopened.replace('');
  const restored = range(reopened,'insert');
  expect(restored.runs.map(r => r.text).join('')).toBe('Enter name');
  expect(restored.runs[0]).toMatchObject({bold:true,color:'2050C0'});
  expect(range(model(await DocxPackage.open(await save(reopenedPackage,reopened))),'insert').control.placeholder).toBe(true);
});

it('restores multiline glossary prompts as run breaks, preserving formatting, package parts and undo', async () => {
  const p = await DocxPackage.open(readFileSync('public/fixtures/placeholder-breaks.docx')), d = model(p);
  expect(unzipSync(await save(p,d))).toEqual(p.parts);
  const before = d.text, first = range(d,'insert');
  d.select(first.start,first.end); d.replace('');
  const prompt = range(d,'insert');
  expect(prompt.control.placeholder).toBe(true);
  expect(prompt.runs.map(r=>r.text).join('')).toBe('First line\vSecond line\vThird line');
  expect(prompt.runs[0]).toMatchObject({bold:true,color:'2050C0'});
  const bytes = await save(p,d), reopened = model(await DocxPackage.open(bytes));
  expect(reopened.text).toBe(d.text);
  expect(reopened.paragraphs.length).toBe(d.paragraphs.length);
  for (const [name,data] of Object.entries(p.parts)) if (name !== 'word/document.xml') expect(unzipSync(bytes)[name]).toEqual(data);
  d.undo(); expect(d.text).toBe(before); expect(unzipSync(await save(p,d))).toEqual(p.parts);
  d.redo(); expect(d.text).toBe(reopened.text);
});

it.each([
  ['<w:br w:type="textWrapping" w:clear="none"/>','\v'],
  ['<w:br w:type="page"/>','\f'],
  ['<w:br w:type="column"/>','\u000e'],
])('supports glossary break %s after restoration and reopening', async (markup, character) => {
  const parts = unzipSync(readFileSync('public/fixtures/placeholder-breaks.docx'));
  parts['word/glossary/document.xml'] = strToU8(strFromU8(parts['word/glossary/document.xml']).replace('<w:br/>',markup));
  const p = await DocxPackage.open(zipSync(parts)), d = model(p), r = range(d,'insert');
  d.select(r.start,r.end); d.replace('');
  expect(range(d,'insert').runs.map(r=>r.text).join('')).toBe(`First line${character}Second line\vThird line`);
  expect(model(await DocxPackage.open(await save(p,d))).text).toBe(d.text);
});

it.each(['<w:br w:clear="all"/>','<w:br><w:t>x</w:t></w:br>','<w:br w:unknown="1"/>','<w:cr w:type="page"/>'])('rejects unsupported or malformed glossary breaks: %s', async markup => {
  const parts = unzipSync(readFileSync('public/fixtures/placeholder-breaks.docx'));
  parts['word/glossary/document.xml'] = strToU8(strFromU8(parts['word/glossary/document.xml']).replace('<w:br/>',markup));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/placeholder breaks|attributes|nested/);
});

it('preserves bookmark markers nested inside a persistent control hyperlink', async () => {
  const parts=unzipSync(source), xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');
  const content=xml.getElementsByTagNameNS(W,'sdtContent')[0];
  const fragment=new DOMParser().parseFromString(`<w:hyperlink xmlns:w="${W}" w:anchor="Target"><w:r><w:t>Al</w:t></w:r><w:bookmarkStart w:id="31" w:name="Target"/><w:r><w:t>pha b</w:t></w:r><w:bookmarkEnd w:id="31"/><w:r><w:t>eta</w:t></w:r></w:hyperlink>`,'application/xml');
  content.replaceChildren(xml.importNode(fragment.documentElement,true));
  parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));
  const p=await DocxPackage.open(zipSync(parts)), d=model(p), r=range(d,'insert');
  d.select(0);d.replace('Intro ');
  const reopened=model(await DocxPackage.open(await save(p,d)));
  expect(reopened.bookmarks[0]).toMatchObject({name:'Target',start:r.start+8,end:r.start+13});
  expect(contentControlRanges(reopened.paragraphs)).toHaveLength(10);
  d.undo();expect(unzipSync(await save(p,d))).toEqual(parts);
});

it('removes a wholly selected unlocked wrapper when search also replaces surrounding text', async () => {
  const p=await DocxPackage.open(source), d=model(p), r=range(d,'insert');
  d.select(r.start,r.end+6); expect(d.replaceMatches('Alpha beta after','Replaced')).toBe(1);
  const reopened=model(await DocxPackage.open(await save(p,d)));
  expect(range(reopened,'insert')).toBeUndefined();
  expect(contentControlRanges(reopened.paragraphs)).toHaveLength(9);
  expect(reopened.text).toBe(d.text);
  d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});

it('inserts an inline picture at the actual placeholder replacement offset', async () => {
  const pictures=await DocxPackage.open(readFileSync('public/fixtures/inline-images.docx'));
  const p=await DocxPackage.open(source),d=model(p),r=range(d,'placeholder');
  d.assets.probe={bytes:Object.values(pictures.assets)[0].bytes,mime:'image/png'};
  d.select(r.start+2);d.insertImage('probe',{width:914400,height:457200,alt:'Probe image'});
  expect(d.selectedImage.alt).toBe('Probe image');
  const reopened=model(await DocxPackage.open(await save(p,d))), control=range(reopened,'placeholder');
  expect(control.runs).toHaveLength(1);expect(control.runs[0].image.alt).toBe('Probe image');
  expect(control.control.placeholder).toBe(false);
  d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});

it('preserves an explicit false placeholder flag until restoring placeholder contents', async () => {
  const parts=unzipSync(source);
  parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace('<w:richText/>','<w:showingPlcHdr w:val="false"/><w:richText/>'));
  const p=await DocxPackage.open(zipSync(parts)), d=model(p);
  d.select(0);d.replace('Intro ');
  const unrelated=await save(p,d), xml=new DOMParser().parseFromString(strFromU8(unzipSync(unrelated)['word/document.xml']),'application/xml');
  expect(xml.getElementsByTagNameNS(W,'sdt')[0].getElementsByTagNameNS(W,'showingPlcHdr')[0].getAttributeNS(W,'val')).toBe('false');
  const r=range(d,'insert');d.select(r.start,r.end);d.replace('');
  expect(range(model(await DocxPackage.open(await save(p,d))),'insert').control.placeholder).toBe(true);
  d.undo();d.undo();expect(unzipSync(await save(p,d))).toEqual(parts);
});
