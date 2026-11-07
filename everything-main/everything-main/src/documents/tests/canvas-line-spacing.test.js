import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage, createDocx } from '../src/engine/docx.js';
import { TextDocument, paragraph } from '../src/engine/model.js';
import { layoutDocument, caretRect, hitTest, selectionRects } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';

let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/line-spacing.docx');
const model = pkg => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
const save = async (pkg, doc) => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
const setting = (lineRule, lineSpacing) => ({ lineRule, lineSpacing });
const select = (doc, text) => { const at = doc.text.indexOf(text); expect(at).toBeGreaterThanOrEqual(0); doc.select(at, at + text.length); };
const measure = (text, style) => ({ width: [...text].length * style.fontSize * 2 / 3, ascent: style.fontSize, descent: style.fontSize / 3 });
const layout = doc => layoutDocument(doc.paragraphs, measure, pageGeometry(doc.pageSettings), doc.numbering, doc.tables);
function sameParts(a, b, except = []) { expect(Object.keys(a)).toEqual(Object.keys(b)); for (const key of Object.keys(a)) if (!except.includes(key)) expect(Buffer.from(a[key]).equals(Buffer.from(b[key])), key).toBe(true); }
function rewrite(content, path = 'word/document.xml') { const parts = unzipSync(source), xml = strFromU8(parts[path]); expect(xml).toContain('<w:spacing w:line="160" w:lineRule="exact"/>'); parts[path] = strToU8(xml.replace('<w:spacing w:line="160" w:lineRule="exact"/>', content)); return zipSync(parts); }

it('resolves exact/minimum style chains and resets an omitted rule to multiple spacing without changing package bytes', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  for (const [label, rule, value] of [['Inherited exact', 'exact', 24], ['Direct minimum', 'atLeast', 12], ['Omitted rule', 'auto', 1.5], ['Rule only', 'exact', 18], ['Fractional height', 'exact', 18.05]]) {
    select(doc, label); expect(doc.paragraphFormatting).toMatchObject(setting(rule, value));
  }
  sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('uses single spacing when no level of the hierarchy supplies a line value, even with a stored rule', async () => {
  const parts = unzipSync(source);
  for (const path of ['word/document.xml', 'word/styles.xml']) parts[path] = strToU8(strFromU8(parts[path]).replace(/ w:line="[^"]*"/g, ''));
  const doc = model(await DocxPackage.open(zipSync(parts))); expect(doc.paragraphs.every(p => p.format.lineRule === 'auto' && p.format.lineSpacing === 1)).toBe(true);
});

it('edits exact, minimum and custom multiples, retains other spacing, and restores selection and bytes through undo', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); select(doc, 'Inherited exact'); const before = doc.snapshot();
  doc.setParagraphLineSpacing(setting('exact', 30)); select(doc, 'Direct minimum'); doc.setParagraphLineSpacing(null);
  expect(doc.paragraphFormatting).toMatchObject({ ...setting('exact', 24), spaceBefore: 4, spaceAfter: 8 });
  select(doc, 'Omitted rule'); doc.setParagraphLineSpacing(setting('auto', 1.333)); expect(doc.paragraphFormatting.lineSpacing).toBe(320 / 240);
  const bytes = await save(pkg, doc), reopened = model(await DocxPackage.open(bytes)); expect(reopened.paragraphs.map(p => p.format)).toEqual(doc.paragraphs.map(p => p.format));
  expect(reopened.text).toBe(doc.text); sameParts(unzipSync(bytes), pkg.parts, ['word/document.xml']);
  doc.undo(); doc.undo(); doc.undo(); expect(doc.snapshot()).toEqual(before); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
  doc.redo(); doc.redo(); doc.redo(); expect(doc.paragraphFormatting.lineSpacing).toBe(320 / 240);
});

it('keeps a cleared paragraph responsive to ancestor edits and preserves direct overrides and redo no-ops', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); select(doc, 'Direct minimum'); doc.setParagraphLineSpacing(null);
  doc.editParagraphStyle('CanvasLineBase', { paragraph: setting('exact', 28) }); expect(doc.paragraphFormatting).toMatchObject(setting('exact', 28));
  select(doc, 'Inherited exact'); doc.setParagraphLineSpacing(setting('atLeast', 20)); doc.editParagraphStyle('CanvasLineBase', { paragraph: setting('exact', 32) }); expect(doc.paragraphFormatting).toMatchObject(setting('atLeast', 20));
  doc.undo(); const before = doc.snapshot(); expect(doc.setParagraphLineSpacing(setting('atLeast', 20))).toBe(false); expect(doc.future).toHaveLength(1); expect(doc.snapshot()).toEqual(before);
  doc.redo(); const reopened = model(await DocxPackage.open(await save(pkg, doc))); select(reopened, 'Direct minimum'); expect(reopened.paragraphFormatting).toMatchObject(setting('exact', 32));
});

it('applies mixed selections without including a paragraph at the trailing selection boundary', async () => {
  const doc = model(await DocxPackage.open(source)); doc.select(doc.text.indexOf('Inherited exact'), doc.text.indexOf('Omitted rule'));
  expect(doc.paragraphFormatting.lineRule).toBeNull(); doc.setParagraphLineSpacing(setting('atLeast', 30)); expect(doc.selectedParagraphs).toHaveLength(2); expect(doc.selectedParagraphs.every(p => p.format.lineSpacing === 30)).toBe(true);
  select(doc, 'Omitted rule'); expect(doc.paragraphFormatting).toMatchObject(setting('auto', 1.5));
});

it('keeps exact baselines, clipping, carets, selection and pointer positions on the same lines', async () => {
  const doc = model(await DocxPackage.open(source)); select(doc, 'Clipped exact'); const before = layout(doc), clipped = before.lines.find(l => l.start === doc.range[0]);
  expect(clipped.clip).toBe(true); expect(clipped.height).toBeCloseTo(8 * 4 / 3); expect(clipped.baseline).toBeCloseTo(clipped.y + clipped.height * .8);
  const caret = caretRect(before, doc.range[0]); expect(caret.height).toBeCloseTo(clipped.height); expect(selectionRects(before, ...doc.range)[0].height).toBeCloseTo(clipped.height);
  expect(hitTest(before, caret.page, caret.x, caret.y + caret.height / 2)).toBe(doc.range[0]);
  doc.setParagraphLineSpacing(setting('atLeast', 10)); const after = layout(doc), expanded = after.lines.find(l => l.start === doc.range[0]); expect(expanded.height).toBeGreaterThan(clipped.height); expect(expanded.clip).toBe(false); doc.undo(); expect(layout(doc)).toEqual(before);
  select(doc, 'Inherited exact'); const old = caretRect(layout(doc), doc.range[0]); doc.setParagraphLineSpacing(setting('exact', 30)); const next = caretRect(layout(doc), doc.range[0]); expect(next.height).toBe(old.height); expect(next.y - old.y).toBeCloseTo(6.4);
});

it('repaginates flowing cells and repeated headers while retaining source positions', async () => {
  const doc = model(await DocxPackage.open(source)); select(doc, 'Flowing text.'); const before = layout(doc), original = doc.text;
  doc.setParagraphLineSpacing(setting('atLeast', 42)); const after = layout(doc); expect(after.pageCount).toBeGreaterThan(before.pageCount); expect(doc.text).toBe(original); doc.undo(); expect(layout(doc)).toEqual(before);
  select(doc, 'Header spacing'); doc.setParagraphLineSpacing(setting('atLeast', 28)); const result = layout(doc), header = result.repeatedLines.find(l => l.start === doc.range[0]); expect(header.height).toBeCloseTo(28 * 4 / 3); expect(hitTest(result, header.page, header.stops[0].x, header.y + header.height / 2)).toBe(header.start);
});

it('uses the authored spacing for inline pictures and restores natural image height with minimum spacing', async () => {
  const doc = model(await DocxPackage.open(readFileSync('public/fixtures/inline-images.docx'))), p = doc.paragraphs.find(p => p.runs.some(r => r.image)); doc.select(doc.paragraphOffset(doc.paragraphs.indexOf(p)));
  doc.setParagraphLineSpacing(setting('exact', 12)); const exact = layout(doc).lines.find(l => l.paragraphId === p.id && l.fragments.some(f => f.image)); expect(exact.height).toBe(16); expect(exact.clip).toBe(true);
  doc.setParagraphLineSpacing(setting('atLeast', 12)); const minimum = layout(doc).lines.find(l => l.paragraphId === p.id && l.fragments.some(f => f.image)); expect(minimum.height).toBeGreaterThan(exact.height); expect(minimum.fragments.find(f => f.image).image).toEqual(exact.fragments.find(f => f.image).image);
  for (const [rule, value] of [['atLeast', 1], ['exact', 0]]) {
    doc.setParagraphLineSpacing(setting(rule, value));
    const natural = layout(doc).lines.find(l => l.paragraphId === p.id && l.fragments.some(f => f.image));
    expect(natural.height).toBe(minimum.height); expect(natural.clip).toBe(false);
  }
});

it('retains point spacing and inherited resets through paragraph splitting, merging and new-document export', async () => {
  const pkg = createDocx(), doc = model(pkg); doc.replace('First Á😀'); doc.setParagraphLineSpacing(setting('exact', 24.05)); doc.replace('\nSecond'); expect(doc.paragraphs.every(p => p.format.lineSpacing === 24.05)).toBe(true);
  doc.select(doc.paragraphOffset(1)); doc.delete(-1); expect(doc.paragraphs).toHaveLength(1); doc.undo(); doc.setParagraphLineSpacing(null); doc.replace('\nThird');
  expect(doc.paragraphs.slice(1).every(p => p.format.lineRule === 'auto' && p.format.lineSpacing === 1)).toBe(true);
  const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(reopened.paragraphs.map(p => p.format)).toEqual(doc.paragraphs.map(p => p.format)); expect(reopened.text).toBe(doc.text);
});

it.each(['w:line="-1"', 'w:line="1.5"', 'w:line=""', 'w:line="NaN"', 'w:line="18pt"', 'w:lineRule=""', 'w:lineRule="unknown"', 'w:line="240" w:unexpected="1"'])('rejects unsupported line-spacing declarations before editing: %s', async attrs => {
  await expect(DocxPackage.open(rewrite(`<w:spacing ${attrs}/>`))).rejects.toThrow(/spacing/);
});
it.each(['<w:spacing/><w:spacing/>', '<w:spacing><w:line/></w:spacing>', '<w:spacing>text</w:spacing>', '<w:spacing><![CDATA[text]]></w:spacing>'])('rejects duplicate or nested spacing markup: %s', async content => {
  await expect(DocxPackage.open(rewrite(content))).rejects.toThrow(/spacing/);
});
it.each(['suppressTopSpacing', 'suppressBottomSpacing', 'suppressSpacingAtTopOfPage'])('rejects active unsupported page-edge spacing compatibility: %s', async name => {
  const parts = unzipSync(source), xml = strFromU8(parts['word/settings.xml']); parts['word/settings.xml'] = strToU8(xml.replace('<w:compat>', `<w:compat><w:${name}/>`)); await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/line-spacing compatibility/);
  parts['word/settings.xml'] = strToU8(xml.replace('<w:compat>', `<w:compat><w:${name} w:val="0"/>`)); await expect(DocxPackage.open(zipSync(parts))).resolves.toBeDefined();
});
it.each([{}, setting('bad', 1), setting('auto', -1), setting('auto', 6), setting('exact', -1), setting('atLeast', 601), setting('exact', 18.01), setting('exact', NaN)])('rejects invalid editing without changing history: %j', value => {
  const doc = new TextDocument([paragraph('Text')]), before = doc.snapshot(); expect(() => doc.setParagraphLineSpacing(value)).toThrow(); expect(doc.snapshot()).toEqual(before); expect(doc.history).toHaveLength(0);
});


it.each([.5,.75,1,250/240,1.5,2])('retains line advances and aligns automatic baselines at %s lines', multiple => {
  const p=paragraph('Alpha\vBeta'); p.format={...p.format,lineRule:'auto',lineSpacing:multiple};
  const doc=new TextDocument([p]),result=layout(doc),[a,b]=result.lines;
  const ascent=12,descent=4,advance=16*multiple;
  expect(a.height).toBeCloseTo(advance);expect(b.baseline-a.baseline).toBeCloseTo(advance);
  expect(a.baseline-a.y).toBeCloseTo(multiple<1?ascent*multiple:ascent);
  const caret=caretRect(result,0);expect(caret.y).toBeCloseTo(a.baseline-ascent);expect(caret.height).toBeCloseTo(ascent+descent);
  expect(hitTest(result,0,a.stops[0].x,a.y+Math.min(a.height/2,1))).toBe(0);
});
