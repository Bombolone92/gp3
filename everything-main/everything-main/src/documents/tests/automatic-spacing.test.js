import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument, paragraphText } from '../src/engine/model.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { resolvedFormat } from '../src/engine/formatting.js';

let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const refs = JSON.parse(readFileSync('tests/fixtures/automatic-spacing/reference.json'));
const bytes = name => readFileSync('public/fixtures/' + name);
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const save = async (p,d) => new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const layout = d => layoutDocument(d.paragraphs, (text, style) => ({ width: text.length * style.fontSize / 2, ascent: style.fontSize, descent: style.fontSize / 3 }), pageGeometry(d.pageSettings), d.numbering, d.tables);
const select = (d, text) => { const at = d.text.indexOf(text); expect(at).toBeGreaterThanOrEqual(0); d.select(at, at + text.length); };
const find = (d, text) => d.paragraphs.find(p => paragraphText(p) === text);

for (const ref of refs) it('matches the native reference paragraph gaps and retains every package part: ' + ref.file, async () => {
  const pkg = await DocxPackage.open(bytes(ref.file)), d = model(pkg), result = layout(d);
  expect(result.pageCount).toBe(ref.pages.length);
  for (const [page, lines] of ref.pages.entries()) {
    let previous;
    for (const item of lines) {
      const p = find(d, item.text); if (!p) continue; // PDF list markers are separate text objects.
      const line = result.lines.find(l => l.paragraphId === p.id);
      expect(line.page, item.text).toBe(page);
      if (previous && p.runs[0].fontSize === previous.p.runs[0].fontSize) expect((line.y - previous.line.y) * .75, item.text).toBeCloseTo(item.baseline - previous.item.baseline, 0);
      previous = { p, line, item };
    }
  }
  expect(unzipSync(await save(pkg,d))).toEqual(pkg.parts);
});

it('explicit edits replace automatic spacing even at the same displayed value; clear and undo restore it', async () => {
  const pkg = await DocxPackage.open(bytes('automatic-spacing-modern.docx')), d = model(pkg);
  select(d,'S10Auto1B'); const before = layout(d);
  expect(d.setParagraphFormat({ spaceBefore: 14, spaceAfter: 7 })).toBe(true);
  expect(find(d,'S10Auto1B').format.autoSpaceBefore).toBeUndefined();
  let saved = await save(pkg,d), reopened = model(await DocxPackage.open(saved));
  expect(find(reopened,'S10Auto1B').format).toMatchObject({ spaceBefore:14,spaceAfter:7 });
  expect(find(reopened,'S10Auto1B').format.autoSpaceAfter).toBeUndefined();
  for (const [name, part] of Object.entries(pkg.parts)) if (name !== 'word/document.xml') expect(unzipSync(saved)[name]).toEqual(part);
  d.undo(); expect(layout(d)).toEqual(before); expect(unzipSync(await save(pkg,d))).toEqual(pkg.parts);
  d.redo(); expect(find(d,'S10Auto1B').format.autoSpaceAfter).toBeUndefined();
});

it('resolves inherited flags, explicit false and restoration', async () => {
  const parts = unzipSync(bytes('automatic-spacing-modern.docx'));
  parts['word/styles.xml'] = strToU8(strFromU8(parts['word/styles.xml']).replace('w:before="0" w:after="0"','w:before="0" w:after="0" w:beforeAutospacing="1" w:afterAutospacing="1"'));
  const pkg = await DocxPackage.open(zipSync(parts)), d = model(pkg);
  expect(find(d,'S10Auto1A').format).toMatchObject({autoSpaceBefore:true,autoSpaceAfter:true});
  expect(find(d,'S10Auto0B').format).toMatchObject({spaceBefore:24,spaceAfter:36});
  expect(find(d,'S10Auto0B').format.autoSpaceBefore).toBeUndefined();
  select(d,'S10Auto1A'); d.setParagraphFormat({spaceBefore:3});
  expect(find(d,'S10Auto1A').format.autoSpaceBefore).toBeUndefined();
  d.clearDirectParagraphFormatting(); expect(find(d,'S10Auto1A').format.autoSpaceBefore).toBe(true);
  expect(find(model(await DocxPackage.open(await save(pkg,d))),'S10Auto1A').format.autoSpaceBefore).toBe(true);
});

it.each(['1','true','on'])('automatic %s overrides explicit points and line units', value => {
  expect(resolvedFormat({spacing:{beforeAutospacing:value,before:'300',beforeLines:'200'}})).toMatchObject({spaceBefore:14,explicitSpaceBefore:24,autoSpaceBefore:true});
});

it('retains and validates the additive compatibility flag', async () => {
  const pkg=await DocxPackage.open(bytes('automatic-spacing-fixed.docx')),d=model(pkg);
  expect(d.pageSettings.doNotUseHTMLParagraphAutoSpacing).toBe(true);
  select(d,'S10Auto1B');expect(d.paragraphFormatting).toMatchObject({spaceBefore:24,spaceAfter:36});
  expect(() => d.setPageSettings({doNotUseHTMLParagraphAutoSpacing:false})).toThrow(/retained/);
  const parts={...pkg.parts};parts['word/settings.xml']=strToU8(strFromU8(parts['word/settings.xml']).replace('<w:doNotUseHTMLParagraphAutoSpacing/>','<w:doNotUseHTMLParagraphAutoSpacing w:val="invalid"/>'));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
});
