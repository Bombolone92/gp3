import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { DocxPackage, W } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutDocument, caretRect, hitTest, selectionRects } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';

let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/style-line-spacing.docx');
const model = pkg => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
const save = async (pkg, doc) => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
const select = (doc, text) => { const at = doc.text.indexOf(text); expect(at).toBeGreaterThanOrEqual(0); doc.select(at, at + text.length); };
const layout = doc => layoutDocument(doc.paragraphs, (text, style) => ({ width: [...text].length * style.fontSize * 2 / 3, ascent: style.fontSize, descent: style.fontSize / 3 }), pageGeometry(doc.pageSettings), doc.numbering, doc.tables);
const edit = (doc, id, paragraph) => doc.editParagraphStyle(id, { paragraph });
const sameParts = (a, b, except = []) => { expect(Object.keys(a)).toEqual(Object.keys(b)); for (const key of Object.keys(a)) if (!except.includes(key)) expect(Buffer.from(a[key]).equals(Buffer.from(b[key])), key).toBe(true); };

it('loads independent inherited, direct, reset, omitted-rule and rule-only declarations without changing package parts', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  for (const [label, lineRule, lineSpacing] of [['Base A', 'exact', 24], ['Child follows', 'exact', 24], ['Direct minimum', 'atLeast', 18], ['Reset becomes', 'auto', 1.5], ['Omitted rule', 'auto', 1.25], ['Rule inherits', 'atLeast', 24]]) {
    select(doc, label); expect(doc.paragraphFormatting).toMatchObject({ lineRule, lineSpacing });
  }
  sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('edits shared line spacing in one transaction, preserves direct overrides and unrelated XML, and restores selection on undo', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); select(doc, 'Child follows'); const before = doc.snapshot();
  edit(doc, 'SharedBase', { lineRule: 'exact', lineSpacing: 30.05 });
  expect(doc.paragraphFormatting).toMatchObject({ lineRule: 'exact', lineSpacing: 30.05, spaceBefore: 4, spaceAfter: 8 });
  select(doc, 'Direct minimum'); expect(doc.paragraphFormatting).toMatchObject({ lineRule: 'atLeast', lineSpacing: 18 });
  const bytes = await save(pkg, doc); sameParts(unzipSync(bytes), pkg.parts, ['word/styles.xml', 'word/document.xml']);
  const reopened = model(await DocxPackage.open(bytes)); expect(reopened.paragraphs.map(p => p.format)).toEqual(doc.paragraphs.map(p => p.format)); expect(reopened.text).toBe(doc.text);
  doc.undo(); expect(doc.snapshot()).toEqual(before); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
  expect(doc.editParagraphStyle('SharedBase', {})).toBe(false); expect(doc.future).toHaveLength(1); doc.redo(); expect(doc.styles.definitions.SharedBase.properties.spacing.line).toBe('601');
});

it('removes only a shared style override and continues inheriting future ancestor changes after reopen', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  edit(doc, 'SharedReset', { lineRule: null, lineSpacing: null });
  let reopened = model(await DocxPackage.open(await save(pkg, doc))); select(reopened, 'Reset becomes');
  expect(reopened.paragraphFormatting).toMatchObject({ lineRule: 'exact', lineSpacing: 24 });
  edit(reopened, 'SharedBase', { lineRule: 'atLeast', lineSpacing: 32 }); expect(reopened.paragraphFormatting).toMatchObject({ lineRule: 'atLeast', lineSpacing: 32 });
  expect(reopened.styles.definitions.SharedReset.properties.spacing).toEqual({});
});

it('does not freeze an inherited amount when only a style rule is edited', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  edit(doc, 'SharedChild', { lineRule: 'atLeast' });
  const reopened = model(await DocxPackage.open(await save(pkg, doc)));
  expect(reopened.styles.definitions.SharedChild.properties.spacing).toEqual({ lineRule: 'atLeast' });
  edit(reopened, 'SharedBase', { lineRule: 'exact', lineSpacing: 36 }); select(reopened, 'Child follows');
  expect(reopened.paragraphFormatting).toMatchObject({ lineRule: 'atLeast', lineSpacing: 36 });
});

it('preserves a line-only style and resets a removed local rule to auto regardless of patch key order', async () => {
  for (const patch of [{ lineSpacing: 1.333, lineRule: null }, { lineRule: null, lineSpacing: 1.333 }]) {
    const pkg = await DocxPackage.open(source), doc = model(pkg); edit(doc, 'SharedBase', patch);
    const bytes = await save(pkg, doc), reopened = model(await DocxPackage.open(bytes));
    const xml = new DOMParser().parseFromString(strFromU8(unzipSync(bytes)['word/styles.xml']), 'application/xml');
    const style = [...xml.getElementsByTagNameNS(W, 'style')].find(n => n.getAttributeNS(W, 'styleId') === 'SharedBase');
    const spacing = style.getElementsByTagNameNS(W, 'spacing')[0];
    expect(spacing.getAttributeNS(W, 'line')).toBe('320'); expect(spacing.hasAttributeNS(W, 'lineRule')).toBe(false);
    select(reopened, 'Child follows'); expect(reopened.paragraphFormatting).toMatchObject({ lineRule: 'auto', lineSpacing: 320 / 240 });
  }
});

it('can remove only a style amount while retaining its rule and inherited raw amount across saves', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  edit(doc, 'SharedReset', { lineSpacing: null, lineRule: 'atLeast' });
  const reopened = model(await DocxPackage.open(await save(pkg, doc)));
  expect(reopened.styles.definitions.SharedReset.properties.spacing).toEqual({ lineRule: 'atLeast' });
  select(reopened, 'Reset becomes'); expect(reopened.paragraphFormatting).toMatchObject({ lineRule: 'atLeast', lineSpacing: 24 });
});

it('reflows shared body and table paragraphs with caret, selection and repeated-header geometry', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); select(doc, 'Child follows'); const before = layout(doc);
  edit(doc, 'SharedBase', { lineRule: 'atLeast', lineSpacing: 42 }); const after = layout(doc); expect(after.pageCount).toBeGreaterThan(before.pageCount);
  const line = after.lines.find(l => l.start === doc.range[0]), caret = caretRect(after, doc.range[0]);
  expect(line.height).toBeCloseTo(56); expect(hitTest(after, caret.page, caret.x, caret.y + caret.height / 2)).toBe(doc.range[0]);
  const selection = selectionRects(after, ...doc.range)[0];
  expect(selection.height).toBe(line.height); expect(caret.y).toBeGreaterThanOrEqual(selection.y); expect(caret.y + caret.height).toBeLessThanOrEqual(selection.y + selection.height);
  select(doc, 'Shared header'); const repeated = after.repeatedLines.find(l => l.start === doc.range[0]);
  expect(repeated.height).toBeCloseTo(56); expect(hitTest(after, repeated.page, repeated.stops[0].x, repeated.y + repeated.height / 2)).toBe(repeated.start);
  doc.undo(); expect(layout(doc)).toEqual(before);
});

it('keeps shared spacing through Unicode paragraph splits, merges and empty paragraphs', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); select(doc, 'Child follows');
  edit(doc, 'SharedBase', { lineRule: 'atLeast', lineSpacing: 32 }); doc.select(doc.range[0]); doc.replace('Á😀\n');
  expect(doc.selectedParagraphs[0].format.lineSpacing).toBe(32); doc.delete(-1); expect(doc.text).toContain('Á😀Child follows');
  const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(reopened.text).toBe(doc.text);
  expect(reopened.paragraphs.find(p => !p.runs.length || p.runs.every(r => !r.text)).format.lineSpacing).toBe(32);
});

it.each([{ lineRule: 'bad' }, { lineRule: undefined }, { lineRule: 'auto', lineSpacing: 6 }, { lineRule: 'exact', lineSpacing: -1 }, { lineRule: 'exact', lineSpacing: 18.01 }, { lineSpacing: NaN }, { lineSpacing: -1 }])('rejects invalid style spacing atomically: %j', async patch => {
  const doc = model(await DocxPackage.open(source)), before = doc.snapshot(); expect(() => edit(doc, 'SharedBase', patch)).toThrow(/spacing|lines/); expect(doc.snapshot()).toEqual(before); expect(doc.history).toHaveLength(0);
});
