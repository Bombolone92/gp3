import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage, W } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { invalidateProofingState } from '../src/engine/docx-proofing-state.js';

let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = () => readFileSync('tests/fixtures/proofing-state/proofing-clean.docx');
const model = pkg => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
const save = async (pkg, d) => unzipSync(new Uint8Array(await pkg.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer()));
const flags = parts => {
  const path = Object.keys(parts).find(p => strFromU8(parts[p]).includes('<w:proofState'));
  const node = new DOMParser().parseFromString(strFromU8(parts[path]), 'application/xml').getElementsByTagNameNS(W, 'proofState')[0];
  return ['spelling', 'grammar'].map(name => node.getAttributeNS(W, name));
};
it('invalidates clean proofing on insertion, preserves unrelated parts, and restores exact source on undo', async () => {
  const original = unzipSync(source()), pkg = await DocxPackage.open(source()), d = model(pkg);
  expect(await save(pkg, d)).toEqual(original);
  d.select(0); d.replace('Another ');
  const edited = await save(pkg, d);
  expect(flags(edited)).toEqual(['dirty', 'dirty']);
  for (const path of Object.keys(original)) if (!['word/document.xml', 'word/settings.xml'].includes(path)) expect(edited[path], path).toEqual(original[path]);
  expect(model(await DocxPackage.open(zipSync(edited))).text).toBe('Another jumpd');
  d.undo(); expect(await save(pkg, d)).toEqual(original);
});
it('keeps completed proofing through run splitting and paragraph geometry edits', async () => {
  const pkg = await DocxPackage.open(source()), d = model(pkg);
  d.select(1, 3); d.setRunFormat({ bold: true });
  d.setParagraphFormat({ alignment: 'center' });
  expect((await save(pkg, d))['word/settings.xml']).toEqual(pkg.parts['word/settings.xml']);
});
it.each([{ noProof: true }, { fontLanguage: 'en-AU' }])('invalidates completed proofing after changing body proofing scope: %j', async patch => {
  const pkg = await DocxPackage.open(source()), d = model(pkg);
  d.select(0, 5); d.setRunFormat(patch);
  expect(flags(await save(pkg, d))).toEqual(['dirty', 'dirty']);
  d.undo(); expect(await save(pkg, d)).toEqual(pkg.parts);
});
it.each(['dirty', 'flagged'])('handles the %s control without inventing a completed check', async name => {
  const pkg = await DocxPackage.open(readFileSync(`tests/fixtures/proofing-state/proofing-${name}.docx`)), d = model(pkg);
  d.select(0, 5); d.replace('jumped');
  expect(flags(await save(pkg, d))).toEqual(['dirty', 'dirty']);
});
it.each(['header', 'footer', 'footnotes', 'endnotes', 'comments'])('invalidates text in a relocated %s part', type => {
  const original = unzipSync(source()), path = `word/relocated/${type}.xml`;
  original['[Content_Types].xml'] = strToU8(strFromU8(original['[Content_Types].xml']).replace('</Types>', `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${type}+xml"/></Types>`));
  original[path] = strToU8(`<w:${type} xmlns:w="${W}"><w:p><w:r><w:t>Before</w:t></w:r></w:p></w:${type}>`);
  const parts = { ...original, [path]: strToU8(strFromU8(original[path]).replace('Before', 'After')) };
  invalidateProofingState(parts, original); expect(flags(parts)).toEqual(['dirty', 'dirty']);
});
it('resolves a relocated settings relationship and preserves independent dirty or omitted states', () => {
  const original = unzipSync(source()), path = 'word/options/proofing.xml';
  original[path] = strToU8(`<w:settings xmlns:w="${W}"><w:proofState w:spelling="clean"/><w:defaultTabStop w:val="720"/></w:settings>`);
  delete original['word/settings.xml'];
  original['word/_rels/document.xml.rels'] = strToU8(strFromU8(original['word/_rels/document.xml.rels']).replace('Target="settings.xml"', 'Target="options/proofing.xml"'));
  const parts = { ...original, 'word/document.xml': strToU8(strFromU8(original['word/document.xml']).replace('jumpd', 'jumped')) };
  invalidateProofingState(parts, original);
  expect(flags(parts)).toEqual(['dirty', null]); expect(strFromU8(parts[path])).toContain('<w:defaultTabStop w:val="720"/>');
});
it('does not create settings or flags when completion was never claimed', () => {
  const original = unzipSync(source());
  original['word/settings.xml'] = strToU8(`<w:settings xmlns:w="${W}"/>`);
  const parts = { ...original, 'word/document.xml': strToU8(strFromU8(original['word/document.xml']).replace('jumpd', 'jumped')) };
  invalidateProofingState(parts, original); expect(parts['word/settings.xml']).toBe(original['word/settings.xml']);
});
it('invalidates an actual header export and restores its settings and story bytes on undo', async () => {
  const original = unzipSync(readFileSync('public/fixtures/header-drawings.docx'));
  original['word/settings.xml'] = unzipSync(source())['word/settings.xml'];
  const pkg = await DocxPackage.open(zipSync(original)), path = 'word/stories/header.xml', story = pkg.pageStories.stories[path];
  const d = new TextDocument(story.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, story.tables, pkg.assets);
  const exportStory = async () => unzipSync(new Uint8Array(await pkg.export(undefined, undefined, undefined, undefined, undefined, undefined, { [path]: { paragraphs: d.paragraphs, tables: d.tables } }).arrayBuffer()));
  d.select(0); d.replace('Changed '); expect(flags(await exportStory())).toEqual(['dirty', 'dirty']);
  d.undo(); expect(await exportStory()).toEqual(original);
});
it('invalidates changed DrawingML text but preserves geometry-only changes', () => {
  const original = unzipSync(source()), path = 'word/document.xml';
  original[path] = strToU8(strFromU8(original[path]).replace('<w:t>jumpd</w:t>', '<w:drawing xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:xfrm><a:off x="0" y="0"/></a:xfrm><a:p><a:r><a:t>jumpd</a:t></a:r></a:p></w:drawing>'));
  const moved = { ...original, [path]: strToU8(strFromU8(original[path]).replace('x="0"', 'x="10"')) };
  invalidateProofingState(moved, original); expect(moved['word/settings.xml']).toBe(original['word/settings.xml']);
  const edited = { ...original, [path]: strToU8(strFromU8(original[path]).replace('jumpd', 'jumped')) };
  invalidateProofingState(edited, original); expect(flags(edited)).toEqual(['dirty', 'dirty']);
});
it('changes only the clean proofState values and keeps the XML declaration byte for byte', () => {
  const original = unzipSync(source()), declaration = "<?xml version='1.0' encoding='UTF-8' standalone='yes'?>\r\n";
  original['word/settings.xml'] = strToU8(`${declaration}<w:settings xmlns:w="${W}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:zoom w:percent='100'/><w:proofState w:spelling='clean'  w:grammar="clean" /><w:defaultTabStop w:val="720"/></w:settings>`);
  const parts = { ...original, 'word/document.xml': strToU8(strFromU8(original['word/document.xml']).replace('jumpd', 'jumped')) };
  invalidateProofingState(parts, original);
  expect(strFromU8(parts['word/settings.xml'])).toBe(strFromU8(original['word/settings.xml']).replace("w:spelling='clean'", "w:spelling='dirty'").replace('w:grammar="clean"', 'w:grammar="dirty"'));
});
it('keeps the declaration when an ambiguous proofState requires reserialization', () => {
  const original = unzipSync(source());
  original['word/settings.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings xmlns:w="${W}"><w:proofState w:spelling="&#99;lean" w:grammar="clean"/></w:settings>`);
  const parts = { ...original, 'word/document.xml': strToU8(strFromU8(original['word/document.xml']).replace('jumpd', 'jumped')) };
  invalidateProofingState(parts, original);
  expect(flags(parts)).toEqual(['dirty', 'dirty']); expect(strFromU8(parts['word/settings.xml'])).toMatch(/^<\?xml version="1.0" encoding="UTF-8" standalone="yes"\?>/);
});
it('keeps completed proofing when only tab stop definitions change', () => {
  const original = unzipSync(source()), path = 'word/document.xml';
  original[path] = strToU8(strFromU8(original[path]).replace('<w:p>', '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>'));
  const parts = { ...original, [path]: strToU8(strFromU8(original[path]).replace('<w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs>', '<w:tabs><w:tab w:val="left" w:pos="720"/><w:tab w:val="right" w:pos="1440"/></w:tabs>')) };
  expect(parts[path]).not.toEqual(original[path]);
  invalidateProofingState(parts, original); expect(parts['word/settings.xml']).toBe(original['word/settings.xml']);
});
