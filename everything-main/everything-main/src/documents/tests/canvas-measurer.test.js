// @vitest-environment jsdom
import { afterEach, it, expect, vi } from 'vitest';
import { TextDocument, paragraph } from '../src/engine/model.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { createCanvasMeasurer } from '../src/engine/canvas-measurer.js';
import { CanvasEditor } from '../src/engine/canvas-editor.js';

// A canvas context whose text advances are fixed, recording every text it is asked to measure.
function countingContext() {
  const measured = [];
  const context = {
    fontKerning: 'auto', getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    measureText: text => { measured.push(text); return { width: [...text].length * 8 }; },
    setTransform() {}, fillRect() {}, fillText() {}, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, moveTo() {}, lineTo() {}, stroke() {}, setLineDash() {},
  };
  return { context, measured };
}
const sentence = i => `Paragraph ${i} keeps its words, wrapping across the width of the page more than once in a while.`;
const lay = (doc, measure) => { measure.paragraphCache().nextGeneration(); return layoutDocument(doc.paragraphs, measure, pageGeometry(doc.pageSettings), doc.numbering, doc.tables); };
const plain = layout => JSON.parse(JSON.stringify({ lines: layout.lines, pages: layout.pages, pageCount: layout.pageCount }));

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

it('keeps measured paragraphs when one layout measures more texts than its text memory holds', () => {
  // Each line is measured prefix by prefix, so a long document passes a small limit within one layout.
  const doc = new TextDocument(Array.from({ length: 40 }, (_, i) => paragraph(sentence(i))));
  const { context, measured } = countingContext();
  const measure = createCanvasMeasurer(context, { limit: 200 });
  const first = lay(doc, measure);
  expect(measured.length).toBeGreaterThan(200);
  expect(measure.paragraphCache().entries.size).toBe(40);
  doc.select(5); doc.replace('typed ');
  measured.length = 0;
  const edited = lay(doc, measure);
  // Only the edited paragraph is measured again.
  expect(measured.length).toBeGreaterThan(0);
  expect(measured.every(text => !text.includes('Paragraph 1 ') && !text.includes('Paragraph 39'))).toBe(true);
  expect(edited.lines.length).toBe(first.lines.length);
  expect(plain(edited)).toEqual(plain(lay(doc, createCanvasMeasurer(countingContext().context))));
  // Clearing forgets both memories.
  measure.clear();
  expect(measure.paragraphCache().entries.size).toBe(0);
});

it('an editor handed an opening measurer lays out from its measurements', () => {
  const paragraphs = Array.from({ length: 20 }, (_, i) => paragraph(sentence(i)));
  const { context, measured } = countingContext();
  const measure = createCanvasMeasurer(context);
  lay(new TextDocument(paragraphs), measure);
  measured.length = 0;
  const host = document.createElement('div'); document.body.append(host);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(countingContext().context);
  const editor = new CanvasEditor(host, { paragraphs, measure });
  expect(editor.measure).toBe(measure);
  expect(measured.some(text => text.includes('Paragraph'))).toBe(false);
  // Deferred faces lay the adopting editor out again.
  const relayout = vi.spyOn(editor, 'relayout');
  measure.onFontsReady();
  expect(relayout).toHaveBeenCalledOnce();
  editor.destroy();
});
