import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument, paragraphFormat } from '../src/engine/model.js';
import { resolvedFormat } from '../src/engine/formatting.js';

let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const refs = JSON.parse(readFileSync('tests/fixtures/default-paragraph-spacing/reference.json')).cases;
for (const ref of refs) it(`matches the native reference ${ref.name} paragraph-default category`, async () => {
  const pkg = await DocxPackage.open(readFileSync(`public/fixtures/${ref.file}`), { bestEffort: true });
  const expected = Number(ref.nativeDefaultSpacing.line || 240) / 240;
  expect(resolvedFormat(pkg.styles.defaults.properties).lineSpacing).toBe(expected);
  expect(resolvedFormat(pkg.styles.defaults.properties).spaceAfter).toBe(ref.nativeCom.normalSpaceAfter);
  const footer = pkg.pageStories.stories['word/stories/footer.xml'];
  expect(paragraphFormat(footer.paragraphs[0], pkg.numbering).lineSpacing).toBe(1);
  expect(paragraphFormat(footer.paragraphs[1], pkg.numbering).lineSpacing).toBe(ref.nativeCom.lineSpacingRule === 4 ? 18 : expected);
  expect(paragraphFormat(footer.paragraphs[1], pkg.numbering).spaceAfter).toBe(0);
});

it('preserves omitted defaults on no-edit/undo and serializes an explicit override', async () => {
  const parts = unzipSync(readFileSync('public/fixtures/inline-object-baseline.docx'));
  parts['word/styles.xml'] = strToU8(strFromU8(parts['word/styles.xml']).replace(/<w:pPrDefault>.*?<\/w:pPrDefault>/, ''));
  const pkg = await DocxPackage.open(zipSync(parts));
  const model = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  const save = async () => new Uint8Array(await pkg.export(model.paragraphs, model.pageSettings, model.numbering, model.styles, model.tables, model.assets).arrayBuffer());
  const same = data => { const actual = unzipSync(data); for (const name of Object.keys(parts)) expect(Buffer.from(actual[name]).equals(Buffer.from(parts[name])), name).toBe(true); };
  expect(model.paragraphs[0].format.lineSpacing).toBe(278 / 240);
  same(await save());
  model.select(0); model.setParagraphFormat({ lineRule: 'auto', lineSpacing: 1 });
  const edited = await save(), reopened = await DocxPackage.open(edited);
  expect(reopened.paragraphs[0].format.lineSpacing).toBe(1);
  expect(reopened.paragraphs[1].format.lineSpacing).toBe(278 / 240);
  expect(Buffer.from(unzipSync(edited)['word/styles.xml']).equals(Buffer.from(parts['word/styles.xml']))).toBe(true);
  model.undo(); same(await save());
});
