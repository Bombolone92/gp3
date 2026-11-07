import {beforeAll, afterAll, it, expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {readOpenTypeFeatures} from '../src/engine/ligatures.js';

const folder = 'tests/fixtures/script-kerning-defaults/';
const reference = JSON.parse(readFileSync(folder + 'reference.json'));
let dom;
beforeAll(() => {
  dom = new JSDOM();
  for (const name of ['DOMParser', 'XMLSerializer']) globalThis[name] = dom.window[name];
});
afterAll(() => { dom.window.close(); for (const name of ['DOMParser', 'XMLSerializer']) delete globalThis[name]; });
for (const entry of reference) it(`resolves and preserves native run defaults: ${entry.name}`, async () => {
  const bytes = readFileSync(folder + entry.name + '.docx');
  const pkg = await DocxPackage.open(bytes);
  const doc = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  const enabled = entry.enabled ?? entry.compatibilityMode === 15;
  expect(pkg.styles.openTypeFeatures).toBe(enabled);
  expect(doc.paragraphs).toHaveLength(entry.rows.length);
  const modes = doc.paragraphs.map((p, i) => {
    expect(p.runs[0].kerning).toBe(entry.rows[i].nativeKerning);
    const mode = enabled && entry.rows[i].nativeLigatures === 3 ? 'standardContextual' : 'none';
    expect(p.runs[0].ligatures).toBe(mode);
    return mode;
  });
  const save = async () => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
  expect(unzipSync(await save())).toEqual(unzipSync(bytes));
  doc.select(0); doc.replace('EDIT ');
  const edited = await save(), reopened = await DocxPackage.open(edited);
  expect(reopened.paragraphs.map(p => p.runs[0].ligatures)).toEqual(modes);
  for (const part of ['word/styles.xml', 'word/settings.xml']) expect(unzipSync(edited)[part]).toEqual(pkg.parts[part]);
  doc.undo(); expect(unzipSync(await save())).toEqual(unzipSync(bytes));
});

it('keeps explicit OpenType flags authoritative over the compatibility default', () => {
  const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const parse = value => new DOMParser().parseFromString(`<w:settings xmlns:w="${w}"><w:compat><w:compatSetting w:name="enableOpenTypeFeatures" w:uri="http://schemas.microsoft.com/office/word" w:val="${value}"/></w:compat></w:settings>`, 'application/xml').documentElement;
  for (const mode of [12, 14, 15]) {
    expect(readOpenTypeFeatures(parse('0'), mode)).toBe(false);
    expect(readOpenTypeFeatures(parse('1'), mode)).toBe(true);
  }
  expect(readOpenTypeFeatures(undefined)).toBe(false);
});
