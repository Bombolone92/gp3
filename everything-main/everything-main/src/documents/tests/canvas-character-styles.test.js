import { beforeAll, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage, createDocx, W } from '../src/engine/docx.js';
import { TextDocument, paragraph, paragraphText } from '../src/engine/model.js';
import { layoutDocument, caretRect, hitTest } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';

beforeAll(() => { const window = new JSDOM('').window; globalThis.DOMParser = window.DOMParser; globalThis.XMLSerializer = window.XMLSerializer; });
const fixture = () => DocxPackage.open(readFileSync('public/fixtures/character-styles.docx'));
const model = pkg => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles);
const save = async (pkg, doc) => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles).arrayBuffer());
const position = (doc, i) => doc.paragraphs.slice(0, i).reduce((n, p) => n + paragraphText(p).length + 1, 0);
const base = 'CanvasCharacterBase', child = 'CanvasCharacterChild', grand = 'CanvasCharacterGrandchild';
const nodes = (xml, name) => [...xml.getElementsByTagNameNS(W, name)];
const parse = bytes => new DOMParser().parseFromString(strFromU8(bytes), 'application/xml');
const layout = doc => layoutDocument(doc.paragraphs, (text, style) => ({ width: text.length * style.fontSize * .6, ascent: style.fontSize, descent: style.fontSize / 4 }), pageGeometry(doc.pageSettings), doc.numbering);
const sameParts = (actual, expected) => { expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort()); for (const name of Object.keys(expected)) expect(Buffer.from(actual[name]).equals(Buffer.from(expected[name])), name).toBe(true); };
async function rewrite(pkg, transform) {
  const parts = { ...pkg.parts }, doc = parse(parts['word/document.xml']), styles = parse(parts['word/styles.xml']);
  transform(doc, styles);
  parts['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(doc)); parts['word/styles.xml'] = strToU8(new XMLSerializer().serializeToString(styles));
  return DocxPackage.open(zipSync(parts));
}

describe('character styles across editing and DOCX', () => {
  it('imports run and paragraph-mark references and keeps all original package bytes', async () => {
    const pkg = await fixture(), doc = model(pkg);
    expect(doc.paragraphs[0].runs.map(r => [r.styleId, r.fontSize, r.bold, r.italic])).toEqual([[undefined, 12, false, false], [base, 14, false, true], [child, 14, true, false], [child, 22, false, true]]);
    expect(doc.paragraphs[1].runs[1]).toMatchObject({ bold: false, italic: true, fontSize: 14 });
    expect(doc.paragraphs[3]).toMatchObject({ markStyleId: grand, markFormat: { fontSize: 14, bold: true, underline: true } });
    sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
    expect(doc.characterStyles.find(s => s.id === 'CanvasDecorative').error).toBeUndefined();
    doc.select(0, 5); doc.setCharacterStyle('CanvasDecorative'); expect(doc.paragraphs[0].runs[0].underlineStyle).toBe('double');
    doc.undo(); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
  });
  it('applies a character style to a backward partial selection and preserves direct overrides and undo', async () => {
    const pkg = await fixture(), doc = model(pkg); doc.select(19, 2); const before = doc.snapshot();
    expect(doc.characterStyle).toBeNull(); doc.setCharacterStyle(grand);
    expect(doc.selection).toEqual(before.selection); expect(doc.text).toBe('Plain base child direct\nParagraph inherited child\nClear this style\n\n' + 'Styled text across pages. '.repeat(25) + '\nStyled bullet item\nÁ😀 symbol');
    expect(doc.paragraphs[0].runs[0].text).toBe('Pl');
    const direct = doc.paragraphs[0].runs.find(r => r.text === ' di'); expect(direct).toMatchObject({ styleId: grand, fontSize: 22, bold: false, italic: true, underline: true });
    const out = await DocxPackage.open(await save(pkg, doc));
    expect(out.paragraphs[0].runs.map(r => [r.text, r.styleId, r.fontSize, r.bold, r.italic])).toEqual(doc.paragraphs[0].runs.map(r => [r.text, r.styleId, r.fontSize, r.bold, r.italic]));
    expect(out.parts['word/styles.xml']).toEqual(pkg.parts['word/styles.xml']); expect(out.parts['word/numbering.xml']).toEqual(pkg.parts['word/numbering.xml']);
    const first = nodes(parse(out.parts['word/document.xml']), 'r').find(r => nodes(r, 't')[0]?.textContent === 'ain ');
    expect(nodes(first, 'rStyle')[0].getAttributeNS(W, 'val')).toBe(grand); expect(nodes(first, 'sz')).toHaveLength(0);
    doc.undo(); expect(doc.selection).toEqual(before.selection); sameParts(unzipSync(await save(pkg, doc)), pkg.parts); doc.redo(); expect(doc.characterStyle).toBe(grand);
  });
  it('removes only the character-style reference and keeps direct run formatting', async () => {
    const pkg = await fixture(), doc = model(pkg); doc.select(16, 23); doc.setCharacterStyle('');
    expect(doc.paragraphs[0].runs.at(-1)).toMatchObject({ styleId: null, fontSize: 22, bold: false, italic: true, underline: false });
    const out = await DocxPackage.open(await save(pkg, doc)), xml = parse(out.parts['word/document.xml']);
    const direct = nodes(xml, 'r').find(r => nodes(r, 't')[0]?.textContent === ' direct');
    expect(nodes(direct, 'rStyle')).toHaveLength(0); expect(nodes(direct, 'sz')[0].getAttributeNS(W, 'val')).toBe('44');
    doc.undo(); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
  });
  it('edits a shared base, recomputes descendants and marks, and retains paragraph and direct overrides', async () => {
    const pkg = await fixture(), doc = model(pkg), before = doc.snapshot();
    doc.editCharacterStyle(base, { run: { fontSize: 18, italic: null }, name: 'Renamed character base' });
    expect(doc.paragraphs[0].runs[1]).toMatchObject({ fontSize: 18, italic: false });
    expect(doc.paragraphs[0].runs[2]).toMatchObject({ fontSize: 18, bold: true, italic: false });
    expect(doc.paragraphs[0].runs[3]).toMatchObject({ fontSize: 22, bold: false, italic: true });
    expect(doc.paragraphs[1].runs[1]).toMatchObject({ fontSize: 18, bold: false, italic: true });
    expect(doc.paragraphs[3].markFormat.fontSize).toBe(18);
    const out = model(await DocxPackage.open(await save(pkg, doc)));
    expect(out.paragraphs.map(p => p.markFormat)).toEqual(doc.paragraphs.map(p => p.markFormat)); expect(out.styles.definitions[child].basedOn).toBe(base);
    doc.undo(); expect(doc.paragraphs).toEqual(before.paragraphs); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
  });
  it('keeps a collapsed style choice pending, types with it, and restores pending state with undo', async () => {
    const pkg = await fixture(), doc = model(pkg); doc.select(12);
    expect(doc.setCharacterStyle(base)).toBe(false); expect(doc.history).toHaveLength(0); expect(doc.characterStyle).toBe(base); expect(doc.runFormatting).toMatchObject({ fontSize: 14, bold: false, italic: true });
    sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
    doc.replace('X'); expect(doc.paragraphs[0].runs.find(r => r.text === 'X')).toMatchObject({ styleId: base, italic: true, bold: false });
    const out = await DocxPackage.open(await save(pkg, doc)); expect(out.paragraphs[0].runs.find(r => r.text === 'X').styleId).toBe(base);
    doc.undo(); expect(doc.characterStyle).toBe(base); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
    doc.select(12); expect(doc.characterStyle).toBe(child); doc.setCharacterStyle(''); doc.setRunFormat({ fontSize: 16 }); doc.replace('Y');
    expect(doc.paragraphs[0].runs.find(r => r.text === 'Y')).toMatchObject({ styleId: null, fontSize: 16, italic: false, bold: false });
  });
  it('uses the first selected character when replacing styled text at a run boundary', async () => {
    const pkg = await fixture(), doc = model(pkg); doc.select(6, 10); doc.setCharacterStyle(grand);
    doc.replace('replacement'); expect(doc.paragraphs[0].runs.find(r => r.text === 'replacement')).toMatchObject({ styleId: grand, bold: true, underline: true });
    expect(model(await DocxPackage.open(await save(pkg, doc))).paragraphs[0].runs.find(r => r.text === 'replacement').styleId).toBe(grand);
    doc.undo(); expect(doc.selection).toEqual({ anchor: 6, focus: 10 }); expect(doc.characterStyle).toBe(grand);
  });
  it('persists styles on an empty paragraph, continues them with Enter, and updates them after reopening', async () => {
    const pkg = createDocx([paragraph()]), doc = model(pkg);
    doc.setCharacterStyle('Emphasis'); expect(doc.paragraphs[0].markFormat.italic).toBe(true); expect(doc.history).toHaveLength(1);
    const bytes = await save(pkg, doc), out = await DocxPackage.open(bytes), reopened = model(out);
    expect(reopened.characterStyle).toBe('Emphasis'); reopened.editCharacterStyle('Emphasis', { run: { fontSize: 19 } });
    expect(reopened.paragraphs[0].markFormat.fontSize).toBe(19); reopened.replace('First'); reopened.insertParagraph();
    expect(reopened.characterStyle).toBe('Emphasis'); reopened.replace('Second\vline\fpage');
    const again = model(await DocxPackage.open(await save(out, reopened))); expect(again.paragraphs.every(p => p.markStyleId === 'Emphasis')).toBe(true);
    expect(again.paragraphs.flatMap(p => p.runs).every(r => r.styleId === 'Emphasis' && r.fontSize === 19)).toBe(true);
    expect(nodes(parse(unzipSync(await save(out, reopened))['word/document.xml']), 'sz')).toHaveLength(0);
  });
  it('formats selected paragraph marks without touching the next paragraph and respects grapheme boundaries', async () => {
    const doc = model(await fixture()); doc.select(position(doc, 2), position(doc, 4)); doc.setCharacterStyle(base);
    expect(doc.paragraphs[2].markStyleId).toBe(base); expect(doc.paragraphs[3].markStyleId).toBe(base); expect(doc.paragraphs[4].markStyleId).toBeUndefined();
    const start = position(doc, 6); doc.select(start + 1, start + 3); expect(doc.range).toEqual([start + 2, start + 4]);
    doc.setCharacterStyle(grand); expect(doc.paragraphs[6].runs.map(r => r.text)).toEqual(['Á', '😀', ' symbol']); expect(doc.paragraphs[6].runs[1].styleId).toBe(grand);
  });
  it('creates and applies a custom character style atomically, edits it, and keeps stable IDs through round trip', async () => {
    const pkg = createDocx([paragraph('Custom style text')]), doc = model(pkg); doc.select(0, 6);
    doc.createCharacterStyle('Review text', 'Emphasis'); const id = doc.characterStyle;
    expect(doc.history).toHaveLength(1); expect(doc.paragraphs[0].runs[0]).toMatchObject({ styleId: id, italic: true });
    doc.editCharacterStyle(id, { run: { fontSize: 17, underline: true } });
    const out = model(await DocxPackage.open(await save(pkg, doc))); expect(out.styles.definitions[id]).toMatchObject({ name: 'Review text', basedOn: 'Emphasis', type: 'character' });
    expect(out.paragraphs[0].runs[0]).toMatchObject({ fontSize: 17, underline: true, italic: true });
    doc.undo(); doc.undo(); expect(doc.styles.definitions[id]).toBeUndefined(); expect(doc.characterStyle).toBe('');
    doc.redo(); expect(doc.styles.definitions[id]).toBeDefined();
  });
  it('repaginates through shared character size changes and restores selection and geometry with undo', async () => {
    const doc = model(await fixture()), before = layout(doc); doc.select(doc.text.length, 3); const selection = { ...doc.selection };
    doc.editCharacterStyle(base, { run: { fontSize: 28 } }); const result = layout(doc); expect(result.pageCount).toBeGreaterThan(before.pageCount); expect(doc.selection).toEqual(selection);
    for (const line of result.lines) { const caret = caretRect(result, line.start); expect(hitTest(result, caret.page, caret.x, caret.y + 2)).toBe(line.start); }
    doc.undo(); expect(layout(doc)).toEqual(before);
  });
  it('rejects invalid choices, unsupported formats and cycles without changing document state', async () => {
    const pkg = await rewrite(await fixture(), (xml, styles) => { const def = nodes(styles, 'style').find(n => n.getAttributeNS(W, 'styleId') === 'CanvasDecorative'); nodes(def, 'u')[0].setAttributeNS(W, 'w:val', 'zigzag'); });
    const doc = model(pkg), before = doc.snapshot();
    for (const change of [() => doc.setCharacterStyle('CanvasDecorative'), () => doc.setCharacterStyle('CanvasParagraph'), () => doc.editCharacterStyle(base, { basedOn: grand }), () => doc.editCharacterStyle(base, { basedOn: 'CanvasParagraph' }), () => doc.editCharacterStyle(base, { run: { fontSize: 1638.5 } }), () => doc.editCharacterStyle(base, { paragraph: { keepNext: true } })]) expect(change).toThrow();
    expect(doc.snapshot()).toEqual(before); expect(doc.history).toHaveLength(0);
    expect(doc.editCharacterStyle(base, { run: {} })).toBe(false);
  });
  it('applies character defaults to ordinary runs and marks, but ignores missing or wrong-type explicit references', async () => {
    const pkg = await rewrite(await fixture(), (xml, styles) => {
      const def = nodes(styles, 'style').find(n => n.getAttributeNS(W, 'styleId') === base); def.setAttributeNS(W, 'w:default', '1');
      const ref = nodes(xml, 'rStyle').find(n => n.getAttributeNS(W, 'val') === child); ref.setAttributeNS(W, 'w:val', 'MissingCharacter');
    });
    const doc = model(pkg); expect(doc.paragraphs[0].runs[0]).toMatchObject({ fontSize: 14, italic: true }); expect(doc.paragraphs[0].markFormat.italic).toBe(true);
    expect(doc.paragraphs[0].runs[2]).toMatchObject({ fontSize: 12, italic: false });
    doc.select(10, 16); doc.setCharacterStyle(''); expect(doc.paragraphs[0].runs[2]).toMatchObject({ fontSize: 14, italic: true });
    expect(model(await DocxPackage.open(await save(pkg, doc))).paragraphs[0].runs[2].italic).toBe(true);
  });
  it('ignores nested rStyle in a character definition and rejects duplicate references in document runs and marks', async () => {
    const pkg = await fixture();
    const opened = await rewrite(pkg, (xml, styles) => {
      const def = nodes(styles, 'style').find(n => n.getAttributeNS(W, 'styleId') === base), ref = styles.createElementNS(W, 'w:rStyle'); ref.setAttributeNS(W, 'w:val', grand); nodes(def, 'rPr')[0].prepend(ref);
    });
    expect(opened.paragraphs[0].runs[1].bold).toBe(false);
    for (const mark of [false, true]) await expect(rewrite(pkg, xml => {
      const ref = nodes(xml, 'rStyle').find(n => (n.parentNode.parentNode.localName === 'pPr') === mark); ref.after(ref.cloneNode(true));
    })).rejects.toThrow(/duplicate character/);
  });
});
