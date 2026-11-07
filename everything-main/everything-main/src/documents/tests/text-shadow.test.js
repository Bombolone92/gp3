import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage, createDocx } from '../src/engine/docx.js';
import { TextDocument, paragraph } from '../src/engine/model.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { checkedTextShadow } from '../src/engine/text-shadow.js';

let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('tests/fixtures/text-shadow-line-metrics/control.docx');
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const save = async (p, d) => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
const equalParts = (a, b, except = []) => { expect(Object.keys(a)).toEqual(Object.keys(b)); for (const key in a) if (!except.includes(key)) expect(a[key], key).toEqual(b[key]); };
const shadow = checkedTextShadow({ distance: 38100, direction: 5400000, scaleX: 1, scaleY: 1, alignment: 'ctr', color: '888888' });

it('imports shadow and outline independently and preserves the original OPC bytes', async () => {
  const p = await DocxPackage.open(source), d = model(p);
  expect(p.readOnly).toBeFalsy();
  const runs = d.paragraphs.filter(p => p.runs.some(r => r.text.startsWith('Sample'))).map(p => p.runs[0]);
  expect(runs.map(r => !!r.textShadow)).toEqual([false, true, false, true, false, true, false, true, false, true, false, true]);
  expect(runs[1].textShadow).toMatchObject({ distance: 38100, direction: 2640000, color: '888888', alpha: 1 });
  equalParts(unzipSync(await save(p, d)), p.parts);
});

it('retains shadows during splitting, insertion, font changes, export and exact undo', async () => {
  const p = await DocxPackage.open(source), d = model(p);
  const at = d.text.indexOf('Sample line 1', d.text.indexOf('After')) + 7;
  d.select(at); d.replace('new '); d.select(at, at + 4); d.setRunFormat({ fontSize: 24 });
  const edited = await save(p, d), reopened = model(await DocxPackage.open(edited));
  expect(reopened.text).toContain('Sample new line 1');
  expect(reopened.paragraphs.flatMap(p => p.runs).find(r => r.text === 'new ').textShadow).toMatchObject({ distance: 38100, direction: 2640000 });
  equalParts(unzipSync(edited), p.parts, ['word/document.xml']);
  d.undo(); d.undo(); equalParts(unzipSync(await save(p, d)), p.parts);
});

it('writes and clears an explicit shadow with markup compatibility in a new document', async () => {
  const p = createDocx([paragraph('New shadow')]), d = model(p);
  d.select(0, d.text.length); d.setRunFormat({ textShadow: shadow });
  const bytes = await save(p, d);
  expect(strFromU8(unzipSync(bytes)['word/document.xml'])).toContain('mc:Ignorable="w14"');
  expect(model(await DocxPackage.open(bytes)).paragraphs[0].runs[0].textShadow).toEqual(shadow);
  d.setRunFormat({ textShadow: null });
  expect(model(await DocxPackage.open(await save(p, d))).paragraphs[0].runs[0].textShadow).toMatchObject({ alpha: 0, distance: 0, blurRadius: 0, scaleX: 0, scaleY: 0 });
});

it('preserves kerning and caret stops across adjacent shadow and plain runs', () => {
  const d = new TextDocument([paragraph('AVAV')]);
  const measure = text => ({ width: (text.length - (text.match(/AV/g)?.length || 0) / 3) * 8, ascent: 12, descent: 4 });
  const layout = () => layoutDocument(d.paragraphs, measure, pageGeometry(d.pageSettings));
  const before = layout(); d.select(1, 3); d.setRunFormat({ textShadow: shadow }); const after = layout();
  expect(after.lines[0].fragments).toHaveLength(1);
  expect(after.lines[0].stops).toEqual(before.lines[0].stops);
  expect(after.lines[0].height).toBeGreaterThan(before.lines[0].height);
  expect(after.lines[0].fragments[0].colors.map(c => !!c.textShadow)).toEqual([false, true, false]);
});

it.each(['w14:dist="-1"', 'w14:dist="1.5"', 'w14:dist="2147483647"'])('rejects an invalid shadow distance %s', replacement => {
  const parts = unzipSync(source); parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('w14:dist="38100"', replacement));
  return expect(DocxPackage.open(zipSync(parts))).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
});

it('uses the documented zero scale defaults and ordered alpha/luminance transforms', async () => {
  const parts = unzipSync(source);
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml'])
    .replace(' w14:sx="100000" w14:sy="100000"', '')
    .replace('<w14:srgbClr w14:val="888888"/>', '<w14:srgbClr w14:val="888888"><w14:lumMod w14:val="50000"/><w14:alpha w14:val="25000"/></w14:srgbClr>'));
  const p = await DocxPackage.open(zipSync(parts)), s = p.paragraphs.flatMap(p => p.runs).find(r => r.textShadow).textShadow;
  expect(s).toMatchObject({ color: '888888', alpha: 1, scaleX: 1, scaleY: 1 }); // First removed declaration belongs to the paragraph mark.
  expect(p.paragraphs.find(p => p.markFormat.textShadow).markFormat.textShadow).toMatchObject({ color: '444444', alpha: .25, scaleX: 0, scaleY: 0 });
});

it('resolves inherited shadows and preserves style editing and removal through export', async () => {
  const parts = unzipSync(source); let effect;
  const xml = strFromU8(parts['word/document.xml']).replace(/<w:r><w:rPr>([\s\S]*?)<\/w:rPr>/g, (whole, props) => {
    const found = props.match(/<w14:shadow[\s\S]*?<\/w14:shadow>/);
    if (effect || !found) return whole;
    effect = found[0];
    return '<w:r><w:rPr><w:rStyle w:val="ShadowStyle"/>' + props.replace(effect, '') + '</w:rPr>';
  });
  expect(effect).toBeTruthy(); parts['word/document.xml'] = strToU8(xml);
  parts['word/styles.xml'] = strToU8(`<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14"><w:style w:type="character" w:styleId="ShadowStyle"><w:name w:val="Shadow Style"/><w:rPr>${effect}</w:rPr></w:style></w:styles>`);
  parts['word/_rels/document.xml.rels'] = strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  parts['[Content_Types].xml'] = strToU8(strFromU8(parts['[Content_Types].xml']).replace('</Types>', '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'));
  const p = await DocxPackage.open(zipSync(parts)), d = model(p);
  expect(d.paragraphs[2].runs[0].textShadow.color).toBe('888888'); equalParts(unzipSync(await save(p, d)), parts);
  d.editCharacterStyle('ShadowStyle', { run: { textShadow: { ...shadow, color: '113355' } } });
  expect(model(await DocxPackage.open(await save(p, d))).paragraphs[2].runs[0].textShadow.color).toBe('113355');
  d.editCharacterStyle('ShadowStyle', { run: { textShadow: null } });
  expect(model(await DocxPackage.open(await save(p, d))).paragraphs[2].runs[0].textShadow).toBeNull();
});
