import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { createDocx, DocxPackage, W } from '../src/engine/docx.js';
import { TextDocument, paragraph, paragraphFormat, PAGINATION_DEFAULTS } from '../src/engine/model.js';
import { layoutDocument, caretRect, hitTest, selectionRects } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';

let dom;
beforeAll(() => {
  dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer;
});
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const measure = (text, style) => ({ width: text.length * 8, ascent: 15 * style.fontSize / 12, descent: 5 * style.fontSize / 12 });
const page = { width: 240, height: 140, margin: 20 }; // five ordinary lines
const p = (count, format = {}) => paragraph(Array.from({ length: count }, (_, i) => `Line ${i + 1}`).join('\v'), { format: { spaceAfter: 0, ...format } });
const layout = paragraphs => layoutDocument(paragraphs, measure, page);
const pages = (result, para) => result.lines.filter(l => l.paragraphId === para.id).map(l => l.page);
const bytes = async blob => new Uint8Array(await blob.arrayBuffer());
const exported = async (pkg, doc) => bytes(pkg.export(doc.paragraphs, doc.pageSettings));
const flags = para => Object.fromEntries(Object.keys(PAGINATION_DEFAULTS).map(k => [k, paragraphFormat(para)[k]]));

async function fixture(styles, body) {
  const parts = unzipSync(await bytes(createDocx().export()));
  parts['word/styles.xml'] = strToU8(`<w:styles xmlns:w="${W}">${styles}</w:styles>`);
  parts['word/document.xml'] = strToU8(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`);
  parts['customXml/item.xml'] = strToU8('<original>Keep these bytes</original>');
  return zipSync(parts);
}

describe('paragraph page placement', () => {
  it('moves fitting and oversized keepLines paragraphs to a fresh page, without leading blank pages', () => {
    for (const count of [3, 8]) {
      const ps = [p(4), p(count, { keepLines: true })];
      expect(pages(layout(ps), ps[1])).toEqual(count === 3 ? [1, 1, 1] : [1, 1, 1, 1, 1, 2, 2, 2]);
      expect(pages(layout([ps[1]]), ps[1])[0]).toBe(0);
    }
  });
  it('keeps an entire chain, including its final paragraph and collapsed internal spacing, together', () => {
    const ps = [p(3), p(1, { keepNext: true, spaceAfter: 6 }), p(1, { keepNext: true, spaceBefore: 9 }), p(2)];
    const result = layout(ps);
    expect(ps.map(para => pages(result, para))).toEqual([[0, 0, 0], [1], [1], [1, 1]]);
    expect(result.lines[4].y).toBe(52); // 20 + 20 + max(8, 12)
    expect(result.pageCount).toBe(2);
  });
  it('starts an oversized keepNext chain once and allows its suffix to use the same page', () => {
    const ps = [p(1), p(2, { keepNext: true }), p(2, { keepNext: true }), p(2, { widowControl: false })];
    const result = layout(ps);
    expect(ps.map(para => pages(result, para))).toEqual([[0], [1, 1], [1, 1], [1, 2]]);
    expect(layout(ps.slice(1)).pageCount).toBe(2);
    const alone = p(1, { keepNext: true });
    expect(layout([p(4), alone]).pageCount).toBe(1); // no following paragraph
  });
  it('does not keep paragraphs whose effective keepNext/keepLines is false', () => {
    const ps = [p(4), p(1, { keepNext: false }), p(3, { keepLines: false, widowControl: false })];
    expect(ps.map(para => pages(layout(ps), para))).toEqual([[0, 0, 0, 0], [0], [1, 1, 1]]);
    const split = [p(3), p(3, { keepLines: false, widowControl: false })];
    expect(pages(layout(split), split[1])).toEqual([0, 0, 1]);
  });
  it('prevents both first and last singletons, defaults to on, and respects explicit off', () => {
    for (const [filler, count, controlled, uncontrolled] of [[4, 4, [1, 1, 1, 1], [0, 1, 1, 1]], [2, 4, [0, 0, 1, 1], [0, 0, 0, 1]], [3, 3, [1, 1, 1], [0, 0, 1]]]) {
      const ps = [p(filler), p(count)];
      expect(pages(layout(ps), ps[1])).toEqual(controlled);
      ps[1].format.widowControl = false;
      expect(pages(layout(ps), ps[1])).toEqual(uncontrolled);
    }
  });
  it('balances the final page of a long paragraph and tolerates impossible constraints on tiny pages', () => {
    const long = p(11);
    expect(pages(layout([long]), long)).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2]);
    const tiny = layoutDocument([p(3, { keepLines: true, keepNext: true }), p(3)], measure, { ...page, height: 60 });
    expect(tiny.pageCount).toBe(6);
    expect(tiny.lines.every(l => l.y === 20)).toBe(true);
  });
  it('uses measured mixed text heights for the final pair without enlarging text from its paragraph mark', () => {
    const mixed = paragraph('', { runs: [{ text: 'a\vb\vc\v', fontSize: 12 }, { text: 'd', fontSize: 24 }], markFormat: { fontSize: 36 }, format: { spaceAfter: 0 } });
    const result = layout([p(1), mixed]);
    expect(pages(result, mixed)).toEqual([0, 0, 1, 1]);
    expect(result.lines.at(-1).height).toBe(40);
    expect(mixed.markFormat.fontSize).toBe(36);
    expect(result.lines.every(l => l.y + l.height <= 120)).toBe(true);
  });
  it('looks ahead across variable-height pages to avoid an otherwise avoidable final singleton', () => {
    const mixed = paragraph('', { runs: [{ text: 'a\vb\vc\v', fontSize: 12 }, { text: 'd\v', fontSize: 48 }, { text: 'e\vf', fontSize: 12 }], format: { spaceAfter: 0 } });
    expect(pages(layout([mixed]), mixed)).toEqual([0, 0, 1, 1, 2, 2]);
  });
  it('suppresses an excessive initial gap instead of leaving an orphan on an otherwise empty page', () => {
    const para = p(3, { spaceBefore: 60 });
    expect(pages(layout([para]), para)).toEqual([0, 0, 0]);
  });
  it('gives pageBreakBefore precedence over keepNext without moving the preceding chain unnecessarily', () => {
    const ps = [p(2), p(1, { keepNext: true }), p(3, { pageBreakBefore: true })];
    expect(ps.map(para => pages(layout(ps), para))).toEqual([[0, 0], [0], [1, 1, 1]]);
  });
  it('honors manual page breaks within kept paragraphs and then keeps the trailing content with the next', () => {
    const mid = paragraph('Before\fAfter', { format: { keepNext: true, keepLines: true, spaceAfter: 0 } });
    const ps = [p(3), mid, p(4)];
    expect(ps.map(para => pages(layout(ps), para))).toEqual([[0, 0, 0], [0, 1], [1, 1, 1, 1]]);
    const terminal = paragraph('End\f', { format: { keepNext: true, keepLines: true } });
    const result = layout([p(4), terminal, p(1, { pageBreakBefore: true })]);
    expect(result.pageCount).toBe(2);
    expect(result.lines.at(-2)).toMatchObject({ virtual: true, page: 1, y: 20 });
    expect(result.lines.at(-1)).toMatchObject({ page: 1, y: 20 });
    const leading = [p(4), p(1, { keepNext: true }), paragraph('\fNext')];
    expect(pages(layout(leading), leading[1])).toEqual([0]);
    expect(layout(leading).pageCount).toBe(2);
  });
  it('retains before spacing on explicit pages, suppresses it on automatic moves, and ignores trailing after spacing', () => {
    const ps = [p(4), p(2, { keepLines: true, spaceBefore: 15, spaceAfter: 600 })];
    expect(layout(ps).lines[4]).toMatchObject({ page: 1, y: 20 });
    ps[1].format.pageBreakBefore = true;
    expect(layout(ps).lines[4]).toMatchObject({ page: 1, y: 40 });
    expect(layout(ps).pageCount).toBe(2);
    const blank = paragraph('\f', { format: { spaceBefore: 50, keepLines: true } });
    expect(layout([blank, p(1)]).lines.at(-1)).toMatchObject({ page: 1, y: 20 });
  });
  it('keeps empty paragraphs as real lines, moves their caret, and maps a selection across the page boundary', () => {
    const empty = paragraph('', { format: { keepNext: true, spaceAfter: 0 } }), next = p(2);
    const ps = [p(4), empty, next], result = layout(ps);
    expect(pages(result, empty)).toEqual([1]);
    const emptyLine = result.lines.find(l => l.paragraphId === empty.id);
    expect(caretRect(result, emptyLine.start)).toMatchObject({ page: 1, y: 20 });
    expect(hitTest(result, 1, 20, 30)).toBe(emptyLine.start);
    expect(new Set(selectionRects(result, emptyLine.start - 2, emptyLine.start + 2).map(r => r.page))).toEqual(new Set([0, 1]));
    for (const line of result.lines) for (const stop of line.stops) {
      const caret = caretRect(result, stop.offset);
      expect(hitTest(result, caret.page, caret.x, caret.y + 5)).toBe(stop.offset);
    }
  });
  it('keeps soft-wrap affinity after widow-driven movement', () => {
    const ps = [p(4), paragraph('word '.repeat(14), { format: { spaceAfter: 0 } })];
    const result = layout(ps), moved = result.lines.filter(l => l.paragraphId === ps[1].id);
    expect(moved[0].page).toBe(1);
    const boundary = moved[1].start;
    expect(caretRect(result, boundary, 'backward').y).toBe(moved[0].y);
    expect(caretRect(result, boundary, 'forward').y).toBe(moved[1].y);
  });
});

describe('pagination editing and DOCX preservation', () => {
  it('formats mixed selections in one undo step, excludes the next start, and preserves redo for no-ops', () => {
    const doc = new TextDocument([p(4), p(2, { keepLines: true }), p(1)]);
    const secondStart = doc.paragraphs[0].runs[0].text.length + 1;
    const thirdStart = secondStart + doc.paragraphs[1].runs[0].text.length + 1;
    doc.select(0, thirdStart);
    expect(doc.paragraphFormatting.keepLines).toBeNull();
    const before = doc.snapshot(), oldLayout = layout(doc.paragraphs);
    doc.setParagraphFormat({ keepLines: false, keepNext: true, widowControl: false });
    expect(doc.history).toHaveLength(1); expect(doc.selection).toEqual(before.selection);
    expect(flags(doc.paragraphs[2])).toEqual(PAGINATION_DEFAULTS);
    const after = doc.snapshot();
    doc.undo(); expect(doc.snapshot()).toEqual(before); expect(layout(doc.paragraphs)).toEqual(oldLayout);
    expect(doc.setParagraphFormat({ keepNext: false })).toBe(false);
    expect(doc.future).toHaveLength(1); doc.redo(); expect(doc.snapshot()).toEqual(after);
  });
  it.each(['keepNext', 'keepLines', 'widowControl'])('rejects nonboolean %s without edits or undo entries', key => {
    const doc = new TextDocument([p(1)]), old = doc.snapshot();
    expect(() => doc.setParagraphFormat({ [key]: 1 })).toThrow('on or off');
    expect(doc.snapshot()).toEqual(old); expect(doc.history).toHaveLength(0);
  });
  it('inherits each flag through defaults, basedOn and direct values without toggling style booleans', async () => {
    const pkg = await DocxPackage.open(await fixture(
      '<w:docDefaults><w:pPrDefault><w:pPr><w:keepLines/><w:widowControl w:val="off"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:styleId="Base" w:default="1"><w:pPr><w:keepNext w:val="on"/><w:keepLines w:val="0"/></w:pPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Child"><w:basedOn w:val="Base"/><w:pPr><w:keepNext w:val="true"/><w:widowControl w:val="1"/></w:pPr></w:style>',
      '<w:p><w:pPr><w:pStyle w:val="Child"/></w:pPr><w:r><w:t>First</w:t></w:r></w:p><w:p><w:pPr><w:keepNext w:val="false"/><w:keepLines/></w:pPr><w:r><w:t>Second</w:t></w:r></w:p>'));
    expect(pkg.paragraphs.map(flags)).toEqual([
      { keepNext: true, keepLines: false, widowControl: true, pageBreakBefore: false },
      { keepNext: false, keepLines: true, widowControl: false, pageBreakBefore: false },
    ]);
    const doc = new TextDocument(pkg.paragraphs, pkg.pageSettings);
    expect(unzipSync(await exported(pkg, doc))).toEqual(pkg.parts);
    doc.select(0, doc.text.length); doc.setParagraphFormat({ keepNext: false, keepLines: false, widowControl: true });
    doc.select(2); doc.replace('\n'); // Splits carry effective properties and explicit overrides.
    const reopened = await DocxPackage.open(await exported(pkg, doc));
    expect(reopened.paragraphs).toHaveLength(3);
    expect(reopened.paragraphs.map(flags)).toEqual(doc.paragraphs.map(flags));
    const main = new DOMParser().parseFromString(strFromU8(reopened.parts['word/document.xml']), 'application/xml');
    // Enter gives the new left paragraph mark the insertion formatting; the
    // original mark remains on the right (native paragraph-mark-edit controls).
    const firstProperties = [...main.getElementsByTagNameNS(W, 'pPr')][0];
    expect([...firstProperties.children].map(n => n.localName)).toEqual(['pStyle', 'keepNext', 'keepLines', 'widowControl', 'rPr']);
    expect(reopened.paragraphs[0].markFormat).toMatchObject({fontAscii: 'Noto Sans', fontSize: 10});
    expect(main.getElementsByTagNameNS(W, 'keepNext')[0].getAttributeNS(W, 'val')).toBe('0');
    for (const [name, data] of Object.entries(pkg.parts)) if (name !== 'word/document.xml') expect(reopened.parts[name]).toEqual(data);
    doc.delete(-1); expect(doc.paragraphs).toHaveLength(2); expect(flags(doc.paragraphs[0])).toEqual(flags(reopened.paragraphs[0]));
    doc.undo(); doc.redo(); expect(doc.paragraphs).toHaveLength(2);
  });
  it('defaults absent properties correctly and writes the same defaults on fresh documents', async () => {
    const source = await DocxPackage.open(await fixture('', '<w:p/>'));
    expect(flags(source.paragraphs[0])).toEqual(PAGINATION_DEFAULTS);
    const pkg = createDocx([p(1)]), doc = new TextDocument(pkg.paragraphs, pkg.pageSettings);
    expect(flags((await DocxPackage.open(await exported(pkg, doc))).paragraphs[0])).toEqual(PAGINATION_DEFAULTS);
  });
  it('rejects invalid pagination values before opening for edits', async () => {
    await expect(DocxPackage.open(await fixture('', '<w:p><w:pPr><w:keepNext w:val="perhaps"/></w:pPr></w:p>'))).rejects.toThrow('invalid keepNext');
  });
  it('opens the independent fixture, paginates its chain, keepLines and widow, and restores every part on undo', async () => {
    const pkg = await DocxPackage.open(new Uint8Array(readFileSync('public/fixtures/paragraph-pagination.docx')));
    const doc = new TextDocument(pkg.paragraphs, pkg.pageSettings);
    const initial = layoutDocument(doc.paragraphs, measure, pageGeometry(doc.pageSettings));
    expect(initial.pageCount).toBe(4);
    expect(doc.paragraphs.map(para => pages(initial, para))).toEqual([
      Array(10).fill(0), [1], [1], [1, 1, 1], Array(8).fill(2), [2, 2, 2, 3, 3], [3],
    ]);
    doc.select(0, doc.text.length); doc.setParagraphFormat({ keepNext: false, keepLines: false, widowControl: false });
    const reopened = await DocxPackage.open(await exported(pkg, doc));
    expect(reopened.paragraphs.map(flags)).toEqual(doc.paragraphs.map(flags));
    expect(layoutDocument(reopened.paragraphs, measure, pageGeometry(reopened.pageSettings)).pageCount).toBe(3);
    doc.undo();
    const restored = unzipSync(await exported(pkg, doc));
    expect(Object.keys(restored)).toEqual(Object.keys(pkg.parts));
    for (const [name, data] of Object.entries(pkg.parts)) expect(Buffer.from(restored[name]).equals(Buffer.from(data)), name).toBe(true);
  });
});
