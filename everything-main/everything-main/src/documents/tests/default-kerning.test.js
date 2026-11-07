import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { DocxPackage, createDocx } from '../src/engine/docx.js';
import { TextDocument, paragraph } from '../src/engine/model.js';
import { assertPackageParts } from './helpers/assert-package-parts.js';

const folder = 'tests/fixtures/default-kerning/';
const reference = JSON.parse(readFileSync(folder + 'reference.json'));
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
it('binds independently authored source and native measurements', () => {
  for (const [name, hash] of Object.entries(reference.sha256)) expect(createHash('sha256').update(readFileSync(folder + name)).digest('hex'), name).toBe(hash);
});
for (const ref of reference.cases) it(`preserves the native reference kerning defaults and explicit overrides: ${ref.name}`, async () => {
  const pkg = await DocxPackage.open(readFileSync(folder + ref.name + '.docx'));
  const model = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  const thresholds = p => p.paragraphs.map(p => p.runs[0].kerning);
  expect(thresholds(model)).toEqual(ref.thresholds);
  const save = async () => new Uint8Array(await pkg.export(model.paragraphs, model.pageSettings, model.numbering, model.styles, model.tables, model.assets).arrayBuffer());
  assertPackageParts(unzipSync(await save()), pkg.parts);
  model.select(0, model.paragraphs[0].runs[0].text.length); model.setRunFormat({ kerning: 0 });
  const edited = await save(), parts = unzipSync(edited);
  expect((await DocxPackage.open(edited)).paragraphs[0].runs[0].kerning).toBe(0);
  for (const name of Object.keys(pkg.parts)) if (name !== 'word/document.xml') expect(Buffer.from(parts[name]).equals(Buffer.from(pkg.parts[name])), name).toBe(true);
  model.undo(); expect(thresholds(model)).toEqual(ref.thresholds); assertPackageParts(unzipSync(await save()), pkg.parts);
});
it('keeps newly authored documents explicitly unkerned', async () => {
  const authored = createDocx([paragraph('AVATAR')]);
  const pkg = await DocxPackage.open(new Uint8Array(await authored.export(authored.paragraphs).arrayBuffer()));
  expect(pkg.paragraphs[0].runs[0].kerning).toBe(0);
});
